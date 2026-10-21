import crypto from 'crypto';

export const AFFILIATE_CLICK_VISITOR_COOKIE_NAME = 'iw_affiliate_click_visitor';
export const AFFILIATE_CLICK_VISITOR_DEFAULT_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
export const AFFILIATE_CLICK_VISITOR_MAX_AGE_MS = 366 * 24 * 60 * 60 * 1000;
export const AFFILIATE_CLICK_DEDUPE_WINDOW_MS = 30 * 60 * 1000;

const VISITOR_TOKEN_PREFIX = 'aff_vis_v1';
const VISITOR_KEY_PREFIX = 'acv1_';
const CLICK_DOCUMENT_PREFIX = 'aclk2_';
const CLICK_KEY_FINGERPRINT_PREFIX = 'ack1_';
const MAX_TOKEN_LENGTH = 1024;
const MAX_CLOCK_SKEW_MS = 30 * 1000;
const MAX_REFERRER_LENGTH = 2048;
const MAX_REFERRER_ORIGIN_LENGTH = 255;
const DEVELOPMENT_SIGNING_SECRET = crypto.randomBytes(32).toString('hex');

const AFFILIATE_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{0,63}$/;
const CAMPAIGN_CODE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const ARTICLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const AFFILIATE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const VISITOR_NONCE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const VISITOR_KEY_PATTERN = /^acv1_[A-Za-z0-9_-]{43}$/;
const CLICK_DOCUMENT_ID_PATTERN = /^aclk2_[a-f0-9]{64}$/;
const CLICK_KEY_FINGERPRINT_PATTERN = /^ack1_[A-Za-z0-9_-]{43}$/;

interface AffiliateClickVisitorTokenPayload {
  v: 1;
  j: string;
  iat: number;
  exp: number;
}

export interface AffiliateClickVisitorIdentity {
  visitorKey: string;
  issuedAt: number;
  expiresAt: number;
}

export interface AffiliateClickVisitorTokenOptions {
  now?: number;
  maxAgeMs?: number;
  nonce?: string;
  signingSecret?: string;
}

export interface DurableAffiliateClickEventV2 {
  schemaVersion: 2;
  id: string;
  keyFingerprint: string;
  affiliateCode: string;
  affiliateId: string;
  articleId?: string;
  campaignCode?: string;
  visitorKey?: string;
  referrerOrigin?: string;
  timestamp: string;
  dedupeWindowStartedAt?: string;
}

export interface AffiliateClickAnalyticsActivationV1 {
  schemaVersion: 1;
  eventSchemaVersion: 2;
  activatedAt: string;
  completeFrom: string;
  keyVersion: 'v1';
  keyFingerprint: string;
}

export type DurableAffiliateClickCoverageReason =
  | 'complete'
  | 'invalid_range'
  | 'not_enabled'
  | 'query_failed'
  | 'invalid_activation_marker'
  | 'runtime_not_required'
  | 'missing_secret'
  | 'key_mismatch'
  | 'predates_durable_history'
  | 'settling_window'
  | 'truncated'
  | 'invalid_events'
  | 'missing_visitor_keys';

export interface DurableAffiliateClickCoverageAssessment {
  eventCoverage: 'complete' | 'partial' | 'unavailable';
  uniqueVisitorCoverage: 'complete' | 'partial' | 'unavailable';
  conversionCoverage: 'complete' | 'partial' | 'unavailable';
  reasons: DurableAffiliateClickCoverageReason[];
  validEventCount: number;
  invalidEventCount: number;
  eventsWithoutVisitorKey: number;
}

function resolveSigningSecret(explicitSecret?: unknown): string | null {
  const hasExplicitSecret = explicitSecret !== undefined;
  const candidate = hasExplicitSecret
    ? explicitSecret
    : process.env.AFFILIATE_CLICK_ANALYTICS_SECRET
      ?? process.env.AFFILIATE_SESSION_SIGNING_SECRET
      ?? process.env.SESSION_SIGNING_SECRET;
  if (typeof candidate === 'string' && candidate.trim().length >= 32) {
    return candidate.trim();
  }
  if (hasExplicitSecret || process.env.VERCEL || process.env.NODE_ENV === 'production') {
    return null;
  }
  return DEVELOPMENT_SIGNING_SECRET;
}

