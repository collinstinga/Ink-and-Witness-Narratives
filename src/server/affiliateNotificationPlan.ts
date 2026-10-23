import crypto from 'crypto';
import type { AffiliatePublicProfile, LiteraryCircleNotificationSettings } from '../types.js';
import {
  summarizeAffiliateNotificationEligibility,
  validateAffiliateNotificationSettings,
} from './affiliateNotifications.js';

// Scheduled campaigns, inactivity reminders, and opportunities need their own
// source validation and cooldown evidence before they can enter this planner.
const DIRECT_EVENTS = ['activation', 'new_release', 'new_commission', 'tier_upgrade'] as const;
type DirectEvent = typeof DIRECT_EVENTS[number];
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const SAFE_TIER_ID = /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/;
export const MAX_AFFILIATE_NOTIFICATION_PLAN_RECIPIENTS = 200;

export interface AffiliateNotificationSource {
  eventType: DirectEvent;
  sourceId: string;
  sourceVersion: number;
  occurredAt: string;
  targetAffiliateId?: string;
  /** Verified destination from a committed tier transition, not a profile edit. */
  targetTierId?: string;
}

export interface HeldAffiliateNotificationIntent {
  schemaVersion: 1;
  id: string;
  eventId: string;
  eventType: DirectEvent;
  affiliateId: string;
  settingsRevision: number;
  state: 'held';
  dueAt: string;
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
  now: string;
}): AffiliateNotificationPlan {
  const source = input.source;
  if (!source || typeof source !== 'object' || Array.isArray(source)
    || Object.keys(source).some(key => !['eventType', 'sourceId', 'sourceVersion', 'occurredAt', 'targetAffiliateId', 'targetTierId'].includes(key))
    || !DIRECT_EVENTS.includes(source.eventType)
    || typeof source.sourceId !== 'string' || !SAFE_ID.test(source.sourceId)
    || !Number.isSafeInteger(source.sourceVersion) || source.sourceVersion < 1) invalid();
  if (source.targetTierId !== undefined && (source.eventType !== 'tier_upgrade'
    || typeof source.targetTierId !== 'string' || !SAFE_TIER_ID.test(source.targetTierId))) invalid();
  const occurredMs = isoMilliseconds(source.occurredAt);
  const nowMs = isoMilliseconds(input.now);
  if (occurredMs > nowMs) invalid();
  const targeted = source.eventType !== 'new_release';
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
  const dueMs = occurredMs + template.timing.delayMinutes * 60_000;
  if (!Number.isSafeInteger(dueMs) || Math.abs(dueMs) > 8.64e15) invalid();
  const dueAt = new Date(dueMs).toISOString();
  for (const affiliate of input.affiliates) {
    if (targeted && affiliate.id !== source.targetAffiliateId) { exclude('not_event_recipient'); continue; }
    if (!settings.enabled || !template.enabled) { exclude('notifications_disabled'); continue; }
    const eligibilityAffiliate = source.eventType === 'tier_upgrade' && source.targetTierId && affiliate.literaryCircle
      ? { ...affiliate, literaryCircle: { ...affiliate.literaryCircle,
        tier: { ...affiliate.literaryCircle.tier, id: source.targetTierId } } }
      : affiliate;
    const eligibility = summarizeAffiliateNotificationEligibility([eligibilityAffiliate], template);
    if (!eligibility.eligible) {
      exclude(Object.keys(eligibility.reasons)[0] || 'ineligible');
      continue;
    }
    const approvedMs = Date.parse(affiliate.approvedAt || '');
    if (!Number.isFinite(approvedMs) || approvedMs <= 0 || approvedMs > nowMs) {
      exclude('writer_approval_not_effective');
      continue;
    }
    // A later opt-in must not turn historical releases into a marketing backlog.
    // Delivery must independently recheck current consent before sending.
    if (source.eventType === 'new_release') {
      const consentAt = affiliate.notificationPreferences?.marketingConsentAt;
      const consentMs = typeof consentAt === 'string' ? Date.parse(consentAt) : NaN;
      const releaseEnabledAt = affiliate.notificationPreferences?.releaseUpdatesEnabledAt;
      const releaseEnabledMs = typeof releaseEnabledAt === 'string' ? Date.parse(releaseEnabledAt) : NaN;
      if (!Number.isFinite(consentMs) || consentMs <= 0 || consentMs > occurredMs
        || new Date(consentMs).toISOString() !== consentAt) {
        exclude('marketing_consent_after_event');
        continue;
      }
      if (!Number.isFinite(releaseEnabledMs) || releaseEnabledMs <= 0 || releaseEnabledMs > occurredMs
        || new Date(releaseEnabledMs).toISOString() !== releaseEnabledAt) {
        exclude('release_opt_in_after_event');
        continue;
      }
    }
    result.intents.push({
      schemaVersion: 1,
      id: digest('ani1_', [eventId, affiliate.id]),
      eventId,
      eventType: source.eventType,
      affiliateId: affiliate.id,
      settingsRevision: settings.revision,
      state: 'held',
      dueAt,
    });
  }
  return result;
}
