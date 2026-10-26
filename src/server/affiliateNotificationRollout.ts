import crypto from 'crypto';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import type { LiteraryCircleNotificationSettings, ProductionAffiliateNotificationMode,
  ProductionAffiliateNotificationReviewRequest, ProductionAffiliateNotificationRolloutStatus } from '../types.js';
export type { ProductionAffiliateNotificationMode, ProductionAffiliateNotificationReviewRequest,
  ProductionAffiliateNotificationRolloutStatus } from '../types.js';
import type { AffiliateNotificationSource } from './affiliateNotificationPlan.js';
import { getFirestoreClientTarget } from './db.js';
import { normalizeNewsletterEmail, newsletterEmailIndexId } from './newsletterSecurity.js';
import { validateAffiliateNotificationSettings } from './affiliateNotifications.js';
import { sendNewsletterEmail } from './newsletterEmail.js';

export const AFFILIATE_NOTIFICATION_ROLLOUT_DOCUMENT_ID = 'affiliate_notification_rollout';
export const AFFILIATE_NOTIFICATION_PRODUCTION_PROJECT = 'ink-and-witness-narratives';
export const AFFILIATE_NOTIFICATION_PRODUCTION_ORIGIN = 'https://www.inkandwitness-narratives.co.ke';
export const AFFILIATE_NOTIFICATION_REVIEW_MAX_DAYS = 30;
export const AFFILIATE_NOTIFICATION_FOUNDING_COHORT_SHA256 = 'd1c67263f094f594e6d8b92b8a2c391a8cf789fd9d2cda3ddedb72360db35555';
const CORE_MARKER = 'literary-circle-production-core-v1';
const HASH = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const DAY = 86_400_000;

export interface ProductionAffiliateNotificationReview {
  schemaVersion: 1;
  revision: number;
  mode: ProductionAffiliateNotificationMode;
  projectId: string;
  databaseId: '(default)';
  canonicalBaseUrl: string;
  fromEmail: string;
  providerAccountSha256: string;
  settingsRevision: number;
  settingsSha256: string;
  activatedAt: string;
  reviewedAt: string;
  expiresAt: string;
  reviewedBySha256: string;
  /** Only the owner's independently committed, explicitly approved test address. */
  testRecipient?: string;
  verifiedTestDeliveryId?: string;
  /** Explicit opt-in to one welcome per original identity, not a migration. */
  foundingWelcome?: { affiliateIds: string[]; markerSha256: string };
}
interface SignedRollout {
  schemaVersion: 1;
  revision: number;
  state: 'reviewed' | 'paused';
  review: ProductionAffiliateNotificationReview;
  reviewSha256: string;
  signature: string;
}

const record = (value: unknown): value is Record<string, any> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
function exact(value: Record<string, unknown>, keys: string[]): boolean { return Object.keys(value).every(key => keys.includes(key)); }
export function affiliateNotificationRolloutHash(value: unknown): string {
  const canonical = (item: unknown): string => {
    if (item === null || typeof item !== 'object') return JSON.stringify(item);
    if (Array.isArray(item)) return `[${item.map(canonical).join(',')}]`;
    return `{${Object.keys(item).filter(key => (item as any)[key] !== undefined).sort()
      .map(key => `${JSON.stringify(key)}:${canonical((item as any)[key])}`).join(',')}}`;
  };
  return crypto.createHash('sha256').update(canonical(value)).digest('hex');
}
const rawHash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
function time(value: unknown): number | null {
  const result = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(result) && result > 0 && new Date(result).toISOString() === value ? result : null;
}
function signingSecret(env: NodeJS.ProcessEnv): string | null {
  const secret = env.AFFILIATE_NOTIFICATION_SIGNING_SECRET;
  return typeof secret === 'string' && secret.trim() === secret && secret.length >= 32 && secret.length <= 512 ? secret : null;
}
function signature(value: Omit<SignedRollout, 'signature'>, env: NodeJS.ProcessEnv): string {
  return crypto.createHmac('sha256', signingSecret(env)!).update(`affiliate-production-review-v1\0${affiliateNotificationRolloutHash(value)}`).digest('hex');
}
function seal(value: Omit<SignedRollout, 'signature'>, env: NodeJS.ProcessEnv): SignedRollout { return { ...value, signature: signature(value, env) }; }
export function productionAffiliateNotificationMode(env: NodeJS.ProcessEnv = process.env): ProductionAffiliateNotificationMode | null {
  return env.AFFILIATE_NOTIFICATION_DELIVERY_MODE === 'production_test' || env.AFFILIATE_NOTIFICATION_DELIVERY_MODE === 'production_live'
    ? env.AFFILIATE_NOTIFICATION_DELIVERY_MODE : null;
}

/** Exact production SDK binding is independent of a writer's mutable review.
 * An environment label, review document or injected transport alone is not authority. */
