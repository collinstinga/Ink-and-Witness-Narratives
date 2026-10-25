import crypto from 'crypto';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import type { AffiliatePublicProfile, LiteraryCircleNotificationSettings } from '../types.js';
import { getFirestoreClientTarget } from './db.js';
import { planAffiliateNotifications, type AffiliateNotificationSource, type HeldAffiliateNotificationIntent } from './affiliateNotificationPlan.js';
import { renderAffiliateNotificationTemplate, validateAffiliateNotificationSettings } from './affiliateNotifications.js';
import { createAffiliateMarketingOptOutToken } from './affiliateNotificationSecurity.js';
import { normalizeNewsletterEmail, newsletterEmailIndexId } from './newsletterSecurity.js';
import { NewsletterProviderError, sendNewsletterEmail } from './newsletterEmail.js';
import { newsletterOutcomeForResendEvent, verifyResendWebhook, type NewsletterWebhookHeaders } from './newsletterWebhook.js';
import { AFFILIATE_RELEASE_NOTIFICATION_MAX_AGE_MS } from './affiliateNotificationEvents.js';
import { verifiedManualAffiliateNotificationTierIds } from './affiliateNotificationTierFilter.js';
import type { VerifiedAffiliateNotificationMonthlyTiers } from './affiliateNotificationTierFilter.js';
import { readVerifiedAffiliateNotificationMonthlyTiers } from './affiliateNotificationMonthlyTiers.js';

export const AFFILIATE_NOTIFICATION_DELIVERY_COLLECTION = 'affiliate_notification_deliveries';
export const AFFILIATE_NOTIFICATION_DELIVERY_CONFIG_ID = 'affiliate_notification_delivery';
export const MAX_AFFILIATE_DELIVERY_ATTEMPTS = 6;
const LEASE_MS = 120_000;
// Resend retains idempotency keys for 24 hours. Never retry an ambiguous send
// after that retention period; a writer must investigate a dead letter instead.
const IDEMPOTENCY_WINDOW_MS = 23 * 60 * 60 * 1_000;
const INTENT_ID = /^ani1_[a-f0-9]{64}$/;
const DELIVERY_ID = /^nld_[a-f0-9]{48}$/;
const HASH = /^[a-f0-9]{64}$/;
const SAFE_PROJECT = /^[a-z][a-z0-9-]{4,29}[a-z0-9]$/;
const PRODUCTION_PROJECTS = ['ink-and-witness-narratives', 'divine-experience-pq6d2'];
const MARKETING_EVENTS = new Set(['new_release', 'upcoming_campaign', 'inactivity_reminder', 'exclusive_opportunity']);
const TERMINAL = new Set(['accepted', 'delivered', 'bounced', 'complained', 'suppressed', 'failed', 'dead_letter', 'cancelled']);

export function affiliateNotificationDeliveryHash(value: unknown): string {
  const canonical = (item: unknown): string => {
    if (item === null || typeof item !== 'object') return JSON.stringify(item);
    if (Array.isArray(item)) return `[${item.map(canonical).join(',')}]`;
    const object = item as Record<string, unknown>;
    return `{${Object.keys(object).filter(key => object[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`;
  };
  return crypto.createHash('sha256').update(canonical(value)).digest('hex');
}

function iso(value: unknown): number | null {
  const milliseconds = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value ? milliseconds : null;
}

function record(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key));
}

function secureOrigin(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
      || url.pathname !== '/' || url.origin !== value || !url.hostname.includes('.')
      || url.hostname === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)) return null;
    return url.origin;
  } catch { return null; }
}

export interface AffiliateNotificationDeliveryReview {
  schemaVersion: 1;
  enabled: true;
  mode: 'staging_test';
  projectId: string;
  databaseId: string;
  canonicalBaseUrl: string;
  fromEmail: string;
  allowedRecipients: string[];
  settingsRevision: number;
  settingsSha256: string;
  reviewedAt: string;
  expiresAt: string;
  reviewedBy: string;
}

type DeliveryStatus = 'leased' | 'dispatching' | 'retry_pending' | 'accepted' | 'delivered'
  | 'bounced' | 'complained' | 'suppressed' | 'failed' | 'dead_letter' | 'cancelled';

export interface AffiliateNotificationDeliveryRecord {
  schemaVersion: 1;
  kind: 'delivery';
  id: string;
  intentId: string;
  eventId: string;
  affiliateId: string;
  recipientEmailSha256: string;
  settingsRevision: number;
  reviewSha256: string;
  contentSha256: string;
  sourceEvidenceSha256: string;
  initialSourceEvidenceSha256?: string;
  status: DeliveryStatus;
  attemptCount: number;
  createdAt: string;
  updatedAt: string;
  leaseToken?: string;
  leaseExpiresAt?: string;
  firstAttemptAt?: string;
  lastAttemptAt?: string;
  retryWindowExpiresAt?: string;
  nextAttemptAt?: string;
  providerMessageId?: string;
  lastWebhookEventIdSha256?: string;
  lastWebhookAt?: string;
  lastErrorCode?: 'provider_retryable' | 'provider_rejected' | 'eligibility_changed' | 'retry_budget_exhausted';
}

export type AffiliateNotificationSourceVerifier = (input: {
  transaction: Transaction;
  source: AffiliateNotificationSource;
  intent: HeldAffiliateNotificationIntent;
  now: string;
}) => Promise<{
  eligible: true; variables: Record<string, string>; evidenceSha256: string;
  cooldown?: { key: string; minimumIntervalMs: number };
} | null>;

