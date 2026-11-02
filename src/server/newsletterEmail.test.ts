import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildNewsletterCampaignEmail,
  buildNewsletterConfirmationEmail,
  buildReaderPasswordResetEmail,
  isRetryableNewsletterProviderError,
  isNewsletterProviderConfigured,
  getAffiliateEmailReplyTo,
  NewsletterProviderConfigurationError,
  NewsletterProviderError,
  sendNewsletterEmail
} from './newsletterEmail.js';

const originalEnvironment = {
  key: process.env.RESEND_API_KEY,
  from: process.env.NEWSLETTER_FROM_EMAIL,
  replyTo: process.env.NEWSLETTER_REPLY_TO,
  affiliateReplyTo: process.env.AFFILIATE_EMAIL_REPLY_TO,
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
    if (originalEnvironment.affiliateReplyTo === undefined) delete process.env.AFFILIATE_EMAIL_REPLY_TO;
    else process.env.AFFILIATE_EMAIL_REPLY_TO = originalEnvironment.affiliateReplyTo;
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

  it('builds a one-time reader password reset email without exposing credentials', () => {
    const email = buildReaderPasswordResetEmail({
      name: 'Amina <Reader>',
      resetUrl: 'https://www.inkandwitness-narratives.co.ke/password-reset?token=pr1_safe-token',
      expiresInMinutes: 60
    });

    expect(email.subject).toContain('Reset');
    expect(email.html).toContain('Choose a new password');
    expect(email.html).toContain('Amina &lt;Reader&gt;');
    expect(email.html).toContain('https://www.inkandwitness-narratives.co.ke/password-reset?token=pr1_safe-token');
    expect(email.text).toContain('works once');
    expect(email.text).not.toContain('temporary password');
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
      expect(body.tags).toEqual([{
        name: 'delivery_id',
        value: 'nld_0123456789abcdef0123456789abcdef0123456789abcdef'
      }]);
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
      deliveryId: 'nld_0123456789abcdef0123456789abcdef0123456789abcdef',
      fetchImpl
    })).resolves.toEqual({ providerMessageId: 'email_123' });
  });

  it('keeps transient provider failures retryable at the same delivery checkpoint', () => {
    expect(isRetryableNewsletterProviderError(new NewsletterProviderError('domain is not verified', 403))).toBe(true);
    expect(isRetryableNewsletterProviderError(new NewsletterProviderError('rate limited', 429))).toBe(true);
    expect(isRetryableNewsletterProviderError(new NewsletterProviderError('provider unavailable', 503))).toBe(true);
    expect(isRetryableNewsletterProviderError(new NewsletterProviderError('bad recipient', 422))).toBe(false);
  });

  it('resolves a scoped affiliate reply address without changing the shared newsletter default', () => {
    const env = { AFFILIATE_EMAIL_REPLY_TO: '  Partner.Replies@Example.Test  ', NEWSLETTER_REPLY_TO: 'Legacy Writer <legacy@example.test>' };
    expect(getAffiliateEmailReplyTo(env)).toBe('partner.replies@example.test');
    expect(getAffiliateEmailReplyTo({ ...env, AFFILIATE_EMAIL_REPLY_TO: '' })).toBe(env.NEWSLETTER_REPLY_TO);
    expect(getAffiliateEmailReplyTo({ NEWSLETTER_REPLY_TO: env.NEWSLETTER_REPLY_TO })).toBe(env.NEWSLETTER_REPLY_TO);
    expect(getAffiliateEmailReplyTo({})).toBeUndefined();
    expect(env.NEWSLETTER_REPLY_TO).toBe('Legacy Writer <legacy@example.test>');
  });

  it.each(['not-an-address', 'one@example.test,two@example.test', 'one@example.test;two@example.test',
    'one@example.test\r\nBcc: victim@example.test', 'one@example.test\u0000', 'Partner <one@example.test>'])
    ('rejects malformed dedicated affiliate reply configuration %j', value => {
      expect(() => getAffiliateEmailReplyTo({ AFFILIATE_EMAIL_REPLY_TO: value, NEWSLETTER_REPLY_TO: 'fallback@example.test' }))
        .toThrow(NewsletterProviderConfigurationError);
    });

  it('sets an internal reply override while preserving the verified From, recipients and idempotency key', async () => {
    process.env.RESEND_API_KEY = 're_test';
    process.env.NEWSLETTER_FROM_EMAIL = 'Ink & Witness <updates@example.com>';
    process.env.NEWSLETTER_REPLY_TO = 'newsletter@example.test';
    process.env.AFFILIATE_EMAIL_REPLY_TO = 'partner@example.test';
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => new Response(JSON.stringify({ id: 'synthetic-email' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch;
    const message = { to: 'reader@example.test', subject: 'Subject', html: '<p>Body</p>', text: 'Body', idempotencyKey: 'reply-routing-one', fetchImpl };
    await sendNewsletterEmail({ ...message, replyTo: getAffiliateEmailReplyTo() });
    const first = (fetchImpl as any).mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(first.body))).toMatchObject({ from: process.env.NEWSLETTER_FROM_EMAIL, to: ['reader@example.test'], reply_to: 'partner@example.test' });
    expect(first.headers).toMatchObject({ 'Idempotency-Key': 'reply-routing-one' });
    await sendNewsletterEmail({ ...message, idempotencyKey: 'newsletter-routing-two' });
    expect(JSON.parse(String((fetchImpl as any).mock.calls[1][1].body))).toMatchObject({ from: process.env.NEWSLETTER_FROM_EMAIL, reply_to: 'newsletter@example.test' });
    expect(process.env.NEWSLETTER_REPLY_TO).toBe('newsletter@example.test');
  });

  it.each(['one@example.test\r\nBcc: victim@example.test', 'one@example.test,two@example.test', 'one@example.test\u0000'])
    ('rejects an unsafe internal reply override before contacting the provider %j', async replyTo => {
      process.env.RESEND_API_KEY = 're_test';
      process.env.NEWSLETTER_FROM_EMAIL = 'Ink & Witness <updates@example.com>';
      const fetchImpl = vi.fn() as unknown as typeof fetch;
      await expect(sendNewsletterEmail({ to: 'reader@example.test', subject: 'Subject', html: '<p>Body</p>', text: 'Body',
        idempotencyKey: 'unsafe-reply', replyTo, fetchImpl })).rejects.toBeInstanceOf(NewsletterProviderConfigurationError);
      expect(fetchImpl).not.toHaveBeenCalled();
    });
});
