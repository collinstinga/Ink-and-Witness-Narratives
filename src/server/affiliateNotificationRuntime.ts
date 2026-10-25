import crypto from 'crypto';
import { FieldPath } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';
import type {
  AffiliatePublicProfile,
  AffiliateNotificationRuntimeMode as RuntimeMode,
  AffiliateNotificationRuntimeResult,
  AffiliateNotificationRuntimeStatus,
} from '../types.js';
export type { AffiliateNotificationRuntimeResult } from '../types.js';
import {
  affiliateNotificationSourceGate,
  prepareCommittedAffiliateNotification,
  resolveAffiliateNotificationSource,
  type ResolvedAffiliateNotificationSource,
} from './affiliateNotificationEvents.js';
import {
  inspectScheduledAffiliateNotificationSource,
  prepareScheduledAffiliateNotifications,
} from './affiliateNotificationSchedule.js';
import { campaignNotificationAuditId, literaryCircleNotificationAuditId } from './affiliateNotificationAudit.js';
import { planAffiliateNotifications } from './affiliateNotificationPlan.js';
import { validateAffiliateNotificationSettings } from './affiliateNotifications.js';
import {
  AUTOMATIC_AFFILIATE_NOTIFICATION_TIER_FILTER_UNSUPPORTED,
  verifiedManualAffiliateNotificationTierIds,
} from './affiliateNotificationTierFilter.js';
import {
  AFFILIATE_NOTIFICATION_DELIVERY_COLLECTION,
  affiliateNotificationDeliveryGate,
  affiliateNotificationDeliveryHash as hash,
  deliverHeldAffiliateNotification,
  type AffiliateNotificationSourceVerifier,
} from './affiliateNotificationDelivery.js';
import type { sendNewsletterEmail } from './newsletterEmail.js';

export const AFFILIATE_NOTIFICATION_RUNTIME_LIMITS = Object.freeze({
  activeAffiliates: 200,
  campaigns: 100,
  releaseCampaigns: 100,
  communityPosts: 40,
  preparedSourcesPerRun: 20,
  inactivityBatch: 25,
  deliveryPage: 20,
  dispatchedIntentsPerRun: 10,
  statusDeliveries: 500,
  statusIntents: 1_000,
});
const OUTBOX = 'affiliate_notification_outbox';
const PREPARE_CURSOR = 'runtime_prepare_cursor_v1';
const DELIVERY_CURSOR = 'runtime_delivery_cursor_v1';
const CURSOR_LEASE_MS = 10 * 60_000;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const INTENT_ID = /^ani1_[a-f0-9]{64}$/;
const TERMINAL = new Set(['accepted', 'delivered', 'bounced', 'complained', 'suppressed', 'failed', 'dead_letter', 'cancelled']);
const DELIVERY_STATUSES = new Set([...TERMINAL, 'leased', 'dispatching', 'retry_pending']);

type RuntimeStatus = AffiliateNotificationRuntimeResult['status'];
type Counts = Record<string, number>;

interface RuntimeCursor {
  schemaVersion: 1;
  kind: 'runtime_cursor';
  id: string;
  mode: RuntimeMode;
  afterKey: string | null;
  updatedAt: string;
  leaseToken?: string;
  leaseExpiresAt?: string;
  lastCompletedAt?: string;
}

interface SourceCandidate {
  key: string;
  kind: 'new_release' | 'upcoming_campaign' | 'exclusive_opportunity';
  sourceId: string;
  evidenceId?: string;
  occurredAt?: string;
}

