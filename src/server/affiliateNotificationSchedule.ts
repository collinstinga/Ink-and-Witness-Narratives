import crypto from 'crypto';
import type { DocumentReference, Firestore, Transaction } from 'firebase-admin/firestore';
import type { AffiliateNotificationSource } from './affiliateNotificationPlan.js';
import {
  affiliateNotificationSourceFingerprint as fingerprint,
  affiliateNotificationSourceGate,
  type ResolvedAffiliateNotificationSource,
} from './affiliateNotificationEvents.js';
import { validateAffiliateNotificationSettings } from './affiliateNotifications.js';
import { normalizeAffiliateNotificationPreferences } from './affiliateNotificationPreferences.js';

export type ScheduledAffiliateNotificationKind = 'upcoming_campaign' | 'inactivity_reminder' | 'exclusive_opportunity';
export const MAX_SCHEDULED_NOTIFICATION_AUDIENCE = 200;
export const MAX_INACTIVITY_NOTIFICATION_AUDIENCE = 25;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const DAY_MS = 86_400_000;
const OPPORTUNITY_TYPES = new Set(['announcement', 'monthly_campaign', 'promotional_guidance']);

type RecordValue = Record<string, unknown>;
type Status = 'disabled' | 'blocked' | 'ineligible' | 'created' | 'existing' | 'failed';

function record(value: unknown): value is RecordValue {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function time(value: unknown): number | null {
  const parsed = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 && new Date(parsed).toISOString() === value ? parsed : null;
}

function text(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && Boolean(value.trim()) && value.length <= maximum && !/[\u0000-\u001f]/.test(value);
}

function hash(values: unknown[]): string {
  return crypto.createHash('sha256').update(JSON.stringify(values)).digest('hex');
}

/** Audit snapshots deliberately exclude mutable campaign counters: a genuine
 * sale must not invalidate an already-committed upcoming campaign notice. */
function campaignPolicy(value: RecordValue): RecordValue {
  const keys = ['id', 'revision', 'code', 'name', 'description', 'commissionRate', 'attributionDays',
    'eligiblePieceIds', 'startDate', 'endDate', 'isActive', 'createdAt', 'updatedAt', 'updatedBy'];
  return Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [key, value[key]]));
}

function matchingAudit(audit: RecordValue, id: string, action: string, targetType: string, targetId: string): boolean {
  return audit.id === id && audit.action === action && audit.targetType === targetType && audit.targetId === targetId
    && text(audit.actor, 120) && record(audit.newValue);
}

interface ScheduledInput {
  db: Firestore;
  kind: ScheduledAffiliateNotificationKind;
  /** Campaign ID or stable private community post ID. Inactivity uses affiliateId. */
  sourceId?: string;
  /** Exact existing audit document, not a query for the most recent history. */
  evidenceId?: string;
  affiliateId?: string;
  now: string;
}

/** Internal runtime preflight; proves an explicit source before freezing its
 * audience. This has the same bounded reads as revalidation and no writes. */
