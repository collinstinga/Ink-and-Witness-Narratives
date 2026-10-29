import crypto from 'crypto';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import type { AffiliatePartnerEmailCampaign, AffiliatePartnerEmailInput, AffiliatePartnerEmailOverview,
  AffiliatePartnerEmailRecipient, AffiliatePartnerEmailPreview, AffiliatePartnerEmailStep } from '../types/affiliatePartnerEmail.js';
import { getFirestoreClientTarget, type FirestoreTargetConfig } from './db.js';
import { hasValidAffiliateWriterApproval } from './affiliateApproval.js';
import { normalizeAffiliateNotificationPreferences } from './affiliateNotificationPreferences.js';
import { createAffiliateMarketingOptOutToken } from './affiliateNotificationSecurity.js';
import { normalizeNewsletterEmail, newsletterEmailIndexId } from './newsletterSecurity.js';
import { buildNewsletterCampaignEmail, NewsletterProviderConfigurationError, NewsletterProviderError, sendNewsletterEmail } from './newsletterEmail.js';
import type { NewsletterWebhookOutcome } from './newsletterWebhook.js';

export const PARTNER_EMAIL_CAMPAIGNS = 'affiliate_partner_email_campaigns';
export const PARTNER_EMAIL_DELIVERIES = 'affiliate_partner_email_deliveries';
const MAX_RECIPIENTS = 200, BATCH_SIZE = 5, LEASE_MS = 120_000;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/;
const CAMPAIGN_ID = /^apc_[a-f0-9]{48}$/;
const REQUEST_ID = /^[A-Za-z0-9_-]{16,80}$/;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const record = (value: unknown): value is Record<string, any> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const digest = (value: unknown) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const deliveryId = (campaign: string, affiliateId: string) => `nld_${digest(['partner-email', campaign, affiliateId]).slice(0, 48)}`;
type Recipient = { id: string; name: string; email: string };
type StoredCampaign = AffiliatePartnerEmailCampaign & { schemaVersion: 1; contentHash: string; createdBy: string;
  recipients: Recipient[]; baseUrl: string; fromEmail: string; nextIndex: number; leaseToken?: string; leaseUntil?: number };
type Delivery = { schemaVersion: 1; kind: 'manual_partner_email'; id: string; campaignId: string; affiliateId: string;
  emailHash: string; status: 'queued' | 'dispatching' | 'accepted' | 'excluded' | 'failed' | 'uncertain';
  createdAt: string; updatedAt: string; providerMessageId?: string; outcome?: string; lastWebhookHash?: string };

export class AffiliatePartnerEmailError extends Error {
  constructor(readonly statusCode: number, message: string) { super(message); this.name = 'AffiliatePartnerEmailError'; }
}

export function validateAffiliatePartnerEmailInput(value: unknown, withRequestId = false): AffiliatePartnerEmailInput & { requestId?: string } {
  const allowed = ['subject', 'body', 'audience', 'affiliateIds', ...(withRequestId ? ['requestId'] : [])];
  if (!record(value) || Object.keys(value).some(key => !allowed.includes(key))
    || typeof value.subject !== 'string' || !value.subject.trim() || value.subject.trim().length > 200 || /[\r\n]/.test(value.subject) || CONTROL.test(value.subject)
    || typeof value.body !== 'string' || !value.body.trim() || value.body.trim().length > 12_000 || CONTROL.test(value.body)
    || !['all', 'selected'].includes(value.audience) || !Array.isArray(value.affiliateIds) || value.affiliateIds.length > MAX_RECIPIENTS
    || value.affiliateIds.some((id: unknown) => typeof id !== 'string' || !ID.test(id))
    || (withRequestId && (typeof value.requestId !== 'string' || !REQUEST_ID.test(value.requestId)))) {
    throw new AffiliatePartnerEmailError(400, 'Enter a subject (up to 200 characters), message (up to 12,000 characters), and a valid partner audience.');
  }
  const affiliateIds = [...new Set(value.affiliateIds as string[])].sort();
  if ((value.audience === 'selected' && !affiliateIds.length) || (value.audience === 'all' && affiliateIds.length)) {
    throw new AffiliatePartnerEmailError(400, 'Choose at least one partner, or select all eligible partners.');
  }
  return { subject: value.subject.trim(), body: value.body.trim().replace(/\r\n/g, '\n'), audience: value.audience,
    affiliateIds, ...(withRequestId ? { requestId: value.requestId } : {}) };
}