export interface AffiliateNotificationDeliveryResult {
  status: 'disabled' | 'blocked' | 'ineligible' | 'not_due' | 'busy' | 'accepted'
    | 'already_processed' | 'retry_pending' | 'dead_letter' | 'failed';
  deliveryId?: string;
}

/** Environment gate is checked before Firestore access. Template settings remain
 * preview_only. A separate short-lived, hash-pinned review authorizes only a
 * maximum of five explicitly consented staging test addresses. Never production.
 */
export function affiliateNotificationDeliveryGate(db: Firestore, env: NodeJS.ProcessEnv): 'allowed' | 'disabled' | 'blocked' {
  const mode = env.AFFILIATE_NOTIFICATION_DELIVERY_MODE || 'off';
  if (mode === 'off') return 'disabled';
  if (mode !== 'staging_test') return 'blocked';
  const projectId = env.FIREBASE_PROJECT_ID || '';
  const allowed = (env.LITERARY_CIRCLE_STAGING_PROJECT_IDS || '').split(',').map(value => value.trim()).filter(Boolean);
  const denied = new Set([...PRODUCTION_PROJECTS, ...(env.LITERARY_CIRCLE_PRODUCTION_PROJECT_IDS || '').split(',').map(value => value.trim())]);
  const actual = getFirestoreClientTarget(db);
  const environment = (env.VERCEL_ENV || '').trim().toLowerCase();
  if (environment === 'production' || (!environment && (env.NODE_ENV || '').trim().toLowerCase() === 'production')
    || !SAFE_PROJECT.test(projectId) || !allowed.includes(projectId) || denied.has(projectId)
    || allowed.some(id => !SAFE_PROJECT.test(id) || denied.has(id))
    || actual?.projectId !== projectId || actual.firestoreDatabaseId !== (env.FIRESTORE_DATABASE_ID || '(default)')
    || env.FIRESTORE_EMULATOR_HOST || env.FIREBASE_AUTH_EMULATOR_HOST || env.FIREBASE_DATABASE_EMULATOR_HOST
    || !HASH.test(env.AFFILIATE_NOTIFICATION_DELIVERY_REVIEW_SHA256 || '')
    || !secureOrigin(env.AFFILIATE_NOTIFICATION_STAGING_BASE_URL)
    || !env.RESEND_API_KEY?.trim() || !env.NEWSLETTER_FROM_EMAIL?.trim() || !env.RESEND_WEBHOOK_SECRET?.trim()
    || (env.AFFILIATE_NOTIFICATION_SIGNING_SECRET || '').trim().length < 32) return 'blocked';
  return 'allowed';
}

function validReview(value: unknown, env: NodeJS.ProcessEnv, now: number): value is AffiliateNotificationDeliveryReview {
  if (!record(value) || !exactKeys(value, ['schemaVersion', 'enabled', 'mode', 'projectId', 'databaseId', 'canonicalBaseUrl', 'fromEmail', 'allowedRecipients', 'settingsRevision', 'settingsSha256', 'reviewedAt', 'expiresAt', 'reviewedBy'])
    || value.schemaVersion !== 1 || value.enabled !== true || value.mode !== 'staging_test'
    || value.projectId !== env.FIREBASE_PROJECT_ID || value.databaseId !== (env.FIRESTORE_DATABASE_ID || '(default)')
    || secureOrigin(value.canonicalBaseUrl) !== env.AFFILIATE_NOTIFICATION_STAGING_BASE_URL
    || typeof value.fromEmail !== 'string' || value.fromEmail !== env.NEWSLETTER_FROM_EMAIL?.trim() || /[\r\n]/.test(value.fromEmail)
    || !Array.isArray(value.allowedRecipients) || !value.allowedRecipients.length || value.allowedRecipients.length > 5
    || Array.from(value.allowedRecipients).some(email => typeof email !== 'string' || normalizeNewsletterEmail(email) !== email)
    || new Set(value.allowedRecipients).size !== value.allowedRecipients.length
    || !Number.isSafeInteger(value.settingsRevision) || value.settingsRevision < 0 || !HASH.test(value.settingsSha256)
    || typeof value.reviewedBy !== 'string' || !value.reviewedBy.trim() || value.reviewedBy.length > 120
    || affiliateNotificationDeliveryHash(value) !== env.AFFILIATE_NOTIFICATION_DELIVERY_REVIEW_SHA256) return false;
  const reviewed = iso(value.reviewedAt), expires = iso(value.expiresAt);
  return reviewed !== null && expires !== null && reviewed <= now && expires > now
    && expires > reviewed && expires - reviewed <= 7 * 24 * 60 * 60 * 1_000;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]!);
}

function sameOriginLink(value: string | undefined, baseUrl: string): string | undefined {
  if (!value) return undefined;
  const url = new URL(value, baseUrl);
  if (url.origin !== baseUrl || url.username || url.password || url.protocol !== 'https:') throw new Error('Unsafe partner email link.');
  return url.href;
}

