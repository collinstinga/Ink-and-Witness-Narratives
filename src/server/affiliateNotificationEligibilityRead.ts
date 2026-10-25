import type { Firestore } from 'firebase-admin/firestore';
import type { AffiliateNotificationEligibilitySummary, AffiliatePublicProfile, LiteraryCircleNotificationEventType } from '../types.js';
import { getDb } from './db.js';
import {
  AFFILIATE_NOTIFICATION_EVENT_TYPES,
  AffiliateNotificationValidationError,
  DEFAULT_AFFILIATE_NOTIFICATION_SETTINGS,
  summarizeAffiliateNotificationEligibility,
  validateAffiliateNotificationSettings,
} from './affiliateNotifications.js';
import { verifiedManualAffiliateNotificationTierIds } from './affiliateNotificationTierFilter.js';
import { readVerifiedAffiliateNotificationMonthlyTiers } from './affiliateNotificationMonthlyTiers.js';
import { MAX_AFFILIATE_NOTIFICATION_PLAN_RECIPIENTS } from './affiliateNotificationPlan.js';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
export class AffiliateNotificationEligibilityOverflowError extends Error {
  readonly code = 'AFFILIATE_NOTIFICATION_ELIGIBILITY_OVERFLOW';
  constructor() {
    super('The partner audience exceeds the safe preview limit. A reviewed larger-audience preview is required.');
    this.name = 'AffiliateNotificationEligibilityOverflowError';
  }
}
export class AffiliateNotificationEligibilityReadError extends Error {
  constructor() {
    super('Partner notification eligibility could not be checked right now. Please retry.');
    this.name = 'AffiliateNotificationEligibilityReadError';
  }
}

/** Writer-only aggregate preview. Audience, effective policy and canonical
 * qualification are read from one bounded read-only transaction. No cache,
 * financial mutation, held intent, provider, or email operation exists here.
 * Optional settings are writer template drafts, never tier-policy overrides. */
export async function readAffiliateNotificationEligibility(input: {
  eventType: LiteraryCircleNotificationEventType;
  settings?: unknown;
  /** Server/test injection only; the HTTP request cannot choose these fields. */
  db?: Firestore;
  now?: string;
}): Promise<AffiliateNotificationEligibilitySummary> {
  if (!AFFILIATE_NOTIFICATION_EVENT_TYPES.includes(input.eventType)) {
    throw new AffiliateNotificationValidationError('A supported partner notification event is required.');
  }
  const draft = input.settings === undefined ? undefined : validateAffiliateNotificationSettings(input.settings);
  const now = input.now ?? new Date().toISOString();
  const milliseconds = Date.parse(now);
  if (!Number.isFinite(milliseconds) || milliseconds <= 0 || new Date(milliseconds).toISOString() !== now) {
    throw new AffiliateNotificationEligibilityReadError();
  }
  try {
    const db = input.db ?? getDb();
    return await db.runTransaction(async transaction => {
      const audience = await transaction.get(db.collection('affiliates').limit(MAX_AFFILIATE_NOTIFICATION_PLAN_RECIPIENTS + 1));
      if (audience.docs.length > MAX_AFFILIATE_NOTIFICATION_PLAN_RECIPIENTS) throw new AffiliateNotificationEligibilityOverflowError();
      const ids = new Set<string>();
      const affiliates: AffiliatePublicProfile[] = [];
      for (const snapshot of audience.docs) {
        if (typeof snapshot.id !== 'string' || !SAFE_ID.test(snapshot.id) || ids.has(snapshot.id)) throw new AffiliateNotificationEligibilityReadError();
        ids.add(snapshot.id);
        affiliates.push({ ...snapshot.data(), id: snapshot.id } as AffiliatePublicProfile);
      }
      const settingsSnapshot = draft ? undefined
        : await transaction.get(db.collection('site_configs').doc('affiliate_notifications'));
      const settings = draft ?? (settingsSnapshot?.exists
        ? validateAffiliateNotificationSettings(settingsSnapshot.data()) : DEFAULT_AFFILIATE_NOTIFICATION_SETTINGS);
      const template = settings.templates.find(candidate => candidate.eventType === input.eventType);
      if (!template) throw new AffiliateNotificationValidationError('The selected partner notification template is unavailable.');
      if (!template.eligibility.tierIds.length) return summarizeAffiliateNotificationEligibility(affiliates, template);
      const circle = await transaction.get(db.collection('site_configs').doc('affiliate_literary_circle'));
      const policy = circle.exists ? circle.data() : undefined;
      const verifiedManualTierIds = verifiedManualAffiliateNotificationTierIds(affiliates, policy, now);
      const verifiedMonthlyTiers = await readVerifiedAffiliateNotificationMonthlyTiers({ db, transaction, affiliates, settings: policy, now });
      return summarizeAffiliateNotificationEligibility(affiliates, template, { verifiedManualTierIds, verifiedMonthlyTiers });
    }, { readOnly: true });
  } catch (error) {
    if (error instanceof AffiliateNotificationEligibilityOverflowError || error instanceof AffiliateNotificationValidationError) throw error;
    // Never log or return SDK errors, identifiers or cached partial counts.
    throw new AffiliateNotificationEligibilityReadError();
  }
}