export function productionAffiliateNotificationGate(db: Firestore, env: NodeJS.ProcessEnv, delivery = false): 'allowed' | 'disabled' | 'blocked' {
  if (!env.AFFILIATE_NOTIFICATION_EVENT_MODE || env.AFFILIATE_NOTIFICATION_EVENT_MODE === 'off') return 'disabled';
  const target = getFirestoreClientTarget(db);
  if (env.AFFILIATE_NOTIFICATION_EVENT_MODE !== 'production_held' || !productionAffiliateNotificationMode(env)
    || env.VERCEL_ENV !== 'production' || env.FIREBASE_PROJECT_ID !== AFFILIATE_NOTIFICATION_PRODUCTION_PROJECT
    || (env.FIRESTORE_DATABASE_ID || '(default)') !== '(default)'
    || target?.projectId !== AFFILIATE_NOTIFICATION_PRODUCTION_PROJECT || target.firestoreDatabaseId !== '(default)'
    || env.AFFILIATE_NOTIFICATION_PRODUCTION_BASE_URL !== AFFILIATE_NOTIFICATION_PRODUCTION_ORIGIN
    || !signingSecret(env) || env.FIRESTORE_EMULATOR_HOST || env.FIREBASE_AUTH_EMULATOR_HOST || env.FIREBASE_DATABASE_EMULATOR_HOST
    || !env.RESEND_API_KEY?.trim() || !env.NEWSLETTER_FROM_EMAIL?.trim() || /[\r\n]/.test(env.NEWSLETTER_FROM_EMAIL)
    || delivery && !env.RESEND_WEBHOOK_SECRET?.trim()
    || productionAffiliateNotificationMode(env) === 'production_test' && !HASH.test(env.AFFILIATE_NOTIFICATION_TEST_RECIPIENT_SHA256 || '')) return 'blocked';
  return 'allowed';
}

function validEnvelope(value: unknown, env: NodeJS.ProcessEnv): value is SignedRollout {
  if (!record(value) || !exact(value, ['schemaVersion', 'revision', 'state', 'review', 'reviewSha256', 'signature'])
    || value.schemaVersion !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 1
    || !['reviewed', 'paused'].includes(value.state) || !record(value.review) || !signingSecret(env)
    || !HASH.test(value.reviewSha256) || !HASH.test(value.signature)) return false;
  const { signature: signed, ...unsigned } = value;
  const expected = signature(unsigned as Omit<SignedRollout, 'signature'>, env);
  if (!crypto.timingSafeEqual(Buffer.from(signed), Buffer.from(expected))) return false;
  const review = value.review;
  if (!exact(review, ['schemaVersion', 'revision', 'mode', 'projectId', 'databaseId', 'canonicalBaseUrl', 'fromEmail',
    'providerAccountSha256', 'settingsRevision', 'settingsSha256', 'activatedAt', 'reviewedAt', 'expiresAt', 'reviewedBySha256', 'testRecipient', 'verifiedTestDeliveryId', 'foundingWelcome'])
    || review.schemaVersion !== 1 || !Number.isSafeInteger(review.revision) || review.revision < 1 || review.revision > value.revision
    || review.projectId !== AFFILIATE_NOTIFICATION_PRODUCTION_PROJECT || review.databaseId !== '(default)'
    || review.canonicalBaseUrl !== AFFILIATE_NOTIFICATION_PRODUCTION_ORIGIN
    || !['production_test', 'production_live'].includes(review.mode)
    || typeof review.fromEmail !== 'string' || !review.fromEmail.trim() || /[\r\n]/.test(review.fromEmail)
    || !HASH.test(review.providerAccountSha256)
    || !Number.isSafeInteger(review.settingsRevision) || review.settingsRevision < 0
    || !HASH.test(review.settingsSha256) || !HASH.test(review.reviewedBySha256)
    || affiliateNotificationRolloutHash(review) !== value.reviewSha256) return false;
  const activated = time(review.activatedAt), reviewed = time(review.reviewedAt), expires = time(review.expiresAt);
  if (activated === null || reviewed === null || expires === null || activated > reviewed || expires <= reviewed
    || expires - reviewed > AFFILIATE_NOTIFICATION_REVIEW_MAX_DAYS * DAY) return false;
  if (review.mode === 'production_test') {
    if (typeof review.testRecipient !== 'string' || normalizeNewsletterEmail(review.testRecipient) !== review.testRecipient
      || review.foundingWelcome !== undefined || review.verifiedTestDeliveryId !== undefined) return false;
  } else if (review.testRecipient !== undefined || typeof review.verifiedTestDeliveryId !== 'string' || !/^nld_[a-f0-9]{48}$/.test(review.verifiedTestDeliveryId)) return false;
  if (review.foundingWelcome !== undefined && (!record(review.foundingWelcome)
    || !exact(review.foundingWelcome, ['affiliateIds', 'markerSha256']) || !HASH.test(review.foundingWelcome.markerSha256)
    || !Array.isArray(review.foundingWelcome.affiliateIds) || review.foundingWelcome.affiliateIds.length !== 9
    || review.foundingWelcome.affiliateIds.some((id: unknown) => typeof id !== 'string' || !SAFE_ID.test(id))
    || new Set(review.foundingWelcome.affiliateIds).size !== 9)) return false;
  return true;
}
function transportMatches(review: ProductionAffiliateNotificationReview, env: NodeJS.ProcessEnv): boolean {
  return review.mode === productionAffiliateNotificationMode(env) && review.fromEmail === env.NEWSLETTER_FROM_EMAIL?.trim()
    && review.providerAccountSha256 === rawHash(env.RESEND_API_KEY?.trim() || '')
    && (review.mode !== 'production_test' || rawHash(review.testRecipient!) === env.AFFILIATE_NOTIFICATION_TEST_RECIPIENT_SHA256);
}

