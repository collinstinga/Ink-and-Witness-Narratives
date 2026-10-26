import crypto from 'crypto';
import type { Firestore, DocumentReference, Transaction } from 'firebase-admin/firestore';
import type { AffiliateNotificationSource } from './affiliateNotificationPlan.js';
import { getFirestoreClientTarget } from './db.js';
import type { AffiliateAccount, AffiliateSaleCommission } from '../types.js';
import { literaryCirclePeriodKey, normalizeLiteraryCircleSettings, resolveLiteraryCircleSettingsForTransaction } from './literaryCircle.js';
import { MAX_TIER_TRANSITION_PRIOR_COMMISSIONS, validateStoredLiteraryCircleTierTransition } from './literaryCircleTierTransition.js';
import {
  affiliateNotificationRolloutHash, authorizeProductionAffiliateNotificationSource, productionAffiliateNotificationGate,
} from './affiliateNotificationRollout.js';

type SourceKind = 'activation' | 'new_commission' | 'new_release' | 'tier_upgrade';
type PreparationStatus = 'disabled' | 'blocked' | 'ineligible' | 'created' | 'existing' | 'failed';
interface PreparationResult { status: PreparationStatus; intentCount: number }
export interface ResolvedAffiliateNotificationSource {
  source: AffiliateNotificationSource;
  /** Hash binds every validated document path and its complete snapshot. */
  evidenceSha256: string;
  /** Trusted business text. URL construction stays with the reviewed sender. */
  context: Record<string, string>;
  /** Re-read every source document in the caller's claim/send transaction. */
  verifySource: (transaction: Transaction) => Promise<boolean>;
  /** Delivery must atomically enforce this per-recipient elapsed-time bound. */
  cooldown?: { key: string; minimumIntervalMs: number };
}
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const SAFE_PROJECT = /^[a-z][a-z0-9-]{4,29}[a-z0-9]$/;
const KNOWN_PRODUCTION = ['ink-and-witness-narratives', 'divine-experience-pq6d2'];
export const MAX_AFFILIATE_NOTIFICATION_RECOVERY_IDS = 25;
export const MAX_TIER_NOTIFICATION_RECOVERY_IDS = 5;
/** Do not introduce an old release backlog when held automation is enabled. */
export const AFFILIATE_RELEASE_NOTIFICATION_MAX_AGE_MS = 7 * 86_400_000;

export function affiliateNotificationSourceGate(db: Firestore, env: NodeJS.ProcessEnv): 'held' | 'disabled' | 'blocked' {
  const mode = (env.AFFILIATE_NOTIFICATION_EVENT_MODE || 'off').trim().toLowerCase();
  if (mode === 'off') return 'disabled';
  if (mode === 'production_held') return productionAffiliateNotificationGate(db, env) === 'allowed' ? 'held' : 'blocked';
  if (mode !== 'held') return 'blocked';
  const project = (env.FIREBASE_PROJECT_ID || '').trim();
  const allowed = (env.LITERARY_CIRCLE_STAGING_PROJECT_IDS || '').split(',').map(value => value.trim()).filter(Boolean);
  const denied = new Set([...KNOWN_PRODUCTION, ...(env.LITERARY_CIRCLE_PRODUCTION_PROJECT_IDS || '').split(',').map(value => value.trim())]);
  const vercelEnv = (env.VERCEL_ENV || '').trim().toLowerCase();
  const database = (env.FIRESTORE_DATABASE_ID || '(default)').trim();
  const actualTarget = getFirestoreClientTarget(db);
  if (vercelEnv === 'production' || (!vercelEnv && (env.NODE_ENV || '').trim().toLowerCase() === 'production')
    || !SAFE_PROJECT.test(project) || !allowed.includes(project)
    || allowed.some(id => !SAFE_PROJECT.test(id) || denied.has(id))
    || denied.has(project) || actualTarget?.projectId !== project || actualTarget?.firestoreDatabaseId !== database
    || env.FIRESTORE_EMULATOR_HOST || env.FIREBASE_DATABASE_EMULATOR_HOST || env.FIREBASE_AUTH_EMULATOR_HOST) return 'blocked';
  return 'held';
}