function signVisitorPayload(encodedPayload: string, signingSecret: string): string {
  return crypto
    .createHmac('sha256', signingSecret)
    .update(`${VISITOR_TOKEN_PREFIX}:${encodedPayload}`, 'utf8')
    .digest('hex');
}

function safeSignatureMatch(expected: string, supplied: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(supplied)) return false;
  const expectedBuffer = Buffer.from(expected, 'hex');
  const suppliedBuffer = Buffer.from(supplied, 'hex');
  return expectedBuffer.length === suppliedBuffer.length
    && crypto.timingSafeEqual(expectedBuffer, suppliedBuffer);
}

function deriveVisitorKey(nonce: string, signingSecret: string): string {
  const digest = crypto
    .createHmac('sha256', signingSecret)
    .update(`ink-witness:affiliate-click-visitor:v1\u0000${nonce}`, 'utf8')
    .digest('base64url');
  return `${VISITOR_KEY_PREFIX}${digest}`;
}

/**
 * Non-secret commitment used to detect click-key rotation. It is safe to store
 * beside private click records, but is never returned by an analytics route.
 */
export function deriveAffiliateClickAnalyticsKeyFingerprint(secret: unknown): string | null {
  const signingSecret = typeof secret === 'string' ? secret.trim() : '';
  if (signingSecret.length < 32) return null;
  const digest = crypto
    .createHmac('sha256', signingSecret)
    .update('ink-witness:affiliate-click-key-fingerprint:v1', 'utf8')
    .digest('base64url');
  return `${CLICK_KEY_FINGERPRINT_PREFIX}${digest}`;
}

function resolveTokenMaxAge(value: unknown): number {
  const requested = Number(value ?? AFFILIATE_CLICK_VISITOR_DEFAULT_MAX_AGE_MS);
  if (!Number.isFinite(requested)) return AFFILIATE_CLICK_VISITOR_DEFAULT_MAX_AGE_MS;
  return Math.max(1, Math.min(AFFILIATE_CLICK_VISITOR_MAX_AGE_MS, Math.floor(requested)));
}

/**
 * Creates a signed, random first-party analytics token. The returned token is
 * suitable only for an HttpOnly cookie; durable storage receives the derived
 * visitorKey from verifyAffiliateClickVisitorCookie(), never this bearer value.
 */
export function createAffiliateClickVisitorCookieValue(
  options: AffiliateClickVisitorTokenOptions = {},
): string | null {
  const signingSecret = resolveSigningSecret(options.signingSecret);
  if (!signingSecret) return null;
  const now = options.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0) return null;
  const nonce = options.nonce ?? crypto.randomBytes(32).toString('base64url');
  if (!VISITOR_NONCE_PATTERN.test(nonce)) return null;
  const payload: AffiliateClickVisitorTokenPayload = {
    v: 1,
    j: nonce,
    iat: now,
    exp: now + resolveTokenMaxAge(options.maxAgeMs),
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = signVisitorPayload(encodedPayload, signingSecret);
  return `${VISITOR_TOKEN_PREFIX}.${encodedPayload}.${signature}`;
}

export function verifyAffiliateClickVisitorCookie(
  cookieValue: unknown,
  options: Pick<AffiliateClickVisitorTokenOptions, 'now' | 'signingSecret'> = {},
): AffiliateClickVisitorIdentity | null {
  if (typeof cookieValue !== 'string' || cookieValue.length > MAX_TOKEN_LENGTH) return null;
  const signingSecret = resolveSigningSecret(options.signingSecret);
  if (!signingSecret) return null;
  const parts = cookieValue.split('.');
  if (
    parts.length !== 3
    || parts[0] !== VISITOR_TOKEN_PREFIX
    || !/^[A-Za-z0-9_-]+$/.test(parts[1])
  ) return null;
  const expectedSignature = signVisitorPayload(parts[1], signingSecret);
  if (!safeSignatureMatch(expectedSignature, parts[2])) return null;

  let payload: AffiliateClickVisitorTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as AffiliateClickVisitorTokenPayload;
  } catch {
    return null;
  }
  const now = options.now ?? Date.now();
  if (
    payload.v !== 1
    || !VISITOR_NONCE_PATTERN.test(payload.j)
    || !Number.isSafeInteger(payload.iat)
    || !Number.isSafeInteger(payload.exp)
    || !Number.isSafeInteger(now)
    || payload.iat < 0
    || payload.iat > now + MAX_CLOCK_SKEW_MS
    || payload.exp <= payload.iat
    || payload.exp - payload.iat > AFFILIATE_CLICK_VISITOR_MAX_AGE_MS
    || now > payload.exp
  ) return null;

  return {
    visitorKey: deriveVisitorKey(payload.j, signingSecret),
    issuedAt: payload.iat,
    expiresAt: payload.exp,
  };
}