export class AffiliateNotificationRolloutError extends Error {
  constructor(readonly code: 'blocked' | 'invalid' | 'conflict' | 'unavailable', readonly statusCode = code === 'invalid' ? 400 : code === 'conflict' ? 409 : 503) {
    super(`Partner notification review ${code}. No email or account changes were performed.`);
    this.name = 'AffiliateNotificationRolloutError';
  }
}
export function parseProductionAffiliateNotificationReviewRequest(value: unknown): ProductionAffiliateNotificationReviewRequest | null {
  if (!record(value) || !exact(value, ['expectedRevision', 'mode', 'durationDays', 'includeFoundingWelcome'])
    || Object.keys(value).length !== 4 || !Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 0
    || !['production_test', 'production_live'].includes(value.mode) || !Number.isSafeInteger(value.durationDays)
    || value.durationDays < 1 || value.durationDays > AFFILIATE_NOTIFICATION_REVIEW_MAX_DAYS || typeof value.includeFoundingWelcome !== 'boolean'
    || value.mode === 'production_test' && value.includeFoundingWelcome) return null;
  return value as unknown as ProductionAffiliateNotificationReviewRequest;
}

/** Server routes must first authenticate the writer and pass their actual
 * account email, never an address copied from a request body. */
export async function saveProductionAffiliateNotificationReview(input: {
  db: Firestore; request: ProductionAffiliateNotificationReviewRequest; authenticatedWriterEmail: string; approvedTestRecipient?: string; now?: string;
}, env: NodeJS.ProcessEnv = process.env): Promise<ProductionAffiliateNotificationRolloutStatus> {
  const request = parseProductionAffiliateNotificationReviewRequest(input.request);
  const writer = normalizeNewsletterEmail(input.authenticatedWriterEmail);
  const testRecipient = normalizeNewsletterEmail(input.approvedTestRecipient ?? env.AFFILIATE_NOTIFICATION_TEST_RECIPIENT_EMAIL);
  const now = input.now || new Date().toISOString();
  if (!request || !writer || time(now) === null) throw new AffiliateNotificationRolloutError('invalid');
  if (productionAffiliateNotificationGate(input.db, env, true) !== 'allowed' || request.mode !== productionAffiliateNotificationMode(env)
    || request.mode === 'production_test' && (!testRecipient || rawHash(testRecipient) !== env.AFFILIATE_NOTIFICATION_TEST_RECIPIENT_SHA256)) throw new AffiliateNotificationRolloutError('blocked');
  const ref = input.db.collection('site_configs').doc(AFFILIATE_NOTIFICATION_ROLLOUT_DOCUMENT_ID);
  try {
    await input.db.runTransaction(async transaction => {
      const [snapshot, settingsSnapshot] = await transaction.getAll(ref, input.db.collection('site_configs').doc('affiliate_notifications'));
      const previous = snapshot.data();
      // A valid old review may be renewed after expiry/settings changes, but a
      // corrupt signature is never overwritten as an automatic repair.
      if (snapshot.exists && !validEnvelope(previous, env)) throw new AffiliateNotificationRolloutError('conflict');
      if ((snapshot.exists ? previous!.revision : 0) !== request.expectedRevision) throw new AffiliateNotificationRolloutError('conflict');
      if (!settingsSnapshot.exists) throw new AffiliateNotificationRolloutError('invalid');
      const settings = validateAffiliateNotificationSettings(settingsSnapshot.data());
      let verifiedTestDeliveryId: string | undefined;
      if (request.mode === 'production_live') {
        // First activation needs a signed delivery receipt for the separately
        // committed writer test, not a successful mock or provider acceptance.
        verifiedTestDeliveryId = previous?.review.mode === 'production_live' ? previous.review.verifiedTestDeliveryId
          : previous?.review.mode === 'production_test' ? productionAffiliateNotificationTestDeliveryId(previous.reviewSha256) : undefined;
        if (!verifiedTestDeliveryId || !HASH.test(env.AFFILIATE_NOTIFICATION_TEST_RECIPIENT_SHA256 || '')
          || previous.review.fromEmail !== env.NEWSLETTER_FROM_EMAIL!.trim()
          || previous.review.providerAccountSha256 !== rawHash(env.RESEND_API_KEY!.trim())) throw new AffiliateNotificationRolloutError('blocked');
        const proof = await transaction.get(input.db.collection('affiliate_notification_deliveries').doc(verifiedTestDeliveryId));
        const delivery = proof.data();
        if (!proof.exists || !validWriterTest(delivery, verifiedTestDeliveryId) || delivery.status !== 'delivered'
          || delivery.recipientEmailSha256 !== env.AFFILIATE_NOTIFICATION_TEST_RECIPIENT_SHA256
          || !delivery.providerMessageId || !delivery.lastWebhookAt || !delivery.lastWebhookEventIdSha256
          || time(delivery.lastWebhookAt)! > time(now)!
          || previous.review.mode === 'production_test' && time(now)! - time(delivery.lastWebhookAt)! > 7 * DAY) throw new AffiliateNotificationRolloutError('blocked');
      }
      let foundingWelcome: ProductionAffiliateNotificationReview['foundingWelcome'];
      if (request.includeFoundingWelcome) {
        const marker = await transaction.get(input.db.collection('migration_markers').doc(CORE_MARKER));
        const members = await transaction.get(input.db.collection('affiliates').where('literaryCircle.foundingMember', '==', true).limit(10));
        const evidence = marker.data();
        if (!marker.exists || evidence?.kind !== CORE_MARKER || evidence.status !== 'complete'
          || evidence.projectId !== AFFILIATE_NOTIFICATION_PRODUCTION_PROJECT || evidence.databaseId !== '(default)'
          || evidence.foundingCohortSha256 !== AFFILIATE_NOTIFICATION_FOUNDING_COHORT_SHA256 || members.docs.length !== 9) throw new AffiliateNotificationRolloutError('conflict');
        const cohort = members.docs.map(member => ({ id: member.id, code: String(member.data().affiliateCode || '').trim().toUpperCase(),
          emailHash: rawHash(normalizeNewsletterEmail(member.data().email) || '') })).sort((a, b) => a.id.localeCompare(b.id));
        if (cohort.some(member => !SAFE_ID.test(member.id) || !member.code)
          || affiliateNotificationRolloutHash(cohort) !== AFFILIATE_NOTIFICATION_FOUNDING_COHORT_SHA256) throw new AffiliateNotificationRolloutError('conflict');
        foundingWelcome = { affiliateIds: cohort.map(member => member.id), markerSha256: affiliateNotificationRolloutHash(evidence) };
      }
      const review: ProductionAffiliateNotificationReview = {
        schemaVersion: 1, revision: request.expectedRevision + 1, mode: request.mode,
        projectId: AFFILIATE_NOTIFICATION_PRODUCTION_PROJECT, databaseId: '(default)', canonicalBaseUrl: AFFILIATE_NOTIFICATION_PRODUCTION_ORIGIN,
        fromEmail: env.NEWSLETTER_FROM_EMAIL!.trim(), providerAccountSha256: rawHash(env.RESEND_API_KEY!.trim()),
        settingsRevision: settings.revision, settingsSha256: affiliateNotificationRolloutHash(settings),
        activatedAt: now, reviewedAt: now, expiresAt: new Date(time(now)! + request.durationDays * DAY).toISOString(),
        reviewedBySha256: rawHash(writer), ...(request.mode === 'production_test' ? { testRecipient: testRecipient! } : {}),
        ...(verifiedTestDeliveryId ? { verifiedTestDeliveryId } : {}),
        ...(foundingWelcome ? { foundingWelcome } : {}),
      };
      const next = seal({ schemaVersion: 1, revision: review.revision, state: 'reviewed', review, reviewSha256: affiliateNotificationRolloutHash(review) }, env);
      transaction.set(ref, next);
      const auditId = `notification_review_${crypto.randomBytes(16).toString('hex')}`;
      transaction.create(input.db.collection('affiliate_audit').doc(auditId), {
        id: auditId, actor: 'Authenticated writer', action: 'affiliate_notification_production_reviewed', targetType: 'notification',
        targetId: AFFILIATE_NOTIFICATION_ROLLOUT_DOCUMENT_ID, timestamp: now,
        summary: 'Reviewed prospective partner notifications; existing accounts, consent and financial records preserved.',
        newValue: { revision: next.revision, mode: review.mode, settingsRevision: settings.revision, activatedAt: now,
          expiresAt: review.expiresAt, reviewSha256: next.reviewSha256, foundingWelcomeCount: foundingWelcome?.affiliateIds.length || 0 },
      });
    });
    return getProductionAffiliateNotificationRolloutStatus({ db: input.db, now }, env);
  } catch (error) {
    if (error instanceof AffiliateNotificationRolloutError) throw error;
    throw new AffiliateNotificationRolloutError('unavailable');
  }
}