export async function inspectScheduledAffiliateNotificationSource(
  input: ScheduledInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ResolvedAffiliateNotificationSource | null> {
  return readScheduledSource({ ...input }, env);
}

/** Only exact, bounded document reads. This never discovers affiliates, sends
 * email, scans history, updates membership, or writes financial records. */
async function readScheduledSource(input: ScheduledInput, env: NodeJS.ProcessEnv): Promise<ResolvedAffiliateNotificationSource | null> {
  const { db, kind, sourceId, evidenceId, affiliateId, now } = input;
  if (affiliateNotificationSourceGate(db, env) !== 'held') return null;
  const nowMs = time(now);
  if (nowMs === null || !['upcoming_campaign', 'inactivity_reminder', 'exclusive_opportunity'].includes(kind)) return null;
  const settingsRef = db.collection('site_configs').doc('affiliate_notifications');
  const refs: DocumentReference[] = [settingsRef];
  if (kind === 'inactivity_reminder') {
    if (sourceId !== undefined || evidenceId !== undefined || !affiliateId || !SAFE_ID.test(affiliateId)) return null;
    refs.push(db.collection('affiliates').doc(affiliateId));
  } else {
    if (affiliateId !== undefined || !sourceId || !SAFE_ID.test(sourceId) || !evidenceId || !SAFE_ID.test(evidenceId)) return null;
    refs.push(db.collection(kind === 'upcoming_campaign' ? 'affiliate_campaigns' : 'site_configs')
      .doc(kind === 'upcoming_campaign' ? sourceId : 'affiliate_literary_circle'));
    refs.push(db.collection('affiliate_audit').doc(evidenceId));
  }
  const snapshots = await db.getAll(...refs);
  const byPath = new Map(snapshots.map(snapshot => [snapshot.ref.path, snapshot]));
  if (refs.some(ref => !byPath.get(ref.path)?.exists)) return null;
  const values = refs.map(ref => byPath.get(ref.path)!.data()! as RecordValue);
  const settings = validateAffiliateNotificationSettings(values[0]);
  const template = settings.templates.find(item => item.eventType === kind)!;
  if (!settings.enabled || !template.enabled) return null;
  const settingsAt = time(settings.updatedAt);
  if (settingsAt === null || settingsAt > nowMs) return null;
  const context: Record<string, string> = {};
  let source: AffiliateNotificationSource;
  let cooldown: ResolvedAffiliateNotificationSource['cooldown'];

  if (kind === 'inactivity_reminder') {
    const affiliate = values[1];
    const preferences = normalizeAffiliateNotificationPreferences(affiliate.notificationPreferences);
    const consentAt = time(preferences.marketingConsentAt);
    const topicAt = time(preferences.inactivityRemindersEnabledAt);
    if (preferences.marketingConsent !== 'granted' || preferences.allMarketingOptOut || !preferences.inactivityReminders
      || consentAt === null || topicAt === null || consentAt > nowMs || topicAt > nowMs) return null;
    // Opting into reminders never immediately schedules years of inactivity.
    // Invalid/future activity suppresses instead of pretending that it is old.
    const baselineValues: unknown[] = [affiliate.createdAt, affiliate.approvedAt, settings.updatedAt,
      preferences.marketingConsentAt, preferences.inactivityRemindersEnabledAt];
    const membership = record(affiliate.literaryCircle) ? affiliate.literaryCircle : {};
    if (membership.memberSince !== undefined) baselineValues.push(membership.memberSince);
    for (const key of ['lastLoginAt', 'lastActivityAt', 'lastReferralAt', 'lastVerifiedSaleAt', 'lastDashboardAt']) {
      if (affiliate[key] !== undefined) baselineValues.push(affiliate[key]);
    }
    const baselines = baselineValues.map(time);
    if (baselines.some(value => value === null || value > nowMs)) return null;
    const baseline = Math.max(...baselines as number[]);
    const interval = template.timing.cooldownDays! * DAY_MS;
    const firstDue = baseline + template.timing.inactivityDays! * DAY_MS;
    if (nowMs < firstDue) return null;
    const cycle = Math.floor((nowMs - firstDue) / interval);
    const due = firstDue + cycle * interval;
    // Missing a cycle does not produce an old reminder backlog. Only the current
    // 24-hour opportunity can be held; the next cycle is independent and bounded.
    const expiry = Math.min(due + DAY_MS, due + interval);
    if (nowMs >= expiry || due + template.timing.delayMinutes * 60_000 >= expiry) return null;
    source = {
      eventType: kind, sourceId: `quiet_${hash([affiliateId, new Date(baseline).toISOString()])}`,
      sourceVersion: cycle + 1, targetAffiliateId: affiliateId,
      occurredAt: new Date(due).toISOString(), notBefore: new Date(due).toISOString(), expiresAt: new Date(expiry).toISOString(),
    };
    cooldown = { key: hash(['inactivity_reminder', affiliateId]), minimumIntervalMs: interval };
  } else if (kind === 'upcoming_campaign') {
    const campaign = values[1]; const audit = values[2];
    const auditAt = time(audit.timestamp); const updatedAt = time(campaign.updatedAt);
    const createdAt = time(campaign.createdAt); const startsAt = time(campaign.startDate); const endsAt = time(campaign.endDate);
    if (campaign.id !== sourceId || !Number.isSafeInteger(campaign.revision) || Number(campaign.revision) < 1
      || campaign.isActive !== true || !text(campaign.name, 120) || !text(campaign.updatedBy, 120)
      || !matchingAudit(audit, evidenceId!, 'campaign_saved', 'campaign', sourceId!)
      || auditAt === null || updatedAt === null || createdAt === null || startsAt === null || endsAt === null
      || auditAt !== updatedAt || createdAt > auditAt || auditAt > nowMs || startsAt <= nowMs || endsAt <= startsAt
      || fingerprint(campaignPolicy(audit.newValue as RecordValue)) !== fingerprint(campaignPolicy(campaign))) return null;
    const notBefore = Math.max(auditAt, startsAt - template.timing.leadTimeHours! * 3_600_000);
    if (notBefore + template.timing.delayMinutes * 60_000 >= startsAt) return null;
    // SourceVersion intentionally does not follow edit revision. One campaign
    // identity cannot repeatedly mail the same audience after cosmetic edits.
    source = { eventType: kind, sourceId: sourceId!, sourceVersion: 1, evidenceId,
      occurredAt: new Date(auditAt).toISOString(), notBefore: new Date(notBefore).toISOString(), expiresAt: new Date(startsAt).toISOString() };
    context.campaignName = campaign.name;
    context.campaignStartDate = new Intl.DateTimeFormat('en-KE', { timeZone: 'Africa/Nairobi', dateStyle: 'long', timeStyle: 'short', hourCycle: 'h23' }).format(startsAt);
  } else {
    const circle = values[1]; const audit = values[2];
    const community = record(circle.community) ? circle.community : {};
    const posts = community.posts;
    if (circle.enabled !== true || community.enabled !== true || !Array.isArray(posts) || posts.length > 40
      || !Number.isSafeInteger(circle.revision) || Number(circle.revision) < 1
      || !matchingAudit(audit, evidenceId!, 'literary_circle_settings_updated', 'settings', 'affiliate_literary_circle')
      || fingerprint(audit.newValue) !== fingerprint(circle)) return null;
    const matches = posts.filter(post => record(post) && post.id === sourceId);
    if (matches.length !== 1) return null;
    const post = matches[0] as RecordValue;
    const auditAt = time(audit.timestamp); const updatedAt = time(circle.updatedAt); const publishedAt = time(post.publishedAt);
    const explicitExpiry = post.expiresAt === undefined ? undefined : time(post.expiresAt);
    if (post.isPublished !== true || !OPPORTUNITY_TYPES.has(String(post.type)) || !text(post.title, 120)
      || auditAt === null || updatedAt === null || publishedAt === null || explicitExpiry === null
      || updatedAt > auditAt || auditAt > nowMs || publishedAt > nowMs || !text(circle.updatedBy, 120)) return null;
    const previous = record(audit.previousValue) && record(audit.previousValue.community) && Array.isArray(audit.previousValue.community.posts)
      ? audit.previousValue.community.posts.find(post => record(post) && post.id === sourceId) : undefined;
    // Saving unrelated tier/community settings does not announce an old post.
    if (record(previous) && fingerprint(previous) === fingerprint(post)) return null;
    const occurred = Math.max(auditAt, publishedAt);
    const expiry = Math.min(explicitExpiry ?? Infinity, occurred + 30 * DAY_MS);
    if (nowMs >= expiry || occurred + template.timing.delayMinutes * 60_000 >= expiry) return null;
    source = { eventType: kind, sourceId: sourceId!, sourceVersion: 1, evidenceId,
      occurredAt: new Date(occurred).toISOString(), notBefore: new Date(occurred).toISOString(), expiresAt: new Date(expiry).toISOString() };
    context.opportunityTitle = post.title;
  }

  const expected = values.map(fingerprint);
  return {
    source, context, evidenceSha256: fingerprint(refs.map((ref, index) => [ref.path, expected[index]])),
    ...(cooldown ? { cooldown } : {}),
    verifySource: async (transaction: Transaction) => {
      const current = await transaction.getAll(...refs);
      const currentByPath = new Map(current.map(snapshot => [snapshot.ref.path, snapshot]));
      return refs.every((ref, index) => {
        const snapshot = currentByPath.get(ref.path);
        return snapshot?.exists && fingerprint(snapshot.data()) === expected[index];
      });
    },
  };
}

/** Reconstruct the precise persisted source from current committed evidence.
 * Source edits, timing changes, expiry, activity or opt-out invalidate a held
 * message instead of authorizing delivery based on its old snapshot. */
export async function resolveScheduledAffiliateNotificationSource(input: {
  db: Firestore; source: AffiliateNotificationSource; now: string;
}, env: NodeJS.ProcessEnv = process.env): Promise<ResolvedAffiliateNotificationSource | null> {
  const source = { ...input.source };
  const candidate = await readScheduledSource({ db: input.db, kind: source.eventType as ScheduledAffiliateNotificationKind,
    now: input.now,
    ...(source.eventType === 'inactivity_reminder' ? { affiliateId: source.targetAffiliateId }
      : { sourceId: source.sourceId, evidenceId: source.evidenceId }),
  }, env);
  return candidate && fingerprint(candidate.source) === fingerprint(source) ? candidate : null;
}

/** Bounded server-only scheduler adapter. Audience selection is supplied by the
 * authenticated internal caller, frozen for each campaign/post (do not split a
 * source across audience subsets). No collection scan or email dispatch. */
export async function prepareScheduledAffiliateNotifications(input: {
  db: Firestore; kind: ScheduledAffiliateNotificationKind; sourceId?: string; evidenceId?: string;
  affiliateIds: string[]; now?: string;
}, env: NodeJS.ProcessEnv = process.env): Promise<{ attempted: number; counts: Partial<Record<Status, number>>; intentCount: number }> {
  const { db, kind, sourceId, evidenceId } = input;
  const mode = affiliateNotificationSourceGate(db, env);
  if (mode !== 'held') return { attempted: 0, counts: { [mode]: 1 }, intentCount: 0 };
  if (!Array.isArray(input.affiliateIds) || input.affiliateIds.length < 1
    || input.affiliateIds.length > (kind === 'inactivity_reminder' ? MAX_INACTIVITY_NOTIFICATION_AUDIENCE : MAX_SCHEDULED_NOTIFICATION_AUDIENCE)
    || Array.from(input.affiliateIds).some(id => typeof id !== 'string' || !SAFE_ID.test(id))
    || new Set(input.affiliateIds).size !== input.affiliateIds.length) throw new Error('Invalid scheduled partner notification audience.');
  const affiliateIds = [...input.affiliateIds].sort(); const now = input.now || new Date().toISOString();
  const counts: Partial<Record<Status, number>> = {}; let intentCount = 0; let attempted = 0;
  const audiences = kind === 'inactivity_reminder' ? affiliateIds.map(id => [id]) : [affiliateIds];
  for (const audience of audiences) {
    attempted++;
    try {
      const resolved = await readScheduledSource({ db, kind, sourceId, evidenceId, now,
        ...(kind === 'inactivity_reminder' ? { affiliateId: audience[0] } : {}),
      }, env);
      if (!resolved) { counts.ineligible = (counts.ineligible || 0) + 1; continue; }
      const { storeHeldAffiliateNotifications } = await import('./affiliateNotificationOutbox.js');
      const stored = await storeHeldAffiliateNotifications({ db, mode: 'held', source: resolved.source,
        affiliateIds: audience, now, verifySource: resolved.verifySource });
      counts[stored.status] = (counts[stored.status] || 0) + 1;
      intentCount += stored.intentCount;
    } catch {
      counts.failed = (counts.failed || 0) + 1;
    }
  }
  return { attempted, counts, intentCount };
}