function buildEmail(input: {
  affiliate: AffiliatePublicProfile;
  settings: LiteraryCircleNotificationSettings;
  source: AffiliateNotificationSource;
  variables: Record<string, string>;
  review: AffiliateNotificationDeliveryReview;
  secret: string;
}): Omit<Parameters<typeof sendNewsletterEmail>[0], 'idempotencyKey' | 'deliveryId' | 'fetchImpl'> {
  const template = input.settings.templates.find(item => item.eventType === input.source.eventType)!;
  const baseUrl = input.review.canonicalBaseUrl;
  const variables = {
    ...input.variables, affiliateName: input.affiliate.name || 'Literary Partner', portalUrl: `${baseUrl}/#affiliates`,
    ...(input.variables.piecePath ? { pieceUrl: sameOriginLink(input.variables.piecePath, baseUrl)! } : {}),
  };
  const content = renderAffiliateNotificationTemplate(template, variables);
  if (Object.values(content).some(value => typeof value !== 'string' || /[{}]|[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value))
    || /[\r\n]/.test(content.subject) || !content.subject.trim()) throw new Error('Unresolved partner email template.');
  const ctaUrl = sameOriginLink(content.ctaUrl, baseUrl);
  const marketing = MARKETING_EVENTS.has(input.source.eventType);
  const unsubscribeUrl = marketing
    ? `${baseUrl}/affiliate/notifications/unsubscribe?token=${encodeURIComponent(createAffiliateMarketingOptOutToken(input.affiliate.id, input.secret))}`
    : undefined;
  const body = content.body.split(/\n{2,}/).map(paragraph => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`).join('');
  const cta = ctaUrl && content.ctaLabel ? `<p><a href="${escapeHtml(ctaUrl)}">${escapeHtml(content.ctaLabel)}</a></p>` : '';
  const footer = unsubscribeUrl ? `<p style="font-size:12px">Literary Circle updates you opted into. <a href="${escapeHtml(unsubscribeUrl)}">Stop marketing updates</a>.</p>` : '<p style="font-size:12px">An update about your Literary Circle account. Manage optional alerts in your partner dashboard.</p>';
  return {
    to: normalizeNewsletterEmail(input.affiliate.email)!, subject: content.subject,
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(content.subject)}</title></head><body style="margin:0;background:#080d18;color:#e2e8f0;font-family:Georgia,serif"><main style="max-width:600px;margin:0 auto;padding:32px 24px"><p>INK &amp; WITNESS LITERARY CIRCLE</p><h1>${escapeHtml(content.heading)}</h1>${body}${cta}${footer}</main></body></html>`,
    text: `${content.heading}\n\n${content.body}${ctaUrl ? `\n\n${content.ctaLabel || 'Open dashboard'}: ${ctaUrl}` : ''}${unsubscribeUrl ? `\n\nStop marketing updates: ${unsubscribeUrl}` : '\n\nManage optional alerts in your partner dashboard.'}`,
    ...(unsubscribeUrl ? { unsubscribeUrl } : {}),
  };
}

function deliveryId(intentId: string): string {
  return `nld_${crypto.createHash('sha256').update(`affiliate\0${intentId}`).digest('hex').slice(0, 48)}`;
}

function validDelivery(value: unknown, id: string): value is AffiliateNotificationDeliveryRecord {
  return record(value) && exactKeys(value, ['schemaVersion', 'kind', 'id', 'intentId', 'eventId', 'affiliateId', 'recipientEmailSha256', 'settingsRevision', 'reviewSha256', 'contentSha256', 'sourceEvidenceSha256', 'initialSourceEvidenceSha256', 'status', 'attemptCount', 'createdAt', 'updatedAt', 'leaseToken', 'leaseExpiresAt', 'firstAttemptAt', 'lastAttemptAt', 'retryWindowExpiresAt', 'nextAttemptAt', 'providerMessageId', 'lastWebhookEventIdSha256', 'lastWebhookAt', 'lastErrorCode'])
    && value.schemaVersion === 1 && value.kind === 'delivery' && value.id === id && DELIVERY_ID.test(id)
    && INTENT_ID.test(value.intentId) && deliveryId(value.intentId) === id
    && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,159}$/.test(value.affiliateId)
    && /^ane1_[a-f0-9]{64}$/.test(value.eventId)
    && [value.recipientEmailSha256, value.reviewSha256, value.contentSha256, value.sourceEvidenceSha256].every(item => typeof item === 'string' && HASH.test(item))
    && (value.initialSourceEvidenceSha256 === undefined || typeof value.initialSourceEvidenceSha256 === 'string' && HASH.test(value.initialSourceEvidenceSha256))
    && Number.isSafeInteger(value.settingsRevision) && value.settingsRevision >= 0
    && Number.isSafeInteger(value.attemptCount) && value.attemptCount >= 0 && value.attemptCount <= MAX_AFFILIATE_DELIVERY_ATTEMPTS
    && ['leased', 'dispatching', 'retry_pending', ...TERMINAL].includes(value.status)
    && iso(value.createdAt) !== null && iso(value.updatedAt) !== null
    && ['leaseExpiresAt', 'firstAttemptAt', 'lastAttemptAt', 'retryWindowExpiresAt', 'nextAttemptAt', 'lastWebhookAt'].every(key => value[key] === undefined || iso(value[key]) !== null)
    && (value.leaseToken === undefined || /^[a-f0-9]{48}$/.test(value.leaseToken))
    && (value.providerMessageId === undefined || typeof value.providerMessageId === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value.providerMessageId));
}

/** Both account and provider suppression remain separate from marketing opt-out:
 * unsubscribing from the public newsletter alone cannot cancel financial alerts.
 * Provider suppression applies to every event, including operational notices.
 */