export async function pauseProductionAffiliateNotifications(input: {
  db: Firestore; expectedRevision: number; authenticatedWriterEmail: string; now?: string;
}, env: NodeJS.ProcessEnv = process.env): Promise<ProductionAffiliateNotificationRolloutStatus> {
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1 || !normalizeNewsletterEmail(input.authenticatedWriterEmail)) throw new AffiliateNotificationRolloutError('invalid');
  if (productionAffiliateNotificationGate(input.db, env) !== 'allowed') throw new AffiliateNotificationRolloutError('blocked');
  const now = input.now || new Date().toISOString();
  if (time(now) === null) throw new AffiliateNotificationRolloutError('invalid');
  const ref = input.db.collection('site_configs').doc(AFFILIATE_NOTIFICATION_ROLLOUT_DOCUMENT_ID);
  try {
    await input.db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref); const previous = snapshot.data();
      if (!snapshot.exists || !validEnvelope(previous, env) || previous.revision !== input.expectedRevision) throw new AffiliateNotificationRolloutError('conflict');
      if (previous.state === 'paused') return;
      const { signature: _signature, ...unsigned } = previous;
      transaction.set(ref, seal({ ...unsigned, revision: previous.revision + 1, state: 'paused' }, env));
      const auditId = `notification_pause_${crypto.randomBytes(16).toString('hex')}`;
      transaction.create(input.db.collection('affiliate_audit').doc(auditId), {
        id: auditId, actor: 'Authenticated writer', action: 'affiliate_notification_production_paused', targetType: 'notification',
        targetId: AFFILIATE_NOTIFICATION_ROLLOUT_DOCUMENT_ID, timestamp: now,
        summary: 'Paused partner notifications without altering accounts, consent, purchases or earnings.', newValue: { revision: previous.revision + 1 },
      });
    });
    return getProductionAffiliateNotificationRolloutStatus({ db: input.db, now }, env);
  } catch (error) { if (error instanceof AffiliateNotificationRolloutError) throw error; throw new AffiliateNotificationRolloutError('unavailable'); }
}