function normalizeAffiliateCode(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return AFFILIATE_CODE_PATTERN.test(normalized) ? normalized : null;
}

function normalizeCampaignCode(value: unknown): string | undefined | null {
  if (value === undefined || value === null || value === '') return undefined;
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return CAMPAIGN_CODE_PATTERN.test(normalized) ? normalized : null;
}

function normalizeArticleId(value: unknown): string | undefined | null {
  if (value === undefined || value === null || value === '') return undefined;
  const normalized = typeof value === 'string' ? value.trim() : '';
  return ARTICLE_ID_PATTERN.test(normalized) ? normalized : null;
}

export function createDurableAffiliateClickDedupeIdentity(input: {
  affiliateCode: unknown;
  articleId?: unknown;
  campaignCode?: unknown;
  visitorKey: unknown;
  occurredAtMs: unknown;
  signingSecret?: string;
}): { documentId: string; dedupeWindowStartedAt: string } | null {
  const signingSecret = resolveSigningSecret(input.signingSecret);
  const affiliateCode = normalizeAffiliateCode(input.affiliateCode);
  const articleId = normalizeArticleId(input.articleId);
  const campaignCode = normalizeCampaignCode(input.campaignCode);
  const occurredAtMs = Number(input.occurredAtMs);
  if (
    !signingSecret
    || !affiliateCode
    || articleId === null
    || campaignCode === null
    || typeof input.visitorKey !== 'string'
    || !VISITOR_KEY_PATTERN.test(input.visitorKey)
    || !Number.isSafeInteger(occurredAtMs)
    || occurredAtMs < 0
  ) return null;

  const windowStartedAtMs = Math.floor(occurredAtMs / AFFILIATE_CLICK_DEDUPE_WINDOW_MS)
    * AFFILIATE_CLICK_DEDUPE_WINDOW_MS;
  const fingerprint = JSON.stringify({
    affiliateCode,
    articleId: articleId || null,
    campaignCode: campaignCode || null,
    visitorKey: input.visitorKey,
    windowStartedAtMs,
  });
  const digest = crypto
    .createHmac('sha256', signingSecret)
    .update(`ink-witness:affiliate-click-dedupe:v2\u0000${fingerprint}`, 'utf8')
    .digest('hex');
  return {
    documentId: `${CLICK_DOCUMENT_PREFIX}${digest}`,
    dedupeWindowStartedAt: new Date(windowStartedAtMs).toISOString(),
  };
}

/** Keeps only the URL origin. Paths, query strings, fragments and credentials are never retained. */
export function sanitizeAffiliateClickReferrerOrigin(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const candidate = value.trim();
  if (!candidate || candidate.length > MAX_REFERRER_LENGTH) return undefined;
  try {
    const parsed = new URL(candidate);
    if (
      (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')
      || !parsed.hostname
      || parsed.username
      || parsed.password
      || parsed.origin.length > MAX_REFERRER_ORIGIN_LENGTH
    ) return undefined;
    return parsed.origin;
  } catch {
    return undefined;
  }
}

function canonicalIsoTimestamp(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp).toISOString();
}

const DURABLE_EVENT_ALLOWED_KEYS = new Set([
  'schemaVersion',
  'id',
  'keyFingerprint',
  'affiliateCode',
  'affiliateId',
  'articleId',
  'campaignCode',
  'visitorKey',
  'referrerOrigin',
  'timestamp',
  'dedupeWindowStartedAt',
]);

const ACTIVATION_MARKER_ALLOWED_KEYS = new Set([
  'schemaVersion',
  'eventSchemaVersion',
  'activatedAt',
  'completeFrom',
  'keyVersion',
  'keyFingerprint',
]);

