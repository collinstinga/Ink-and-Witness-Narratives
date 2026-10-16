import crypto from 'crypto';
import type { Transaction } from 'firebase-admin/firestore';

import type {
  PaymentTransaction,
  ReaderSubscription,
  ReaderSubscriptionSummary,
  SubscriptionPlan,
  SubscriptionPurchaseSnapshot,
} from '../types.js';
import { getDb, sanitizeForFirestore } from './db.js';
import {
  DEFAULT_SUBSCRIPTION_PLANS,
  SubscriptionValidationError,
  calculateSubscriptionRenewalWindow,
  createSubscriptionPurchaseSnapshot,
  getReaderSubscriptionId,
  normalizeSubscriptionPlan,
  toPublicSubscriptionPlan,
  validateSubscriptionPurchaseSnapshot,
} from './subscriptionSecurity.js';

export const SUBSCRIPTION_PLAN_COLLECTION = 'subscription_plans';
export const READER_SUBSCRIPTION_COLLECTION = 'reader_subscriptions';
export const SUBSCRIPTION_ACTIVATION_COLLECTION = 'subscription_activations';

const MAX_PLAN_RESULTS = 24;
const SUBSCRIPTION_PLAN_CATALOG_DOCUMENT = 'subscription_plan_catalog';
const SUBSCRIPTION_PLAN_CATALOG_VERSION = 1;
let defaultPlansPromise: Promise<void> | null = null;

export class SubscriptionPlanConflictError extends Error {
  readonly statusCode = 409;

  constructor() {
    super('This Reader Pass changed in another Writer Studio session. Reload it before saving again.');
    this.name = 'SubscriptionPlanConflictError';
  }
}

function canonicalTimestamp(value: unknown, fallback: string): string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : fallback;
}

function normalizeStoredPlan(id: string, value: unknown): SubscriptionPlan | null {
  if (!value || typeof value !== 'object') return null;
  try {
    const normalized = normalizeSubscriptionPlan({
      ...(value as Record<string, unknown>),
      id,
    });
    return normalized as SubscriptionPlan;
  } catch {
    return null;
  }
}

function sortPlans(plans: SubscriptionPlan[]): SubscriptionPlan[] {
  return [...plans].sort((left, right) => left.order - right.order || left.name.localeCompare(right.name));
}

function normalizePlanCatalog(value: unknown): SubscriptionPlan[] | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as { schemaVersion?: unknown; plans?: unknown };
  if (input.schemaVersion !== SUBSCRIPTION_PLAN_CATALOG_VERSION || !Array.isArray(input.plans)) return null;
  if (input.plans.length < 1 || input.plans.length > MAX_PLAN_RESULTS) return null;

  const plans: SubscriptionPlan[] = [];
  const seen = new Set<string>();
  for (const candidate of input.plans) {
    if (!candidate || typeof candidate !== 'object' || typeof (candidate as { id?: unknown }).id !== 'string') {
      return null;
    }
    const id = (candidate as { id: string }).id;
    const plan = normalizeStoredPlan(id, candidate);
    if (!plan || seen.has(plan.id)) return null;
    seen.add(plan.id);
    plans.push(plan);
  }
  return sortPlans(plans);
}

function planCatalogRecord(plans: SubscriptionPlan[], updatedAt: string) {
  return sanitizeForFirestore({
    schemaVersion: SUBSCRIPTION_PLAN_CATALOG_VERSION,
    revision: crypto.randomUUID(),
    plans: sortPlans(plans),
    updatedAt,
  });
}