function record(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function iso(value: unknown): number | null {
  const milliseconds = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(milliseconds) && milliseconds > 0 && new Date(milliseconds).toISOString() === value ? milliseconds : null;
}

function increment(counts: Counts, key: string, value = 1): void { counts[key] = (counts[key] || 0) + value; }

function result(mode: RuntimeMode, status: RuntimeStatus): AffiliateNotificationRuntimeResult {
  return { mode, status, attempted: 0, scanned: 0, intentCount: 0, counts: {} };
}

function validCursor(value: unknown, id: string, mode: RuntimeMode, now: number): value is RuntimeCursor {
  return record(value) && Object.keys(value).every(key => ['schemaVersion', 'kind', 'id', 'mode', 'afterKey', 'updatedAt', 'leaseToken', 'leaseExpiresAt', 'lastCompletedAt'].includes(key))
    && value.schemaVersion === 1 && value.kind === 'runtime_cursor' && value.id === id && value.mode === mode
    && (value.afterKey === null || typeof value.afterKey === 'string' && value.afterKey.length <= 220
      && (mode === 'dispatch' ? INTENT_ID.test(value.afterKey) : /^[A-Za-z0-9_.:-]+$/.test(value.afterKey)))
    && iso(value.updatedAt) !== null && iso(value.updatedAt)! <= now
    && (value.lastCompletedAt === undefined || iso(value.lastCompletedAt) !== null && iso(value.lastCompletedAt)! <= now)
    && (value.leaseToken === undefined && value.leaseExpiresAt === undefined
      || typeof value.leaseToken === 'string' && /^[a-f0-9]{48}$/.test(value.leaseToken) && iso(value.leaseExpiresAt) !== null);
}

async function leaseCursor(db: Firestore, mode: RuntimeMode, now: string): Promise<{ status: 'leased'; cursor: RuntimeCursor; token: string } | { status: 'busy' | 'conflict' }> {
  const id = mode === 'prepare' ? PREPARE_CURSOR : DELIVERY_CURSOR;
  const ref = db.collection(AFFILIATE_NOTIFICATION_DELIVERY_COLLECTION).doc(id);
  const token = crypto.randomBytes(24).toString('hex');
  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref); const existing = snapshot.data();
    if (snapshot.exists && !validCursor(existing, id, mode, iso(now)!)) return { status: 'conflict' as const };
    if (existing?.leaseExpiresAt && iso(existing.leaseExpiresAt)! > iso(now)!) return { status: 'busy' as const };
    const cursor: RuntimeCursor = {
      ...(existing || {}), schemaVersion: 1, kind: 'runtime_cursor', id, mode,
      afterKey: existing?.afterKey ?? null, updatedAt: now, leaseToken: token,
      leaseExpiresAt: new Date(iso(now)! + CURSOR_LEASE_MS).toISOString(),
    };
    if (snapshot.exists) transaction.set(ref, cursor); else transaction.create(ref, cursor);
    return { status: 'leased' as const, cursor, token };
  });
}

async function finishCursor(db: Firestore, lease: { cursor: RuntimeCursor; token: string }, afterKey: string | null, now: string): Promise<boolean> {
  const ref = db.collection(AFFILIATE_NOTIFICATION_DELIVERY_COLLECTION).doc(lease.cursor.id);
  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref); const previous = snapshot.data();
    if (!snapshot.exists || !validCursor(previous, lease.cursor.id, lease.cursor.mode, iso(now)!) || previous.leaseToken !== lease.token) return false;
    const { leaseToken: _token, leaseExpiresAt: _expiry, ...clean } = previous;
    transaction.set(ref, { ...clean, afterKey, updatedAt: now, lastCompletedAt: now });
    return true;
  });
}

/** A create-only audience record makes source replay independent of later joins,
 * suspensions and process restarts. Only affiliate IDs are stored, never email.
 * These documents live in the already-backed-up delivery-state collection. */
async function frozenAudience(input: {
  db: Firestore; eventId: string; resolved: ResolvedAffiliateNotificationSource; audience: string[]; now: string;
}): Promise<string[]> {
  const { db, eventId, resolved, audience, now } = input;
  const id = `audience_${eventId}`;
  const ref = db.collection(AFFILIATE_NOTIFICATION_DELIVERY_COLLECTION).doc(id);
  const sourceSha256 = hash(resolved.source);
  return db.runTransaction(async transaction => {
    if (!await resolved.verifySource(transaction)) throw new Error('Partner notification source changed.');
    const snapshot = await transaction.get(ref); const previous = snapshot.data();
    if (snapshot.exists) {
      if (!record(previous) || Object.keys(previous).some(key => !['schemaVersion', 'kind', 'id', 'eventId', 'sourceSha256', 'affiliateIds', 'audienceSha256', 'createdAt'].includes(key))
        || previous.schemaVersion !== 1 || previous.kind !== 'runtime_audience' || previous.id !== id || previous.eventId !== eventId
        || previous.sourceSha256 !== sourceSha256 || !Array.isArray(previous.affiliateIds) || previous.affiliateIds.length < 1 || previous.affiliateIds.length > 200
        || Array.from(previous.affiliateIds).some(item => typeof item !== 'string' || !SAFE_ID.test(item))
        || new Set(previous.affiliateIds).size !== previous.affiliateIds.length
        || hash(previous.affiliateIds) !== hash([...previous.affiliateIds].sort())
        || previous.audienceSha256 !== hash(previous.affiliateIds) || iso(previous.createdAt) === null || iso(previous.createdAt)! > iso(now)!) {
        throw new Error('Partner notification frozen audience conflict.');
      }
      return [...previous.affiliateIds] as string[];
    }
    const affiliateIds = [...audience].sort();
    transaction.create(ref, { schemaVersion: 1, kind: 'runtime_audience', id, eventId, sourceSha256,
      affiliateIds, audienceSha256: hash(affiliateIds), createdAt: now });
    return affiliateIds;
  });
}