/** Validate the create-only server marker without accepting future fields implicitly. */
export function normalizeAffiliateClickAnalyticsActivationV1(
  value: unknown,
): AffiliateClickAnalyticsActivationV1 | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => !ACTIVATION_MARKER_ALLOWED_KEYS.has(key))) return null;
  if (
    record.schemaVersion !== 1
    || record.eventSchemaVersion !== 2
    || record.keyVersion !== 'v1'
    || typeof record.keyFingerprint !== 'string'
    || !CLICK_KEY_FINGERPRINT_PATTERN.test(record.keyFingerprint)
  ) {
    return null;
  }
  const activatedAt = canonicalIsoTimestamp(record.activatedAt);
  const completeFrom = canonicalIsoTimestamp(record.completeFrom);
  if (
    !activatedAt
    || !completeFrom
    || record.activatedAt !== activatedAt
    || record.completeFrom !== completeFrom
    || Date.parse(activatedAt) >= Date.parse(completeFrom)
  ) return null;
  return {
    schemaVersion: 1,
    eventSchemaVersion: 2,
    activatedAt,
    completeFrom,
    keyVersion: 'v1',
    keyFingerprint: record.keyFingerprint,
  };
}

/**
 * Fail-closed durable event validator. Unknown fields are rejected so a future
 * caller cannot accidentally persist IPs, browser fingerprints, raw referrers,
 * account identifiers or other private request material.
 */
export function normalizeDurableAffiliateClickEventV2(value: unknown): DurableAffiliateClickEventV2 | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => !DURABLE_EVENT_ALLOWED_KEYS.has(key))) return null;
  if (record.schemaVersion !== 2) return null;
  if (typeof record.id !== 'string' || !CLICK_DOCUMENT_ID_PATTERN.test(record.id)) return null;
  if (
    typeof record.keyFingerprint !== 'string'
    || !CLICK_KEY_FINGERPRINT_PATTERN.test(record.keyFingerprint)
  ) return null;
  const affiliateCode = normalizeAffiliateCode(record.affiliateCode);
  const affiliateId = typeof record.affiliateId === 'string' ? record.affiliateId.trim() : '';
  const articleId = normalizeArticleId(record.articleId);
  const campaignCode = normalizeCampaignCode(record.campaignCode);
  const timestamp = canonicalIsoTimestamp(record.timestamp);
  if (
    !affiliateCode
    || !AFFILIATE_ID_PATTERN.test(affiliateId)
    || articleId === null
    || campaignCode === null
    || !timestamp
    || record.timestamp !== timestamp
  ) return null;

  const visitorKey = record.visitorKey === undefined
    ? undefined
    : typeof record.visitorKey === 'string'
      ? record.visitorKey
      : null;
  if (visitorKey === null || (visitorKey !== undefined && !VISITOR_KEY_PATTERN.test(visitorKey))) return null;
  const dedupeWindowStartedAt = record.dedupeWindowStartedAt === undefined
    ? undefined
    : canonicalIsoTimestamp(record.dedupeWindowStartedAt);
  if (
    record.dedupeWindowStartedAt !== undefined
    && (!dedupeWindowStartedAt || record.dedupeWindowStartedAt !== dedupeWindowStartedAt)
  ) return null;
  if (Boolean(visitorKey) !== Boolean(dedupeWindowStartedAt)) return null;
  if (dedupeWindowStartedAt) {
    const occurredAtMs = Date.parse(timestamp);
    const windowStartedAtMs = Date.parse(dedupeWindowStartedAt);
    if (
      occurredAtMs < windowStartedAtMs
      || occurredAtMs >= windowStartedAtMs + AFFILIATE_CLICK_DEDUPE_WINDOW_MS
    ) return null;
  }

  const referrerOrigin = record.referrerOrigin === undefined
    ? undefined
    : sanitizeAffiliateClickReferrerOrigin(record.referrerOrigin);
  if (record.referrerOrigin !== undefined && !referrerOrigin) return null;

  return {
    schemaVersion: 2,
    id: record.id,
    keyFingerprint: record.keyFingerprint,
    affiliateCode,
    affiliateId,
    ...(articleId ? { articleId } : {}),
    ...(campaignCode ? { campaignCode } : {}),
    ...(visitorKey ? { visitorKey } : {}),
    ...(referrerOrigin ? { referrerOrigin } : {}),
    timestamp,
    ...(dedupeWindowStartedAt ? { dedupeWindowStartedAt } : {}),
  };
}