export async function readProductionAffiliateNotificationReview(input: {
  db: Firestore; transaction?: Transaction; now: string;
}, env: NodeJS.ProcessEnv = process.env): Promise<{ review: ProductionAffiliateNotificationReview; reviewSha256: string; envelopeSha256: string } | null> {
  if (productionAffiliateNotificationGate(input.db, env) !== 'allowed' || time(input.now) === null) return null;
  const refs = [input.db.collection('site_configs').doc(AFFILIATE_NOTIFICATION_ROLLOUT_DOCUMENT_ID), input.db.collection('site_configs').doc('affiliate_notifications')];
  const snapshots = input.transaction ? await input.transaction.getAll(...refs) : await input.db.getAll(...refs);
  const value = snapshots[0]?.data();
  if (!snapshots[0]?.exists || !validEnvelope(value, env) || !transportMatches(value.review, env) || value.state !== 'reviewed'
    || time(value.review.reviewedAt)! > time(input.now)! || time(value.review.expiresAt)! <= time(input.now)! || !snapshots[1]?.exists) return null;
  const settings = validateAffiliateNotificationSettings(snapshots[1].data());
  if (value.review.settingsRevision !== settings.revision || value.review.settingsSha256 !== affiliateNotificationRolloutHash(settings)) return null;
  return { review: value.review, reviewSha256: value.reviewSha256, envelopeSha256: affiliateNotificationRolloutHash(value) };
}

/** No email address, source identity, hash/signature or provider configuration is
 * exposed through the writer's status endpoint. */
export async function getProductionAffiliateNotificationRolloutStatus(input: {
  db: Firestore; now?: string;
}, env: NodeJS.ProcessEnv = process.env): Promise<ProductionAffiliateNotificationRolloutStatus> {
  const now = input.now || new Date().toISOString(); const gate = productionAffiliateNotificationGate(input.db, env);
  const empty = { revision: 0, environmentMode: productionAffiliateNotificationMode(env), foundingWelcomeCount: 0,
    maximumReviewDays: AFFILIATE_NOTIFICATION_REVIEW_MAX_DAYS, testRecipientConfigured: HASH.test(env.AFFILIATE_NOTIFICATION_TEST_RECIPIENT_SHA256 || ''),
    // Review capability is not delivery authority. A test-to-live deployment
    // intentionally mismatches its old signed mode until the writer reviews it.
    reviewAvailable: productionAffiliateNotificationGate(input.db, env, true) === 'allowed' };
  if (gate !== 'allowed') return { ...empty, status: gate };
  const [snapshot, settingsSnapshot] = await input.db.getAll(input.db.collection('site_configs').doc(AFFILIATE_NOTIFICATION_ROLLOUT_DOCUMENT_ID),
    input.db.collection('site_configs').doc('affiliate_notifications'));
  if (!snapshot?.exists) return { ...empty, status: 'unreviewed' };
  const value = snapshot.data();
  if (!validEnvelope(value, env) || !transportMatches(value.review, env) || time(now) === null) return { ...empty, revision: Number.isSafeInteger(value?.revision) ? value.revision : 0, status: 'blocked' };
  const safe = { ...empty, revision: value.revision, mode: value.review.mode, activatedAt: value.review.activatedAt,
    expiresAt: value.review.expiresAt, settingsRevision: value.review.settingsRevision, foundingWelcomeCount: value.review.foundingWelcome?.affiliateIds.length || 0 };
  if (value.state === 'paused') return { ...safe, status: 'paused' };
  if (time(value.review.expiresAt)! <= time(now)! || time(value.review.reviewedAt)! > time(now)!) return { ...safe, status: 'expired' };
  const settings: LiteraryCircleNotificationSettings | null = settingsSnapshot?.exists ? validateAffiliateNotificationSettings(settingsSnapshot.data()) : null;
  const testRef = value.review.mode === 'production_test'
    ? input.db.collection('affiliate_notification_deliveries').doc(productionAffiliateNotificationTestDeliveryId(value.reviewSha256)) : null;
  const test = testRef ? (await input.db.getAll(testRef))[0] : null;
  const testStatus = test?.exists && validWriterTest(test.data(), testRef!.id) ? { testDeliveryStatus: test.data()!.status as string } : {};
  return { ...safe, ...testStatus, status: settings && settings.revision === value.review.settingsRevision && affiliateNotificationRolloutHash(settings) === value.review.settingsSha256 ? 'ready' : 'settings_changed' };
}