/** Native production only. A preview with copied secrets must never send to real partners. */
export function affiliatePartnerEmailConfiguration(db: Firestore, env: NodeJS.ProcessEnv,
  target = getFirestoreClientTarget(db)): { baseUrl: string; fromEmail: string; secret: string } | null {
  if (env.VERCEL_ENV !== 'production' || target?.projectId !== 'ink-and-witness-narratives'
    || target.firestoreDatabaseId !== '(default)' || env.FIRESTORE_EMULATOR_HOST || env.FIREBASE_AUTH_EMULATOR_HOST
    || !env.RESEND_API_KEY?.trim() || !env.RESEND_WEBHOOK_SECRET?.trim()
    || (env.AFFILIATE_NOTIFICATION_SIGNING_SECRET || '').trim().length < 32) return null;
  const fromEmail = (env.NEWSLETTER_FROM_EMAIL || '').trim();
  if (!fromEmail || /[\r\n]/.test(fromEmail)) return null;
  try {
    const url = new URL(env.AFFILIATE_NOTIFICATION_PRODUCTION_BASE_URL || '');
    if (url.protocol !== 'https:' || !['inkandwitness-narratives.co.ke', 'www.inkandwitness-narratives.co.ke'].includes(url.hostname)
      || url.username || url.password || url.port || url.search || url.hash || url.pathname !== '/') return null;
    return { baseUrl: url.origin, fromEmail, secret: env.AFFILIATE_NOTIFICATION_SIGNING_SECRET!.trim() };
  } catch { return null; }
}

async function suppressed(db: Firestore, tx: Transaction, email: string): Promise<boolean> {
  const hash = newsletterEmailIndexId(email);
  const [block, index] = await tx.getAll(db.collection('affiliate_notification_deliveries').doc(`suppression_${hash}`),
    db.collection('newsletter_email_index').doc(hash));
  if (block.exists) return true;
  if (!index.exists) return false;
  const row = index.data();
  if (!row || row.storageVersion !== 1 || row.emailHash !== hash || typeof row.subscriberId !== 'string'
    || !/^sub_[A-Za-z0-9_-]{12,}$/.test(row.subscriberId)) return true;
  const subscriber = await tx.get(db.collection('newsletter_subscribers').doc(row.subscriberId)), data = subscriber.data();
  return !subscriber.exists || !data || data.storageVersion !== 1 || data.email !== email || data.emailIndexId !== hash
    || !['active', 'pending', 'unsubscribed'].includes(data.status);
}

function eligibility(value: unknown): string | null {
  if (!record(value) || value.status !== 'active' || !hasValidAffiliateWriterApproval(value)) return 'Partner approval is inactive or missing.';
  if (value.acceptedTerms !== true) return 'Partner terms have not been accepted.';
  if (!normalizeNewsletterEmail(value.email)) return 'A valid email address is missing.';
  const preferences = normalizeAffiliateNotificationPreferences(value.notificationPreferences);
  if (preferences.marketingConsent !== 'granted' || preferences.allMarketingOptOut) return 'Partner has not opted into marketing emails.';
  if (!preferences.campaignUpdates) return 'Partner has disabled campaign emails.';
  return null;
}

