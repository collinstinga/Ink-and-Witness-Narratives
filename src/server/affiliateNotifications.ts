import crypto from 'crypto';
import type {
  AffiliateAuditLogEntry,
  AffiliateNotificationEligibilitySummary,
  AffiliatePublicProfile,
  LiteraryCircleNotificationEligibility,
  LiteraryCircleNotificationEventType,
  LiteraryCircleNotificationSettings,
  LiteraryCircleNotificationTemplate,
} from '../types.js';
import { getDb, getFirestoreDoc, sanitizeForFirestore } from './db.js';
import { normalizeAffiliateNotificationPreferences } from './affiliateNotificationPreferences.js';
import { hasValidAffiliateWriterApproval } from './affiliateApproval.js';
import {
  AUTOMATIC_AFFILIATE_NOTIFICATION_TIER_FILTER_UNSUPPORTED,
  isVerifiedAffiliateNotificationMonthlyTier,
  type VerifiedAffiliateNotificationMonthlyTiers,
} from './affiliateNotificationTierFilter.js';

export const AFFILIATE_NOTIFICATION_SETTINGS_DOCUMENT_ID = 'affiliate_notifications';
export const AFFILIATE_NOTIFICATION_SCHEMA_VERSION = 1 as const;

const CONFIG_COLLECTION = 'site_configs';
const AUDIT_COLLECTION = 'affiliate_audit';
const MAX_DELAY_MINUTES = 7 * 24 * 60;
const MAX_LEAD_TIME_HOURS = 90 * 24;
const MAX_INACTIVITY_DAYS = 365;
const MAX_COOLDOWN_DAYS = 365;
const SAFE_TIER_ID = /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const AFFILIATE_NOTIFICATION_EVENT_TYPES: readonly LiteraryCircleNotificationEventType[] = [
  'activation',
  'new_release',
  'upcoming_campaign',
  'new_commission',
  'tier_upgrade',
  'inactivity_reminder',
  'exclusive_opportunity',
];

const MARKETING_EVENTS = new Set<LiteraryCircleNotificationEventType>([
  'new_release',
  'upcoming_campaign',
  'inactivity_reminder',
  'exclusive_opportunity',
]);

const PLACEHOLDERS: Record<LiteraryCircleNotificationEventType, readonly string[]> = {
  activation: ['affiliateName', 'tierName', 'portalUrl'],
  new_release: ['affiliateName', 'pieceTitle', 'pieceUrl'],
  upcoming_campaign: ['affiliateName', 'campaignName', 'campaignStartDate', 'portalUrl'],
  new_commission: ['affiliateName', 'commissionAmount', 'pieceTitle', 'portalUrl'],
  tier_upgrade: ['affiliateName', 'tierName', 'portalUrl'],
  inactivity_reminder: ['affiliateName', 'portalUrl'],
  exclusive_opportunity: ['affiliateName', 'opportunityTitle', 'portalUrl'],
};