/** Production test mode cannot authorize any ordinary affiliate message. Live
 * sources are prospective; the only historical exception is an explicitly
 * reviewed welcome for the preserved, marker-bound original founding cohort. */
export async function authorizeProductionAffiliateNotificationSource(input: {
  db: Firestore; source: AffiliateNotificationSource; now: string; transaction?: Transaction;
}, env: NodeJS.ProcessEnv = process.env): Promise<{ reviewSha256: string; expiresAt: string; envelopeSha256: string } | null> {
  const loaded = await readProductionAffiliateNotificationReview(input, env);
  if (!loaded || loaded.review.mode !== 'production_live') return null;
  const occurred = time(input.source.occurredAt), now = time(input.now);
  if (occurred === null || now === null || occurred > now) return null;
  if (occurred < time(loaded.review.activatedAt)!) {
    const welcome = loaded.review.foundingWelcome;
    if (input.source.eventType !== 'activation' || !input.source.targetAffiliateId || !welcome?.affiliateIds.includes(input.source.targetAffiliateId)) return null;
    const ref = input.db.collection('migration_markers').doc(CORE_MARKER);
    const snapshot = input.transaction ? await input.transaction.get(ref) : (await input.db.getAll(ref))[0];
    if (!snapshot?.exists || affiliateNotificationRolloutHash(snapshot.data()) !== welcome.markerSha256) return null;
  }
  return { reviewSha256: loaded.reviewSha256, expiresAt: loaded.review.expiresAt, envelopeSha256: loaded.envelopeSha256 };
}

export function productionAffiliateNotificationTestDeliveryId(reviewSha256: string): string {
  return `nld_${affiliateNotificationRolloutHash(['writer_delivery_test_v1', reviewSha256]).slice(0, 48)}`;
}
interface WriterTestDelivery {
  schemaVersion: 1; kind: 'writer_test'; id: string; reviewSha256: string; recipientEmailSha256: string;
  contentSha256: string; status: string; attemptCount: number; createdAt: string; updatedAt: string;
  leaseToken: string; leaseExpiresAt: string; firstAttemptAt?: string; providerMessageId?: string;
  lastWebhookEventIdSha256?: string; lastWebhookAt?: string;
}
function validWriterTest(value: unknown, id: string): value is WriterTestDelivery {
  return record(value) && exact(value, ['schemaVersion', 'kind', 'id', 'reviewSha256', 'recipientEmailSha256', 'contentSha256', 'status',
    'attemptCount', 'createdAt', 'updatedAt', 'leaseToken', 'leaseExpiresAt', 'firstAttemptAt', 'providerMessageId', 'lastWebhookEventIdSha256', 'lastWebhookAt'])
    && value.schemaVersion === 1 && value.kind === 'writer_test' && value.id === id && HASH.test(value.reviewSha256)
    && productionAffiliateNotificationTestDeliveryId(value.reviewSha256) === id
    && HASH.test(value.recipientEmailSha256) && HASH.test(value.contentSha256) && /^[a-f0-9]{48}$/.test(value.leaseToken)
    && ['leased', 'dispatching', 'cancelled', 'accepted', 'delivered', 'bounced', 'complained', 'suppressed', 'failed', 'needs_investigation'].includes(value.status)
    && (value.attemptCount === 0 || value.attemptCount === 1) && time(value.createdAt) !== null && time(value.updatedAt) !== null
    && time(value.leaseExpiresAt) !== null && (value.firstAttemptAt === undefined || time(value.firstAttemptAt) !== null)
    && (value.providerMessageId === undefined || typeof value.providerMessageId === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value.providerMessageId))
    && (value.lastWebhookEventIdSha256 === undefined || HASH.test(value.lastWebhookEventIdSha256))
    && (value.lastWebhookAt === undefined || time(value.lastWebhookAt) !== null);
}
async function writerTestSuppressed(db: Firestore, transaction: Transaction, email: string): Promise<boolean> {
  const hash = newsletterEmailIndexId(email);
  const [suppression, index] = await transaction.getAll(db.collection('affiliate_notification_deliveries').doc(`suppression_${hash}`),
    db.collection('newsletter_email_index').doc(hash));
  if (suppression.exists) return true;
  if (!index.exists) return false;
  const value = index.data();
  if (value?.storageVersion !== 1 || value.emailHash !== hash || typeof value.subscriberId !== 'string' || !/^sub_[A-Za-z0-9_-]{12,}$/.test(value.subscriberId)) return true;
  const subscriber = await transaction.get(db.collection('newsletter_subscribers').doc(value.subscriberId));
  const data = subscriber.data();
  return !subscriber.exists || data?.email !== email || data.emailIndexId !== hash || data.storageVersion !== 1 || !['active', 'pending', 'unsubscribed'].includes(data.status);
}

/** One controlled operational writer email per review. It never impersonates
 * an affiliate, creates an account/commission or drains a marketing audience.
 * Ambiguous attempts are not blindly retried; the writer reviews the outcome. */