function normalizeStoredSubscription(value: unknown): ReaderSubscription | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Partial<ReaderSubscription>;
  if (
    typeof input.id !== 'string'
    || typeof input.userId !== 'string'
    || typeof input.userEmail !== 'string'
    || typeof input.activePlanId !== 'string'
    || typeof input.activePlanName !== 'string'
    || typeof input.startedAt !== 'string'
    || typeof input.expiresAt !== 'string'
    || typeof input.lastRenewedAt !== 'string'
    || typeof input.lastCheckoutRequestId !== 'string'
    || !Number.isFinite(Date.parse(input.startedAt))
    || !Number.isFinite(Date.parse(input.expiresAt))
    || !Number.isFinite(Date.parse(input.lastRenewedAt))
  ) {
    return null;
  }
  const now = Date.now();
  const storedStatus = input.status === 'revoked' ? 'revoked' : 'active';
  const status: ReaderSubscription['status'] = storedStatus === 'revoked'
    ? 'revoked'
    : Date.parse(input.expiresAt) > now
      ? 'active'
      : 'expired';
  return {
    id: input.id,
    userId: input.userId,
    userEmail: input.userEmail.trim().toLowerCase(),
    status,
    activePlanId: input.activePlanId,
    activePlanName: input.activePlanName,
    renewable: input.renewable !== false,
    startedAt: new Date(input.startedAt).toISOString(),
    expiresAt: new Date(input.expiresAt).toISOString(),
    lastRenewedAt: new Date(input.lastRenewedAt).toISOString(),
    lastCheckoutRequestId: input.lastCheckoutRequestId,
    renewalCount: Math.max(0, Math.floor(Number(input.renewalCount) || 0)),
    createdAt: canonicalTimestamp(input.createdAt, input.startedAt),
    updatedAt: canonicalTimestamp(input.updatedAt, input.lastRenewedAt),
    ...(typeof input.revokedAt === 'string' && Number.isFinite(Date.parse(input.revokedAt))
      ? { revokedAt: new Date(input.revokedAt).toISOString() }
      : {}),
    ...(typeof input.revokedReason === 'string' && input.revokedReason.trim()
      ? { revokedReason: input.revokedReason.trim().slice(0, 300) }
      : {}),
  };
}

function subscriptionSummary(subscription: ReaderSubscription): ReaderSubscriptionSummary {
  return {
    status: subscription.status,
    planId: subscription.activePlanId,
    planName: subscription.activePlanName,
    startedAt: subscription.startedAt,
    expiresAt: subscription.expiresAt,
    renewable: subscription.renewable,
    lastRenewedAt: subscription.lastRenewedAt,
  };
}

function editablePlanCandidate(
  id: string,
  input: Partial<SubscriptionPlan>,
  existing: SubscriptionPlan | null,
  now: string,
): SubscriptionPlan {
  return normalizeSubscriptionPlan({
    id,
    name: input.name ?? existing?.name ?? 'Reader Pass',
    description: input.description ?? existing?.description ?? 'Full-catalogue reader access.',
    priceKes: input.priceKes ?? existing?.priceKes ?? 1,
    durationMonths: input.durationMonths ?? existing?.durationMonths ?? 1,
    renewable: input.renewable ?? existing?.renewable ?? true,
    isPublished: input.isPublished ?? existing?.isPublished ?? false,
    order: input.order ?? existing?.order ?? 0,
    badge: input.badge ?? existing?.badge,
    coverImage: input.coverImage ?? existing?.coverImage,
    coverImageAlt: input.coverImageAlt ?? existing?.coverImageAlt,
    coverPosition: input.coverPosition ?? existing?.coverPosition,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }) as SubscriptionPlan;
}

function transactionSubscriptionSnapshot(transaction: PaymentTransaction): SubscriptionPurchaseSnapshot {
  return validateSubscriptionPurchaseSnapshot({
    version: transaction.subscriptionPlanVersion,
    planId: transaction.subscriptionPlanId,
    planName: transaction.subscriptionPlanName,
    priceKes: transaction.amount,
    durationMonths: transaction.subscriptionDurationMonths,
    renewable: transaction.subscriptionRenewable,
  }) as SubscriptionPurchaseSnapshot;
}

export interface SubscriptionSettlementResult {
  subscription: ReaderSubscription;
  periodStartsAt: string;
  expiresAt: string;
  isRenewal: boolean;
  activationAlreadyExists: boolean;
}