/** Concrete verifier used by the delivery worker in BOTH its claim and pre-send
 * transactions. External source reads are followed by transaction fingerprint
 * revalidation; a source read outage throws, never pretends to be an opt-out. */
export function affiliateNotificationRuntimeSourceVerifier(db: Firestore, env: NodeJS.ProcessEnv): AffiliateNotificationSourceVerifier {
  const environment = { ...env };
  return async ({ transaction, source, now }) => {
    const resolved = await resolveAffiliateNotificationSource({ db, source, now }, environment);
    if (!resolved || !await resolved.verifySource(transaction)) return null;
    return { eligible: true, variables: { ...resolved.context }, evidenceSha256: resolved.evidenceSha256,
      ...(resolved.cooldown ? { cooldown: { ...resolved.cooldown } } : {}),
    };
  };
}

async function runPreparation(db: Firestore, now: string, env: NodeJS.ProcessEnv): Promise<AffiliateNotificationRuntimeResult> {
  const output = result('prepare', 'completed');
  const [settingsSnapshot] = await db.getAll(db.collection('site_configs').doc('affiliate_notifications'));
  if (!settingsSnapshot?.exists) return result('prepare', 'disabled');
  const settings = validateAffiliateNotificationSettings(settingsSnapshot.data());
  if (!settings.enabled || settings.templates.every(template => !template.enabled)) return result('prepare', 'disabled');
  // +1 detects overflow explicitly BEFORE any runtime marker/outbox write.
  // No cursor silently omits affiliates from a broadcast audience.
  const active = await db.collection('affiliates').where('status', '==', 'active').limit(201).get();
  const campaigns = await db.collection('affiliate_campaigns').where('isActive', '==', true).limit(101).get();
  const releases = await db.collection('newsletter_campaigns').where('kind', '==', 'release').limit(101).get();
  const [circleSnapshot] = await db.getAll(db.collection('site_configs').doc('affiliate_literary_circle'));
  const circle = circleSnapshot?.exists ? circleSnapshot.data()! : {};
  const posts = record(circle.community) && Array.isArray(circle.community.posts) ? circle.community.posts : [];
  const overflow = [active.docs.length > 200 ? 'active_affiliates' : '', campaigns.docs.length > 100 ? 'campaigns' : '',
    releases.docs.length > 100 ? 'release_campaigns' : '', posts.length > 40 ? 'community_posts' : ''].filter(Boolean);
  if (overflow.length) return { ...result('prepare', 'overflow'), overflow };
  const affiliates = active.docs.map(snapshot => ({ ...snapshot.data(), id: snapshot.id } as AffiliatePublicProfile));
  const audience = affiliates.map(affiliate => affiliate.id).sort();
  if (audience.some(id => !SAFE_ID.test(id)) || new Set(audience).size !== audience.length) return result('prepare', 'conflict');
  if (!audience.length) return output;
  const candidates: SourceCandidate[] = [];
  const enabled = (kind: string) => settings.templates.some(template => template.eventType === kind && template.enabled);
  if (enabled('upcoming_campaign')) for (const snapshot of campaigns.docs) {
    const value = snapshot.data();
    if (!SAFE_ID.test(snapshot.id) || !Number.isSafeInteger(value.revision) || value.revision < 1) continue;
    candidates.push({ key: `upcoming_campaign:${snapshot.id}`, kind: 'upcoming_campaign', sourceId: snapshot.id,
      evidenceId: campaignNotificationAuditId(snapshot.id, value.revision) });
  }
  if (enabled('new_release')) for (const snapshot of releases.docs) {
    const value = snapshot.data();
    if (!SAFE_ID.test(snapshot.id) || !['queued', 'sending', 'sent', 'partially_sent'].includes(value.status) || iso(value.queuedAt) === null) continue;
    candidates.push({ key: `new_release:${snapshot.id}`, kind: 'new_release', sourceId: snapshot.id, occurredAt: value.queuedAt });
  }
  if (enabled('exclusive_opportunity') && Number.isSafeInteger(circle.revision) && circle.revision >= 1) for (const post of posts) {
    if (!record(post) || !SAFE_ID.test(post.id) || post.isPublished !== true
      || !['announcement', 'monthly_campaign', 'promotional_guidance'].includes(post.type)) continue;
    candidates.push({ key: `exclusive_opportunity:${post.id}`, kind: 'exclusive_opportunity', sourceId: post.id,
      evidenceId: literaryCircleNotificationAuditId(circle.revision) });
  }
  candidates.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  if (new Set(candidates.map(candidate => candidate.key)).size !== candidates.length) return result('prepare', 'conflict');
  if (!candidates.length && !enabled('inactivity_reminder')) return output;
  const lease = await leaseCursor(db, 'prepare', now);
  if (lease.status !== 'leased') return result('prepare', lease.status);
  let afterKey = lease.cursor.afterKey;
  try {
    let first = afterKey ? candidates.findIndex(candidate => candidate.key > afterKey!) : 0;
    if (first < 0) first = 0;
    const batch = candidates.slice(first, first + AFFILIATE_NOTIFICATION_RUNTIME_LIMITS.preparedSourcesPerRun);
    for (const candidate of batch) {
      output.scanned++; output.attempted++; afterKey = candidate.key;
      try {
        const resolved = candidate.kind === 'new_release'
          ? await resolveAffiliateNotificationSource({ db, source: { eventType: 'new_release', sourceId: candidate.sourceId,
            sourceVersion: 1, occurredAt: candidate.occurredAt! }, now }, env)
          : await inspectScheduledAffiliateNotificationSource({ db, kind: candidate.kind, sourceId: candidate.sourceId,
            evidenceId: candidate.evidenceId, now }, env);
        if (!resolved) { increment(output.counts, 'ineligible'); continue; }
        const plan = planAffiliateNotifications({ source: resolved.source, settings, affiliates, now,
          verifiedManualTierIds: verifiedManualAffiliateNotificationTierIds(affiliates, circle, now),
        });
        // Tier-filtered audiences are decided authoritatively by the fresh
        // outbox transaction, including exact monthly summaries. This cheap
        // prefilter must not reject a canonical automatic tier using a stale ID.
        const tierFiltered = (settings.templates.find(template => template.eventType === resolved.source.eventType)?.eligibility?.tierIds?.length || 0) > 0;
        if (!plan.intents.length && !tierFiltered) {
          increment(output.counts, plan.reasons?.[AUTOMATIC_AFFILIATE_NOTIFICATION_TIER_FILTER_UNSUPPORTED]
            ? AUTOMATIC_AFFILIATE_NOTIFICATION_TIER_FILTER_UNSUPPORTED : 'ineligible');
          continue;
        }
        const frozen = await frozenAudience({ db, eventId: plan.eventId, resolved, audience, now });
        const prepared = candidate.kind === 'new_release'
          ? await prepareCommittedAffiliateNotification({ db, kind: 'new_release', sourceId: candidate.sourceId, affiliateIds: frozen, now }, env)
          : await prepareScheduledAffiliateNotifications({ db, kind: candidate.kind, sourceId: candidate.sourceId,
            evidenceId: candidate.evidenceId, affiliateIds: frozen, now }, env);
        if ('counts' in prepared) for (const [status, count] of Object.entries(prepared.counts)) increment(output.counts, status, count!);
        else increment(output.counts, prepared.status);
        output.intentCount += prepared.intentCount;
      } catch { increment(output.counts, 'failed'); }
    }
    output.hasMore = first + batch.length < candidates.length;
    if (!output.hasMore) afterKey = null;
    if (enabled('inactivity_reminder')) {
      for (let offset = 0; offset < audience.length; offset += AFFILIATE_NOTIFICATION_RUNTIME_LIMITS.inactivityBatch) {
        const prepared = await prepareScheduledAffiliateNotifications({ db, kind: 'inactivity_reminder',
          affiliateIds: audience.slice(offset, offset + AFFILIATE_NOTIFICATION_RUNTIME_LIMITS.inactivityBatch), now }, env);
        output.attempted += prepared.attempted; output.intentCount += prepared.intentCount;
        for (const [status, count] of Object.entries(prepared.counts)) increment(output.counts, status, count!);
      }
    }
  } finally {
    if (!await finishCursor(db, lease, afterKey, now)) output.status = 'conflict';
  }
  return output;
}

