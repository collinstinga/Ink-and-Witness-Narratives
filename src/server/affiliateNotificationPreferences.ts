import crypto from 'crypto';
import type {
  AffiliateAccount,
  AffiliateAuditLogEntry,
  AffiliateNotificationPreferences,
} from '../types.js';
import { getDb, getFirestoreDoc, sanitizeForFirestore } from './db.js';
import { verifyAffiliateMarketingOptOutToken } from './affiliateNotificationSecurity.js';

export const AFFILIATE_NOTIFICATION_PREFERENCES_SCHEMA_VERSION = 1 as const;
export const AFFILIATE_MARKETING_DISCLOSURE_VERSION = 'literary-circle-marketing-2026-10-v1';

const AFFILIATE_COLLECTION = 'affiliates';
const AUDIT_COLLECTION = 'affiliate_audit';
const SAFE_AFFILIATE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/;

export interface AffiliateNotificationPreferencesUpdate {
  expectedRevision: number;
  marketingConsent: boolean;
  releaseUpdates: boolean;
  campaignUpdates: boolean;
  inactivityReminders: boolean;
  exclusiveOpportunities: boolean;
  commissionAlerts: boolean;
  tierAlerts: boolean;
}

export const DEFAULT_AFFILIATE_NOTIFICATION_PREFERENCES: AffiliateNotificationPreferences = {
  schemaVersion: AFFILIATE_NOTIFICATION_PREFERENCES_SCHEMA_VERSION,
  revision: 0,
  marketingConsent: 'unknown',
  releaseUpdates: false,
  campaignUpdates: false,
  inactivityReminders: false,
  exclusiveOpportunities: false,
  commissionAlerts: true,
  tierAlerts: true,
  allMarketingOptOut: true,
};

export class AffiliateNotificationPreferencesValidationError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = 'AffiliateNotificationPreferencesValidationError';
  }
}

export class AffiliateNotificationPreferencesConflictError extends Error {
  readonly statusCode = 409;

  constructor() {
    super('Notification preferences changed in another session. Reload them before saving again.');
    this.name = 'AffiliateNotificationPreferencesConflictError';
  }
}

export class AffiliateNotificationPreferencesNotFoundError extends Error {
  readonly statusCode = 404;

