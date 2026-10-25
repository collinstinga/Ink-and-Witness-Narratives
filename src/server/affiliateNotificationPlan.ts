import crypto from 'crypto';
import type { AffiliatePublicProfile, LiteraryCircleNotificationSettings } from '../types.js';
import {
  summarizeAffiliateNotificationEligibility,
  validateAffiliateNotificationSettings,
} from './affiliateNotifications.js';
import {
  isVerifiedAffiliateNotificationMonthlyTier,
  type VerifiedAffiliateNotificationMonthlyTiers,
} from './affiliateNotificationTierFilter.js';

const SUPPORTED_EVENTS = ['activation', 'new_release', 'new_commission', 'tier_upgrade',
  'upcoming_campaign', 'inactivity_reminder', 'exclusive_opportunity'] as const;
type PlannedEvent = typeof SUPPORTED_EVENTS[number];
const SCHEDULED_EVENTS = new Set<PlannedEvent>(['upcoming_campaign', 'inactivity_reminder', 'exclusive_opportunity']);
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const SAFE_TIER_ID = /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/;
export const MAX_AFFILIATE_NOTIFICATION_PLAN_RECIPIENTS = 200;

export interface AffiliateNotificationSource {
  eventType: PlannedEvent;
  sourceId: string;
  sourceVersion: number;
  occurredAt: string;
  targetAffiliateId?: string;
  /** Verified destination from a committed tier transition, not a profile edit. */
  targetTierId?: string;
  /** Explicit committed writer audit supporting a campaign or private post. */
  evidenceId?: string;
  /** Server-derived scheduling bounds, never caller-selected delivery dates. */
  notBefore?: string;
  expiresAt?: string;
}

export interface HeldAffiliateNotificationIntent {
  schemaVersion: 1;
  id: string;
  eventId: string;
  eventType: PlannedEvent;
  affiliateId: string;
  settingsRevision: number;
  state: 'held';
  dueAt: string;
  /** Pins automatic tier audience eligibility to exact canonical qualification. */
  tierEvidenceSha256?: string;
}

export interface AffiliateNotificationPlan {
  eventId: string;
  deliveryMode: 'preview_only';
  intents: HeldAffiliateNotificationIntent[];
  excluded: number;
  reasons: Record<string, number>;
}

function invalid(): never {
  // Never reflect identifiers or source payloads into an error/log response.
  throw new Error('Invalid partner notification planning input.');
}

function isoMilliseconds(value: unknown): number {
  if (typeof value !== 'string') return invalid();
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) return invalid();
  return milliseconds;
}

function digest(prefix: string, values: unknown[]): string {
  return prefix + crypto.createHash('sha256').update(JSON.stringify(values)).digest('hex');
}

/**
 * Internal preparation only. No Firestore, provider, queue, or account mutation.
 * Source events must eventually come from committed server-side business events,
 * never reader/client input. A future worker must recheck all eligibility.
 */