/** Extend a trusted source with the independently signed production review.
 * Its fresh transaction read also fences pause, edits, expiry and cutover. */
export async function withProductionAffiliateNotificationAuthorization(input: {
  db: Firestore; resolved: ResolvedAffiliateNotificationSource | null; now: string;
}, env: NodeJS.ProcessEnv): Promise<ResolvedAffiliateNotificationSource | null> {
  if (!input.resolved || env.AFFILIATE_NOTIFICATION_EVENT_MODE !== 'production_held') return input.resolved;
  const resolved = input.resolved;
  const authorization = await authorizeProductionAffiliateNotificationSource({ db: input.db, source: resolved.source, now: input.now }, env);
  if (!authorization) return null;
  return { ...resolved, evidenceSha256: affiliateNotificationRolloutHash([resolved.evidenceSha256, authorization.envelopeSha256]),
    verifySource: async transaction => {
      if (!await resolved.verifySource(transaction)) return false;
      const fresh = await authorizeProductionAffiliateNotificationSource({ db: input.db, transaction, source: resolved.source, now: input.now }, env);
      return fresh?.envelopeSha256 === authorization.envelopeSha256;
    },
  };
}

export function affiliateNotificationSourceFingerprint(value: unknown): string {
  // Firestore records contain JSON-compatible business fields; use sorted keys
  // so independent snapshot projections compare the same document contents.
  const canonical = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(canonical);
    if (!item || typeof item !== 'object') return item;
    return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => [key, canonical(nested)]));
  };
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function canonicalTime(value: unknown, now: number): string | null {
  const milliseconds = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(milliseconds) && milliseconds > 0 && milliseconds <= now
    ? new Date(milliseconds).toISOString() : null;
}

function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1_000_000;
}

function matchesConfirmedPurchase(commission: Record<string, unknown>, payment: Record<string, unknown>): boolean {
  const receipt = payment.mpesaReceiptNumber || payment.bankReference || `CHECKOUT-${payment.checkoutRequestId || payment.id}`;
  return typeof payment.status === 'string' && ['CONFIRMED', 'SUCCESS', 'PAID'].includes(payment.status) && payment.type === 'PURCHASE'
    && typeof payment.paymentMethod === 'string' && ['mpesa', 'bank'].includes(payment.paymentMethod)
    && payment.checkoutRequestId === commission.checkoutRequestId
    && typeof payment.id === 'string' && payment.id === commission.transactionId
    && payment.articleId === commission.articleId && payment.amount === commission.saleAmountKes
    && typeof commission.affiliateCode === 'string' && Boolean(commission.affiliateCode.trim())
    && typeof payment.affiliateCode === 'string'
    && payment.affiliateCode.trim().toUpperCase() === commission.affiliateCode.trim().toUpperCase()
    && typeof receipt === 'string' && Boolean(receipt.trim()) && receipt.length <= 256
    && receipt === commission.receiptNumber;
}

function matchesSettlementTime(commission: Record<string, unknown>, payment: Record<string, unknown>): boolean {
  const selected = [payment.confirmedAt, payment.settledAt, payment.completedAt, payment.createdAt]
    .find(value => typeof value === 'string' && Number.isFinite(Date.parse(value)));
  return typeof selected === 'string' && selected === commission.createdAt;
}

/** Internal post-commit adapter. Defaults off; production additionally requires
 * independent signed source authorization before held records are prepared. */
