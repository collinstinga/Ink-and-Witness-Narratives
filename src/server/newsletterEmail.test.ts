import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildNewsletterCampaignEmail,
  buildNewsletterConfirmationEmail,
  isNewsletterProviderConfigured,
  NewsletterProviderConfigurationError,
  sendNewsletterEmail
} from './newsletterEmail.js';

const originalEnvironment = {
  key: process.env.RESEND_API_KEY,
  from: process.env.NEWSLETTER_FROM_EMAIL,
  replyTo: process.env.NEWSLETTER_REPLY_TO,
  nodeEnv: process.env.NODE_ENV
};

describe('newsletter email provider', () => {
  afterEach(() => {
    if (originalEnvironment.key === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalEnvironment.key;
    if (originalEnvironment.from === undefined) delete process.env.NEWSLETTER_FROM_EMAIL;
    else process.env.NEWSLETTER_FROM_EMAIL = originalEnvironment.from;
    if (originalEnvironment.replyTo === undefined) delete process.env.NEWSLETTER_REPLY_TO;
    else process.env.NEWSLETTER_REPLY_TO = originalEnvironment.replyTo;
    if (originalEnvironment.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnvironment.nodeEnv;
  });

  it('renders escaped confirmation content', () => {
    const email = buildNewsletterConfirmationEmail({
      name: '<Reader>',
      confirmationUrl: 'https://example.com/confirm?token=abc'
    });
    expect(email.subject).toContain('Confirm');
    expect(email.html).toContain('&lt;Reader&gt;');
    expect(email.html).not.toContain('Hello <Reader>');
  });

  it('renders a campaign without allowing raw HTML or unsafe links', () => {
    process.env.NODE_ENV = 'production';
    const email = buildNewsletterCampaignEmail({
      content: {
        subject: 'A new piece',
        body: '<script>alert(1)</script>\n\nA second paragraph.',
        ctaLabel: 'Read now',
        ctaUrl: 'javascript:alert(1)',
        coverImageUrl: 'http://insecure.example/cover.jpg'
      },
      baseUrl: 'https://ink.example',
      unsubscribeUrl: 'https://ink.example/unsubscribe?token=abc'
    });
    expect(email.html).toContain('&lt;script&gt;');
    expect(email.html).not.toContain('javascript:');
    expect(email.html).not.toContain('insecure.example');
    expect(email.html).toContain('Manage or unsubscribe');
  });

  it('fails closed when the provider is not configured', async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.NEWSLETTER_FROM_EMAIL;
    expect(isNewsletterProviderConfigured()).toBe(false);
    await expect(sendNewsletterEmail({
      to: 'reader@example.com',
      subject: 'Subject',
      html: '<p>Body</p>',
      text: 'Body',
      idempotencyKey: 'test'
    })).rejects.toBeInstanceOf(NewsletterProviderConfigurationError);
  });

  it('sends through the server-side provider with an idempotency key', async () => {
    process.env.RESEND_API_KEY = 're_test';
    process.env.NEWSLETTER_FROM_EMAIL = 'Ink & Witness <updates@example.com>';
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer re_test');
      expect(headers['Idempotency-Key']).toBe('campaign-1-subscriber-1');
      const body = JSON.parse(String(init?.body));
      expect(body.to).toEqual(['reader@example.com']);
      return new Response(JSON.stringify({ id: 'email_123' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }) as typeof fetch;

    await expect(sendNewsletterEmail({
      to: 'reader@example.com',
      subject: 'Subject',
      html: '<p>Body</p>',
      text: 'Body',
      idempotencyKey: 'campaign-1-subscriber-1',
      fetchImpl
    })).resolves.toEqual({ providerMessageId: 'email_123' });
  });
});
