import crypto from 'crypto';
import { FieldPath } from 'firebase-admin/firestore';
import type {
  NewsletterAdminSummary,
  NewsletterAudience,
  NewsletterCampaign,
  NewsletterCampaignContent,
  NewsletterCampaignStatus,
  NewsletterDelivery,
  NewsletterDeliveryStatus,
  NewsletterSubscriber,
  NewsletterSubscriberStatus
} from '../types.js';
import { getDb, sanitizeForFirestore } from './db.js';
import {
  createNewsletterUnsubscribeToken,
  newsletterEmailIndexId,
  normalizeNewsletterEmail,
  sanitizeNewsletterInterests,
  sanitizeSubscriberName,
  verifyNewsletterUnsubscribeToken
} from './newsletterSecurity.js';

export const NEWSLETTER_COLLECTIONS = Object.freeze({
  emailIndex: 'newsletter_email_index',
  subscribers: 'newsletter_subscribers',
  confirmationChallenges: 'newsletter_confirmation_challenges',
  campaigns: 'newsletter_campaigns',
  deliveries: 'newsletter_deliveries'
});

const STORAGE_VERSION = 1 as const;
const CONFIRMATION_TOKEN_PREFIX = 'nwc_';
const CONFIRMATION_TOKEN_PATTERN = /^nwc_[A-Za-z0-9_-]{43}$/;
const DEFAULT_CONFIRMATION_TTL_MS = 24 * 60 * 60 * 1000;
const MIN_CONFIRMATION_TTL_MS = 5 * 60 * 1000;
const MAX_CONFIRMATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ADMIN_PAGE_SIZE = 100;
const MAX_CAMPAIGN_BODY_LENGTH = 200_000;
const SUBSCRIBER_ID_PATTERN = /^sub_[A-Za-z0-9_-]{12,}$/;
const CAMPAIGN_ID_PATTERN = /^nlc_[A-Za-z0-9_-]{12,}$/;
const DELIVERY_ID_PATTERN = /^nld_[a-f0-9]{48}$/;
const SAFE_REFERENCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;

const SUBSCRIBER_STATUSES: readonly NewsletterSubscriberStatus[] = [
  'pending',
  'active',
  'unsubscribed',
  'suppressed'
];
const CONSENT_SOURCES: readonly NewsletterSubscriber['consentSource'][] = [
  'homepage',
  'reader_preferences',
  'writer_import'
];
const CAMPAIGN_STATUSES: readonly NewsletterCampaignStatus[] = [
  'draft',
  'queued',
  'sending',
  'sent',
  'partially_sent',
  'failed'
];
const DELIVERY_STATUSES: readonly NewsletterDeliveryStatus[] = [
  'queued',
  'sent',
  'delivered',
  'bounced',
  'complained',
  'suppressed',
  'failed'
];

type StoredNewsletterSubscriber = NewsletterSubscriber & {
  storageVersion: typeof STORAGE_VERSION;
  emailIndexId: string;
  nameSearch: string;
  confirmationChallengeId?: string;
  confirmationExpiresAt?: number;
};

type StoredNewsletterCampaign = NewsletterCampaign & {
  storageVersion: typeof STORAGE_VERSION;
};

type StoredNewsletterDelivery = NewsletterDelivery & {
  storageVersion: typeof STORAGE_VERSION;
};

interface ConfirmationChallengeRecord {
  storageVersion: typeof STORAGE_VERSION;
  purpose: 'newsletter_confirmation';
  subscriberId: string;
  emailIndexId: string;
  createdAt: string;
  expiresAt: number;
}

interface NewsletterEmailIndexRecord {
  storageVersion: typeof STORAGE_VERSION;
  subscriberId: string;
  emailHash: string;
  createdAt: string;
  updatedAt: string;
}

export interface NewsletterSubscribeInput {
  email: unknown;
  name?: unknown;
  interests?: unknown;
  followedWorkIds?: unknown;
  contentMode?: unknown;
  consentSource: NewsletterSubscriber['consentSource'];
  consentVersion: unknown;
}

export interface NewsletterConfirmationDelivery {
  subscriberId: string;
  email: string;
  name?: string;
  confirmationToken: string;
  expiresAt: number;
}

export interface NewsletterSubscriptionOptions {
  confirmationTtlMs?: number;
  onConfirmationRequired?: (
    delivery: NewsletterConfirmationDelivery
  ) => void | Promise<void>;
}

export interface NewsletterPublicMutationResult {
  accepted: true;
}

export interface NewsletterSubscriberListOptions {
  status?: NewsletterSubscriberStatus;
  search?: string;
  limit?: number;
  cursor?: string;
}

export interface NewsletterSubscriberListResult {
  subscribers: NewsletterSubscriber[];
  nextCursor?: string;
}

export interface CreateNewsletterCampaignInput {
  content: NewsletterCampaignContent;
  audience: NewsletterAudience;
  createdBy: string;
}

export interface EnsureNewsletterReleaseCampaignInput extends CreateNewsletterCampaignInput {
  pieceId: unknown;
}

export interface NewsletterCampaignDraftPatch {
  content?: NewsletterCampaignContent;
  audience?: NewsletterAudience;
}

export interface NewsletterCampaignStatusPatch {
  status: NewsletterCampaignStatus;
  lastError?: string;
}

export interface NewsletterDeliveryOutcomeInput {
  status: Exclude<NewsletterDeliveryStatus, 'queued'>;
  providerMessageId?: string;
  error?: string;
}

export class NewsletterValidationError extends Error {
  readonly code = 'NEWSLETTER_VALIDATION_ERROR';

  constructor(message: string) {
    super(message);
    this.name = 'NewsletterValidationError';
  }
}

export class NewsletterIntegrityError extends Error {
  readonly code = 'NEWSLETTER_INTEGRITY_ERROR';

  constructor(message = 'Newsletter storage is temporarily unavailable.') {
    super(message);
    this.name = 'NewsletterIntegrityError';
  }
}

export class NewsletterStateError extends Error {
  readonly code = 'NEWSLETTER_STATE_ERROR';

  constructor(message: string) {
    super(message);
    this.name = 'NewsletterStateError';
  }
}

function publicAccepted(): NewsletterPublicMutationResult {
  return { accepted: true };
}

function nowIso(now = Date.now()): string {
  return new Date(now).toISOString();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isIsoDateString(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value));
}

function boundedText(
  value: unknown,
  maximumLength: number,
  fieldName: string,
  options: { required?: boolean; preserveWhitespace?: boolean } = {}
): string | undefined {
  if (value === undefined || value === null) {
    if (options.required) throw new NewsletterValidationError(`${fieldName} is required.`);
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new NewsletterValidationError(`${fieldName} must be text.`);
  }
  const text = options.preserveWhitespace ? value.trim() : value.trim().replace(/\s+/g, ' ');
  if (!text) {
    if (options.required) throw new NewsletterValidationError(`${fieldName} is required.`);
    return undefined;
  }
  if (text.length > maximumLength) {
    throw new NewsletterValidationError(`${fieldName} is too long.`);
  }
  return text;
}