async function audience(db: Firestore, tx: Transaction, input?: AffiliatePartnerEmailInput): Promise<AffiliatePartnerEmailRecipient[]> {
  const snapshot = await tx.get(db.collection('affiliates').limit(MAX_RECIPIENTS + 1));
  if (snapshot.docs.length > MAX_RECIPIENTS) throw new AffiliatePartnerEmailError(409, 'The partner list exceeds the safe audience limit. Choose a reviewed larger-audience delivery.');
  const selected = input?.audience === 'selected' ? new Set(input.affiliateIds) : null;
  const seen = new Set<string>(), rows: AffiliatePartnerEmailRecipient[] = [];
  for (const document of [...snapshot.docs].sort((a, b) => a.id.localeCompare(b.id))) {
    if (selected && !selected.has(document.id)) continue;
    if (!ID.test(document.id)) throw new AffiliatePartnerEmailError(503, 'Partner identities could not be checked safely.');
    const value = document.data(), email = normalizeNewsletterEmail(value?.email) || '';
    let reason = eligibility(value);
    if (!reason && await suppressed(db, tx, email)) reason = 'Email delivery is suppressed for this address.';
    if (!reason && seen.has(email)) reason = 'Another eligible partner uses this email; one email per address.';
    if (!reason) seen.add(email);
    rows.push({ id: document.id, name: typeof value?.name === 'string' ? value.name.slice(0, 160) : 'Literary Partner',
      email, eligible: !reason, ...(reason ? { reason } : {}) });
  }
  if (selected && rows.length !== selected.size) throw new AffiliatePartnerEmailError(409, 'A selected partner no longer exists. Refresh the partner list.');
  return rows;
}

const publicCampaign = (row: StoredCampaign): AffiliatePartnerEmailCampaign => ({
  id: row.id, subject: row.subject, body: row.body, audience: row.audience, affiliateIds: [...row.affiliateIds], status: row.status,
  eligibleCount: row.eligibleCount, sentCount: row.sentCount, failedCount: row.failedCount, createdAt: row.createdAt,
  excludedCount: row.excludedCount || 0, remainingCount: row.remainingCount || 0, uncertainCount: row.uncertainCount || 0,
});
function validCampaign(value: unknown, id: string): value is StoredCampaign {
  if (!record(value)) return false;
  let content: AffiliatePartnerEmailInput;
  try { content = validateAffiliatePartnerEmailInput({ subject: value.subject, body: value.body, audience: value.audience, affiliateIds: value.affiliateIds }); }
  catch { return false; }
  return value.schemaVersion === 1 && value.id === id && CAMPAIGN_ID.test(id)
    && typeof value.contentHash === 'string' && /^[a-f0-9]{64}$/.test(value.contentHash)
    && digest(content) === value.contentHash
    && Array.isArray(value.recipients) && value.recipients.length > 0 && value.recipients.length <= MAX_RECIPIENTS
    && value.recipients.every((r: any) => record(r) && ID.test(r.id) && normalizeNewsletterEmail(r.email) === r.email && typeof r.name === 'string')
    && new Set(value.recipients.map((r: Recipient) => r.email)).size === value.recipients.length
    && new Set(value.recipients.map((r: Recipient) => r.id)).size === value.recipients.length
    && Number.isSafeInteger(value.nextIndex) && value.nextIndex >= 0 && value.nextIndex <= value.recipients.length
    && ['eligibleCount', 'sentCount', 'failedCount', 'excludedCount', 'remainingCount', 'uncertainCount'].every(key => Number.isSafeInteger(value[key]) && value[key] >= 0)
    && value.eligibleCount === value.recipients.length && value.remainingCount === value.recipients.length - value.nextIndex
    && typeof value.createdAt === 'string' && Number.isFinite(Date.parse(value.createdAt));
}

export class AffiliatePartnerEmailStore {
  constructor(private readonly deps: { db: () => Firestore; env?: () => NodeJS.ProcessEnv; now?: () => number;
    sendEmail?: typeof sendNewsletterEmail; target?: (db: Firestore) => FirestoreTargetConfig | null }) {}
  private now() { return this.deps.now?.() ?? Date.now(); }
  private config(db: Firestore) { return affiliatePartnerEmailConfiguration(db, this.deps.env?.() ?? process.env,
    (this.deps.target || getFirestoreClientTarget)(db)); }