export async function sendProductionAffiliateNotificationTest(input: {
  db: Firestore; authenticatedWriterEmail: string; approvedTestRecipient?: string; clock?: () => string; sendEmail?: typeof sendNewsletterEmail;
}, env: NodeJS.ProcessEnv = process.env): Promise<{ status: 'accepted' | 'already_processed' | 'blocked' | 'ineligible' | 'failed'; deliveryId?: string }> {
  const writer = normalizeNewsletterEmail(input.authenticatedWriterEmail);
  const recipient = normalizeNewsletterEmail(input.approvedTestRecipient ?? env.AFFILIATE_NOTIFICATION_TEST_RECIPIENT_EMAIL);
  if (productionAffiliateNotificationGate(input.db, env, true) !== 'allowed' || productionAffiliateNotificationMode(env) !== 'production_test'
    || !writer || !recipient || rawHash(recipient) !== env.AFFILIATE_NOTIFICATION_TEST_RECIPIENT_SHA256) return { status: 'blocked' };
  const transportMatches = () => Boolean(input.sendEmail) || ['RESEND_API_KEY', 'NEWSLETTER_FROM_EMAIL', 'NEWSLETTER_REPLY_TO']
    .every(key => (env[key] || '').trim() === (process.env[key] || '').trim());
  if (!transportMatches()) return { status: 'blocked' };
  const clock = input.clock || (() => new Date().toISOString()); const now = clock();
  if (time(now) === null) return { status: 'ineligible' };
  const loaded = await readProductionAffiliateNotificationReview({ db: input.db, now }, env);
  if (!loaded || loaded.review.mode !== 'production_test' || loaded.review.testRecipient !== recipient) return { status: 'ineligible' };
  const id = productionAffiliateNotificationTestDeliveryId(loaded.reviewSha256);
  const ref = input.db.collection('affiliate_notification_deliveries').doc(id);
  const leaseToken = crypto.randomBytes(24).toString('hex');
  const message = { to: recipient, subject: 'Ink & Witness Literary Circle — controlled delivery test',
    text: 'This is the writer’s controlled Literary Circle email delivery test. No affiliate or customer emails were sent by this test. No accounts, purchases, commissions or marketing consent were changed.',
    html: '<p>This is the writer’s controlled Literary Circle email delivery test.</p><p>No affiliate or customer emails were sent by this test. No accounts, purchases, commissions or marketing consent were changed.</p>' };
  const contentSha256 = affiliateNotificationRolloutHash({ message, from: loaded.review.fromEmail,
    providerAccountSha256: loaded.review.providerAccountSha256, replyTo: env.NEWSLETTER_REPLY_TO?.trim() || null });
  try {
    const claimed = await input.db.runTransaction(async transaction => {
      const fresh = await readProductionAffiliateNotificationReview({ db: input.db, transaction, now: clock() }, env);
      const previous = await transaction.get(ref);
      const suppressed = await writerTestSuppressed(input.db, transaction, recipient);
      if (!fresh || fresh.envelopeSha256 !== loaded.envelopeSha256 || suppressed) return 'ineligible' as const;
      if (previous.exists) return validWriterTest(previous.data(), id) ? 'already_processed' as const : 'ineligible' as const;
      transaction.create(ref, { schemaVersion: 1, kind: 'writer_test', id, reviewSha256: loaded.reviewSha256,
        recipientEmailSha256: rawHash(recipient), contentSha256, status: 'leased', attemptCount: 0, createdAt: now, updatedAt: now,
        leaseToken, leaseExpiresAt: new Date(Math.min(time(now)! + 120_000, time(loaded.review.expiresAt)!)).toISOString() } satisfies WriterTestDelivery);
      return 'claimed' as const;
    });
    if (claimed !== 'claimed') return { status: claimed, deliveryId: id };
    const dispatch = await input.db.runTransaction(async transaction => {
      const at = clock(); const fresh = await readProductionAffiliateNotificationReview({ db: input.db, transaction, now: at }, env);
      const snapshot = await transaction.get(ref); const previous = snapshot.data();
      const suppressed = await writerTestSuppressed(input.db, transaction, recipient);
      if (!validWriterTest(previous, id) || previous.status !== 'leased' || previous.leaseToken !== leaseToken) return null;
      if (!fresh || fresh.envelopeSha256 !== loaded.envelopeSha256 || suppressed || time(at) === null || time(at)! >= time(previous.leaseExpiresAt)!) {
        transaction.set(ref, { ...previous, status: 'cancelled', updatedAt: at }); return null;
      }
      transaction.set(ref, { ...previous, status: 'dispatching', attemptCount: 1, firstAttemptAt: at, updatedAt: at });
      return { leaseExpiresAt: previous.leaseExpiresAt, authorizationExpiresAt: fresh.review.expiresAt };
    });
    const at = time(clock());
    if (!dispatch || at === null || at >= time(dispatch.leaseExpiresAt)! || at >= time(dispatch.authorizationExpiresAt)! || !transportMatches()) return { status: 'ineligible', deliveryId: id };
    let providerMessageId: string;
    try {
      const result = await (input.sendEmail || sendNewsletterEmail)({ ...message, idempotencyKey: `affiliate-writer-test-v1:${id}`, deliveryId: id });
      if (!result || !/^[A-Za-z0-9_-]{1,200}$/.test(result.providerMessageId)) throw new Error('Unconfirmed provider acknowledgement.');
      providerMessageId = result.providerMessageId;
    } catch {
      await input.db.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref); const previous = snapshot.data();
        if (validWriterTest(previous, id) && previous.leaseToken === leaseToken && previous.status === 'dispatching') {
          transaction.set(ref, { ...previous, status: 'needs_investigation', updatedAt: clock() });
        }
      });
      return { status: 'failed', deliveryId: id };
    }
    await input.db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref); const previous = snapshot.data();
      if (!validWriterTest(previous, id) || previous.leaseToken !== leaseToken || previous.providerMessageId && previous.providerMessageId !== providerMessageId) throw new Error('Writer test acknowledgement conflict.');
      transaction.set(ref, { ...previous, providerMessageId, status: previous.status === 'dispatching' ? 'accepted' : previous.status, updatedAt: clock() });
    });
    return { status: 'accepted', deliveryId: id };
  } catch { return { status: 'failed', deliveryId: id }; }
}