async function isSuppressed(db: Firestore, transaction: Transaction, email: string): Promise<boolean> {
  const emailHash = newsletterEmailIndexId(email);
  const [suppression, index] = await transaction.getAll(
    db.collection(AFFILIATE_NOTIFICATION_DELIVERY_COLLECTION).doc(`suppression_${emailHash}`),
    db.collection('newsletter_email_index').doc(emailHash),
  );
  if (suppression.exists) return true;
  if (!index.exists) return false;
  const value = index.data();
  if (!value || value.storageVersion !== 1 || value.emailHash !== emailHash
    || typeof value.subscriberId !== 'string' || !/^sub_[A-Za-z0-9_-]{12,}$/.test(value.subscriberId)) return true;
  const subscriber = await transaction.get(db.collection('newsletter_subscribers').doc(value.subscriberId));
  const data = subscriber.data();
  return !subscriber.exists || !data || data.storageVersion !== 1 || data.email !== email || data.emailIndexId !== emailHash || data.status === 'suppressed'
    || !['active', 'pending', 'unsubscribed'].includes(data.status);
}

interface Loaded {
  intent: HeldAffiliateNotificationIntent;
  source: AffiliateNotificationSource;
  review: AffiliateNotificationDeliveryReview;
  email: ReturnType<typeof buildEmail>;
  evidenceSha256: string;
  contentSha256: string;
  cooldown?: { key: string; minimumIntervalMs: number };
}

async function loadEligible(input: {
  db: Firestore; transaction: Transaction; intentId: string; env: NodeJS.ProcessEnv; now: string;
  verifySource: AffiliateNotificationSourceVerifier;
}): Promise<Loaded | 'not_due' | null> {
  const { db, transaction, intentId, env, now } = input;
  const nowMs = iso(now)!;
  const [intentSnapshot, reviewSnapshot, settingsSnapshot] = await transaction.getAll(
    db.collection('affiliate_notification_outbox').doc(intentId),
    db.collection('site_configs').doc(AFFILIATE_NOTIFICATION_DELIVERY_CONFIG_ID),
    db.collection('site_configs').doc('affiliate_notifications'),
  );
  const intent = intentSnapshot.data();
  const review = reviewSnapshot.data();
  if (!intentSnapshot.exists || !record(intent) || !exactKeys(intent, ['schemaVersion', 'id', 'eventId', 'eventType', 'affiliateId', 'settingsRevision', 'state', 'dueAt', 'tierEvidenceSha256', 'kind', 'createdAt'])
    || intent.tierEvidenceSha256 !== undefined && (typeof intent.tierEvidenceSha256 !== 'string' || !HASH.test(intent.tierEvidenceSha256))
    || intent.kind !== 'intent' || intent.schemaVersion !== 1 || intent.state !== 'held' || intent.id !== intentId
    || !/^ane1_[a-f0-9]{64}$/.test(intent.eventId) || !iso(intent.createdAt) || iso(intent.createdAt)! > nowMs
    || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(intent.affiliateId)
    || !validReview(review, env, nowMs) || !settingsSnapshot.exists) return null;
  const due = iso(intent.dueAt);
  if (due === null) return null;
  if (due > nowMs) return 'not_due';
  const settings = validateAffiliateNotificationSettings(settingsSnapshot.data());
  if (settings.revision !== review.settingsRevision || intent.settingsRevision !== settings.revision
    || affiliateNotificationDeliveryHash(settings) !== review.settingsSha256) return null;
  const [sourceSnapshot, affiliateSnapshot] = await transaction.getAll(
    db.collection('affiliate_notification_outbox').doc(intent.eventId), db.collection('affiliates').doc(intent.affiliateId),
  );
  const sourceRecord = sourceSnapshot.data();
  if (!sourceSnapshot.exists || !record(sourceRecord)
    || !exactKeys(sourceRecord, ['schemaVersion', 'kind', 'id', 'source', 'sourceSha256', 'audienceSha256', 'intentEvidence', 'createdAt', 'deliveryMode'])
    || sourceRecord.schemaVersion !== 1 || sourceRecord.kind !== 'source' || sourceRecord.id !== intent.eventId
    || sourceRecord.deliveryMode !== 'preview_only' || sourceRecord.createdAt !== intent.createdAt
    || !HASH.test(sourceRecord.audienceSha256) || affiliateNotificationDeliveryHash(sourceRecord.source) !== sourceRecord.sourceSha256
    || !Array.isArray(sourceRecord.intentEvidence) || sourceRecord.intentEvidence.length < 1 || sourceRecord.intentEvidence.length > 200
    || Array.from(sourceRecord.intentEvidence).some((item: unknown) => !record(item) || !exactKeys(item, ['id', 'sha256']) || !INTENT_ID.test(item.id) || !HASH.test(item.sha256))
    || new Set(sourceRecord.intentEvidence.map((item: any) => item.id)).size !== sourceRecord.intentEvidence.length
    || !sourceRecord.intentEvidence.some((item: any) => item.id === intentId && item.sha256 === affiliateNotificationDeliveryHash(intent))
    || !affiliateSnapshot.exists) return null;
  const affiliate = { ...affiliateSnapshot.data(), id: intent.affiliateId } as AffiliatePublicProfile;
  const email = normalizeNewsletterEmail(affiliate.email);
  if (!email || !review.allowedRecipients.includes(email) || await isSuppressed(db, transaction, email)) return null;
  const source = sourceRecord.source as AffiliateNotificationSource;
  if (!source || iso(source.occurredAt) === null || iso(source.occurredAt)! > iso(intent.createdAt)!) return null;
  if (source.eventType === 'new_release' && nowMs >= iso(source.occurredAt)! + AFFILIATE_RELEASE_NOTIFICATION_MAX_AGE_MS) return null;
  const template = settings.templates.find(item => item.eventType === source.eventType);
  let verifiedManualTierIds: Record<string, string> | undefined;
  let verifiedMonthlyTiers: VerifiedAffiliateNotificationMonthlyTiers | undefined;
  if (template?.eligibility.tierIds.length && !(source.eventType === 'tier_upgrade' && source.targetTierId)) {
    // Resolve exact current canonical summaries against the effective policy;
    // missing evidence stays held. No commission-history scan or repair.
    const circle = await transaction.get(db.collection('site_configs').doc('affiliate_literary_circle'));
    verifiedManualTierIds = verifiedManualAffiliateNotificationTierIds([affiliate], circle.exists ? circle.data() : undefined, now);
    verifiedMonthlyTiers = await readVerifiedAffiliateNotificationMonthlyTiers({
      db, transaction, affiliates: [affiliate], settings: circle.exists ? circle.data() : undefined, now,
    });
  }
  const plan = planAffiliateNotifications({ source, settings, affiliates: [affiliate], now,
    ...(verifiedManualTierIds ? { verifiedManualTierIds } : {}),
    ...(verifiedMonthlyTiers ? { verifiedMonthlyTiers } : {}),
  });
  if (plan.eventId !== intent.eventId || plan.intents.length !== 1
    || affiliateNotificationDeliveryHash(plan.intents[0]) !== affiliateNotificationDeliveryHash(Object.fromEntries(Object.entries(intent).filter(([key]) => !['kind', 'createdAt'].includes(key))))) return null;
  const evidence = await input.verifySource({ transaction, source, intent: intent as unknown as HeldAffiliateNotificationIntent, now });
  if (!evidence?.eligible || !HASH.test(evidence.evidenceSha256) || !record(evidence.variables)
    || Object.values(evidence.variables).some(value => typeof value !== 'string' || value.length > 4_000)) return null;
  const message = buildEmail({ affiliate, settings, source, variables: evidence.variables, review, secret: env.AFFILIATE_NOTIFICATION_SIGNING_SECRET! });
  if (source.eventType === 'inactivity_reminder' ? !evidence.cooldown
    || !HASH.test(evidence.cooldown.key) || !Number.isSafeInteger(evidence.cooldown.minimumIntervalMs)
    || evidence.cooldown.minimumIntervalMs < 7 * 24 * 60 * 60 * 1_000 || evidence.cooldown.minimumIntervalMs > 365 * 24 * 60 * 60 * 1_000
    : evidence.cooldown !== undefined) return null;
  return {
    intent: intent as unknown as HeldAffiliateNotificationIntent, source, review, email: message,
    evidenceSha256: evidence.evidenceSha256,
    // These transport fields live outside the message options. Pin them too:
    // changed reply-to or provider account cannot replay a different envelope
    // under the previous account's idempotency key after an ambiguous failure.
    contentSha256: affiliateNotificationDeliveryHash({
      message, from: review.fromEmail, replyTo: env.NEWSLETTER_REPLY_TO?.trim() || null,
      providerAccountSha256: affiliateNotificationDeliveryHash(env.RESEND_API_KEY!.trim()),
    }),
    ...(evidence.cooldown ? { cooldown: {
      // Derive at this boundary, independent of period/evidence/config revisions.
      key: affiliateNotificationDeliveryHash(['inactivity_reminder', affiliate.id]),
      minimumIntervalMs: evidence.cooldown.minimumIntervalMs,
    } } : {}),
  };
}