  async overview(): Promise<AffiliatePartnerEmailOverview> {
    const db = this.deps.db();
    const [recipients, snapshots] = await Promise.all([
      db.runTransaction(tx => audience(db, tx), { readOnly: true }),
      db.collection(PARTNER_EMAIL_CAMPAIGNS).orderBy('createdAt', 'desc').limit(30).get(),
    ]);
    return { providerConfigured: Boolean(this.config(db)), recipients,
      campaigns: snapshots.docs.filter(doc => validCampaign(doc.data(), doc.id)).map(doc => publicCampaign(doc.data() as StoredCampaign)) };
  }

  async preview(value: unknown): Promise<AffiliatePartnerEmailPreview> {
    const input = validateAffiliatePartnerEmailInput(value), db = this.deps.db();
    const rows = await db.runTransaction(tx => audience(db, tx, input), { readOnly: true });
    return { eligible: rows.filter(r => r.eligible).length, excluded: rows.filter(r => !r.eligible).length, total: rows.length };
  }

  async create(value: unknown, actorValue: string): Promise<AffiliatePartnerEmailCampaign> {
    const input = validateAffiliatePartnerEmailInput(value, true), actor = normalizeNewsletterEmail(actorValue);
    if (!actor) throw new AffiliatePartnerEmailError(403, 'An authenticated writer is required.');
    const db = this.deps.db(), config = this.config(db);
    if (!config) throw new AffiliatePartnerEmailError(503, 'Partner email sending is available only on the configured live website.');
    const id = `apc_${digest([actor, input.requestId]).slice(0, 48)}`;
    const content: AffiliatePartnerEmailInput = { subject: input.subject, body: input.body, audience: input.audience, affiliateIds: input.affiliateIds };
    const contentHash = digest(content), ref = db.collection(PARTNER_EMAIL_CAMPAIGNS).doc(id), now = new Date(this.now()).toISOString();
    return db.runTransaction(async tx => {
      const existing = await tx.get(ref);
      if (existing.exists) {
        const row = existing.data();
        if (!validCampaign(row, id) || row.createdBy !== actor || row.contentHash !== contentHash) throw new AffiliatePartnerEmailError(409, 'This email request was already used for different content. Refresh before composing another email.');
        return publicCampaign(row);
      }
      const rows = await audience(db, tx, content), recipients = rows.filter(r => r.eligible).map(({ id, email, name }) => ({ id, email, name }));
      if (!recipients.length) throw new AffiliatePartnerEmailError(409, 'No partners are eligible. Partners must opt into campaign emails in their dashboard.');
      const row: StoredCampaign = { schemaVersion: 1, ...content, id, contentHash, createdBy: actor, recipients,
        baseUrl: config.baseUrl, fromEmail: config.fromEmail, nextIndex: 0, status: 'draft', createdAt: now,
        eligibleCount: recipients.length, remainingCount: recipients.length, excludedCount: rows.length - recipients.length,
        sentCount: 0, failedCount: 0, uncertainCount: 0 };
      tx.create(ref, row);
      for (const recipient of recipients) {
        const key = deliveryId(id, recipient.id);
        tx.create(db.collection(PARTNER_EMAIL_DELIVERIES).doc(key), { schemaVersion: 1, kind: 'manual_partner_email', id: key,
          campaignId: id, affiliateId: recipient.id, emailHash: newsletterEmailIndexId(recipient.email), status: 'queued', createdAt: now, updatedAt: now } satisfies Delivery);
      }
      tx.create(db.collection('affiliate_audit').doc(`partner_email_created_${id}`), { id: `partner_email_created_${id}`, timestamp: now,
        actor, action: 'partner_email_campaign_created', targetType: 'campaign', targetId: id,
        summary: `Prepared a manual partner email for ${recipients.length} eligible addresses.` });
      return publicCampaign(row);
    });
  }