function deliveryRecordId(intentId: string): string {
  return `nld_${crypto.createHash('sha256').update(`affiliate\0${intentId}`).digest('hex').slice(0, 48)}`;
}

async function runDispatch(input: {
  db: Firestore; intentIds?: string[]; clock: () => string; sendEmail?: typeof sendNewsletterEmail;
}, env: NodeJS.ProcessEnv): Promise<AffiliateNotificationRuntimeResult> {
  const { db, clock, sendEmail } = input; const output = result('dispatch', 'completed');
  const verifySource = affiliateNotificationRuntimeSourceVerifier(db, env);
  const dispatch = async (intentId: string) => {
    const delivered = await deliverHeldAffiliateNotification({ db, intentId, verifySource, env, clock, ...(sendEmail ? { sendEmail } : {}) });
    output.attempted++; increment(output.counts, delivered.status);
  };
  if (input.intentIds !== undefined) {
    for (const id of input.intentIds) { output.scanned++; await dispatch(id); }
    return output;
  }
  const startedAt = clock(); if (iso(startedAt) === null) return result('dispatch', 'invalid');
  const lease = await leaseCursor(db, 'dispatch', startedAt);
  if (lease.status !== 'leased') return result('dispatch', lease.status);
  let afterKey = lease.cursor.afterKey;
  try {
    let query = db.collection(OUTBOX).where('kind', '==', 'intent').orderBy(FieldPath.documentId());
    if (afterKey) query = query.startAfter(afterKey);
    const page = await query.limit(AFFILIATE_NOTIFICATION_RUNTIME_LIMITS.deliveryPage).get();
    const refs = page.docs.map(snapshot => db.collection(AFFILIATE_NOTIFICATION_DELIVERY_COLLECTION).doc(deliveryRecordId(snapshot.id)));
    const deliveries = refs.length ? await db.getAll(...refs) : [];
    const byId = new Map(deliveries.map(snapshot => [snapshot.id, snapshot]));
    let consumed = 0;
    for (const snapshot of page.docs) {
      if (output.attempted >= AFFILIATE_NOTIFICATION_RUNTIME_LIMITS.dispatchedIntentsPerRun) break;
      consumed++; output.scanned++;
      if (!INTENT_ID.test(snapshot.id)) { increment(output.counts, 'invalid_record'); output.status = 'conflict'; break; }
      afterKey = snapshot.id;
      const current = byId.get(deliveryRecordId(snapshot.id)); const value = current?.data();
      if (current?.exists && record(value) && value.schemaVersion === 1 && value.kind === 'delivery'
        && value.id === current.id && value.intentId === snapshot.id && TERMINAL.has(value.status)) {
        increment(output.counts, 'already_processed'); continue;
      }
      await dispatch(snapshot.id);
    }
    output.hasMore = consumed < page.docs.length || page.docs.length === AFFILIATE_NOTIFICATION_RUNTIME_LIMITS.deliveryPage;
    if (!output.hasMore) afterKey = null;
  } finally {
    const finishedAt = clock();
    if (iso(finishedAt) === null || !await finishCursor(db, lease, afterKey, finishedAt)) output.status = 'conflict';
  }
  return output;
}