function sanitizeReferenceIds(value: unknown, maximum = 50): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const id = entry.trim();
    if (!SAFE_REFERENCE_ID.test(id) || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
    if (result.length >= maximum) break;
  }
  return result;
}

function sanitizeContentMode(value: unknown): NewsletterSubscriber['contentMode'] {
  return value === 'discreet' ? 'discreet' : 'standard';
}

function sanitizeConsentVersion(value: unknown): string {
  const version = boundedText(value, 64, 'consentVersion', { required: true });
  if (!version || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(version)) {
    throw new NewsletterValidationError('consentVersion has an invalid format.');
  }
  return version;
}

function sanitizeConfirmationTtl(value: unknown): number {
  if (value === undefined) return DEFAULT_CONFIRMATION_TTL_MS;
  if (
    typeof value !== 'number'
    || !Number.isFinite(value)
    || value < MIN_CONFIRMATION_TTL_MS
    || value > MAX_CONFIRMATION_TTL_MS
  ) {
    throw new NewsletterValidationError('confirmationTtlMs is outside the allowed range.');
  }
  return Math.floor(value);
}

function createSubscriberId(): string {
  return `sub_${crypto.randomBytes(18).toString('base64url')}`;
}

function createCampaignId(): string {
  return `nlc_${crypto.randomBytes(18).toString('base64url')}`;
}

function releaseCampaignId(pieceId: string): string {
  return `nlc_${sha256(`release\0${pieceId}`).slice(0, 48)}`;
}

function createConfirmationToken(): string {
  return `${CONFIRMATION_TOKEN_PREFIX}${crypto.randomBytes(32).toString('base64url')}`;
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function confirmationChallengeId(token: string): string {
  return sha256(token);
}

function deliveryId(campaignId: string, subscriberId: string): string {
  return `nld_${sha256(`${campaignId}\0${subscriberId}`).slice(0, 48)}`;
}

function normalizeEmailIndexRecord(
  expectedHash: string,
  value: unknown
): NewsletterEmailIndexRecord | null {
  if (!isPlainObject(value)) return null;
  if (
    value.storageVersion !== STORAGE_VERSION
    || value.emailHash !== expectedHash
    || !SUBSCRIBER_ID_PATTERN.test(String(value.subscriberId || ''))
    || !isIsoDateString(value.createdAt)
    || !isIsoDateString(value.updatedAt)
  ) return null;
  return value as unknown as NewsletterEmailIndexRecord;
}

function normalizeStoredSubscriber(id: string, value: unknown): StoredNewsletterSubscriber | null {
  if (!SUBSCRIBER_ID_PATTERN.test(id) || !isPlainObject(value)) return null;
  const email = normalizeNewsletterEmail(value.email);
  if (!email || value.id !== id || value.storageVersion !== STORAGE_VERSION) return null;
  const emailIndexId = newsletterEmailIndexId(email);
  if (value.emailIndexId !== emailIndexId) return null;
  if (!SUBSCRIBER_STATUSES.includes(value.status as NewsletterSubscriberStatus)) return null;
  if (!CONSENT_SOURCES.includes(value.consentSource as NewsletterSubscriber['consentSource'])) return null;
  if (
    !isIsoDateString(value.consentAt)
    || !isIsoDateString(value.subscribedAt)
    || !isIsoDateString(value.updatedAt)
  ) return null;
  if (typeof value.consentVersion !== 'string' || value.consentVersion.length > 64) return null;
  if (!Array.isArray(value.interests)) return null;

  const interests = sanitizeNewsletterInterests(value.interests);
  const followedWorkIds = sanitizeReferenceIds(value.followedWorkIds);
  const name = sanitizeSubscriberName(value.name);
  const contentMode = sanitizeContentMode(value.contentMode);
  const confirmationChallengeIdValue = typeof value.confirmationChallengeId === 'string'
    && /^[a-f0-9]{64}$/.test(value.confirmationChallengeId)
    ? value.confirmationChallengeId
    : undefined;
  const confirmationExpiresAt = typeof value.confirmationExpiresAt === 'number'
    && Number.isFinite(value.confirmationExpiresAt)
    ? value.confirmationExpiresAt
    : undefined;

  if (
    (value.confirmationChallengeId !== undefined && !confirmationChallengeIdValue)
    || (value.confirmationExpiresAt !== undefined && confirmationExpiresAt === undefined)
  ) return null;

  return {
    storageVersion: STORAGE_VERSION,
    id,
    email,
    emailIndexId,
    nameSearch: typeof value.nameSearch === 'string' ? value.nameSearch : (name || '').toLowerCase(),
    ...(name ? { name } : {}),
    interests,
    ...(followedWorkIds.length > 0 ? { followedWorkIds } : {}),
    status: value.status as NewsletterSubscriberStatus,
    consentSource: value.consentSource as NewsletterSubscriber['consentSource'],
    consentVersion: value.consentVersion,
    consentAt: value.consentAt,
    subscribedAt: value.subscribedAt,
    updatedAt: value.updatedAt,
    ...(isIsoDateString(value.confirmedAt) ? { confirmedAt: value.confirmedAt } : {}),
    ...(isIsoDateString(value.unsubscribedAt) ? { unsubscribedAt: value.unsubscribedAt } : {}),
    ...(typeof value.suppressionReason === 'string'
      ? { suppressionReason: value.suppressionReason.slice(0, 500) }
      : {}),
    ...(isIsoDateString(value.lastEmailAt) ? { lastEmailAt: value.lastEmailAt } : {}),
    contentMode,
    ...(confirmationChallengeIdValue ? { confirmationChallengeId: confirmationChallengeIdValue } : {}),
    ...(confirmationExpiresAt !== undefined ? { confirmationExpiresAt } : {})
  };
}

function toSubscriber(record: StoredNewsletterSubscriber): NewsletterSubscriber {
  const {
    storageVersion: _storageVersion,
    emailIndexId: _emailIndexId,
    nameSearch: _nameSearch,
    confirmationChallengeId: _confirmationChallengeId,
    confirmationExpiresAt: _confirmationExpiresAt,
    ...subscriber
  } = record;
  return subscriber;
}

function normalizeChallenge(value: unknown): ConfirmationChallengeRecord | null {
  if (!isPlainObject(value)) return null;
  if (
    value.storageVersion !== STORAGE_VERSION
    || value.purpose !== 'newsletter_confirmation'
    || !SUBSCRIBER_ID_PATTERN.test(String(value.subscriberId || ''))
    || !/^[a-f0-9]{64}$/.test(String(value.emailIndexId || ''))
    || !isIsoDateString(value.createdAt)
    || typeof value.expiresAt !== 'number'
    || !Number.isFinite(value.expiresAt)
  ) return null;
  return value as unknown as ConfirmationChallengeRecord;
}

function validateSubscriberStatus(value: unknown): NewsletterSubscriberStatus | undefined {
  if (value === undefined) return undefined;
  if (!SUBSCRIBER_STATUSES.includes(value as NewsletterSubscriberStatus)) {
    throw new NewsletterValidationError('Invalid subscriber status.');
  }
  return value as NewsletterSubscriberStatus;
}

function normalizePageSize(value: unknown, fallback = 50): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new NewsletterValidationError('limit must be a number.');
  }
  return Math.max(1, Math.min(MAX_ADMIN_PAGE_SIZE, Math.floor(value)));
}