const DEFAULT_COPY: Record<LiteraryCircleNotificationEventType, Omit<LiteraryCircleNotificationTemplate, 'eventType'>> = {
  activation: {
    enabled: false,
    subject: 'Welcome to the Ink & Witness Literary Circle',
    preheader: 'Your Literary Circle access is ready.',
    heading: 'Welcome to the Literary Circle',
    body: 'Hello {{affiliateName}},\n\nYour approved Literary Circle membership is active. You can now explore the catalogue and your partner tools.',
    ctaLabel: 'Open partner dashboard',
    ctaUrl: '{{portalUrl}}',
    timing: { delayMinutes: 0 },
    eligibility: { foundingMembersOnly: false, tierIds: [], requireComplimentaryAccess: true },
  },
  new_release: {
    enabled: false,
    subject: 'New release: {{pieceTitle}}',
    preheader: 'A new Ink & Witness piece is ready to read and share.',
    heading: '{{pieceTitle}} is now available',
    body: 'Hello {{affiliateName}},\n\nA new piece has joined the catalogue. Read it first, then share it when it feels right.',
    ctaLabel: 'Read the new piece',
    ctaUrl: '{{pieceUrl}}',
    timing: { delayMinutes: 0 },
    eligibility: { foundingMembersOnly: false, tierIds: [], requireComplimentaryAccess: true },
  },
  upcoming_campaign: {
    enabled: false,
    subject: 'Upcoming partner campaign: {{campaignName}}',
    preheader: 'Prepare for an upcoming Literary Circle campaign.',
    heading: '{{campaignName}} begins {{campaignStartDate}}',
    body: 'Hello {{affiliateName}},\n\nAn upcoming campaign is ready for your attention. Open your dashboard for the approved details and resources.',
    ctaLabel: 'Open campaign tools',
    ctaUrl: '{{portalUrl}}',
    timing: { delayMinutes: 0, leadTimeHours: 72 },
    eligibility: { foundingMembersOnly: false, tierIds: [], requireComplimentaryAccess: true },
  },
  new_commission: {
    enabled: false,
    subject: 'A new commission was recorded',
    preheader: 'Your Literary Circle earnings have changed.',
    heading: 'You earned {{commissionAmount}}',
    body: 'Hello {{affiliateName}},\n\nA verified sale for {{pieceTitle}} created a new commission. Open your dashboard for the auditable status and balance.',
    ctaLabel: 'View earnings',
    ctaUrl: '{{portalUrl}}',
    timing: { delayMinutes: 0 },
    eligibility: { foundingMembersOnly: false, tierIds: [], requireComplimentaryAccess: false },
  },
  tier_upgrade: {
    enabled: false,
    subject: 'Literary Circle tier upgrade',
    preheader: 'Your Literary Circle recognition has changed.',
    heading: 'Welcome to {{tierName}}',
    body: 'Hello {{affiliateName}},\n\nYour verified performance has earned a Literary Circle tier upgrade. Your dashboard now shows the new recognition.',
    ctaLabel: 'View your membership',
    ctaUrl: '{{portalUrl}}',
    timing: { delayMinutes: 0 },
    eligibility: { foundingMembersOnly: false, tierIds: [], requireComplimentaryAccess: true },
  },
  inactivity_reminder: {
    enabled: false,
    subject: 'Your Literary Circle is still here',
    preheader: 'Return whenever you are ready.',
    heading: 'A quiet invitation back',
    body: 'Hello {{affiliateName}},\n\nYour Literary Circle membership remains available. Visit your dashboard when you would like to read, share, or see what is new.',
    ctaLabel: 'Return to the Literary Circle',
    ctaUrl: '{{portalUrl}}',
    timing: { delayMinutes: 0, inactivityDays: 30, cooldownDays: 30 },
    eligibility: { foundingMembersOnly: false, tierIds: [], requireComplimentaryAccess: true },
  },
  exclusive_opportunity: {
    enabled: false,
    subject: 'Literary Circle opportunity: {{opportunityTitle}}',
    preheader: 'A private opportunity is available to eligible partners.',
    heading: '{{opportunityTitle}}',
    body: 'Hello {{affiliateName}},\n\nA new Literary Circle opportunity is available. Open your dashboard for the writer-approved details.',
    ctaLabel: 'View the opportunity',
    ctaUrl: '{{portalUrl}}',
    timing: { delayMinutes: 0 },
    eligibility: { foundingMembersOnly: false, tierIds: [], requireComplimentaryAccess: true },
  },
};

export const DEFAULT_AFFILIATE_NOTIFICATION_SETTINGS: LiteraryCircleNotificationSettings = {
  schemaVersion: AFFILIATE_NOTIFICATION_SCHEMA_VERSION,
  revision: 0,
  enabled: false,
  deliveryMode: 'preview_only',
  timezone: 'Africa/Nairobi',
  templates: AFFILIATE_NOTIFICATION_EVENT_TYPES.map(eventType => ({
    eventType,
    ...DEFAULT_COPY[eventType],
    timing: { ...DEFAULT_COPY[eventType].timing },
    eligibility: { ...DEFAULT_COPY[eventType].eligibility, tierIds: [] },
  })),
};