  async send(id: string, actorValue: string): Promise<AffiliatePartnerEmailStep> {
    if (!CAMPAIGN_ID.test(id)) throw new AffiliatePartnerEmailError(400, 'Choose a valid partner email.');
    const actor = normalizeNewsletterEmail(actorValue);
    if (!actor) throw new AffiliatePartnerEmailError(403, 'An authenticated writer is required.');
    const db = this.deps.db(), config = this.config(db);
    if (!config) throw new AffiliatePartnerEmailError(503, 'Email sending is disabled here. Open the live website.');
    const ref = db.collection(PARTNER_EMAIL_CAMPAIGNS).doc(id), leaseToken = crypto.randomBytes(24).toString('hex');
    let campaign = await db.runTransaction(async tx => {
      const snapshot = await tx.get(ref), row = snapshot.data();
      if (!validCampaign(row, id)) throw new AffiliatePartnerEmailError(404, 'Partner email was not found.');
      if (row.baseUrl !== config.baseUrl || row.fromEmail !== config.fromEmail) throw new AffiliatePartnerEmailError(409, 'Email sender settings changed. Prepare a new email instead of resending this campaign.');
      if (!row.remainingCount) return row;
      if (row.leaseUntil && row.leaseUntil > this.now()) throw new AffiliatePartnerEmailError(409, 'This email is already being sent. Refresh its status shortly.');
      tx.update(ref, { leaseToken, leaseUntil: this.now() + LEASE_MS, status: 'sending' });
      return { ...row, leaseToken, leaseUntil: this.now() + LEASE_MS, status: 'sending' as const };
    });
    if (!campaign.remainingCount) return { campaign: publicCampaign(campaign), complete: true };
    try {
      for (let step = 0; step < BATCH_SIZE && campaign.remainingCount; step++) {
        const activeConfig = this.config(db);
        if (!activeConfig || activeConfig.baseUrl !== campaign.baseUrl || activeConfig.fromEmail !== campaign.fromEmail || activeConfig.secret !== config.secret) {
          throw new AffiliatePartnerEmailError(409, 'Email settings changed while sending. Refresh status before continuing.');
        }
        const prepared = await db.runTransaction(async tx => {
          const snapshot = await tx.get(ref), row = snapshot.data();
          if (!validCampaign(row, id) || row.leaseToken !== leaseToken || !row.leaseUntil || row.leaseUntil <= this.now()) throw new AffiliatePartnerEmailError(409, 'The email session expired. Refresh status before continuing.');
          const recipient = row.recipients[row.nextIndex], key = deliveryId(id, recipient.id), deliveryRef = db.collection(PARTNER_EMAIL_DELIVERIES).doc(key);
          const [deliverySnapshot, affiliateSnapshot] = await tx.getAll(deliveryRef, db.collection('affiliates').doc(recipient.id));
          const item = deliverySnapshot.data() as Delivery | undefined, affiliate = affiliateSnapshot.data();
          if (!item || item.kind !== 'manual_partner_email' || item.id !== key || item.campaignId !== id || item.affiliateId !== recipient.id
            || item.emailHash !== newsletterEmailIndexId(recipient.email)) throw new AffiliatePartnerEmailError(409, 'This email delivery requires investigation before continuing.');
          let reason = eligibility(affiliate);
          if (normalizeNewsletterEmail(affiliate?.email) !== recipient.email) reason = 'Partner email changed after this campaign was prepared.';
          if (!reason && await suppressed(db, tx, recipient.email)) reason = 'Email delivery is suppressed for this address.';
          if (item.status !== 'queued') {
            // A process can die after provider acceptance. Never resend a
            // dispatching/uncertain recipient, even after the provider key expires.
            const outcome = ['accepted', 'failed', 'excluded', 'uncertain'].includes(item.status) ? item.status : 'uncertain';
            const next = this.advance(row, outcome as Delivery['status']);
            if (item.status === 'dispatching') tx.update(deliveryRef, { status: 'uncertain', updatedAt: new Date(this.now()).toISOString() });
            tx.update(ref, next); return { campaign: { ...row, ...next } as StoredCampaign };
          }
          if (reason) {
            const next = this.advance(row, 'excluded');
            tx.update(deliveryRef, { status: 'excluded', updatedAt: new Date(this.now()).toISOString() }); tx.update(ref, next);
            return { campaign: { ...row, ...next } as StoredCampaign };
          }
          tx.update(deliveryRef, { status: 'dispatching', updatedAt: new Date(this.now()).toISOString() });
          return { campaign: row, recipient, key };
        });
        campaign = prepared.campaign;
        if (!('recipient' in prepared) || !prepared.recipient) continue;
        const { recipient, key } = prepared;
        const unsubscribeUrl = `${config.baseUrl}/affiliate/notifications/unsubscribe?token=${encodeURIComponent(createAffiliateMarketingOptOutToken(recipient.id, config.secret))}`;
        const email = buildNewsletterCampaignEmail({ content: { subject: campaign.subject, heading: campaign.subject, body: campaign.body },
          recipientName: recipient.name, baseUrl: config.baseUrl, unsubscribeUrl });
        let status: Delivery['status'] = 'accepted', providerMessageId: string | undefined;
        try {
          const result = await (this.deps.sendEmail || sendNewsletterEmail)({ to: recipient.email, ...email, unsubscribeUrl,
            deliveryId: key, idempotencyKey: `manual-partner-email-${key}` });
          providerMessageId = result.providerMessageId;
        } catch (error) {
          // Definitive rejection and ambiguous acceptance are both terminal.
          // An owner can inspect provider history; a retry cannot duplicate mail.
          status = error instanceof NewsletterProviderConfigurationError || (error instanceof NewsletterProviderError
            && error.status >= 400 && error.status < 500 && ![408, 409, 425].includes(error.status)) ? 'failed' : 'uncertain';
        }
        campaign = await db.runTransaction(async tx => {
          const [snapshot, deliverySnapshot] = await tx.getAll(ref, db.collection(PARTNER_EMAIL_DELIVERIES).doc(key));
          const row = snapshot.data(), item = deliverySnapshot.data() as Delivery | undefined;
          if (!validCampaign(row, id) || row.leaseToken !== leaseToken || !item || row.recipients[row.nextIndex]?.id !== recipient.id) throw new AffiliatePartnerEmailError(409, 'Delivery status is uncertain. Refresh the campaign before continuing.');
          if (providerMessageId && item.providerMessageId && providerMessageId !== item.providerMessageId) throw new AffiliatePartnerEmailError(409, 'Provider delivery identity changed. Refresh the campaign before continuing.');
          // A signature-verified webhook may arrive before the request returns.
          // Its provider identity proves acceptance even if that response times out.
          const effectiveStatus = item.providerMessageId && item.outcome ? 'accepted' : status;
          const confirmedId = item.providerMessageId || providerMessageId;
          const next = this.advance(row, effectiveStatus), updatedAt = new Date(this.now()).toISOString();
          tx.update(db.collection(PARTNER_EMAIL_DELIVERIES).doc(key), { status: effectiveStatus, updatedAt, ...(confirmedId ? { providerMessageId: confirmedId } : {}) });
          tx.update(ref, next); return { ...row, ...next };
        });
      }
    } finally {
      await db.runTransaction(async tx => {
        const snapshot = await tx.get(ref), row = snapshot.data();
        if (!validCampaign(row, id) || row.leaseToken !== leaseToken) return;
        const status: AffiliatePartnerEmailCampaign['status'] = row.remainingCount ? 'paused' : row.failedCount || row.uncertainCount || row.excludedCount ? 'partially_sent' : 'sent';
        tx.update(ref, { leaseToken: '', leaseUntil: 0, status });
        campaign = { ...row, leaseToken: '', leaseUntil: 0, status };
        tx.create(db.collection('affiliate_audit').doc(`partner_email_batch_${id}_${leaseToken}`), {
          id: `partner_email_batch_${id}_${leaseToken}`, timestamp: new Date(this.now()).toISOString(), actor,
          action: 'partner_email_campaign_batch', targetType: 'campaign', targetId: id,
          summary: `Provider accepted ${row.sentCount}; failed ${row.failedCount}; uncertain ${row.uncertainCount}; remaining ${row.remainingCount}.`,
        });
      });
    }
    return { campaign: publicCampaign(campaign), complete: !campaign.remainingCount };
  }