function encodeCursor(updatedAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ updatedAt, id }), 'utf8').toString('base64url');
}

function decodeCursor(value: unknown): { updatedAt: string; id: string } | null {
  if (typeof value !== 'string' || !value || value.length > 512) return null;
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (
      !isPlainObject(decoded)
      || !isIsoDateString(decoded.updatedAt)
      || !SUBSCRIBER_ID_PATTERN.test(String(decoded.id || ''))
    ) return null;
    return { updatedAt: decoded.updatedAt, id: String(decoded.id) };
  } catch {
    return null;
  }
}

function sanitizeUrl(value: unknown, fieldName: string): string | undefined {
  const url = boundedText(value, 2_048, fieldName);
  if (!url) return undefined;
  if (url.startsWith('/') && !url.startsWith('//')) return url;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return parsed.toString();
  } catch {
    // Fall through to the generic validation error below.
  }
  throw new NewsletterValidationError(`${fieldName} must be an HTTP(S) or site-relative URL.`);
}

function sanitizeCampaignContent(value: unknown): NewsletterCampaignContent {
  if (!isPlainObject(value)) {
    throw new NewsletterValidationError('Campaign content is required.');
  }
  const subject = boundedText(value.subject, 200, 'subject', { required: true });
  const body = boundedText(value.body, MAX_CAMPAIGN_BODY_LENGTH, 'body', {
    required: true,
    preserveWhitespace: true
  });
  if (!subject || !body) throw new NewsletterValidationError('Campaign subject and body are required.');
  return {
    subject,
    ...(boundedText(value.preheader, 300, 'preheader') ? { preheader: boundedText(value.preheader, 300, 'preheader') } : {}),
    ...(boundedText(value.heading, 200, 'heading') ? { heading: boundedText(value.heading, 200, 'heading') } : {}),
    body,
    ...(boundedText(value.ctaLabel, 80, 'ctaLabel') ? { ctaLabel: boundedText(value.ctaLabel, 80, 'ctaLabel') } : {}),
    ...(sanitizeUrl(value.ctaUrl, 'ctaUrl') ? { ctaUrl: sanitizeUrl(value.ctaUrl, 'ctaUrl') } : {}),
    ...(typeof value.pieceId === 'string' && SAFE_REFERENCE_ID.test(value.pieceId.trim())
      ? { pieceId: value.pieceId.trim() }
      : {}),
    ...(typeof value.chapterId === 'string' && SAFE_REFERENCE_ID.test(value.chapterId.trim())
      ? { chapterId: value.chapterId.trim() }
      : {}),
    ...(sanitizeUrl(value.coverImageUrl, 'coverImageUrl')
      ? { coverImageUrl: sanitizeUrl(value.coverImageUrl, 'coverImageUrl') }
      : {})
  };
}

function sanitizeAudience(value: unknown): NewsletterAudience {
  if (!isPlainObject(value)) throw new NewsletterValidationError('Campaign audience is required.');
  const type = value.type;
  if (type === 'all') return { type };
  if (type === 'interests') {
    const interests = sanitizeNewsletterInterests(value.interests);
    if (interests.length === 0) {
      throw new NewsletterValidationError('An interests audience requires at least one interest.');
    }
    return { type, interests };
  }
  if (type === 'selected') {
    const subscriberIds = sanitizeReferenceIds(value.subscriberIds, 500)
      .filter(id => SUBSCRIBER_ID_PATTERN.test(id));
    if (subscriberIds.length === 0) {
      throw new NewsletterValidationError('A selected audience requires at least one subscriber.');
    }
    return { type, subscriberIds };
  }
  if (type === 'work_followers') {
    const workId = typeof value.workId === 'string' ? value.workId.trim() : '';
    if (!SAFE_REFERENCE_ID.test(workId)) {
      throw new NewsletterValidationError('A work-followers audience requires a valid work identifier.');
    }
    return { type, workId };
  }
  throw new NewsletterValidationError('Invalid campaign audience type.');
}

function normalizeCampaign(id: string, value: unknown): StoredNewsletterCampaign | null {
  if (!CAMPAIGN_ID_PATTERN.test(id) || !isPlainObject(value)) return null;
  if (value.id !== id || value.storageVersion !== STORAGE_VERSION || value.provider !== 'resend') return null;
  if (!CAMPAIGN_STATUSES.includes(value.status as NewsletterCampaignStatus)) return null;
  if (!isIsoDateString(value.createdAt) || !isIsoDateString(value.updatedAt)) return null;
  try {
    const content = sanitizeCampaignContent(value.content);
    const audience = sanitizeAudience(value.audience);
    const createdBy = boundedText(value.createdBy, 160, 'createdBy', { required: true });
    const recipientCount = Number(value.recipientCount);
    const sentCount = Number(value.sentCount);
    const failedCount = Number(value.failedCount);
    const kind = value.kind === undefined || value.kind === 'manual'
      ? 'manual'
      : value.kind === 'release'
        ? 'release'
        : null;
    if (
      !createdBy
      || !kind
      || !Number.isSafeInteger(recipientCount) || recipientCount < 0
      || !Number.isSafeInteger(sentCount) || sentCount < 0
      || !Number.isSafeInteger(failedCount) || failedCount < 0
    ) return null;
    return {
      storageVersion: STORAGE_VERSION,
      id,
      kind,
      content,
      audience,
      status: value.status as NewsletterCampaignStatus,
      createdBy,
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
      ...(isIsoDateString(value.queuedAt) ? { queuedAt: value.queuedAt } : {}),
      ...(isIsoDateString(value.sentAt) ? { sentAt: value.sentAt } : {}),
      provider: 'resend',
      recipientCount,
      sentCount,
      failedCount,
      ...(typeof value.lastError === 'string' ? { lastError: value.lastError.slice(0, 1_000) } : {})
    };
  } catch {
    return null;
  }
}

function toCampaign(record: StoredNewsletterCampaign): NewsletterCampaign {
  const { storageVersion: _storageVersion, ...campaign } = record;
  return campaign;
}