export function unavailableDurableAffiliateClickCoverage(
  reason: DurableAffiliateClickCoverageReason,
): DurableAffiliateClickCoverageAssessment {
  return {
    eventCoverage: 'unavailable',
    uniqueVisitorCoverage: 'unavailable',
    conversionCoverage: 'unavailable',
    reasons: [reason],
    validEventCount: 0,
    invalidEventCount: 0,
    eventsWithoutVisitorKey: 0,
  };
}

/**
 * Proves whether a bounded durable query is safe to use for click and
 * conversion reporting. It never upgrades partial or failed history to a
 * complete status merely because the returned event list is empty.
 */
export function assessDurableAffiliateClickCoverage(input: {
  rangeStartsAt: unknown;
  rangeEndsAt: unknown;
  durableHistoryStartsAt?: unknown;
  historyObservedThrough?: unknown;
  querySucceeded: boolean;
  truncated: boolean;
  events: unknown[];
}): DurableAffiliateClickCoverageAssessment {
  const rangeStartsAt = canonicalIsoTimestamp(input.rangeStartsAt);
  const rangeEndsAt = canonicalIsoTimestamp(input.rangeEndsAt);
  if (!rangeStartsAt || !rangeEndsAt || Date.parse(rangeStartsAt) > Date.parse(rangeEndsAt)) {
    return unavailableDurableAffiliateClickCoverage('invalid_range');
  }
  const durableHistoryStartsAt = canonicalIsoTimestamp(input.durableHistoryStartsAt);
  if (!input.querySucceeded) return unavailableDurableAffiliateClickCoverage('query_failed');
  if (!durableHistoryStartsAt) return unavailableDurableAffiliateClickCoverage('not_enabled');

  const rangeStartMs = Date.parse(rangeStartsAt);
  const rangeEndMs = Date.parse(rangeEndsAt);
  const durableHistoryStartMs = Date.parse(durableHistoryStartsAt);
  if (rangeEndMs < durableHistoryStartMs) {
    return unavailableDurableAffiliateClickCoverage('predates_durable_history');
  }
  const reasons: DurableAffiliateClickCoverageReason[] = [];
  if (rangeStartMs < durableHistoryStartMs) reasons.push('predates_durable_history');
  const historyObservedThrough = input.historyObservedThrough === undefined
    ? rangeEndsAt
    : canonicalIsoTimestamp(input.historyObservedThrough);
  if (!historyObservedThrough) {
    return unavailableDurableAffiliateClickCoverage('invalid_range');
  }
  if (Date.parse(historyObservedThrough) < rangeEndMs) reasons.push('settling_window');
  if (input.truncated) reasons.push('truncated');

  let validEventCount = 0;
  let invalidEventCount = 0;
  let eventsWithoutVisitorKey = 0;
  for (const value of input.events) {
    const event = normalizeDurableAffiliateClickEventV2(value);
    if (!event) {
      invalidEventCount += 1;
      continue;
    }
    const timestamp = Date.parse(event.timestamp);
    if (timestamp < rangeStartMs || timestamp > rangeEndMs) {
      invalidEventCount += 1;
      continue;
    }
    validEventCount += 1;
    if (!event.visitorKey) eventsWithoutVisitorKey += 1;
  }
  if (invalidEventCount > 0) reasons.push('invalid_events');
  const eventCoverage = reasons.length === 0 ? 'complete' as const : 'partial' as const;
  if (eventsWithoutVisitorKey > 0) reasons.push('missing_visitor_keys');
  const uniqueVisitorCoverage = eventCoverage === 'complete' && eventsWithoutVisitorKey === 0
    ? 'complete' as const
    : 'partial' as const;
  return {
    eventCoverage,
    uniqueVisitorCoverage,
    // Click completeness alone cannot establish a purchase cohort. Until a
    // bounded click-to-sale join exists, conversion must remain withheld.
    conversionCoverage: 'partial',
    reasons: reasons.length > 0 ? reasons : ['complete'],
    validEventCount,
    invalidEventCount,
    eventsWithoutVisitorKey,
  };
}