/** Server-owned orchestration only: callers authenticate administrators/cron.
 * Preparing held intents NEVER sends. Dispatch requires its independent reviewed
 * staging gate before cursor/query access. No production project is accepted.
 */
export async function runAffiliateNotificationJob(input: {
  db: Firestore;
  mode: RuntimeMode;
  /** Explicit reviewed retry selection or omit to use the durable cursor. */
  intentIds?: string[];
  now?: string;
  clock?: () => string;
  /** Dependency injection for local tests, never populated from a request body. */
  sendEmail?: typeof sendNewsletterEmail;
}, env: NodeJS.ProcessEnv = process.env): Promise<AffiliateNotificationRuntimeResult> {
  const { db, mode, sendEmail } = input; const environment = { ...env };
  if (mode !== 'prepare' && mode !== 'dispatch') return result(mode, 'invalid');
  const gate = affiliateNotificationSourceGate(db, environment);
  if (gate !== 'held') return result(mode, gate);
  if (mode === 'dispatch') {
    const deliveryGate = affiliateNotificationDeliveryGate(db, environment);
    if (deliveryGate !== 'allowed') return result(mode, deliveryGate);
  }
  if (input.intentIds !== undefined && (mode !== 'dispatch' || !Array.isArray(input.intentIds)
    || input.intentIds.length < 1 || input.intentIds.length > AFFILIATE_NOTIFICATION_RUNTIME_LIMITS.dispatchedIntentsPerRun
    || Array.from(input.intentIds).some(id => typeof id !== 'string' || !INTENT_ID.test(id))
    || new Set(input.intentIds).size !== input.intentIds.length)) return result(mode, 'invalid');
  const intentIds = input.intentIds === undefined ? undefined : [...input.intentIds];
  const now = input.now; const clock = input.clock || (() => now || new Date().toISOString());
  const startedAt = clock(); if (iso(startedAt) === null) return result(mode, 'invalid');
  try {
    return mode === 'prepare' ? await runPreparation(db, startedAt, environment)
      : await runDispatch({ db, clock, intentIds, ...(sendEmail ? { sendEmail } : {}) }, environment);
  } catch {
    // Provider/Firestore errors may carry private addresses, links or credentials.
    return result(mode, 'failed');
  }
}