async function consumeCommittedAffiliateNotification(input: {
  db: Firestore;
  kind: SourceKind;
  sourceId: string;
  /** Explicit frozen audience for a release; never a client-supplied list.
   * One campaign supports at most 200 selected affiliates. Do not split it
   * into separate calls: an audience change intentionally conflicts.
   */
  affiliateIds?: string[];
  now?: string;
  includeContext?: boolean;
}, env: NodeJS.ProcessEnv, consume: (resolved: ResolvedAffiliateNotificationSource, audience: string[], now: string) => Promise<PreparationResult>): Promise<PreparationResult> {
  const result = (status: PreparationStatus): PreparationResult => ({ status, intentCount: 0 });
  try {
    const db = input.db;
    const kind = input.kind;
    const sourceId = input.sourceId;
    const suppliedNow = input.now;
    const mode = affiliateNotificationSourceGate(db, env);
    if (mode !== 'held') return result(mode);
    if (!['activation', 'new_commission', 'new_release', 'tier_upgrade'].includes(kind)
      || typeof sourceId !== 'string' || !SAFE_ID.test(sourceId)) return result('ineligible');
    if (input.affiliateIds !== undefined && !Array.isArray(input.affiliateIds)) return result('ineligible');
    const audience = input.affiliateIds === undefined ? undefined : [...input.affiliateIds];
    if (kind === 'new_release' ? !audience || audience.length < 1 || audience.length > 200
      || audience.some(id => typeof id !== 'string' || !SAFE_ID.test(id)) || new Set(audience).size !== audience.length
      : audience !== undefined) return result('ineligible');
    const now = suppliedNow || new Date().toISOString();
    const nowMs = Date.parse(now);
    if (!Number.isFinite(nowMs) || new Date(nowMs).toISOString() !== now) return result('ineligible');
    const primaryRef = db.collection(kind === 'activation' ? 'affiliates'
      : kind === 'new_release' ? 'newsletter_campaigns' : 'affiliate_commissions').doc(sourceId);
    const [primarySnapshot] = await db.getAll(primaryRef);
    if (!primarySnapshot?.exists) return result('ineligible');
    const primary = primarySnapshot.data()!;
    const refs: DocumentReference[] = [primaryRef];
    const expected = [affiliateNotificationSourceFingerprint(primary)];
    const context: Record<string, string> = {};
    let source: AffiliateNotificationSource;
    if (kind === 'activation') {
      const approvedAt = canonicalTime(primary.approvedAt, nowMs);
      if (primary.status !== 'active' || !approvedAt || typeof primary.approvedBy !== 'string'
        || !primary.approvedBy.trim()) return result('ineligible');
      source = { eventType: 'activation', sourceId: primaryRef.id, sourceVersion: Date.parse(approvedAt), occurredAt: approvedAt, targetAffiliateId: primaryRef.id };
      if (input.includeContext) {
        const settingsRef = db.collection('site_configs').doc('affiliate_literary_circle');
        const [snapshot] = await db.getAll(settingsRef);
        if (!snapshot?.exists) return result('ineligible');
        const settings = normalizeLiteraryCircleSettings(snapshot.data());
        const tier = settings.tiers.find(item => item.id === primary.literaryCircle?.tier?.id);
        if (!tier || /[\u0000-\u001f]/.test(tier.name)) return result('ineligible');
        context.tierName = tier.name;
        refs.push(settingsRef); expected.push(affiliateNotificationSourceFingerprint(snapshot.data()));
      }
    } else if (kind === 'new_release') {
      const occurredAt = canonicalTime(primary.queuedAt, nowMs);
      const createdAt = canonicalTime(primary.createdAt, nowMs);
      const pieceId = primary.content?.pieceId;
      if (primary.kind !== 'release' || !['queued', 'sending', 'sent', 'partially_sent'].includes(primary.status)
        || !occurredAt || !createdAt || primary.queuedAt !== occurredAt || primary.createdAt !== createdAt
        || createdAt > occurredAt
        || nowMs >= Date.parse(occurredAt) + AFFILIATE_RELEASE_NOTIFICATION_MAX_AGE_MS
        || typeof pieceId !== 'string' || !SAFE_ID.test(pieceId)
        || typeof primary.createdBy !== 'string' || !primary.createdBy.trim()
        || primaryRef.id !== `nlc_${crypto.createHash('sha256').update(`release\0${pieceId}`).digest('hex').slice(0, 48)}`) {
        return result('ineligible');
      }
      const articleRef = db.collection('articles').doc(pieceId);
      const [articleSnapshot] = await db.getAll(articleRef);
      if (!articleSnapshot?.exists || articleSnapshot.data()?.status !== 'published') return result('ineligible');
      refs.push(articleRef);
      expected.push(affiliateNotificationSourceFingerprint(articleSnapshot.data()));
      if (input.includeContext) {
        const title = articleSnapshot.data()?.title;
        if (typeof title !== 'string' || !title.trim() || title.length > 300 || /[\u0000-\u001f]/.test(title)) return result('ineligible');
        context.pieceTitle = title;
        context.piecePath = `/?monograph=${encodeURIComponent(pieceId)}`;
      }
      source = { eventType: 'new_release', sourceId: primaryRef.id, sourceVersion: 1, occurredAt };
    } else {
      const occurredAt = canonicalTime(primary.createdAt, nowMs);
      if (!['PENDING', 'APPROVED', 'PAID'].includes(primary.status)
        || primary.fraudFlag?.flagged || !occurredAt
        || typeof primary.affiliateId !== 'string' || !SAFE_ID.test(primary.affiliateId)
        || typeof primary.checkoutRequestId !== 'string' || !SAFE_ID.test(primary.checkoutRequestId)
        || typeof primary.articleId !== 'string' || !primary.articleId.trim() || primary.articleId.length > 256
        || !positive(primary.commissionAmountKes) || !positive(primary.saleAmountKes)
        || primary.commissionAmountKes > primary.saleAmountKes) return result('ineligible');
      const paymentRef = db.collection('transactions').doc(primary.checkoutRequestId);
      const [paymentSnapshot] = await db.getAll(paymentRef);
      if (!paymentSnapshot?.exists) return result('ineligible');
      const payment = paymentSnapshot.data()!;
      if (!matchesConfirmedPurchase(primary, payment)) return result('ineligible');
      refs.push(paymentRef);
      expected.push(affiliateNotificationSourceFingerprint(payment));
      if (input.includeContext && kind === 'new_commission') {
        const articleRef = db.collection('articles').doc(primary.articleId);
        const [snapshot] = await db.getAll(articleRef);
        const title = snapshot?.data()?.title;
        context.pieceTitle = typeof title === 'string' && title.trim() && title.length <= 300 && !/[\u0000-\u001f]/.test(title)
          ? title : 'a literary purchase';
        context.commissionAmount = `KES ${Number(primary.commissionAmountKes).toFixed(2)}`;
        // Missing legacy pieces still support a truthful financial alert. Keep
        // existence in the transaction fingerprint so a concurrent edit retries.
        refs.push(articleRef); expected.push(affiliateNotificationSourceFingerprint(snapshot?.exists ? snapshot.data() : null));
      }
      if (kind === 'tier_upgrade') {
        if (!matchesSettlementTime(primary, payment)) return result('ineligible');
        const priorIds: unknown = primary.literaryCircleTierTransition?.qualifyingCommissionIds;
        if (!Array.isArray(priorIds) || priorIds.length > MAX_TIER_TRANSITION_PRIOR_COMMISSIONS
          || Array.from(priorIds).some(id => typeof id !== 'string' || !SAFE_ID.test(id) || id === primaryRef.id)
          || new Set(priorIds).size !== priorIds.length
          || primary.id !== primaryRef.id
          || literaryCirclePeriodKey(occurredAt) !== literaryCirclePeriodKey(now)) return result('ineligible');
        const settingsRef = db.collection('site_configs').doc('affiliate_literary_circle');
        const affiliateRef = db.collection('affiliates').doc(primary.affiliateId);
        const priorRefs = priorIds.map(id => db.collection('affiliate_commissions').doc(id));
        const snapshots = await db.getAll(settingsRef, affiliateRef, ...priorRefs);
        const byPath = new Map(snapshots.map(snapshot => [snapshot.ref.path, snapshot]));
        if ([settingsRef, affiliateRef, ...priorRefs].some(ref => !byPath.get(ref.path)?.exists)
          || priorRefs.some(ref => byPath.get(ref.path)!.data()?.id !== ref.id)) return result('ineligible');
        const settings = resolveLiteraryCircleSettingsForTransaction(normalizeLiteraryCircleSettings(byPath.get(settingsRef.path)!.data()), occurredAt);
        if (input.includeContext) {
          const tier = settings.tiers.find(item => item.id === primary.literaryCircleTierTransition?.toTierId);
          if (!tier || /[\u0000-\u001f]/.test(tier.name)) return result('ineligible');
          context.tierName = tier.name;
        }
        const affiliate = { ...byPath.get(affiliateRef.path)!.data(), id: affiliateRef.id } as AffiliateAccount;
        const history = priorRefs.map(ref => ({ ...byPath.get(ref.path)!.data(), id: ref.id } as AffiliateSaleCommission));
        if (!validateStoredLiteraryCircleTierTransition({
          commission: { ...primary, id: primaryRef.id } as AffiliateSaleCommission,
          affiliate, settings, history, paymentType: 'PURCHASE',
        })) return result('ineligible');
        const priorPaymentRefs = history.map(commission => db.collection('transactions').doc(commission.checkoutRequestId!));
        if (priorPaymentRefs.length) {
          const priorPayments = await db.getAll(...priorPaymentRefs);
          const paymentsByPath = new Map(priorPayments.map(snapshot => [snapshot.ref.path, snapshot]));
          if (history.some((commission, index) => {
            const snapshot = paymentsByPath.get(priorPaymentRefs[index].path);
            return !snapshot?.exists || !matchesConfirmedPurchase(commission as unknown as Record<string, unknown>, snapshot.data()!)
              || !matchesSettlementTime(commission as unknown as Record<string, unknown>, snapshot.data()!);
          })) return result('ineligible');
          for (const ref of priorPaymentRefs) {
            refs.push(ref); expected.push(affiliateNotificationSourceFingerprint(paymentsByPath.get(ref.path)!.data()));
          }
        }
        for (const ref of [settingsRef, affiliateRef, ...priorRefs]) {
          refs.push(ref); expected.push(affiliateNotificationSourceFingerprint(byPath.get(ref.path)!.data()));
        }
      }
      source = { eventType: kind === 'tier_upgrade' ? 'tier_upgrade' : 'new_commission', sourceId: primaryRef.id, sourceVersion: 1, occurredAt, targetAffiliateId: primary.affiliateId,
        ...(kind === 'tier_upgrade' ? { targetTierId: primary.literaryCircleTierTransition.toTierId } : {}),
      };
    }
    const resolved = await withProductionAffiliateNotificationAuthorization({ db, now, resolved: { source, context,
      evidenceSha256: affiliateNotificationSourceFingerprint(refs.map((ref, index) => [ref.path, expected[index]])),
      verifySource: async transaction => {
        const snapshots = await transaction.getAll(...refs);
        const byPath = new Map(snapshots.map(snapshot => [snapshot.ref.path, snapshot]));
        return refs.every((ref, index) => {
          const snapshot = byPath.get(ref.path);
          return snapshot && affiliateNotificationSourceFingerprint(snapshot.exists ? snapshot.data() : null) === expected[index];
        });
      },
    } }, env);
    return resolved ? await consume(resolved, audience || [source.targetAffiliateId!], now) : result('ineligible');
  } catch {
    // Approval/payment commits must stay successful if notification preparation
    // fails. A bounded replay of the committed source can recover it later.
    console.warn('[Partner Notifications] Preparation failed; committed source remains available for recovery.');
    return result('failed');
  }
}