function normalizeDelivery(id: string, value: unknown): StoredNewsletterDelivery | null {
  if (!DELIVERY_ID_PATTERN.test(id) || !isPlainObject(value)) return null;
  const email = normalizeNewsletterEmail(value.email);
  if (
    value.id !== id
    || value.storageVersion !== STORAGE_VERSION
    || value.provider !== 'resend'
    || !email
    || !CAMPAIGN_ID_PATTERN.test(String(value.campaignId || ''))
    || !SUBSCRIBER_ID_PATTERN.test(String(value.subscriberId || ''))
    || !DELIVERY_STATUSES.includes(value.status as NewsletterDeliveryStatus)
    || !isIsoDateString(value.createdAt)
    || !isIsoDateString(value.updatedAt)
  ) return null;
  return {
    storageVersion: STORAGE_VERSION,
    id,
    campaignId: String(value.campaignId),
    subscriberId: String(value.subscriberId),
    email,
    status: value.status as NewsletterDeliveryStatus,
    provider: 'resend',
    ...(typeof value.providerMessageId === 'string'
      ? { providerMessageId: value.providerMessageId.slice(0, 200) }
      : {}),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    ...(isIsoDateString(value.sentAt) ? { sentAt: value.sentAt } : {}),
    ...(isIsoDateString(value.deliveredAt) ? { deliveredAt: value.deliveredAt } : {}),
    ...(isIsoDateString(value.failedAt) ? { failedAt: value.failedAt } : {}),
    ...(typeof value.error === 'string' ? { error: value.error.slice(0, 1_000) } : {})
  };
}

function toDelivery(record: StoredNewsletterDelivery): NewsletterDelivery {
  const { storageVersion: _storageVersion, ...delivery } = record;
  return delivery;
}

function assertSubscriberId(value: unknown): string {
  if (typeof value !== 'string' || !SUBSCRIBER_ID_PATTERN.test(value)) {
    throw new NewsletterValidationError('Invalid subscriber identifier.');
  }
  return value;
}

function assertCampaignId(value: unknown): string {
  if (typeof value !== 'string' || !CAMPAIGN_ID_PATTERN.test(value)) {
    throw new NewsletterValidationError('Invalid campaign identifier.');
  }
  return value;
}

function assertDeliveryId(value: unknown): string {
  if (typeof value !== 'string' || !DELIVERY_ID_PATTERN.test(value)) {
    throw new NewsletterValidationError('Invalid delivery identifier.');
  }
  return value;
}

const CAMPAIGN_TRANSITIONS: Record<NewsletterCampaignStatus, readonly NewsletterCampaignStatus[]> = {
  draft: ['queued'],
  queued: ['sending', 'failed'],
  sending: ['sent', 'partially_sent', 'failed'],
  sent: [],
  partially_sent: [],
  failed: []
};

const DELIVERY_TRANSITIONS: Record<NewsletterDeliveryStatus, readonly NewsletterDeliveryStatus[]> = {
  queued: ['sent', 'delivered', 'bounced', 'complained', 'suppressed', 'failed'],
  sent: ['delivered', 'bounced', 'complained', 'suppressed', 'failed'],
  delivered: ['bounced', 'complained', 'suppressed'],
  bounced: [],
  complained: [],
  suppressed: [],
  failed: []
};

const SENT_DELIVERY_STATUSES = new Set<NewsletterDeliveryStatus>([
  'sent', 'delivered', 'bounced', 'complained'
]);
const FAILED_DELIVERY_STATUSES = new Set<NewsletterDeliveryStatus>([
  'bounced', 'complained', 'suppressed', 'failed'
]);

async function getDocument(collectionName: string, id: string): Promise<unknown | null> {
  const snapshot = await getDb().collection(collectionName).doc(id).get();
  return snapshot.exists ? snapshot.data() : null;
}

async function countDocuments(query: any): Promise<number> {
  const aggregate = await query.count().get();
  const count = Number(aggregate.data().count);
  if (!Number.isSafeInteger(count) || count < 0) throw new NewsletterIntegrityError();
  return count;
}