/** One explicitly selected held intent, never a database scan. No email transport
 * is reached unless the source is freshly proved twice inside read transactions.
 * The provider operation cannot be atomic with Firestore: a crash retries the
 * exact content/key inside the bounded provider idempotency retention window.
 */
export async function deliverHeldAffiliateNotification(input: {
  db: Firestore;
  intentId: string;
  verifySource: AffiliateNotificationSourceVerifier;
  env?: NodeJS.ProcessEnv;
  clock?: () => string;
  sendEmail?: typeof sendNewsletterEmail;
}): Promise<AffiliateNotificationDeliveryResult> {
  const env = { ...(input.env || process.env) };
  const mode = affiliateNotificationDeliveryGate(input.db, env);
  if (mode !== 'allowed') return { status: mode };
  // The shared transport intentionally reads process.env. A test-only injected
  // environment must never authorize a different real provider account/sender.
  const transportMatchesReview = () => Boolean(input.sendEmail) || ['RESEND_API_KEY', 'NEWSLETTER_FROM_EMAIL', 'NEWSLETTER_REPLY_TO']
    .every(key => (env[key] || '').trim() === (process.env[key] || '').trim());
  if (!transportMatchesReview()) return { status: 'blocked' };
  if (!INTENT_ID.test(input.intentId) || typeof input.verifySource !== 'function') return { status: 'ineligible' };
  const clock = input.clock || (() => new Date().toISOString());
  const id = deliveryId(input.intentId);
  const ref = input.db.collection(AFFILIATE_NOTIFICATION_DELIVERY_COLLECTION).doc(id);
  const leaseToken = crypto.randomBytes(24).toString('hex');
  const result = (status: AffiliateNotificationDeliveryResult['status']): AffiliateNotificationDeliveryResult => ({ status, deliveryId: id });
  try {
    const lease = await input.db.runTransaction(async transaction => {
      const now = clock(), nowMs = iso(now);
      if (nowMs === null || affiliateNotificationDeliveryGate(input.db, env) !== 'allowed') return 'ineligible' as const;
      const snapshot = await transaction.get(ref);
      const previous = snapshot.data();
      if (snapshot.exists && !validDelivery(previous, id)) return 'ineligible' as const;
      if (previous && TERMINAL.has(previous.status)) return 'already_processed' as const;
      if (previous?.leaseExpiresAt && iso(previous.leaseExpiresAt)! > nowMs) return 'busy' as const;
      if (previous?.nextAttemptAt && iso(previous.nextAttemptAt)! > nowMs) return 'not_due' as const;
      const loaded = await loadEligible({ ...input, transaction, env, now });
      if (!loaded || loaded === 'not_due') {
        if (!loaded && previous) {
          const { leaseToken: _token, leaseExpiresAt: _lease, nextAttemptAt: _next, ...clean } = previous;
          transaction.set(ref, { ...clean, status: 'cancelled', updatedAt: now, lastErrorCode: 'eligibility_changed' });
        }
        return loaded === 'not_due' ? 'not_due' as const : 'ineligible' as const;
      }
      const identity = {
        recipientEmailSha256: newsletterEmailIndexId(loaded.email.to), settingsRevision: loaded.review.settingsRevision,
        reviewSha256: affiliateNotificationDeliveryHash(loaded.review), contentSha256: loaded.contentSha256,
      };
      if (previous && (Object.entries(identity).some(([key, value]) => previous[key] !== value)
        || previous.intentId !== input.intentId || previous.eventId !== loaded.intent.eventId || previous.affiliateId !== loaded.intent.affiliateId)) {
        const { leaseToken: _token, leaseExpiresAt: _lease, nextAttemptAt: _next, ...clean } = previous;
        transaction.set(ref, { ...clean, status: 'cancelled', updatedAt: now, lastErrorCode: 'eligibility_changed' });
        return 'ineligible' as const;
      }
      if (previous && (previous.attemptCount >= MAX_AFFILIATE_DELIVERY_ATTEMPTS
        || previous.retryWindowExpiresAt && iso(previous.retryWindowExpiresAt)! <= nowMs)) {
        transaction.set(ref, { ...previous, status: 'dead_letter', updatedAt: now, lastErrorCode: 'retry_budget_exhausted' });
        return 'dead_letter' as const;
      }
      const next: AffiliateNotificationDeliveryRecord = {
        ...(previous || {}), schemaVersion: 1, kind: 'delivery', id, intentId: input.intentId,
        eventId: loaded.intent.eventId, affiliateId: loaded.intent.affiliateId, ...identity,
        sourceEvidenceSha256: loaded.evidenceSha256,
        initialSourceEvidenceSha256: previous?.initialSourceEvidenceSha256 || previous?.sourceEvidenceSha256 || loaded.evidenceSha256,
        status: 'leased', attemptCount: previous?.attemptCount || 0,
        createdAt: previous?.createdAt || now, updatedAt: now,
        leaseToken, leaseExpiresAt: new Date(nowMs + LEASE_MS).toISOString(),
      };
      if (snapshot.exists) transaction.set(ref, next); else transaction.create(ref, next);
      return 'leased' as const;
    });
    if (lease !== 'leased') return result(lease);
    // Re-read current configuration, approval, source, preference, and provider
    // suppression after leasing. A source reversal or opt-out cancels dispatch.
    const dispatch = await input.db.runTransaction(async transaction => {
      const now = clock(), nowMs = iso(now);
      const snapshot = await transaction.get(ref), previous = snapshot.data();
      if (nowMs === null || affiliateNotificationDeliveryGate(input.db, env) !== 'allowed' || !validDelivery(previous, id)
        || previous.status !== 'leased' || previous.leaseToken !== leaseToken || iso(previous.leaseExpiresAt)! <= nowMs) return null;
      if (previous.attemptCount >= MAX_AFFILIATE_DELIVERY_ATTEMPTS
        || previous.retryWindowExpiresAt && iso(previous.retryWindowExpiresAt)! <= nowMs) {
        transaction.set(ref, { ...previous, status: 'dead_letter', updatedAt: now, lastErrorCode: 'retry_budget_exhausted' });
        return null;
      }
      const loaded = await loadEligible({ ...input, transaction, env, now });
      if (!loaded || loaded === 'not_due' || loaded.contentSha256 !== previous.contentSha256
        || affiliateNotificationDeliveryHash(loaded.review) !== previous.reviewSha256) {
        transaction.set(ref, { ...previous, status: 'cancelled', updatedAt: now, lastErrorCode: 'eligibility_changed' });
        return null;
      }
      const cooldownRef = loaded.cooldown
        ? input.db.collection(AFFILIATE_NOTIFICATION_DELIVERY_COLLECTION).doc(`cooldown_${loaded.cooldown.key}`) : null;
      const cooldownSnapshot = cooldownRef ? await transaction.get(cooldownRef) : null;
      const cooldown = cooldownSnapshot?.data();
      if (loaded.cooldown && cooldownSnapshot?.exists && (!record(cooldown)
        || !exactKeys(cooldown, ['schemaVersion', 'kind', 'affiliateId', 'eventType', 'deliveryId', 'reservedAt', 'minimumIntervalMs'])
        || cooldown.schemaVersion !== 1 || cooldown.kind !== 'cooldown' || cooldown.affiliateId !== previous.affiliateId
        || cooldown.eventType !== 'inactivity_reminder' || iso(cooldown.reservedAt) === null
        || !Number.isSafeInteger(cooldown.minimumIntervalMs) || cooldown.minimumIntervalMs < 7 * 24 * 60 * 60 * 1_000
        || cooldown.minimumIntervalMs > 365 * 24 * 60 * 60 * 1_000
        || cooldown.deliveryId !== id && nowMs - iso(cooldown.reservedAt)! < Math.max(loaded.cooldown.minimumIntervalMs, cooldown.minimumIntervalMs))) {
        transaction.set(ref, { ...previous, status: 'cancelled', updatedAt: now, lastErrorCode: 'eligibility_changed' });
        return null;
      }
      const next: AffiliateNotificationDeliveryRecord = {
        ...previous, status: 'dispatching', attemptCount: previous.attemptCount + 1, updatedAt: now,
        // Full-document evidence can legitimately change (last login, settlement
        // status) without changing the source or rendered envelope. The trusted
        // adapter has just revalidated and transactionally pinned every current
        // backing document. Keep initial provenance and the latest verified hash.
        sourceEvidenceSha256: loaded.evidenceSha256,
        firstAttemptAt: previous.firstAttemptAt || now, lastAttemptAt: now,
        retryWindowExpiresAt: previous.retryWindowExpiresAt || new Date(nowMs + IDEMPOTENCY_WINDOW_MS).toISOString(),
      };
      transaction.set(ref, next);
      if (cooldownRef && (!cooldownSnapshot?.exists || cooldown?.deliveryId !== id)) {
        // Reserve before the non-transactional provider call. Ambiguous failures
        // are conservatively counted for cooldown; never send extra reminders.
        transaction.set(cooldownRef, { schemaVersion: 1, kind: 'cooldown', affiliateId: previous.affiliateId,
          eventType: 'inactivity_reminder', deliveryId: id, reservedAt: now, minimumIntervalMs: loaded.cooldown!.minimumIntervalMs,
        });
      }
      return {
        email: loaded.email, record: next,
        authorizationExpiresAt: Math.min(
          iso(loaded.review.expiresAt)!, loaded.source.expiresAt ? iso(loaded.source.expiresAt)! : Infinity,
          loaded.source.eventType === 'new_release' ? iso(loaded.source.occurredAt)! + AFFILIATE_RELEASE_NOTIFICATION_MAX_AGE_MS : Infinity,
        ),
      };
    });
    if (!dispatch) return result('ineligible');
    // Validation may take time under load. Never start a provider request after
    // this invocation's lease or the idempotency replay window has elapsed.
    const sendTime = iso(clock());
    if (!transportMatchesReview() || sendTime === null || sendTime >= iso(dispatch.record.leaseExpiresAt)!
      || sendTime >= iso(dispatch.record.retryWindowExpiresAt)! || sendTime >= dispatch.authorizationExpiresAt) return result('failed');
    let outcome: { providerMessageId: string };
    try {
      outcome = await (input.sendEmail || sendNewsletterEmail)({
        ...dispatch.email, idempotencyKey: `affiliate-notification-v1:${id}`, deliveryId: id,
      });
      if (!outcome || typeof outcome.providerMessageId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(outcome.providerMessageId)) throw new NewsletterProviderError('Invalid provider acknowledgement.', 503);
    } catch (error) {
      const retryable = error instanceof NewsletterProviderError && ([408, 409, 425, 429].includes(error.status) || error.status >= 500);
      const now = clock(), nowMs = iso(now);
      if (nowMs === null) return result('failed');
      const exhausted = dispatch.record.attemptCount >= MAX_AFFILIATE_DELIVERY_ATTEMPTS || iso(dispatch.record.retryWindowExpiresAt)! <= nowMs;
      const status = !retryable ? 'dead_letter' : exhausted ? 'dead_letter' : 'retry_pending';
      await input.db.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref), previous = snapshot.data();
        if (!validDelivery(previous, id) || previous.leaseToken !== leaseToken || previous.status !== 'dispatching') return;
        const { leaseToken: _token, leaseExpiresAt: _expires, ...clean } = previous;
        transaction.set(ref, { ...clean, status, updatedAt: now,
          lastErrorCode: exhausted ? 'retry_budget_exhausted' : retryable ? 'provider_retryable' : 'provider_rejected',
          ...(status === 'retry_pending' ? { nextAttemptAt: new Date(nowMs + Math.min(240, 2 ** dispatch.record.attemptCount) * 60_000).toISOString() } : {}),
        });
      });
      return result(status);
    }
    await input.db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref), previous = snapshot.data();
      if (!validDelivery(previous, id) || previous.leaseToken !== leaseToken
        || previous.providerMessageId && previous.providerMessageId !== outcome.providerMessageId) throw new Error('Delivery acknowledgement conflict.');
      const { leaseToken: _token, leaseExpiresAt: _expires, nextAttemptAt: _next, ...clean } = previous;
      transaction.set(ref, { ...clean, providerMessageId: outcome.providerMessageId,
        status: TERMINAL.has(previous.status) ? previous.status : 'accepted', updatedAt: clock(),
      });
    });
    return result('accepted');
  } catch {
    // No raw source/provider errors, recipients, tokens or credentials in results.
    // An ambiguous accepted send keeps its lease for exact-key retry/reconciliation.
    return result('failed');
  }
}