  private advance(row: StoredCampaign, status: Delivery['status']) {
    return { nextIndex: row.nextIndex + 1, remainingCount: Math.max(0, (row.remainingCount || 0) - 1),
      sentCount: row.sentCount + (status === 'accepted' ? 1 : 0), failedCount: row.failedCount + (status === 'failed' ? 1 : 0),
      excludedCount: (row.excludedCount || 0) + (status === 'excluded' ? 1 : 0), uncertainCount: (row.uncertainCount || 0) + (status === 'uncertain' ? 1 : 0) };
  }
}

/** Call only with the existing signature-verified Resend outcome. New manual
 * emails share suppression with automated partner and newsletter delivery. */
export async function reconcileAffiliatePartnerEmailWebhook(input: { db: Firestore; outcome: NewsletterWebhookOutcome; eventId: string; now?: string }): Promise<boolean> {
  const { db, outcome } = input;
  if (!outcome.deliveryId || !/^nld_[a-f0-9]{48}$/.test(outcome.deliveryId)) return false;
  const ref = db.collection(PARTNER_EMAIL_DELIVERIES).doc(outcome.deliveryId), now = input.now || new Date().toISOString();
  return db.runTransaction(async tx => {
    const snapshot = await tx.get(ref), row = snapshot.data() as Delivery | undefined;
    if (!row || row.schemaVersion !== 1 || row.kind !== 'manual_partner_email' || row.id !== outcome.deliveryId
      || !CAMPAIGN_ID.test(row.campaignId) || !ID.test(row.affiliateId) || !/^[a-f0-9]{64}$/.test(row.emailHash)
      || deliveryId(row.campaignId, row.affiliateId) !== row.id
      || (row.providerMessageId && row.providerMessageId !== outcome.providerMessageId)
      || !['dispatching', 'uncertain', 'accepted'].includes(row.status)) return false;
    const eventHash = digest(input.eventId);
    if (row.lastWebhookHash === eventHash) return true;
    const campaignRef = db.collection(PARTNER_EMAIL_CAMPAIGNS).doc(row.campaignId);
    const campaignSnapshot = row.status === 'uncertain' ? await tx.get(campaignRef) : null;
    const campaign = campaignSnapshot?.data();
    const severe = ['bounced', 'complained', 'suppressed'].includes(outcome.status);
    const suppressionRef = db.collection('affiliate_notification_deliveries').doc(`suppression_${row.emailHash}`);
    const block = severe ? await tx.get(suppressionRef) : null;
    const index = severe ? await tx.get(db.collection('newsletter_email_index').doc(row.emailHash)) : null;
    const indexRow = index?.data();
    const subscriberRef = indexRow?.storageVersion === 1 && indexRow.emailHash === row.emailHash && typeof indexRow.subscriberId === 'string'
      && /^sub_[A-Za-z0-9_-]{12,}$/.test(indexRow.subscriberId) ? db.collection('newsletter_subscribers').doc(indexRow.subscriberId) : null;
    const subscriber = subscriberRef ? await tx.get(subscriberRef) : null;
    tx.update(ref, { ...(row.status === 'uncertain' ? { status: 'accepted' } : {}), providerMessageId: outcome.providerMessageId, outcome: row.outcome && ['bounced', 'complained', 'suppressed', 'failed'].includes(row.outcome)
      ? row.outcome : outcome.status, lastWebhookHash: eventHash, updatedAt: now });
    if (row.status === 'uncertain' && validCampaign(campaign, row.campaignId) && (campaign.uncertainCount || 0) > 0) {
      const uncertainCount = campaign.uncertainCount! - 1;
      tx.update(campaignRef, { uncertainCount, sentCount: campaign.sentCount + 1,
        ...(!campaign.remainingCount ? { status: campaign.failedCount || uncertainCount || campaign.excludedCount ? 'partially_sent' : 'sent' } : {}) });
    }
    if (severe && !block?.exists) tx.create(suppressionRef, { schemaVersion: 1, kind: 'provider_suppression', emailSha256: row.emailHash,
      reason: outcome.status, createdAt: now, updatedAt: now });
    if (severe && subscriberRef && subscriber?.exists && subscriber.data()?.emailIndexId === row.emailHash) {
      tx.update(subscriberRef, { status: 'suppressed', suppressionReason: outcome.status, updatedAt: now });
    }
    return true;
  });
}