/** Called only after the existing Resend raw-body signature verifier. A return
 * of null means this is not a writer-test record; normal partner reconciliation
 * continues. No raw recipient/provider body is persisted. */
export async function reconcileProductionAffiliateNotificationTest(input: {
  db: Firestore; deliveryId: string; providerMessageId: string; eventId: string; eventAt: string;
  recipients: unknown; status: string; now: string;
}): Promise<{ status: 'recorded' | 'invalid' } | null> {
  const ref = input.db.collection('affiliate_notification_deliveries').doc(input.deliveryId);
  return input.db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref); const previous = snapshot.data();
    if (!snapshot.exists || previous?.kind !== 'writer_test') return null;
    if (!validWriterTest(previous, input.deliveryId) || previous.attemptCount !== 1 || !previous.firstAttemptAt
      || time(input.now) === null || time(input.eventAt) === null || time(input.eventAt)! > time(input.now)! + 300_000
      || time(input.eventAt)! < time(previous.firstAttemptAt)! - 60_000 || !/^[A-Za-z0-9_-]{1,200}$/.test(input.providerMessageId)
      || previous.providerMessageId && previous.providerMessageId !== input.providerMessageId
      || !Array.isArray(input.recipients) || input.recipients.length !== 1 || !normalizeNewsletterEmail(input.recipients[0])
      || rawHash(normalizeNewsletterEmail(input.recipients[0])!) !== previous.recipientEmailSha256
      || !['sent', 'delivered', 'bounced', 'complained', 'suppressed', 'failed'].includes(input.status)) return { status: 'invalid' as const };
    const eventHash = affiliateNotificationRolloutHash(input.eventId);
    if (previous.lastWebhookEventIdSha256 === eventHash) return { status: 'recorded' as const };
    const severe = ['bounced', 'complained', 'suppressed'].includes(input.status);
    const suppressionRef = input.db.collection('affiliate_notification_deliveries').doc(`suppression_${previous.recipientEmailSha256}`);
    const suppression = severe ? await transaction.get(suppressionRef) : null;
    // Provider suppression is shared with public newsletters. Keep the same
    // index/identity proof used for ordinary partner callbacks: a test bounce
    // must not leave a newsletter subscriber eligible for another send.
    const indexRef = input.db.collection('newsletter_email_index').doc(previous.recipientEmailSha256);
    const indexSnapshot = severe ? await transaction.get(indexRef) : null;
    const index = indexSnapshot?.data();
    const subscriberRef = index && index.storageVersion === 1 && index.emailHash === previous.recipientEmailSha256
      && typeof index.subscriberId === 'string' && /^sub_[A-Za-z0-9_-]{12,}$/.test(index.subscriberId)
      ? input.db.collection('newsletter_subscribers').doc(index.subscriberId) : null;
    const subscriberSnapshot = subscriberRef ? await transaction.get(subscriberRef) : null;
    const subscriber = subscriberSnapshot?.data();
    const keep = ['bounced', 'complained', 'suppressed', 'failed'].includes(previous.status) || previous.status === 'delivered' && ['sent', 'failed'].includes(input.status);
    transaction.set(ref, { ...previous, status: severe ? input.status : keep ? previous.status : input.status === 'sent' ? 'accepted' : input.status,
      providerMessageId: input.providerMessageId, updatedAt: input.now, lastWebhookAt: input.eventAt, lastWebhookEventIdSha256: eventHash });
    if (severe && !suppression?.exists) transaction.create(suppressionRef, { schemaVersion: 1, kind: 'provider_suppression',
      emailSha256: previous.recipientEmailSha256, reason: input.status, deliveryId: previous.id, createdAt: input.now });
    if (severe && subscriberRef && subscriberSnapshot?.exists && subscriber
      && subscriber.storageVersion === 1 && subscriber.emailIndexId === previous.recipientEmailSha256
      && typeof subscriber.email === 'string' && newsletterEmailIndexId(subscriber.email) === previous.recipientEmailSha256
      && subscriber.status !== 'suppressed') {
      transaction.set(subscriberRef, { status: 'suppressed', suppressionReason: input.status, updatedAt: input.now },
        { mergeFields: ['status', 'suppressionReason', 'updatedAt'] });
    }
    return { status: 'recorded' as const };
  });
}