  constructor() {
    super('Affiliate account was not found.');
    this.name = 'AffiliateNotificationPreferencesNotFoundError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeIso(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

function canonicalIso(value: unknown): string | undefined {
  const normalized = safeIso(value);
  return normalized === value ? normalized : undefined;
}

function safeRevision(value: unknown): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function cloneDefault(): AffiliateNotificationPreferences {
  return { ...DEFAULT_AFFILIATE_NOTIFICATION_PREFERENCES };
}

export function normalizeAffiliateNotificationPreferences(value: unknown): AffiliateNotificationPreferences {
  if (!isRecord(value) || value.schemaVersion !== AFFILIATE_NOTIFICATION_PREFERENCES_SCHEMA_VERSION) {
    return cloneDefault();
  }
  const marketingConsent = value.marketingConsent === 'granted' || value.marketingConsent === 'denied'
    ? value.marketingConsent
    : 'unknown';
  const consentGranted = marketingConsent === 'granted'
    && value.marketingConsentVersion === AFFILIATE_MARKETING_DISCLOSURE_VERSION
    && Boolean(safeIso(value.marketingConsentAt));
  return {
    schemaVersion: AFFILIATE_NOTIFICATION_PREFERENCES_SCHEMA_VERSION,
    revision: safeRevision(value.revision),
    marketingConsent: consentGranted ? 'granted' : marketingConsent === 'denied' ? 'denied' : 'unknown',
    ...(consentGranted ? {
      marketingConsentVersion: AFFILIATE_MARKETING_DISCLOSURE_VERSION,
      marketingConsentAt: safeIso(value.marketingConsentAt),
      marketingConsentSource: value.marketingConsentSource === 'affiliate_onboarding'
        ? 'affiliate_onboarding'
        : value.marketingConsentSource === 'writer_recorded'
          ? 'writer_recorded'
          : 'affiliate_dashboard',
    } : {}),
    ...(marketingConsent === 'denied' && safeIso(value.marketingOptOutAt) ? {
      marketingOptOutAt: safeIso(value.marketingOptOutAt),
      marketingOptOutSource: value.marketingOptOutSource === 'signed_email_link'
        ? 'signed_email_link'
        : 'affiliate_dashboard',
    } : {}),
    releaseUpdates: consentGranted && value.releaseUpdates === true,
    ...(consentGranted && value.releaseUpdates === true && canonicalIso(value.releaseUpdatesEnabledAt)
      ? { releaseUpdatesEnabledAt: canonicalIso(value.releaseUpdatesEnabledAt) }
      : {}),
    campaignUpdates: consentGranted && value.campaignUpdates === true,
    ...(consentGranted && value.campaignUpdates === true && canonicalIso(value.campaignUpdatesEnabledAt)
      ? { campaignUpdatesEnabledAt: canonicalIso(value.campaignUpdatesEnabledAt) } : {}),
    inactivityReminders: consentGranted && value.inactivityReminders === true,
    ...(consentGranted && value.inactivityReminders === true && canonicalIso(value.inactivityRemindersEnabledAt)
      ? { inactivityRemindersEnabledAt: canonicalIso(value.inactivityRemindersEnabledAt) } : {}),
    exclusiveOpportunities: consentGranted && value.exclusiveOpportunities === true,
    ...(consentGranted && value.exclusiveOpportunities === true && canonicalIso(value.exclusiveOpportunitiesEnabledAt)
      ? { exclusiveOpportunitiesEnabledAt: canonicalIso(value.exclusiveOpportunitiesEnabledAt) } : {}),
    commissionAlerts: value.commissionAlerts !== false,
    tierAlerts: value.tierAlerts !== false,
    allMarketingOptOut: !consentGranted || value.allMarketingOptOut === true,
    ...(safeIso(value.updatedAt) ? { updatedAt: safeIso(value.updatedAt) } : {}),
  };
}

function validateUpdate(value: unknown): AffiliateNotificationPreferencesUpdate {
  if (!isRecord(value)) throw new AffiliateNotificationPreferencesValidationError('Notification preferences must be an object.');
  const allowed = new Set([
    'expectedRevision',
    'marketingConsent',
    'releaseUpdates',
    'campaignUpdates',
    'inactivityReminders',
    'exclusiveOpportunities',
    'commissionAlerts',
    'tierAlerts',
  ]);
  const unknown = Object.keys(value).find(key => !allowed.has(key));
  if (unknown) throw new AffiliateNotificationPreferencesValidationError(`Notification preferences contain an unsupported “${unknown}” field.`);
  if (!Number.isSafeInteger(value.expectedRevision) || Number(value.expectedRevision) < 0) {
    throw new AffiliateNotificationPreferencesValidationError('A valid expected preference revision is required.');
  }
  for (const key of [...allowed].filter(key => key !== 'expectedRevision')) {
    if (typeof value[key] !== 'boolean') {
      throw new AffiliateNotificationPreferencesValidationError(`${key} must be true or false.`);
    }
  }
  return value as unknown as AffiliateNotificationPreferencesUpdate;
}

function safeAffiliateId(value: unknown): string {
  const affiliateId = typeof value === 'string' ? value.trim() : '';
  if (!SAFE_AFFILIATE_ID.test(affiliateId)) throw new AffiliateNotificationPreferencesNotFoundError();
  return affiliateId;
}

export async function getAffiliateNotificationPreferencesFresh(
  affiliateIdValue: unknown,
): Promise<AffiliateNotificationPreferences> {
  const affiliateId = safeAffiliateId(affiliateIdValue);
  const affiliate = await getFirestoreDoc<AffiliateAccount>(AFFILIATE_COLLECTION, affiliateId);
  if (!affiliate) throw new AffiliateNotificationPreferencesNotFoundError();
  return normalizeAffiliateNotificationPreferences(affiliate.notificationPreferences);
}

export async function saveAffiliateNotificationPreferences(
  affiliateIdValue: unknown,
  updateValue: unknown,
  actor: string,
): Promise<{ preferences: AffiliateNotificationPreferences; audit: AffiliateAuditLogEntry }> {
  const affiliateId = safeAffiliateId(affiliateIdValue);
  const update = validateUpdate(updateValue);
  const db = getDb();
  const affiliateRef = db.collection(AFFILIATE_COLLECTION).doc(affiliateId);
  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(affiliateRef);
    if (!snapshot.exists) throw new AffiliateNotificationPreferencesNotFoundError();
    const affiliate = { ...(snapshot.data() as AffiliateAccount), id: affiliateId };
    const previous = normalizeAffiliateNotificationPreferences(affiliate.notificationPreferences);
    if (previous.revision !== update.expectedRevision) throw new AffiliateNotificationPreferencesConflictError();

    const now = new Date().toISOString();
    const consentGranted = update.marketingConsent === true;
    const releaseUpdates = consentGranted && update.releaseUpdates;
    const preferences: AffiliateNotificationPreferences = {
      schemaVersion: AFFILIATE_NOTIFICATION_PREFERENCES_SCHEMA_VERSION,
      revision: previous.revision + 1,
      marketingConsent: consentGranted ? 'granted' : 'denied',
      ...(consentGranted ? {
        marketingConsentVersion: AFFILIATE_MARKETING_DISCLOSURE_VERSION,
        marketingConsentAt: previous.marketingConsent === 'granted'
          && previous.marketingConsentVersion === AFFILIATE_MARKETING_DISCLOSURE_VERSION
          && previous.marketingConsentAt
          ? previous.marketingConsentAt
          : now,
        marketingConsentSource: 'affiliate_dashboard' as const,
      } : {
        marketingOptOutAt: now,
        marketingOptOutSource: 'affiliate_dashboard' as const,
      }),
      releaseUpdates,
      ...(releaseUpdates ? {
        // An explicit save may opt an older account in from now onward, but
        // missing historical evidence must never be replaced with old consent.
        releaseUpdatesEnabledAt: previous.releaseUpdates && previous.releaseUpdatesEnabledAt
          ? previous.releaseUpdatesEnabledAt
          : now,
      } : {}),
      campaignUpdates: consentGranted && update.campaignUpdates,
      ...(consentGranted && update.campaignUpdates ? {
        campaignUpdatesEnabledAt: previous.campaignUpdates && previous.campaignUpdatesEnabledAt
          ? previous.campaignUpdatesEnabledAt : now,
      } : {}),
      inactivityReminders: consentGranted && update.inactivityReminders,
      ...(consentGranted && update.inactivityReminders ? {
        inactivityRemindersEnabledAt: previous.inactivityReminders && previous.inactivityRemindersEnabledAt
          ? previous.inactivityRemindersEnabledAt : now,
      } : {}),
      exclusiveOpportunities: consentGranted && update.exclusiveOpportunities,
      ...(consentGranted && update.exclusiveOpportunities ? {
        exclusiveOpportunitiesEnabledAt: previous.exclusiveOpportunities && previous.exclusiveOpportunitiesEnabledAt
          ? previous.exclusiveOpportunitiesEnabledAt : now,
      } : {}),
      commissionAlerts: update.commissionAlerts,
      tierAlerts: update.tierAlerts,
      allMarketingOptOut: !consentGranted,
      updatedAt: now,
    };
    const audit: AffiliateAuditLogEntry = {
      id: `aud_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      timestamp: now,
      actor: String(actor || 'Affiliate').trim().slice(0, 120) || 'Affiliate',
      action: 'affiliate_notification_preferences_saved',
      targetType: 'notification',
      targetId: affiliateId,
      summary: `Updated notification preferences for ${affiliate.affiliateCode || affiliateId}.`,
      previousValue: previous,
      newValue: preferences,
    };

    transaction.set(affiliateRef, sanitizeForFirestore({
      notificationPreferences: preferences,
      updatedAt: now,
    }), { mergeFields: ['notificationPreferences', 'updatedAt'] });
    transaction.set(db.collection(AUDIT_COLLECTION).doc(audit.id), sanitizeForFirestore(audit), { merge: false });
    return { preferences, audit };
  });
}

export async function optOutAffiliateMarketingByToken(
  token: unknown,
  options: { signingSecret?: string } = {},
): Promise<{ accepted: true; changed: boolean; affiliateId?: string; audit?: AffiliateAuditLogEntry }> {
  const verified = verifyAffiliateMarketingOptOutToken(token, options.signingSecret);
  if (!verified) return { accepted: true, changed: false };

  const db = getDb();
  const affiliateRef = db.collection(AFFILIATE_COLLECTION).doc(verified.affiliateId);
  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(affiliateRef);
    if (!snapshot.exists) return { accepted: true as const, changed: false };
    const affiliate = { ...(snapshot.data() as AffiliateAccount), id: verified.affiliateId };
    const previous = normalizeAffiliateNotificationPreferences(affiliate.notificationPreferences);
    if (
      previous.marketingConsent === 'denied'
      && previous.allMarketingOptOut
      && !previous.releaseUpdates
      && !previous.campaignUpdates
      && !previous.inactivityReminders
      && !previous.exclusiveOpportunities
    ) {
      return { accepted: true as const, changed: false, affiliateId: verified.affiliateId };
    }

    const now = new Date().toISOString();
    const preferences: AffiliateNotificationPreferences = {
      schemaVersion: AFFILIATE_NOTIFICATION_PREFERENCES_SCHEMA_VERSION,
      revision: previous.revision + 1,
      marketingConsent: 'denied',
      marketingOptOutAt: now,
      marketingOptOutSource: 'signed_email_link',
      releaseUpdates: false,
      campaignUpdates: false,
      inactivityReminders: false,
      exclusiveOpportunities: false,
      commissionAlerts: previous.commissionAlerts,
      tierAlerts: previous.tierAlerts,
      allMarketingOptOut: true,
      updatedAt: now,
    };
    const audit: AffiliateAuditLogEntry = {
      id: `aud_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      timestamp: now,
      actor: 'Affiliate (signed marketing opt-out)',
      action: 'affiliate_marketing_opt_out_confirmed',
      targetType: 'notification',
      targetId: verified.affiliateId,
      summary: `Recorded a signed marketing opt-out for ${affiliate.affiliateCode || verified.affiliateId}.`,
      previousValue: previous,
      newValue: preferences,
    };

    transaction.set(affiliateRef, sanitizeForFirestore({
      notificationPreferences: preferences,
      updatedAt: now,
    }), { mergeFields: ['notificationPreferences', 'updatedAt'] });
    transaction.set(db.collection(AUDIT_COLLECTION).doc(audit.id), sanitizeForFirestore(audit), { merge: false });
    return { accepted: true as const, changed: true, affiliateId: verified.affiliateId, audit };
  });
}