export class AffiliateNotificationValidationError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = 'AffiliateNotificationValidationError';
  }
}

export class AffiliateNotificationConflictError extends Error {
  readonly statusCode = 409;

  constructor() {
    super('Partner notification settings changed since this editor was opened. Reload the latest settings before saving again.');
    this.name = 'AffiliateNotificationConflictError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneDefault(): LiteraryCircleNotificationSettings {
  return JSON.parse(JSON.stringify(DEFAULT_AFFILIATE_NOTIFICATION_SETTINGS));
}

function safeText(value: unknown, fallback: string, maximum: number): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return (normalized || fallback).slice(0, maximum);
}

function safeOptionalText(value: unknown, maximum: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().slice(0, maximum);
  return normalized || undefined;
}

function safeInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function safeIso(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value).find(key => !allowedSet.has(key));
  if (unknown) throw new AffiliateNotificationValidationError(`${label} contains an unsupported “${unknown}” field.`);
}

function containsRawHtml(value: string): boolean {
  return /<\/?[a-z][^>]*>/i.test(value);
}

function tokensIn(value: string): string[] {
  const tokens = [...value.matchAll(/{{\s*([^{}]+?)\s*}}/g)].map(match => match[1]);
  const stripped = value.replace(/{{\s*([^{}]+?)\s*}}/g, '');
  if (/[{}]/.test(stripped)) {
    throw new AffiliateNotificationValidationError('Notification templates contain malformed placeholder braces.');
  }
  return tokens;
}