export const subscriptionStore = {
  async ensureDefaultPlans(): Promise<void> {
    if (!defaultPlansPromise) {
      defaultPlansPromise = (async () => {
        const db = getDb();
        const catalogRef = db.collection('site_configs').doc(SUBSCRIPTION_PLAN_CATALOG_DOCUMENT);
        const existingCatalog = await catalogRef.get();
        if (normalizePlanCatalog(existingCatalog.data())) return;

        await db.runTransaction(async transaction => {
          const currentCatalog = await transaction.get(catalogRef);
          if (normalizePlanCatalog(currentCatalog.data())) return;

          const storedPlansSnapshot = await transaction.get(
            db.collection(SUBSCRIPTION_PLAN_COLLECTION).limit(MAX_PLAN_RESULTS)
          );
          const storedPlans = storedPlansSnapshot.docs
            .map(document => normalizeStoredPlan(document.id, document.data()))
            .filter((plan): plan is SubscriptionPlan => Boolean(plan));
          const plansById = new Map(storedPlans.map(plan => [plan.id, plan]));
          const refs = DEFAULT_SUBSCRIPTION_PLANS.map(plan =>
            db.collection(SUBSCRIPTION_PLAN_COLLECTION).doc(plan.id)
          );
          const now = new Date().toISOString();
          refs.forEach((ref, index) => {
            if (plansById.has(ref.id)) return;
            const seeded = normalizeSubscriptionPlan({
              ...DEFAULT_SUBSCRIPTION_PLANS[index],
              createdAt: now,
              updatedAt: now,
            }) as SubscriptionPlan;
            if (plansById.size >= MAX_PLAN_RESULTS) {
              throw new SubscriptionValidationError(
                'SUBSCRIPTION_PLAN_LIMIT',
                'Reader Pass plan limit reached.'
              );
            }
            plansById.set(seeded.id, seeded);
            transaction.create(refs[index], sanitizeForFirestore(seeded));
          });
          transaction.set(catalogRef, planCatalogRecord([...plansById.values()], now), { merge: false });
        });
      })().catch(error => {
        defaultPlansPromise = null;
        throw error;
      });
    }
    return defaultPlansPromise;
  },

  async listPlans(includeUnpublished = false): Promise<SubscriptionPlan[]> {
    await this.ensureDefaultPlans();
    const catalog = await getDb()
      .collection('site_configs')
      .doc(SUBSCRIPTION_PLAN_CATALOG_DOCUMENT)
      .get();
    const plans = normalizePlanCatalog(catalog.data());
    if (!plans) {
      defaultPlansPromise = null;
      throw new SubscriptionValidationError(
        'SUBSCRIPTION_PLAN_CATALOG_UNAVAILABLE',
        'Reader Pass catalogue is temporarily unavailable.'
      );
    }
    return plans
      .filter(plan => includeUnpublished || plan.isPublished)
      .map(plan => ({ ...plan, ...(plan.coverPosition ? { coverPosition: { ...plan.coverPosition } } : {}) }));
  },

  async listPublicPlans() {
    const plans = await this.listPlans(false);
    return plans.map(plan => toPublicSubscriptionPlan(plan));
  },

  async getPlan(id: string, includeUnpublished = false): Promise<SubscriptionPlan | null> {
    await this.ensureDefaultPlans();
    if (!/^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])?$/.test(id)) return null;
    const snapshot = await getDb().collection(SUBSCRIPTION_PLAN_COLLECTION).doc(id).get();
    const plan = snapshot.exists ? normalizeStoredPlan(snapshot.id, snapshot.data()) : null;
    return plan && (includeUnpublished || plan.isPublished) ? plan : null;
  },

  async savePlan(
    input: Partial<SubscriptionPlan>,
    expectedUpdatedAt: string | null,
  ): Promise<SubscriptionPlan> {
    await this.ensureDefaultPlans();
    const id = typeof input.id === 'string' && input.id
      ? input.id
      : `plan-${crypto.randomBytes(12).toString('hex')}`;
    const db = getDb();
    const ref = db.collection(SUBSCRIPTION_PLAN_COLLECTION).doc(id);
    const catalogRef = db.collection('site_configs').doc(SUBSCRIPTION_PLAN_CATALOG_DOCUMENT);
    return db.runTransaction(async transaction => {
      const [snapshot, catalogSnapshot] = await Promise.all([
        transaction.get(ref),
        transaction.get(catalogRef),
      ]);
      const catalogPlans = normalizePlanCatalog(catalogSnapshot.data());
      if (!catalogPlans) {
        throw new SubscriptionValidationError(
          'SUBSCRIPTION_PLAN_CATALOG_UNAVAILABLE',
          'Reader Pass catalogue is temporarily unavailable.'
        );
      }
      const existing = snapshot.exists ? normalizeStoredPlan(id, snapshot.data()) : null;
      const remoteUpdatedAt = existing?.updatedAt ?? null;
      if (snapshot.exists && remoteUpdatedAt !== expectedUpdatedAt) {
        throw new SubscriptionPlanConflictError();
      }
      if (!snapshot.exists && expectedUpdatedAt !== null) {
        throw new SubscriptionPlanConflictError();
      }
      const now = new Date(
        remoteUpdatedAt && Number.isFinite(Date.parse(remoteUpdatedAt))
          ? Math.max(Date.now(), Date.parse(remoteUpdatedAt) + 1)
          : Date.now()
      ).toISOString();
      const plan = editablePlanCandidate(id, input, existing, now);
      const existingIndex = catalogPlans.findIndex(candidate => candidate.id === id);
      if (existingIndex < 0 && catalogPlans.length >= MAX_PLAN_RESULTS) {
        throw new SubscriptionValidationError('SUBSCRIPTION_PLAN_LIMIT', 'Reader Pass plan limit reached.');
      }
      const nextCatalog = existingIndex >= 0
        ? catalogPlans.map((candidate, index) => index === existingIndex ? plan : candidate)
        : [...catalogPlans, plan];
      transaction.set(ref, sanitizeForFirestore(plan), { merge: false });
      transaction.set(catalogRef, planCatalogRecord(nextCatalog, now), { merge: false });
      return plan;
    });
  },

  async archivePlan(id: string, expectedUpdatedAt: string | null): Promise<SubscriptionPlan> {
    const current = await this.getPlan(id, true);
    if (!current) {
      throw new SubscriptionValidationError('SUBSCRIPTION_PLAN_NOT_FOUND', 'Reader Pass not found.');
    }
    return this.savePlan({ ...current, isPublished: false }, expectedUpdatedAt);
  },

  createPurchaseSnapshot(plan: SubscriptionPlan): SubscriptionPurchaseSnapshot {
    return createSubscriptionPurchaseSnapshot(plan) as SubscriptionPurchaseSnapshot;
  },

  async getReaderSubscription(userId: string): Promise<ReaderSubscription | null> {
    const id = getReaderSubscriptionId(userId);
    const snapshot = await getDb().collection(READER_SUBSCRIPTION_COLLECTION).doc(id).get();
    return snapshot.exists ? normalizeStoredSubscription(snapshot.data()) : null;
  },

  async getReaderSubscriptionSummary(userId: string): Promise<ReaderSubscriptionSummary | undefined> {
    const subscription = await this.getReaderSubscription(userId);
    return subscription ? subscriptionSummary(subscription) : undefined;
  },

  async getActiveReaderSubscription(userId: string): Promise<ReaderSubscription | null> {
    const subscription = await this.getReaderSubscription(userId);
    return subscription?.status === 'active' ? subscription : null;
  },

  async hasActiveSubscription(userId: string): Promise<boolean> {
    return Boolean(await this.getActiveReaderSubscription(userId));
  },

  async applySettlementInTransaction(
    transaction: Transaction,
    payment: PaymentTransaction,
    receiptNumber: string,
    settledAt: string,
  ): Promise<SubscriptionSettlementResult> {
    if (payment.purchaseKind !== 'subscription' || payment.type !== 'PURCHASE') {
      throw new SubscriptionValidationError(
        'SUBSCRIPTION_INVALID_PAYMENT',
        'This payment is not a subscription purchase.'
      );
    }
    const buyerUserId = payment.buyer?.userId;
    const transactionUserId = payment.userId;
    const buyerEmail = payment.buyer?.email?.trim().toLowerCase();
    const transactionEmail = payment.userEmail?.trim().toLowerCase();
    if (
      (buyerUserId && transactionUserId && buyerUserId !== transactionUserId)
      || (buyerEmail && transactionEmail && buyerEmail !== transactionEmail)
    ) {
      throw new SubscriptionValidationError(
        'SUBSCRIPTION_ACCOUNT_CONFLICT',
        'The Reader Pass payment is not bound to one consistent reader account.'
      );
    }
    const userId = buyerUserId || transactionUserId;
    const userEmail = buyerEmail || transactionEmail || '';
    if (!userId || !userEmail) {
      throw new SubscriptionValidationError(
        'SUBSCRIPTION_ACCOUNT_REQUIRED',
        'A reader account is required to activate this Reader Pass.'
      );
    }
    const snapshot = transactionSubscriptionSnapshot(payment);
    if (payment.articleId !== `subscription:${snapshot.planId}`) {
      throw new SubscriptionValidationError(
        'SUBSCRIPTION_INVALID_PAYMENT',
        'The Reader Pass payment does not match its plan snapshot.'
      );
    }
    const subscriptionId = getReaderSubscriptionId(userId);
    const subscriptionRef = getDb().collection(READER_SUBSCRIPTION_COLLECTION).doc(subscriptionId);
    const activationRef = getDb()
      .collection(SUBSCRIPTION_ACTIVATION_COLLECTION)
      .doc(payment.checkoutRequestId);
    const [subscriptionSnapshot, activationSnapshot] = await Promise.all([
      transaction.get(subscriptionRef),
      transaction.get(activationRef),
    ]);
    const current = subscriptionSnapshot.exists
      ? normalizeStoredSubscription(subscriptionSnapshot.data())
      : null;

    if (activationSnapshot.exists) {
      const activation = activationSnapshot.data() as Record<string, unknown>;
      const stored = current;
      if (
        !stored
        || activation.userId !== userId
        || activation.checkoutRequestId !== payment.checkoutRequestId
        || activation.receiptNumber !== receiptNumber
      ) {
        throw new SubscriptionValidationError(
          'SUBSCRIPTION_ACTIVATION_CONFLICT',
          'This payment activation conflicts with an existing record.'
        );
      }
      return {
        subscription: stored,
        periodStartsAt: String(activation.periodStartsAt || stored.lastRenewedAt),
        expiresAt: String(activation.expiresAt || stored.expiresAt),
        isRenewal: typeof activation.subscriptionRenewal === 'boolean'
          ? activation.subscriptionRenewal
          : payment.subscriptionRenewal === true,
        activationAlreadyExists: true,
      };
    }

    // This is decided inside the same transaction that creates the activation,
    // so two concurrent checkouts cannot both be credited as a first payment.
    const isRenewal = Boolean(current);
    const renewal = calculateSubscriptionRenewalWindow({
      currentExpiry: current?.status === 'revoked' ? undefined : current?.expiresAt,
      settledAt,
      durationMonths: snapshot.durationMonths,
    });
    const now = new Date(settledAt).toISOString();
    const next: ReaderSubscription = {
      id: subscriptionId,
      userId,
      userEmail,
      status: 'active',
      activePlanId: snapshot.planId,
      activePlanName: snapshot.planName,
      renewable: snapshot.renewable,
      startedAt: current?.startedAt || renewal.renewalBaseAt,
      expiresAt: renewal.expiresAt,
      lastRenewedAt: now,
      lastCheckoutRequestId: payment.checkoutRequestId,
      renewalCount: current ? current.renewalCount + 1 : 0,
      createdAt: current?.createdAt || now,
      updatedAt: now,
    };
    transaction.set(subscriptionRef, sanitizeForFirestore(next), { merge: false });
    transaction.create(activationRef, sanitizeForFirestore({
      version: 1,
      checkoutRequestId: payment.checkoutRequestId,
      receiptNumber,
      userId,
      userEmail,
      plan: snapshot,
      previousExpiresAt: current?.expiresAt || null,
      subscriptionRenewal: isRenewal,
      periodStartsAt: renewal.renewalBaseAt,
      expiresAt: renewal.expiresAt,
      settledAt: now,
      createdAt: now,
    }));
    return {
      subscription: next,
      periodStartsAt: renewal.renewalBaseAt,
      expiresAt: renewal.expiresAt,
      isRenewal,
      activationAlreadyExists: false,
    };
  },

  async revokeSubscription(
    userId: string,
    reasonInput: string,
  ): Promise<ReaderSubscription> {
    const subscriptionId = getReaderSubscriptionId(userId);
    const ref = getDb().collection(READER_SUBSCRIPTION_COLLECTION).doc(subscriptionId);
    return getDb().runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      const current = snapshot.exists ? normalizeStoredSubscription(snapshot.data()) : null;
      if (!current) {
        throw new SubscriptionValidationError('SUBSCRIPTION_NOT_FOUND', 'Reader subscription not found.');
      }
      const now = new Date().toISOString();
      const revoked: ReaderSubscription = {
        ...current,
        status: 'revoked',
        revokedAt: now,
        revokedReason: reasonInput.trim().slice(0, 300) || 'Revoked by writer',
        updatedAt: now,
      };
      transaction.set(ref, sanitizeForFirestore(revoked), { merge: false });
      return revoked;
    });
  },

  toSummary(subscription: ReaderSubscription): ReaderSubscriptionSummary {
    return subscriptionSummary(subscription);
  },
};