/** Verify the raw signed payload locally before any Firestore operation. Tags
 * identify a separate affiliate delivery record; provider ID and exact envelope
 * recipient are also checked, never a client-supplied email or affiliate ID.
 */
export async function reconcileAffiliateNotificationWebhook(input: {
  db: Firestore; payload: string; headers: NewsletterWebhookHeaders; webhookSecret: string;
  env?: NodeJS.ProcessEnv; clock?: () => string;
}): Promise<{ status: 'disabled' | 'blocked' | 'ignored' | 'recorded' | 'invalid' | 'failed' }> {
  const env = { ...(input.env || process.env) }, mode = affiliateNotificationDeliveryGate(input.db, env);
  if (mode !== 'allowed') return { status: mode };
  try {
    if (typeof input.payload !== 'string' || Buffer.byteLength(input.payload) > 256_000 || !input.webhookSecret?.trim()
      || input.webhookSecret !== env.RESEND_WEBHOOK_SECRET?.trim()
      || typeof input.headers?.id !== 'string' || input.headers.id.length > 200) return { status: 'invalid' };
    const event = verifyResendWebhook({ payload: input.payload, headers: input.headers, webhookSecret: input.webhookSecret });
    const outcome = newsletterOutcomeForResendEvent(event);
    if (!outcome?.deliveryId || !DELIVERY_ID.test(outcome.deliveryId)) return { status: 'ignored' };
    const now = (input.clock || (() => new Date().toISOString()))(), nowMs = iso(now);
    const eventMs = iso(event.created_at);
    if (nowMs === null || eventMs === null || eventMs > nowMs + 5 * 60_000) return { status: 'invalid' };
    const ref = input.db.collection(AFFILIATE_NOTIFICATION_DELIVERY_COLLECTION).doc(outcome.deliveryId);
    return await input.db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref), previous = snapshot.data();
      if (!snapshot.exists) return { status: 'ignored' as const };
      if (!validDelivery(previous, outcome.deliveryId!) || previous.attemptCount < 1 || !previous.firstAttemptAt
        || eventMs < iso(previous.firstAttemptAt)! - 60_000
        || previous.providerMessageId && previous.providerMessageId !== outcome.providerMessageId) return { status: 'invalid' as const };
      const recipients = 'to' in event.data ? event.data.to : undefined;
      if (!Array.isArray(recipients) || recipients.length !== 1 || typeof recipients[0] !== 'string'
        || !normalizeNewsletterEmail(recipients[0]) || newsletterEmailIndexId(normalizeNewsletterEmail(recipients[0])!) !== previous.recipientEmailSha256) return { status: 'invalid' as const };
      const severe = ['bounced', 'complained', 'suppressed'].includes(outcome.status);
      const suppressionRef = input.db.collection(AFFILIATE_NOTIFICATION_DELIVERY_COLLECTION).doc(`suppression_${previous.recipientEmailSha256}`);
      // Always read before any writes (including out-of-order/replayed events).
      const suppression = severe ? await transaction.get(suppressionRef) : null;
      const indexRef = input.db.collection('newsletter_email_index').doc(previous.recipientEmailSha256);
      const indexSnapshot = severe ? await transaction.get(indexRef) : null;
      const index = indexSnapshot?.data();
      const sharedSubscriberRef = index && index.storageVersion === 1 && index.emailHash === previous.recipientEmailSha256
        && typeof index.subscriberId === 'string' && /^sub_[A-Za-z0-9_-]{12,}$/.test(index.subscriberId)
        ? input.db.collection('newsletter_subscribers').doc(index.subscriberId) : null;
      const sharedSubscriber = sharedSubscriberRef ? await transaction.get(sharedSubscriberRef) : null;
      const subscriber = sharedSubscriber?.data();
      const preserveFailure = ['bounced', 'complained', 'suppressed', 'failed'].includes(previous.status);
      const status = severe ? outcome.status : preserveFailure || previous.status === 'delivered' && ['sent', 'failed'].includes(outcome.status)
        ? previous.status : outcome.status === 'sent' ? 'accepted' : outcome.status;
      const eventHash = affiliateNotificationDeliveryHash(input.headers.id);
      if (previous.lastWebhookEventIdSha256 === eventHash) return { status: 'recorded' as const };
      transaction.set(ref, { ...previous, status, providerMessageId: outcome.providerMessageId,
        updatedAt: now, lastWebhookAt: event.created_at, lastWebhookEventIdSha256: eventHash,
      });
      if (severe && !suppression?.exists) transaction.create(suppressionRef, {
        schemaVersion: 1, kind: 'provider_suppression', emailSha256: previous.recipientEmailSha256,
        reason: outcome.status, deliveryId: previous.id, createdAt: now,
      });
      if (severe && sharedSubscriberRef && sharedSubscriber?.exists && subscriber
        && subscriber.storageVersion === 1 && subscriber.emailIndexId === previous.recipientEmailSha256
        && typeof subscriber.email === 'string' && newsletterEmailIndexId(subscriber.email) === previous.recipientEmailSha256
        && subscriber.status !== 'suppressed') {
        transaction.set(sharedSubscriberRef, { status: 'suppressed', suppressionReason: outcome.status, updatedAt: now },
          { mergeFields: ['status', 'suppressionReason', 'updatedAt'] });
      }
      return { status: 'recorded' as const };
    });
  } catch { return { status: 'failed' }; }
}
