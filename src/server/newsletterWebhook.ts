import { Resend, type WebhookEventPayload } from 'resend';
import type { NewsletterDeliveryStatus } from '../types.js';

// Resend currently requires a constructor key even though signature
// verification is entirely local and uses the per-webhook signing secret.
const verifier = new Resend('local-webhook-verifier');

export interface NewsletterWebhookHeaders {
  id: string;
  timestamp: string;
  signature: string;
}

export interface NewsletterWebhookOutcome {
  providerMessageId: string;
  deliveryId?: string;
  status: Exclude<NewsletterDeliveryStatus, 'queued'>;
  error?: string;
}

export function verifyResendWebhook(options: {
  payload: string;
  headers: NewsletterWebhookHeaders;
  webhookSecret: string;
}): WebhookEventPayload {
  return verifier.webhooks.verify(options);
}

export function newsletterOutcomeForResendEvent(
  event: WebhookEventPayload
): NewsletterWebhookOutcome | null {
  if (!event.type.startsWith('email.')) return null;
  if (!('email_id' in event.data) || typeof event.data.email_id !== 'string') return null;
  const providerMessageId = event.data.email_id.trim();
  if (!providerMessageId || providerMessageId.length > 200) return null;
  const deliveryId = 'tags' in event.data ? event.data.tags?.delivery_id : undefined;
  const deliveryReference = typeof deliveryId === 'string'
    && /^nld_[a-f0-9]{48}$/.test(deliveryId)
    ? { deliveryId }
    : {};

  switch (event.type) {
    case 'email.sent':
      return { providerMessageId, ...deliveryReference, status: 'sent' };
    case 'email.delivered':
      return { providerMessageId, ...deliveryReference, status: 'delivered' };
    case 'email.bounced':
      return {
        providerMessageId,
        ...deliveryReference,
        status: 'bounced',
        error: event.data.bounce?.message || 'The recipient address bounced.'
      };
    case 'email.complained':
      return {
        providerMessageId,
        ...deliveryReference,
        status: 'complained',
        error: 'The recipient reported this email as spam.'
      };
    case 'email.failed':
      return {
        providerMessageId,
        ...deliveryReference,
        status: 'failed',
        error: event.data.failed?.reason || 'The email provider reported delivery failure.'
      };
    case 'email.suppressed':
      return {
        providerMessageId,
        ...deliveryReference,
        status: 'suppressed',
        error: event.data.suppressed?.message || 'The provider suppressed this recipient.'
      };
    default:
      return null;
  }
}