export const newsletterStore = {
  async requestSubscription(
    input: NewsletterSubscribeInput,
    options: NewsletterSubscriptionOptions = {}
  ): Promise<NewsletterPublicMutationResult> {
    const email = normalizeNewsletterEmail(input.email);
    if (!email) throw new NewsletterValidationError('A valid email address is required.');
    if (!CONSENT_SOURCES.includes(input.consentSource)) {
      throw new NewsletterValidationError('Invalid consent source.');
    }
    const consentVersion = sanitizeConsentVersion(input.consentVersion);
    const name = sanitizeSubscriberName(input.name);
    const interests = sanitizeNewsletterInterests(input.interests);
    const followedWorkIds = sanitizeReferenceIds(input.followedWorkIds);
    const contentMode = sanitizeContentMode(input.contentMode);
    const confirmationTtlMs = sanitizeConfirmationTtl(options.confirmationTtlMs);
    const timestamp = Date.now();
    const timestampIso = nowIso(timestamp);
    const expiresAt = timestamp + confirmationTtlMs;
    const emailHash = newsletterEmailIndexId(email);
    const generatedSubscriberId = createSubscriberId();
    const token = createConfirmationToken();
    const challengeId = confirmationChallengeId(token);
    const db = getDb();
    const indexRef = db.collection(NEWSLETTER_COLLECTIONS.emailIndex).doc(emailHash);
    const challengeRef = db.collection(NEWSLETTER_COLLECTIONS.confirmationChallenges).doc(challengeId);

    const confirmation = await db.runTransaction(async transaction => {
      const indexSnapshot = await transaction.get(indexRef);
      let subscriberId = generatedSubscriberId;
      let existing: StoredNewsletterSubscriber | null = null;
      let subscriberRef = db.collection(NEWSLETTER_COLLECTIONS.subscribers).doc(subscriberId);

      if (indexSnapshot.exists) {
        const index = normalizeEmailIndexRecord(emailHash, indexSnapshot.data());
        if (!index) throw new NewsletterIntegrityError();
        subscriberId = index.subscriberId;
        subscriberRef = db.collection(NEWSLETTER_COLLECTIONS.subscribers).doc(subscriberId);
        const subscriberSnapshot = await transaction.get(subscriberRef);
        existing = subscriberSnapshot.exists
          ? normalizeStoredSubscriber(subscriberId, subscriberSnapshot.data())
          : null;
        if (!existing || existing.email !== email || existing.emailIndexId !== emailHash) {
          throw new NewsletterIntegrityError();
        }
      }

      // Never let an unauthenticated repeat request alter an active address or
      // revive a provider/legal suppression. The response remains identical.
      if (existing?.status === 'active' || existing?.status === 'suppressed') return null;

      const subscriber: StoredNewsletterSubscriber = {
        storageVersion: STORAGE_VERSION,
        id: subscriberId,
        email,
        emailIndexId: emailHash,
        nameSearch: (name || '').toLocaleLowerCase('en'),
        ...(name ? { name } : {}),
        interests,
        ...(followedWorkIds.length > 0 ? { followedWorkIds } : {}),
        status: 'pending',
        consentSource: input.consentSource,
        consentVersion,
        consentAt: timestampIso,
        subscribedAt: existing?.subscribedAt || timestampIso,
        updatedAt: timestampIso,
        contentMode,
        confirmationChallengeId: challengeId,
        confirmationExpiresAt: expiresAt
      };
      const challenge: ConfirmationChallengeRecord = {
        storageVersion: STORAGE_VERSION,
        purpose: 'newsletter_confirmation',
        subscriberId,
        emailIndexId: emailHash,
        createdAt: timestampIso,
        expiresAt
      };

      if (!indexSnapshot.exists) {
        const index: NewsletterEmailIndexRecord = {
          storageVersion: STORAGE_VERSION,
          subscriberId,
          emailHash,
          createdAt: timestampIso,
          updatedAt: timestampIso
        };
        transaction.create(indexRef, sanitizeForFirestore(index));
        transaction.create(subscriberRef, sanitizeForFirestore(subscriber));
      } else {
        transaction.set(subscriberRef, sanitizeForFirestore(subscriber));
        transaction.set(indexRef, {
          storageVersion: STORAGE_VERSION,
          subscriberId,
          emailHash,
          createdAt: (indexSnapshot.data() as NewsletterEmailIndexRecord).createdAt,
          updatedAt: timestampIso
        });
        if (existing?.confirmationChallengeId && existing.confirmationChallengeId !== challengeId) {
          transaction.delete(
            db.collection(NEWSLETTER_COLLECTIONS.confirmationChallenges)
              .doc(existing.confirmationChallengeId)
          );
        }
      }
      transaction.create(challengeRef, sanitizeForFirestore(challenge));

      return {
        subscriberId,
        email,
        ...(name ? { name } : {}),
        confirmationToken: token,
        expiresAt
      } satisfies NewsletterConfirmationDelivery;
    });

    if (confirmation && options.onConfirmationRequired) {
      await options.onConfirmationRequired(confirmation);
    }
    return publicAccepted();
  },

  async confirmSubscription(token: unknown): Promise<NewsletterPublicMutationResult> {
    if (typeof token !== 'string' || !CONFIRMATION_TOKEN_PATTERN.test(token.trim())) {
      return publicAccepted();
    }
    const cleanToken = token.trim();
    const challengeId = confirmationChallengeId(cleanToken);
    const db = getDb();
    const challengeRef = db.collection(NEWSLETTER_COLLECTIONS.confirmationChallenges).doc(challengeId);
    const timestamp = Date.now();
    const timestampIso = nowIso(timestamp);

    await db.runTransaction(async transaction => {
      const challengeSnapshot = await transaction.get(challengeRef);
      if (!challengeSnapshot.exists) return;
      const challenge = normalizeChallenge(challengeSnapshot.data());
      if (!challenge) throw new NewsletterIntegrityError();
      if (challenge.expiresAt <= timestamp) {
        transaction.delete(challengeRef);
        return;
      }

      const subscriberRef = db.collection(NEWSLETTER_COLLECTIONS.subscribers).doc(challenge.subscriberId);
      const indexRef = db.collection(NEWSLETTER_COLLECTIONS.emailIndex).doc(challenge.emailIndexId);
      const [subscriberSnapshot, indexSnapshot] = await Promise.all([
        transaction.get(subscriberRef),
        transaction.get(indexRef)
      ]);
      const subscriber = subscriberSnapshot.exists
        ? normalizeStoredSubscriber(challenge.subscriberId, subscriberSnapshot.data())
        : null;
      const index = indexSnapshot.exists
        ? normalizeEmailIndexRecord(challenge.emailIndexId, indexSnapshot.data())
        : null;
      if (!subscriber || !index || index.subscriberId !== subscriber.id) {
        throw new NewsletterIntegrityError();
      }

      if (
        subscriber.status !== 'pending'
        || subscriber.confirmationChallengeId !== challengeId
        || subscriber.emailIndexId !== challenge.emailIndexId
      ) {
        transaction.delete(challengeRef);
        return;
      }

      const {
        confirmationChallengeId: _challenge,
        confirmationExpiresAt: _challengeExpiry,
        unsubscribedAt: _unsubscribedAt,
        suppressionReason: _suppressionReason,
        ...subscriberWithoutPendingState
      } = subscriber;
      const confirmed: StoredNewsletterSubscriber = {
        ...subscriberWithoutPendingState,
        status: 'active',
        confirmedAt: timestampIso,
        subscribedAt: timestampIso,
        updatedAt: timestampIso
      };
      transaction.set(subscriberRef, sanitizeForFirestore(confirmed));
      transaction.delete(challengeRef);
    });

    return publicAccepted();
  },

  async unsubscribe(
    token: unknown,
    options: { signingSecret?: string } = {}
  ): Promise<NewsletterPublicMutationResult> {
    const verified = verifyNewsletterUnsubscribeToken(token, options.signingSecret);
    if (!verified) return publicAccepted();
    const db = getDb();
    const subscriberRef = db.collection(NEWSLETTER_COLLECTIONS.subscribers).doc(verified.subscriberId);
    const timestampIso = nowIso();

    await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(subscriberRef);
      if (!snapshot.exists) return;
      const subscriber = normalizeStoredSubscriber(verified.subscriberId, snapshot.data());
      if (!subscriber) throw new NewsletterIntegrityError();
      if (subscriber.status === 'unsubscribed' || subscriber.status === 'suppressed') return;

      const {
        confirmationChallengeId: pendingChallengeId,
        confirmationExpiresAt: _pendingExpiry,
        suppressionReason: _suppressionReason,
        ...subscriberWithoutPendingState
      } = subscriber;
      const unsubscribed: StoredNewsletterSubscriber = {
        ...subscriberWithoutPendingState,
        status: 'unsubscribed',
        unsubscribedAt: timestampIso,
        updatedAt: timestampIso
      };
      transaction.set(subscriberRef, sanitizeForFirestore(unsubscribed));
      if (pendingChallengeId) {
        transaction.delete(
          db.collection(NEWSLETTER_COLLECTIONS.confirmationChallenges).doc(pendingChallengeId)
        );
      }
    });

    return publicAccepted();
  },

  createUnsubscribeToken(subscriberId: string, signingSecret?: string): string {
    return createNewsletterUnsubscribeToken(assertSubscriberId(subscriberId), signingSecret);
  },

  async getSubscriber(subscriberId: string): Promise<NewsletterSubscriber | null> {
    const id = assertSubscriberId(subscriberId);
    const value = await getDocument(NEWSLETTER_COLLECTIONS.subscribers, id);
    if (value === null) return null;
    const subscriber = normalizeStoredSubscriber(id, value);
    if (!subscriber) throw new NewsletterIntegrityError();
    return toSubscriber(subscriber);
  },

  async findSubscriberByEmail(emailValue: unknown): Promise<NewsletterSubscriber | null> {
    const email = normalizeNewsletterEmail(emailValue);
    if (!email) throw new NewsletterValidationError('A valid email address is required.');
    const emailHash = newsletterEmailIndexId(email);
    const indexValue = await getDocument(NEWSLETTER_COLLECTIONS.emailIndex, emailHash);
    if (indexValue === null) return null;
    const index = normalizeEmailIndexRecord(emailHash, indexValue);
    if (!index) throw new NewsletterIntegrityError();
    const subscriber = await this.getSubscriber(index.subscriberId);
    if (!subscriber || subscriber.email !== email) throw new NewsletterIntegrityError();
    return subscriber;
  },

  async listSubscribers(
    options: NewsletterSubscriberListOptions = {}
  ): Promise<NewsletterSubscriberListResult> {
    const status = validateSubscriberStatus(options.status);
    const limit = normalizePageSize(options.limit);
    const search = typeof options.search === 'string'
      ? options.search.trim().slice(0, 254)
      : '';

    if (search) {
      const email = normalizeNewsletterEmail(search);
      const direct = email
        ? await this.findSubscriberByEmail(email)
        : SUBSCRIBER_ID_PATTERN.test(search)
          ? await this.getSubscriber(search)
          : null;
      if (email || SUBSCRIBER_ID_PATTERN.test(search)) {
        return {
          subscribers: direct && (!status || direct.status === status) ? [direct] : []
        };
      }
    }

    const db = getDb();
    let query: any = db.collection(NEWSLETTER_COLLECTIONS.subscribers);
    const nameSearch = search.toLocaleLowerCase('en');
    if (nameSearch) {
      query = query
        .orderBy('nameSearch', 'asc')
        .startAt(nameSearch)
        .endAt(`${nameSearch}\uf8ff`);
    } else if (status) {
      query = query
        .where('status', '==', status)
        .orderBy(FieldPath.documentId(), 'asc');
      if (options.cursor) {
        const cursor = decodeCursor(options.cursor);
        if (!cursor) throw new NewsletterValidationError('Invalid subscriber cursor.');
        query = query.startAfter(cursor.id);
      }
    } else {
      query = query
        .orderBy('updatedAt', 'desc')
        .orderBy(FieldPath.documentId(), 'desc');
      if (options.cursor) {
        const cursor = decodeCursor(options.cursor);
        if (!cursor) throw new NewsletterValidationError('Invalid subscriber cursor.');
        query = query.startAfter(cursor.updatedAt, cursor.id);
      }
    }

    const snapshot = await query.limit(limit + 1).get();
    const normalized: StoredNewsletterSubscriber[] = [];
    for (const document of snapshot.docs) {
      const subscriber = normalizeStoredSubscriber(document.id, document.data());
      if (!subscriber) throw new NewsletterIntegrityError();
      if (!status || subscriber.status === status) normalized.push(subscriber);
    }
    const hasMore = normalized.length > limit;
    const page = normalized.slice(0, limit);
    const last = page[page.length - 1];
    return {
      subscribers: page.map(toSubscriber),
      ...(!nameSearch && hasMore && last
        ? { nextCursor: encodeCursor(last.updatedAt, last.id) }
        : {})
    };
  },

  async getAdminSummary(options: { limit?: number } = {}): Promise<NewsletterAdminSummary> {
    const limit = normalizePageSize(options.limit, 25);
    const collection = getDb().collection(NEWSLETTER_COLLECTIONS.subscribers);
    const [
      totalSubscribers,
      activeSubscribers,
      unsubscribedSubscribers,
      suppressedSubscribers,
      subscriberPage,
      recentCampaigns
    ] = await Promise.all([
      countDocuments(collection),
      countDocuments(collection.where('status', '==', 'active')),
      countDocuments(collection.where('status', '==', 'unsubscribed')),
      countDocuments(collection.where('status', '==', 'suppressed')),
      this.listSubscribers({ limit }),
      this.listCampaigns({ limit: Math.min(limit, 25) })
    ]);
    return {
      totalSubscribers,
      activeSubscribers,
      unsubscribedSubscribers,
      suppressedSubscribers,
      subscribers: subscriberPage.subscribers,
      recentCampaigns
    };
  },

  async suppressSubscriber(subscriberId: string, reason: unknown): Promise<NewsletterSubscriber> {
    const id = assertSubscriberId(subscriberId);
    const suppressionReason = boundedText(reason, 500, 'suppressionReason', { required: true });
    if (!suppressionReason) throw new NewsletterValidationError('suppressionReason is required.');
    const db = getDb();
    const ref = db.collection(NEWSLETTER_COLLECTIONS.subscribers).doc(id);
    const updated = await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      const existing = snapshot.exists ? normalizeStoredSubscriber(id, snapshot.data()) : null;
      if (!existing) throw new NewsletterStateError('Newsletter subscriber was not found.');
      const timestampIso = nowIso();
      const {
        confirmationChallengeId: pendingChallengeId,
        confirmationExpiresAt: _pendingExpiry,
        ...withoutPendingState
      } = existing;
      const suppressed: StoredNewsletterSubscriber = {
        ...withoutPendingState,
        status: 'suppressed',
        suppressionReason,
        updatedAt: timestampIso
      };
      transaction.set(ref, sanitizeForFirestore(suppressed));
      if (pendingChallengeId) {
        transaction.delete(
          db.collection(NEWSLETTER_COLLECTIONS.confirmationChallenges).doc(pendingChallengeId)
        );
      }
      return suppressed;
    });
    return toSubscriber(updated);
  },

  async createCampaign(input: CreateNewsletterCampaignInput): Promise<NewsletterCampaign> {
    const content = sanitizeCampaignContent(input.content);
    const audience = sanitizeAudience(input.audience);
    const createdBy = boundedText(input.createdBy, 160, 'createdBy', { required: true });
    if (!createdBy) throw new NewsletterValidationError('createdBy is required.');
    const id = createCampaignId();
    const timestampIso = nowIso();
    const campaign: StoredNewsletterCampaign = {
      storageVersion: STORAGE_VERSION,
      id,
      kind: 'manual',
      content,
      audience,
      status: 'draft',
      createdBy,
      createdAt: timestampIso,
      updatedAt: timestampIso,
      provider: 'resend',
      recipientCount: 0,
      sentCount: 0,
      failedCount: 0
    };
    await getDb().collection(NEWSLETTER_COLLECTIONS.campaigns).doc(id)
      .create(sanitizeForFirestore(campaign));
    return toCampaign(campaign);
  },

  async ensureReleaseCampaign(
    input: EnsureNewsletterReleaseCampaignInput
  ): Promise<NewsletterCampaign> {
    const pieceId = typeof input.pieceId === 'string' ? input.pieceId.trim() : '';
    if (!SAFE_REFERENCE_ID.test(pieceId)) {
      throw new NewsletterValidationError('A valid piece identifier is required.');
    }
    const content = sanitizeCampaignContent({ ...input.content, pieceId });
    const audience = sanitizeAudience(input.audience);
    const createdBy = boundedText(input.createdBy, 160, 'createdBy', { required: true });
    if (!createdBy) throw new NewsletterValidationError('createdBy is required.');

    const id = releaseCampaignId(pieceId);
    const db = getDb();
    const ref = db.collection(NEWSLETTER_COLLECTIONS.campaigns).doc(id);
    const campaign = await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      if (snapshot.exists) {
        const existing = normalizeCampaign(id, snapshot.data());
        if (!existing || existing.kind !== 'release' || existing.content.pieceId !== pieceId) {
          throw new NewsletterIntegrityError();
        }
        return existing;
      }

      const timestampIso = nowIso();
      const created: StoredNewsletterCampaign = {
        storageVersion: STORAGE_VERSION,
        id,
        kind: 'release',
        content,
        audience,
        status: 'draft',
        createdBy,
        createdAt: timestampIso,
        updatedAt: timestampIso,
        provider: 'resend',
        recipientCount: 0,
        sentCount: 0,
        failedCount: 0
      };
      transaction.create(ref, sanitizeForFirestore(created));
      return created;
    });
    return toCampaign(campaign);
  },

  async getCampaign(campaignId: string): Promise<NewsletterCampaign | null> {
    const id = assertCampaignId(campaignId);
    const value = await getDocument(NEWSLETTER_COLLECTIONS.campaigns, id);
    if (value === null) return null;
    const campaign = normalizeCampaign(id, value);
    if (!campaign) throw new NewsletterIntegrityError();
    return toCampaign(campaign);
  },

  async updateCampaignDraft(
    campaignId: string,
    patch: NewsletterCampaignDraftPatch
  ): Promise<NewsletterCampaign> {
    const id = assertCampaignId(campaignId);
    if (!patch.content && !patch.audience) {
      throw new NewsletterValidationError('A campaign content or audience change is required.');
    }
    const db = getDb();
    const ref = db.collection(NEWSLETTER_COLLECTIONS.campaigns).doc(id);
    const updated = await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      const existing = snapshot.exists ? normalizeCampaign(id, snapshot.data()) : null;
      if (!existing) throw new NewsletterStateError('Newsletter campaign was not found.');
      if (existing.status !== 'draft') {
        throw new NewsletterStateError('Only draft campaigns can be edited.');
      }
      const next: StoredNewsletterCampaign = {
        ...existing,
        content: patch.content ? sanitizeCampaignContent(patch.content) : existing.content,
        audience: patch.audience ? sanitizeAudience(patch.audience) : existing.audience,
        updatedAt: nowIso()
      };
      transaction.set(ref, sanitizeForFirestore(next));
      return next;
    });
    return toCampaign(updated);
  },

  async setCampaignStatus(
    campaignId: string,
    patch: NewsletterCampaignStatusPatch
  ): Promise<NewsletterCampaign> {
    const id = assertCampaignId(campaignId);
    if (!CAMPAIGN_STATUSES.includes(patch.status)) {
      throw new NewsletterValidationError('Invalid campaign status.');
    }
    const db = getDb();
    const ref = db.collection(NEWSLETTER_COLLECTIONS.campaigns).doc(id);
    const updated = await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      const existing = snapshot.exists ? normalizeCampaign(id, snapshot.data()) : null;
      if (!existing) throw new NewsletterStateError('Newsletter campaign was not found.');
      if (existing.status === patch.status) return existing;
      if (!CAMPAIGN_TRANSITIONS[existing.status].includes(patch.status)) {
        throw new NewsletterStateError(`Campaign cannot move from ${existing.status} to ${patch.status}.`);
      }
      const timestampIso = nowIso();
      const next: StoredNewsletterCampaign = {
        ...existing,
        status: patch.status,
        updatedAt: timestampIso,
        ...(patch.status === 'queued' ? { queuedAt: timestampIso } : {}),
        ...(patch.status === 'sent' || patch.status === 'partially_sent'
          ? { sentAt: timestampIso }
          : {}),
        ...(patch.lastError
          ? { lastError: boundedText(patch.lastError, 1_000, 'lastError') }
          : {})
      };
      transaction.set(ref, sanitizeForFirestore(next));
      return next;
    });
    return toCampaign(updated);
  },

  async listCampaigns(options: {
    status?: NewsletterCampaignStatus;
    limit?: number;
  } = {}): Promise<NewsletterCampaign[]> {
    if (options.status && !CAMPAIGN_STATUSES.includes(options.status)) {
      throw new NewsletterValidationError('Invalid campaign status.');
    }
    const limit = normalizePageSize(options.limit, 25);
    let query: any = getDb().collection(NEWSLETTER_COLLECTIONS.campaigns);
    if (options.status) query = query.where('status', '==', options.status);
    const snapshot = await query.orderBy('createdAt', 'desc').limit(limit).get();
    return snapshot.docs.map((document: any) => {
      const campaign = normalizeCampaign(document.id, document.data());
      if (!campaign) throw new NewsletterIntegrityError();
      return toCampaign(campaign);
    });
  },

  async queueDelivery(campaignId: string, subscriberId: string): Promise<NewsletterDelivery> {
    const cleanCampaignId = assertCampaignId(campaignId);
    const cleanSubscriberId = assertSubscriberId(subscriberId);
    const id = deliveryId(cleanCampaignId, cleanSubscriberId);
    const db = getDb();
    const campaignRef = db.collection(NEWSLETTER_COLLECTIONS.campaigns).doc(cleanCampaignId);
    const subscriberRef = db.collection(NEWSLETTER_COLLECTIONS.subscribers).doc(cleanSubscriberId);
    const deliveryRef = db.collection(NEWSLETTER_COLLECTIONS.deliveries).doc(id);

    const delivery = await db.runTransaction(async transaction => {
      const [campaignSnapshot, subscriberSnapshot, deliverySnapshot] = await Promise.all([
        transaction.get(campaignRef),
        transaction.get(subscriberRef),
        transaction.get(deliveryRef)
      ]);
      const campaign = campaignSnapshot.exists
        ? normalizeCampaign(cleanCampaignId, campaignSnapshot.data())
        : null;
      const subscriber = subscriberSnapshot.exists
        ? normalizeStoredSubscriber(cleanSubscriberId, subscriberSnapshot.data())
        : null;
      if (!campaign || !subscriber) throw new NewsletterStateError('Campaign or subscriber was not found.');
      if (deliverySnapshot.exists) {
        const existing = normalizeDelivery(id, deliverySnapshot.data());
        if (!existing) throw new NewsletterIntegrityError();
        return existing;
      }
      if (campaign.status !== 'queued' && campaign.status !== 'sending') {
        throw new NewsletterStateError('Campaign must be queued before deliveries are created.');
      }
      if (subscriber.status !== 'active') {
        throw new NewsletterStateError('Only active subscribers may receive a delivery.');
      }

      const timestampIso = nowIso();
      const queued: StoredNewsletterDelivery = {
        storageVersion: STORAGE_VERSION,
        id,
        campaignId: cleanCampaignId,
        subscriberId: cleanSubscriberId,
        email: subscriber.email,
        status: 'queued',
        provider: 'resend',
        createdAt: timestampIso,
        updatedAt: timestampIso
      };
      const campaignWithRecipient: StoredNewsletterCampaign = {
        ...campaign,
        recipientCount: campaign.recipientCount + 1,
        updatedAt: timestampIso
      };
      transaction.create(deliveryRef, sanitizeForFirestore(queued));
      transaction.set(campaignRef, sanitizeForFirestore(campaignWithRecipient));
      return queued;
    });
    return toDelivery(delivery);
  },

  async getDelivery(deliveryIdValue: string): Promise<NewsletterDelivery | null> {
    const id = assertDeliveryId(deliveryIdValue);
    const value = await getDocument(NEWSLETTER_COLLECTIONS.deliveries, id);
    if (value === null) return null;
    const delivery = normalizeDelivery(id, value);
    if (!delivery) throw new NewsletterIntegrityError();
    return toDelivery(delivery);
  },

  async findDeliveryByProviderMessageId(
    providerMessageIdValue: unknown
  ): Promise<NewsletterDelivery | null> {
    const providerMessageId = boundedText(
      providerMessageIdValue,
      200,
      'providerMessageId',
      { required: true }
    );
    if (!providerMessageId) {
      throw new NewsletterValidationError('providerMessageId is required.');
    }
    const snapshot = await getDb().collection(NEWSLETTER_COLLECTIONS.deliveries)
      .where('providerMessageId', '==', providerMessageId)
      .limit(2)
      .get();
    if (snapshot.empty || snapshot.docs.length === 0) return null;
    if (snapshot.docs.length !== 1) throw new NewsletterIntegrityError();
    const delivery = normalizeDelivery(snapshot.docs[0].id, snapshot.docs[0].data());
    if (!delivery || delivery.providerMessageId !== providerMessageId) {
      throw new NewsletterIntegrityError();
    }
    return toDelivery(delivery);
  },

  async listDeliveries(options: {
    campaignId: string;
    status?: NewsletterDeliveryStatus;
    limit?: number;
  }): Promise<NewsletterDelivery[]> {
    const campaignId = assertCampaignId(options.campaignId);
    if (options.status && !DELIVERY_STATUSES.includes(options.status)) {
      throw new NewsletterValidationError('Invalid delivery status.');
    }
    const limit = normalizePageSize(options.limit, 50);
    let query: any = getDb().collection(NEWSLETTER_COLLECTIONS.deliveries)
      .where('campaignId', '==', campaignId);
    if (options.status) query = query.where('status', '==', options.status);
    const snapshot = await query.orderBy('createdAt', 'desc').limit(limit).get();
    return snapshot.docs.map((document: any) => {
      const delivery = normalizeDelivery(document.id, document.data());
      if (!delivery) throw new NewsletterIntegrityError();
      return toDelivery(delivery);
    });
  },

  async recordDeliveryOutcome(
    deliveryIdValue: string,
    input: NewsletterDeliveryOutcomeInput
  ): Promise<NewsletterDelivery> {
    const id = assertDeliveryId(deliveryIdValue);
    if (!DELIVERY_STATUSES.includes(input.status) || String(input.status) === 'queued') {
      throw new NewsletterValidationError('Invalid delivery outcome status.');
    }
    const providerMessageId = boundedText(input.providerMessageId, 200, 'providerMessageId');
    const error = boundedText(input.error, 1_000, 'error');
    const db = getDb();
    const deliveryRef = db.collection(NEWSLETTER_COLLECTIONS.deliveries).doc(id);

    const updated = await db.runTransaction(async transaction => {
      const deliverySnapshot = await transaction.get(deliveryRef);
      const existing = deliverySnapshot.exists
        ? normalizeDelivery(id, deliverySnapshot.data())
        : null;
      if (!existing) throw new NewsletterStateError('Newsletter delivery was not found.');
      if (existing.status === input.status) return existing;
      if (!DELIVERY_TRANSITIONS[existing.status].includes(input.status)) {
        throw new NewsletterStateError(`Delivery cannot move from ${existing.status} to ${input.status}.`);
      }

      const campaignRef = db.collection(NEWSLETTER_COLLECTIONS.campaigns).doc(existing.campaignId);
      const subscriberRef = db.collection(NEWSLETTER_COLLECTIONS.subscribers).doc(existing.subscriberId);
      const [campaignSnapshot, subscriberSnapshot] = await Promise.all([
        transaction.get(campaignRef),
        transaction.get(subscriberRef)
      ]);
      const campaign = campaignSnapshot.exists
        ? normalizeCampaign(existing.campaignId, campaignSnapshot.data())
        : null;
      const subscriber = subscriberSnapshot.exists
        ? normalizeStoredSubscriber(existing.subscriberId, subscriberSnapshot.data())
        : null;
      if (!campaign || !subscriber) throw new NewsletterIntegrityError();

      const timestampIso = nowIso();
      const next: StoredNewsletterDelivery = {
        ...existing,
        status: input.status,
        updatedAt: timestampIso,
        ...(providerMessageId ? { providerMessageId } : {}),
        ...(SENT_DELIVERY_STATUSES.has(input.status) && !existing.sentAt
          ? { sentAt: timestampIso }
          : {}),
        ...(input.status === 'delivered' ? { deliveredAt: timestampIso } : {}),
        ...(FAILED_DELIVERY_STATUSES.has(input.status) ? { failedAt: timestampIso } : {}),
        ...(error ? { error } : {})
      };
      const enteringSent = !SENT_DELIVERY_STATUSES.has(existing.status)
        && SENT_DELIVERY_STATUSES.has(input.status);
      const enteringFailed = !FAILED_DELIVERY_STATUSES.has(existing.status)
        && FAILED_DELIVERY_STATUSES.has(input.status);
      const nextCampaign: StoredNewsletterCampaign = {
        ...campaign,
        sentCount: campaign.sentCount + (enteringSent ? 1 : 0),
        failedCount: campaign.failedCount + (enteringFailed ? 1 : 0),
        updatedAt: timestampIso
      };

      transaction.set(deliveryRef, sanitizeForFirestore(next));
      transaction.set(campaignRef, sanitizeForFirestore(nextCampaign));
      if (
        (input.status === 'bounced' || input.status === 'complained' || input.status === 'suppressed')
        && subscriber.status !== 'suppressed'
      ) {
        const suppressed: StoredNewsletterSubscriber = {
          ...subscriber,
          status: 'suppressed',
          suppressionReason: input.status,
          updatedAt: timestampIso
        };
        transaction.set(subscriberRef, sanitizeForFirestore(suppressed));
      }
      return next;
    });
    return toDelivery(updated);
  }
};

export type NewsletterStore = typeof newsletterStore;