function validateTemplateText(
  value: unknown,
  label: string,
  maximum: number,
  allowedTokens: readonly string[],
  options: { required?: boolean; singleLine?: boolean } = {},
): string | undefined {
  if (value === undefined || value === null || value === '') {
    if (options.required) throw new AffiliateNotificationValidationError(`${label} is required.`);
    return undefined;
  }
  if (typeof value !== 'string') throw new AffiliateNotificationValidationError(`${label} must be plain text.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new AffiliateNotificationValidationError(`${label} must be between 1 and ${maximum} characters.`);
  }
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(normalized)) {
    throw new AffiliateNotificationValidationError(`${label} contains unsupported control characters.`);
  }
  if (options.singleLine && /[\r\n]/.test(normalized)) {
    throw new AffiliateNotificationValidationError(`${label} must stay on one line.`);
  }
  if (containsRawHtml(normalized)) {
    throw new AffiliateNotificationValidationError(`${label} must not contain HTML.`);
  }
  for (const token of tokensIn(normalized)) {
    if (!allowedTokens.includes(token)) {
      throw new AffiliateNotificationValidationError(`${label} contains the unsupported placeholder “{{${token}}}”.`);
    }
  }
  return normalized;
}

function validateCtaUrl(value: unknown, allowedTokens: readonly string[]): string | undefined {
  const ctaUrl = validateTemplateText(value, 'CTA URL', 1_000, allowedTokens);
  if (!ctaUrl) return undefined;
  const renderedForValidation = ctaUrl.replace(/{{\s*[^{}]+?\s*}}/g, 'https://example.invalid/');
  if (renderedForValidation.startsWith('/')) {
    if (renderedForValidation.startsWith('//')) {
      throw new AffiliateNotificationValidationError('CTA URL must use an internal path or HTTPS URL.');
    }
    return ctaUrl;
  }
  try {
    const url = new URL(renderedForValidation);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('unsafe');
  } catch {
    throw new AffiliateNotificationValidationError('CTA URL must use an internal path or HTTPS URL.');
  }
  return ctaUrl;
}

function normalizeEligibility(value: unknown, fallback: LiteraryCircleNotificationEligibility): LiteraryCircleNotificationEligibility {
  const eligibility = isRecord(value) ? value : {};
  const tierIds = Array.isArray(eligibility.tierIds)
    ? [...new Set(eligibility.tierIds
      .filter((item): item is string => typeof item === 'string')
      .map(item => item.trim().toLowerCase())
      .filter(item => SAFE_TIER_ID.test(item)))]
    : fallback.tierIds;
  return {
    foundingMembersOnly: eligibility.foundingMembersOnly === true,
    tierIds: tierIds.slice(0, 12),
    requireComplimentaryAccess: typeof eligibility.requireComplimentaryAccess === 'boolean'
      ? eligibility.requireComplimentaryAccess
      : fallback.requireComplimentaryAccess,
  };
}

function normalizeTemplate(value: unknown, eventType: LiteraryCircleNotificationEventType): LiteraryCircleNotificationTemplate {
  const fallback = DEFAULT_COPY[eventType];
  const raw = isRecord(value) ? value : {};
  const timing = isRecord(raw.timing) ? raw.timing : {};
  const allowedTokens = PLACEHOLDERS[eventType];
  const subject = typeof raw.subject === 'string' && !containsRawHtml(raw.subject) && !/[\r\n]/.test(raw.subject)
    ? safeText(raw.subject, fallback.subject, 140)
    : fallback.subject;
  const body = typeof raw.body === 'string' && !containsRawHtml(raw.body)
    ? safeText(raw.body, fallback.body, 4_000)
    : fallback.body;
  const safeCandidate = (candidate: unknown, fallbackValue: string, maximum: number) => {
    const result = typeof candidate === 'string' && !containsRawHtml(candidate)
      ? safeText(candidate, fallbackValue, maximum)
      : fallbackValue;
    try {
      return tokensIn(result).every(token => allowedTokens.includes(token)) ? result : fallbackValue;
    } catch {
      return fallbackValue;
    }
  };
  let ctaLabel: string | undefined;
  let ctaUrl: string | undefined;
  try {
    const candidateLabel = validateTemplateText(raw.ctaLabel ?? fallback.ctaLabel, 'CTA label', 80, allowedTokens);
    const candidateUrl = validateCtaUrl(raw.ctaUrl ?? fallback.ctaUrl, allowedTokens);
    if (candidateLabel && candidateUrl) {
      ctaLabel = candidateLabel;
      ctaUrl = candidateUrl;
    }
  } catch {
    // Corrupt persisted CTA data is omitted. It is never carried forward into
    // a normalized configuration or rendered by a future delivery worker.
  }
  return {
    eventType,
    enabled: raw.enabled === true,
    subject: safeCandidate(subject, fallback.subject, 140),
    preheader: safeCandidate(raw.preheader, fallback.preheader, 200),
    heading: safeCandidate(raw.heading, fallback.heading, 160),
    body: safeCandidate(body, fallback.body, 4_000),
    ...(ctaLabel && ctaUrl ? { ctaLabel, ctaUrl } : {}),
    timing: {
      delayMinutes: safeInteger(timing.delayMinutes, fallback.timing.delayMinutes, 0, MAX_DELAY_MINUTES),
      ...(eventType === 'upcoming_campaign' ? {
        leadTimeHours: safeInteger(timing.leadTimeHours, fallback.timing.leadTimeHours || 72, 1, MAX_LEAD_TIME_HOURS),
      } : {}),
      ...(eventType === 'inactivity_reminder' ? {
        inactivityDays: safeInteger(timing.inactivityDays, fallback.timing.inactivityDays || 30, 7, MAX_INACTIVITY_DAYS),
        cooldownDays: safeInteger(timing.cooldownDays, fallback.timing.cooldownDays || 30, 7, MAX_COOLDOWN_DAYS),
      } : {}),
    },
    eligibility: normalizeEligibility(raw.eligibility, fallback.eligibility),
  };
}

export function normalizeAffiliateNotificationSettings(value: unknown): LiteraryCircleNotificationSettings {
  if (!isRecord(value) || value.schemaVersion !== AFFILIATE_NOTIFICATION_SCHEMA_VERSION) return cloneDefault();
  const rawTemplates = Array.isArray(value.templates) ? value.templates : [];
  const byEvent = new Map<LiteraryCircleNotificationEventType, unknown>();
  for (const raw of rawTemplates) {
    if (!isRecord(raw) || !AFFILIATE_NOTIFICATION_EVENT_TYPES.includes(raw.eventType as LiteraryCircleNotificationEventType)) continue;
    byEvent.set(raw.eventType as LiteraryCircleNotificationEventType, raw);
  }
  return {
    schemaVersion: AFFILIATE_NOTIFICATION_SCHEMA_VERSION,
    revision: safeInteger(value.revision, 0, 0, Number.MAX_SAFE_INTEGER),
    enabled: value.enabled === true,
    deliveryMode: 'preview_only',
    timezone: 'Africa/Nairobi',
    templates: AFFILIATE_NOTIFICATION_EVENT_TYPES.map(eventType => normalizeTemplate(byEvent.get(eventType), eventType)),
    ...(safeIso(value.updatedAt) ? { updatedAt: safeIso(value.updatedAt) } : {}),
    ...(safeOptionalText(value.updatedBy, 120) ? { updatedBy: safeOptionalText(value.updatedBy, 120) } : {}),
  };
}

export function validateAffiliateNotificationSettings(value: unknown): LiteraryCircleNotificationSettings {
  if (!isRecord(value)) throw new AffiliateNotificationValidationError('Partner notification settings must be an object.');
  rejectUnknownKeys(value, ['schemaVersion', 'revision', 'enabled', 'deliveryMode', 'timezone', 'templates', 'updatedAt', 'updatedBy'], 'Partner notification settings');
  if (value.schemaVersion !== AFFILIATE_NOTIFICATION_SCHEMA_VERSION) throw new AffiliateNotificationValidationError('Partner notification settings use an unsupported schema version.');
  if (!Number.isSafeInteger(value.revision) || Number(value.revision) < 0) throw new AffiliateNotificationValidationError('Partner notification settings require a non-negative revision.');
  if (typeof value.enabled !== 'boolean') throw new AffiliateNotificationValidationError('Partner notification enabled state must be true or false.');
  if (value.deliveryMode !== 'preview_only') throw new AffiliateNotificationValidationError('Partner notifications must remain in preview-only mode until delivery safeguards are activated.');
  if (value.timezone !== 'Africa/Nairobi') throw new AffiliateNotificationValidationError('Partner notification timezone must remain Africa/Nairobi.');
  if (!Array.isArray(value.templates) || value.templates.length !== AFFILIATE_NOTIFICATION_EVENT_TYPES.length) {
    throw new AffiliateNotificationValidationError('Exactly seven partner notification templates are required.');
  }
  const seen = new Set<LiteraryCircleNotificationEventType>();
  for (const [index, candidate] of value.templates.entries()) {
    const label = `Partner notification template ${index + 1}`;
    if (!isRecord(candidate)) throw new AffiliateNotificationValidationError(`${label} is invalid.`);
    rejectUnknownKeys(candidate, ['eventType', 'enabled', 'subject', 'preheader', 'heading', 'body', 'ctaLabel', 'ctaUrl', 'timing', 'eligibility'], label);
    const eventType = candidate.eventType as LiteraryCircleNotificationEventType;
    if (!AFFILIATE_NOTIFICATION_EVENT_TYPES.includes(eventType) || seen.has(eventType)) throw new AffiliateNotificationValidationError(`${label} has an invalid or duplicate event type.`);
    seen.add(eventType);
    if (typeof candidate.enabled !== 'boolean') throw new AffiliateNotificationValidationError(`${label} enabled state must be true or false.`);
    const allowedTokens = PLACEHOLDERS[eventType];
    validateTemplateText(candidate.subject, `${label} subject`, 140, allowedTokens, { required: true, singleLine: true });
    validateTemplateText(candidate.preheader, `${label} preheader`, 200, allowedTokens, { required: true, singleLine: true });
    validateTemplateText(candidate.heading, `${label} heading`, 160, allowedTokens, { required: true });
    validateTemplateText(candidate.body, `${label} body`, 4_000, allowedTokens, { required: true });
    const ctaLabel = validateTemplateText(candidate.ctaLabel, `${label} CTA label`, 80, allowedTokens);
    const ctaUrl = validateCtaUrl(candidate.ctaUrl, allowedTokens);
    if (Boolean(ctaLabel) !== Boolean(ctaUrl)) throw new AffiliateNotificationValidationError(`${label} CTA label and URL must be provided together.`);
    if (!isRecord(candidate.timing)) throw new AffiliateNotificationValidationError(`${label} timing is required.`);
    rejectUnknownKeys(candidate.timing, ['delayMinutes', 'leadTimeHours', 'inactivityDays', 'cooldownDays'], `${label} timing`);
    if (!Number.isSafeInteger(candidate.timing.delayMinutes) || Number(candidate.timing.delayMinutes) < 0 || Number(candidate.timing.delayMinutes) > MAX_DELAY_MINUTES) {
      throw new AffiliateNotificationValidationError(`${label} delay must be from 0 to ${MAX_DELAY_MINUTES} minutes.`);
    }
    if (eventType === 'upcoming_campaign') {
      if (!Number.isSafeInteger(candidate.timing.leadTimeHours) || Number(candidate.timing.leadTimeHours) < 1 || Number(candidate.timing.leadTimeHours) > MAX_LEAD_TIME_HOURS) {
        throw new AffiliateNotificationValidationError(`${label} campaign lead time is invalid.`);
      }
    } else if (candidate.timing.leadTimeHours !== undefined) {
      throw new AffiliateNotificationValidationError(`${label} cannot configure campaign lead time.`);
    }
    if (eventType === 'inactivity_reminder') {
      if (!Number.isSafeInteger(candidate.timing.inactivityDays) || Number(candidate.timing.inactivityDays) < 7 || Number(candidate.timing.inactivityDays) > MAX_INACTIVITY_DAYS) {
        throw new AffiliateNotificationValidationError(`${label} inactivity threshold is invalid.`);
      }
      if (!Number.isSafeInteger(candidate.timing.cooldownDays) || Number(candidate.timing.cooldownDays) < 7 || Number(candidate.timing.cooldownDays) > MAX_COOLDOWN_DAYS) {
        throw new AffiliateNotificationValidationError(`${label} inactivity cooldown is invalid.`);
      }
    } else if (candidate.timing.inactivityDays !== undefined || candidate.timing.cooldownDays !== undefined) {
      throw new AffiliateNotificationValidationError(`${label} cannot configure inactivity timing.`);
    }
    if (!isRecord(candidate.eligibility)) throw new AffiliateNotificationValidationError(`${label} eligibility is required.`);
    rejectUnknownKeys(candidate.eligibility, ['foundingMembersOnly', 'tierIds', 'requireComplimentaryAccess'], `${label} eligibility`);
    if (typeof candidate.eligibility.foundingMembersOnly !== 'boolean' || typeof candidate.eligibility.requireComplimentaryAccess !== 'boolean') {
      throw new AffiliateNotificationValidationError(`${label} eligibility flags must be true or false.`);
    }
    if (!Array.isArray(candidate.eligibility.tierIds) || candidate.eligibility.tierIds.length > 12) throw new AffiliateNotificationValidationError(`${label} has invalid tier filters.`);
    const tierIds = candidate.eligibility.tierIds.map(item => typeof item === 'string' ? item.trim().toLowerCase() : '');
    if (tierIds.some(item => !SAFE_TIER_ID.test(item)) || new Set(tierIds).size !== tierIds.length) throw new AffiliateNotificationValidationError(`${label} has invalid or duplicate tier filters.`);
  }
  return normalizeAffiliateNotificationSettings(value);
}

export async function getAffiliateNotificationSettingsFresh(): Promise<LiteraryCircleNotificationSettings> {
  const persisted = await getFirestoreDoc<LiteraryCircleNotificationSettings>(CONFIG_COLLECTION, AFFILIATE_NOTIFICATION_SETTINGS_DOCUMENT_ID);
  return persisted ? normalizeAffiliateNotificationSettings(persisted) : cloneDefault();
}

function digestText(value: string | undefined): { length: number; sha256: string } {
  const text = value || '';
  return { length: text.length, sha256: crypto.createHash('sha256').update(text, 'utf8').digest('hex') };
}

function auditSnapshot(settings: LiteraryCircleNotificationSettings): Record<string, unknown> {
  return {
    schemaVersion: settings.schemaVersion,
    revision: settings.revision,
    enabled: settings.enabled,
    deliveryMode: settings.deliveryMode,
    timezone: settings.timezone,
    templates: settings.templates.map(template => ({
      eventType: template.eventType,
      enabled: template.enabled,
      subjectDigest: digestText(template.subject),
      preheaderDigest: digestText(template.preheader),
      headingDigest: digestText(template.heading),
      bodyDigest: digestText(template.body),
      ctaLabelDigest: digestText(template.ctaLabel),
      ctaUrlDigest: digestText(template.ctaUrl),
      timing: template.timing,
      eligibility: template.eligibility,
    })),
  };
}

export async function saveAffiliateNotificationSettings(
  value: unknown,
  actor: string,
  expectedRevision: number,
): Promise<{ settings: LiteraryCircleNotificationSettings; audit: AffiliateAuditLogEntry }> {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new AffiliateNotificationValidationError('A valid expected revision is required.');
  const validated = validateAffiliateNotificationSettings(value);
  if (validated.revision !== expectedRevision) throw new AffiliateNotificationConflictError();
  const db = getDb();
  const settingsRef = db.collection(CONFIG_COLLECTION).doc(AFFILIATE_NOTIFICATION_SETTINGS_DOCUMENT_ID);
  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(settingsRef);
    const previous = snapshot.exists ? normalizeAffiliateNotificationSettings(snapshot.data()) : cloneDefault();
    if (previous.revision !== expectedRevision) throw new AffiliateNotificationConflictError();
    const now = new Date().toISOString();
    const settings: LiteraryCircleNotificationSettings = {
      ...validated,
      revision: previous.revision + 1,
      deliveryMode: 'preview_only',
      updatedAt: now,
      updatedBy: safeText(actor, 'Admin', 120),
    };
    const audit: AffiliateAuditLogEntry = {
      id: `aud_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      timestamp: now,
      actor: settings.updatedBy || 'Admin',
      action: 'affiliate_notification_settings_saved',
      targetType: 'notification',
      targetId: AFFILIATE_NOTIFICATION_SETTINGS_DOCUMENT_ID,
      summary: 'Saved preview-only Literary Circle partner notification settings.',
      previousValue: auditSnapshot(previous),
      newValue: auditSnapshot(settings),
    };
    transaction.set(settingsRef, sanitizeForFirestore(settings), { merge: false });
    transaction.set(db.collection(AUDIT_COLLECTION).doc(audit.id), sanitizeForFirestore(audit), { merge: false });
    return { settings, audit };
  });
}