/** Internal post-commit entry point, never a route accepting client sources. */
export async function prepareCommittedAffiliateNotification(input: {
  db: Firestore; kind: SourceKind; sourceId: string; affiliateIds?: string[]; now?: string;
}, env: NodeJS.ProcessEnv = process.env): Promise<PreparationResult> {
  const db = input.db;
  return consumeCommittedAffiliateNotification(input, env, async (resolved, affiliateIds, now) => {
    const { storeHeldAffiliateNotifications } = await import('./affiliateNotificationOutbox.js');
    return storeHeldAffiliateNotifications({ db, mode: 'held', source: resolved.source,
      verifySource: resolved.verifySource, affiliateIds, now });
  });
}

/** Fresh server source revalidation for held delivery. An existing outbox record
 * is never authorization. Caller must also check current recipient/settings and
 * run verifySource in its transaction immediately before provider dispatch. */
export async function resolveAffiliateNotificationSource(input: {
  db: Firestore; source: AffiliateNotificationSource; now: string;
}, env: NodeJS.ProcessEnv = process.env): Promise<ResolvedAffiliateNotificationSource | null> {
  const source = { ...input.source };
  const db = input.db; const now = input.now;
  if (['upcoming_campaign', 'inactivity_reminder', 'exclusive_opportunity'].includes(source.eventType)) {
    const { resolveScheduledAffiliateNotificationSource } = await import('./affiliateNotificationSchedule.js');
    return resolveScheduledAffiliateNotificationSource({ db, now, source }, env);
  }
  let resolved: ResolvedAffiliateNotificationSource | null = null;
  const result = await consumeCommittedAffiliateNotification({ db, kind: source.eventType as SourceKind,
    sourceId: source.sourceId, now, includeContext: true,
    ...(source.eventType === 'new_release' ? { affiliateIds: ['source-validation'] } : {}),
  }, env, async candidate => {
    if (affiliateNotificationSourceFingerprint(candidate.source) === affiliateNotificationSourceFingerprint(source)) resolved = candidate;
    return { status: 'ineligible', intentCount: 0 };
  });
  if (result.status === 'failed') throw new Error('Partner notification source could not be verified.');
  return resolved;
}

