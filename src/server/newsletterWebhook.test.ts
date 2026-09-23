import crypto from 'crypto';
import { describe, expect, it } from 'vitest';
import {
  newsletterOutcomeForResendEvent,
  verifyResendWebhook
} from './newsletterWebhook.js';

function signedWebhook(payload: string) {
  const key = Buffer.from('newsletter-webhook-test-secret');
  const webhookSecret = `whsec_${key.toString('base64')}`;
  const id = 'evt_newsletter_test';
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = crypto
    .createHmac('sha256', key)
    .update(`${id}.${timestamp}.${payload}`)
    .digest('base64');
  return {
    webhookSecret,
    headers: { id, timestamp, signature: `v1,${signature}` }
  };
}

describe('newsletter webhook verification', () => {
  it('verifies the raw payload before returning an event', () => {
    const payload = JSON.stringify({
      type: 'email.delivered',
      created_at: new Date().toISOString(),
      data: {
        email_id: 'email_123',
        message_id: 'message_123',
        created_at: new Date().toISOString(),
        from: 'updates@example.com',
        to: ['reader@example.com'],
        subject: 'A new piece',
        tags: {
          delivery_id: 'nld_0123456789abcdef0123456789abcdef0123456789abcdef'
        }
      }
    });
    const signed = signedWebhook(payload);
    const event = verifyResendWebhook({ payload, ...signed });
    expect(event.type).toBe('email.delivered');
    expect(() => verifyResendWebhook({ payload: `${payload} `, ...signed })).toThrow();
  });

  it('maps delivery and suppression events without trusting recipient input', () => {
    const base = {
      created_at: new Date().toISOString(),
      data: {
        email_id: 'email_456',
        message_id: 'message_456',
        created_at: new Date().toISOString(),
        from: 'updates@example.com',
        to: ['reader@example.com'],
        subject: 'A new piece',
        tags: {
          delivery_id: 'nld_0123456789abcdef0123456789abcdef0123456789abcdef'
        }
      }
    };
    expect(newsletterOutcomeForResendEvent({
      ...base,
      type: 'email.delivered'
    })).toEqual({
      providerMessageId: 'email_456',
      deliveryId: 'nld_0123456789abcdef0123456789abcdef0123456789abcdef',
      status: 'delivered'
    });
    expect(newsletterOutcomeForResendEvent({
      ...base,
      type: 'email.complained'
    })).toMatchObject({ providerMessageId: 'email_456', status: 'complained' });
  });
});