function preferenceAllows(affiliate: AffiliatePublicProfile, eventType: LiteraryCircleNotificationEventType): boolean {
  const preferences = affiliate.notificationPreferences
    ? normalizeAffiliateNotificationPreferences(affiliate.notificationPreferences)
    : undefined;
  if (MARKETING_EVENTS.has(eventType)) {
    if (!preferences || preferences.marketingConsent !== 'granted' || preferences.allMarketingOptOut) return false;
    if (eventType === 'new_release') return preferences.releaseUpdates;
    if (eventType === 'upcoming_campaign') return preferences.campaignUpdates;
    if (eventType === 'inactivity_reminder') return preferences.inactivityReminders;
    return preferences.exclusiveOpportunities;
  }
  if (eventType === 'new_commission') return preferences?.commissionAlerts !== false;
  if (eventType === 'tier_upgrade') return preferences?.tierAlerts !== false;
  return true;
}

export function summarizeAffiliateNotificationEligibility(
  affiliates: AffiliatePublicProfile[],
  template: LiteraryCircleNotificationTemplate,
  evidence: {
    /** Build from current server-read Literary Circle settings, not a request. */
    verifiedManualTierIds?: Record<string, string>;
    /** Current complete canonical period and approved effective policy only. */
    verifiedMonthlyTiers?: VerifiedAffiliateNotificationMonthlyTiers;
    /** Internal committed-transition planner only; never a generic preview map. */
    verifiedUpgradeTierIds?: Record<string, string>;
  } = {},
): AffiliateNotificationEligibilitySummary {
  const reasons: Record<string, number> = {};
  let eligible = 0;
  const exclude = (reason: string) => { reasons[reason] = (reasons[reason] || 0) + 1; };
  for (const affiliate of affiliates) {
    if (affiliate.status !== 'active') { exclude('account_not_active'); continue; }
    if (!hasValidAffiliateWriterApproval(affiliate)) { exclude('writer_approval_missing'); continue; }
    if (!EMAIL_PATTERN.test(String(affiliate.email || '').trim().toLowerCase()) || affiliate.email.length > 254) { exclude('valid_email_missing'); continue; }
    if (affiliate.acceptedTerms !== true) { exclude('terms_not_accepted'); continue; }
    if (!affiliate.literaryCircle) { exclude('literary_circle_membership_missing'); continue; }
    if (template.eligibility.requireComplimentaryAccess && affiliate.literaryCircle.complimentaryAccess.status !== 'active') { exclude('complimentary_access_not_active'); continue; }
    if (template.eligibility.foundingMembersOnly && !affiliate.literaryCircle.foundingMember) { exclude('not_founding_member'); continue; }
    if (template.eligibility.tierIds.length) {
      let tierId = affiliate.literaryCircle.tier.id;
      const verifiedUpgrade = template.eventType === 'tier_upgrade' && evidence.verifiedUpgradeTierIds?.[affiliate.id] === tierId;
      if (!verifiedUpgrade) {
        if (affiliate.literaryCircle.tier.source === 'manual') {
          if (evidence.verifiedManualTierIds?.[affiliate.id] !== tierId) {
            exclude('manual_tier_filter_requires_current_settings');
            continue;
          }
        } else if (['default', 'monthly_performance'].includes(affiliate.literaryCircle.tier.source)
          && isVerifiedAffiliateNotificationMonthlyTier(evidence.verifiedMonthlyTiers?.[affiliate.id])) {
          // The persisted automatic tier ID may belong to a previous month.
          tierId = evidence.verifiedMonthlyTiers![affiliate.id].tierId;
        } else {
          exclude(AUTOMATIC_AFFILIATE_NOTIFICATION_TIER_FILTER_UNSUPPORTED);
          continue;
        }
      }
      if (!template.eligibility.tierIds.includes(tierId)) { exclude('tier_not_selected'); continue; }
    }
    if (!preferenceAllows(affiliate, template.eventType)) { exclude(MARKETING_EVENTS.has(template.eventType) ? 'marketing_consent_or_preference_missing' : 'notification_preference_disabled'); continue; }
    eligible += 1;
  }
  return { eventType: template.eventType, total: affiliates.length, eligible, excluded: affiliates.length - eligible, reasons };
}

export function renderAffiliateNotificationTemplate(
  template: LiteraryCircleNotificationTemplate,
  context: Record<string, string>,
): Pick<LiteraryCircleNotificationTemplate, 'subject' | 'preheader' | 'heading' | 'body' | 'ctaLabel' | 'ctaUrl'> {
  const allowed = PLACEHOLDERS[template.eventType];
  const render = (value?: string): string | undefined => value?.replace(/{{\s*([^{}]+?)\s*}}/g, (_match, token: string) => {
    if (!allowed.includes(token)) throw new AffiliateNotificationValidationError(`Unsupported placeholder “{{${token}}}”.`);
    return context[token] || `{{${token}}}`;
  });
  return {
    subject: render(template.subject) || template.subject,
    preheader: render(template.preheader) || template.preheader,
    heading: render(template.heading) || template.heading,
    body: render(template.body) || template.body,
    ...(template.ctaLabel ? { ctaLabel: render(template.ctaLabel) } : {}),
    ...(template.ctaUrl ? { ctaUrl: render(template.ctaUrl) } : {}),
  };
}