/** Bounded operational snapshot. Counts are explicitly marked as a sample when
 * the limit is exceeded; never present sampled data as a complete audit total.
 * No messages, addresses, secret tokens, raw payloads or recipient IDs returned.
 */
export async function getAffiliateNotificationRuntimeStatus(input: {
  db: Firestore; now?: string;
}, env: NodeJS.ProcessEnv = process.env): Promise<AffiliateNotificationRuntimeStatus> {
  const db = input.db; const environment = { ...env }; const now = input.now || new Date().toISOString();
  const sourceGate = affiliateNotificationSourceGate(db, environment);
  const deliveryGate = affiliateNotificationDeliveryGate(db, environment);
  const empty = { deliveryGate, sampledDeliveries: 0, counts: {}, preparedIntents: 0,
    truncated: { deliveries: false, intents: false }, limits: AFFILIATE_NOTIFICATION_RUNTIME_LIMITS };
  if (sourceGate !== 'held') return { ...empty, status: sourceGate };
  if (iso(now) === null) return { ...empty, status: 'failed' };
  try {
    const deliveries = await db.collection(AFFILIATE_NOTIFICATION_DELIVERY_COLLECTION).where('kind', '==', 'delivery').limit(501).get();
    const intents = await db.collection(OUTBOX).where('kind', '==', 'intent').limit(1_001).get();
    const [cursorSnapshot] = await db.getAll(db.collection(AFFILIATE_NOTIFICATION_DELIVERY_COLLECTION).doc(DELIVERY_CURSOR));
    const counts: Counts = {};
    for (const snapshot of deliveries.docs.slice(0, 500)) {
      const value = snapshot.data();
      increment(counts, record(value) && DELIVERY_STATUSES.has(value.status) ? value.status : 'invalid_record');
    }
    const cursor = cursorSnapshot?.data();
    return { status: 'ready', deliveryGate, sampledDeliveries: Math.min(500, deliveries.docs.length), counts,
      preparedIntents: Math.min(1_000, intents.docs.length),
      truncated: { deliveries: deliveries.docs.length > 500, intents: intents.docs.length > 1_000 },
      limits: AFFILIATE_NOTIFICATION_RUNTIME_LIMITS,
      ...(cursorSnapshot?.exists && validCursor(cursor, DELIVERY_CURSOR, 'dispatch', iso(now)!) ? { cursor: {
        busy: Boolean(cursor.leaseExpiresAt && iso(cursor.leaseExpiresAt)! > iso(now)!),
        updatedAt: cursor.updatedAt, ...(cursor.lastCompletedAt ? { lastCompletedAt: cursor.lastCompletedAt } : {}),
      } } : {}),
    };
  } catch { return { ...empty, status: 'failed' }; }
}