export function planAffiliateNotifications(input: {
  source: AffiliateNotificationSource;
  settings: LiteraryCircleNotificationSettings;
  affiliates: AffiliatePublicProfile[];
  /** Exact manual assignments proved from fresh server settings; never client input. */
  verifiedManualTierIds?: Record<string, string>;
  /** Fresh canonical monthly summaries and effective policy, never client input. */
  verifiedMonthlyTiers?: VerifiedAffiliateNotificationMonthlyTiers;
  now: string;
}): AffiliateNotificationPlan {
  const source = input.source;
  if (!source || typeof source !== 'object' || Array.isArray(source)
    || Object.keys(source).some(key => !['eventType', 'sourceId', 'sourceVersion', 'occurredAt', 'targetAffiliateId', 'targetTierId', 'evidenceId', 'notBefore', 'expiresAt'].includes(key))
    || !SUPPORTED_EVENTS.includes(source.eventType)
    || typeof source.sourceId !== 'string' || !SAFE_ID.test(source.sourceId)
    || !Number.isSafeInteger(source.sourceVersion) || source.sourceVersion < 1) invalid();
  if (source.targetTierId !== undefined && (source.eventType !== 'tier_upgrade'
    || typeof source.targetTierId !== 'string' || !SAFE_TIER_ID.test(source.targetTierId))) invalid();
  const occurredMs = isoMilliseconds(source.occurredAt);
  const nowMs = isoMilliseconds(input.now);
  if (occurredMs > nowMs) invalid();
  const scheduled = SCHEDULED_EVENTS.has(source.eventType);
  const notBeforeMs = scheduled ? isoMilliseconds(source.notBefore) : occurredMs;
  const expiresMs = scheduled ? isoMilliseconds(source.expiresAt) : Infinity;
  if (scheduled ? notBeforeMs < occurredMs || expiresMs <= notBeforeMs
    : source.notBefore !== undefined || source.expiresAt !== undefined || source.evidenceId !== undefined) invalid();
  if (scheduled && source.eventType !== 'inactivity_reminder'
    ? typeof source.evidenceId !== 'string' || !SAFE_ID.test(source.evidenceId)
    : source.evidenceId !== undefined) invalid();
  const targeted = !['new_release', 'upcoming_campaign', 'exclusive_opportunity'].includes(source.eventType);
  if (targeted ? typeof source.targetAffiliateId !== 'string' || !SAFE_ID.test(source.targetAffiliateId)
    : source.targetAffiliateId !== undefined) invalid();
  if (!Array.isArray(input.affiliates)
    || input.affiliates.length > MAX_AFFILIATE_NOTIFICATION_PLAN_RECIPIENTS) invalid();
  const ids = new Set<string>();
  for (const affiliate of input.affiliates) {
    if (!affiliate || typeof affiliate.id !== 'string' || !SAFE_ID.test(affiliate.id) || ids.has(affiliate.id)) invalid();
    ids.add(affiliate.id);
  }
  const settings = validateAffiliateNotificationSettings(input.settings);
  const template = settings.templates.find(item => item.eventType === source.eventType)!;
  const eventId = digest('ane1_', [source.eventType, source.sourceId, source.sourceVersion, source.targetAffiliateId ?? null]);
  const result: AffiliateNotificationPlan = {
    eventId, deliveryMode: 'preview_only', intents: [], excluded: 0, reasons: {},
  };
  const exclude = (reason: string) => {
    result.excluded++;
    result.reasons[reason] = (result.reasons[reason] || 0) + 1;
  };
  const dueMs = notBeforeMs + template.timing.delayMinutes * 60_000;
  if (!Number.isSafeInteger(dueMs) || Math.abs(dueMs) > 8.64e15) invalid();
  const dueAt = new Date(dueMs).toISOString();
  for (const affiliate of input.affiliates) {
    if (targeted && affiliate.id !== source.targetAffiliateId) { exclude('not_event_recipient'); continue; }
    if (!settings.enabled || !template.enabled) { exclude('notifications_disabled'); continue; }
    if (scheduled && (nowMs >= expiresMs || dueMs >= expiresMs)) { exclude('scheduled_event_expired'); continue; }
    const eligibilityAffiliate = source.eventType === 'tier_upgrade' && source.targetTierId && affiliate.literaryCircle
      ? { ...affiliate, literaryCircle: { ...affiliate.literaryCircle,
        tier: { ...affiliate.literaryCircle.tier, id: source.targetTierId } } }
      : affiliate;
    const eligibility = summarizeAffiliateNotificationEligibility([eligibilityAffiliate], template, {
      verifiedManualTierIds: input.verifiedManualTierIds,
      verifiedMonthlyTiers: input.verifiedMonthlyTiers,
      ...(source.eventType === 'tier_upgrade' && source.targetTierId
        ? { verifiedUpgradeTierIds: { [affiliate.id]: source.targetTierId } } : {}),
    });
    if (!eligibility.eligible) {
      exclude(Object.keys(eligibility.reasons)[0] || 'ineligible');
      continue;
    }
    const approvedMs = Date.parse(affiliate.approvedAt || '');
    if (!Number.isFinite(approvedMs) || approvedMs <= 0 || approvedMs > nowMs) {
      exclude('writer_approval_not_effective');
      continue;
    }
    if (scheduled && approvedMs > occurredMs) { exclude('writer_approval_after_event'); continue; }
    // A later opt-in must not turn historical releases into a marketing backlog.
    // Delivery must independently recheck current consent before sending.
    if (['new_release', 'upcoming_campaign', 'inactivity_reminder', 'exclusive_opportunity'].includes(source.eventType)) {
      const consentAt = affiliate.notificationPreferences?.marketingConsentAt;
      const consentMs = typeof consentAt === 'string' ? Date.parse(consentAt) : NaN;
      const topicField = source.eventType === 'new_release' ? 'releaseUpdatesEnabledAt'
        : source.eventType === 'upcoming_campaign' ? 'campaignUpdatesEnabledAt'
          : source.eventType === 'inactivity_reminder' ? 'inactivityRemindersEnabledAt' : 'exclusiveOpportunitiesEnabledAt';
      const topicEnabledAt = affiliate.notificationPreferences?.[topicField];
      const topicEnabledMs = typeof topicEnabledAt === 'string' ? Date.parse(topicEnabledAt) : NaN;
      if (!Number.isFinite(consentMs) || consentMs <= 0 || consentMs > occurredMs
        || new Date(consentMs).toISOString() !== consentAt) {
        exclude('marketing_consent_after_event');
        continue;
      }
      if (!Number.isFinite(topicEnabledMs) || topicEnabledMs <= 0 || topicEnabledMs > occurredMs
        || new Date(topicEnabledMs).toISOString() !== topicEnabledAt) {
        exclude(source.eventType === 'new_release' ? 'release_opt_in_after_event' : 'topic_opt_in_after_event');
        continue;
      }
    }
    const monthlyTier = input.verifiedMonthlyTiers?.[affiliate.id];
    const pinsMonthlyTier = template.eligibility.tierIds.length > 0
      && !(source.eventType === 'tier_upgrade' && source.targetTierId)
      && ['default', 'monthly_performance'].includes(affiliate.literaryCircle?.tier.source || '')
      && isVerifiedAffiliateNotificationMonthlyTier(monthlyTier);
    result.intents.push({
      schemaVersion: 1,
      id: digest('ani1_', [eventId, affiliate.id]),
      eventId,
      eventType: source.eventType,
      affiliateId: affiliate.id,
      settingsRevision: settings.revision,
      state: 'held',
      dueAt,
      ...(pinsMonthlyTier ? { tierEvidenceSha256: monthlyTier.evidenceSha256 } : {}),
    });
  }
  return result;
}