/** Explicit bounded recovery: no collection scan, cursor, cron, or email dispatch. */
export async function recoverCommittedAffiliateNotifications(input: {
  db: Firestore; kind: Exclude<SourceKind, 'new_release'>; sourceIds: string[]; now?: string;
}, env: NodeJS.ProcessEnv = process.env): Promise<{ attempted: number; counts: Partial<Record<PreparationStatus, number>> }> {
  const db = input.db;
  const kind = input.kind;
  const now = input.now;
  const mode = affiliateNotificationSourceGate(db, env);
  if (mode !== 'held') return { attempted: 0, counts: { [mode]: 1 } };
  if (!Array.isArray(input.sourceIds) || input.sourceIds.length > MAX_AFFILIATE_NOTIFICATION_RECOVERY_IDS
    || (kind === 'tier_upgrade' && input.sourceIds.length > MAX_TIER_NOTIFICATION_RECOVERY_IDS)
    || input.sourceIds.some(id => typeof id !== 'string' || !SAFE_ID.test(id))
    || new Set(input.sourceIds).size !== input.sourceIds.length) {
    throw new Error('Invalid partner notification recovery batch.');
  }
  const sourceIds = [...input.sourceIds];
  const counts: Partial<Record<PreparationStatus, number>> = {};
  for (const sourceId of sourceIds) {
    const prepared = await prepareCommittedAffiliateNotification({ db, kind, sourceId, now }, env);
    counts[prepared.status] = (counts[prepared.status] || 0) + 1;
  }
  return { attempted: sourceIds.length, counts };
}
