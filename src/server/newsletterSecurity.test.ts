import { afterEach, describe, expect, it } from 'vitest';
import {
  createNewsletterUnsubscribeToken,
  newsletterEmailIndexId,
  normalizeNewsletterEmail,
  sanitizeNewsletterInterests,
  sanitizeSubscriberName,
  verifyNewsletterUnsubscribeToken
} from './newsletterSecurity.js';

const SECRET = 'newsletter-security-test-secret-with-at-least-32-characters';

describe('newsletter security', () => {
  afterEach(() => {
    delete process.env.VERCEL;
  });

  it('normalizes valid email addresses and rejects malformed input', () => {
    expect(normalizeNewsletterEmail('  Reader@Example.COM ')).toBe('reader@example.com');
    expect(normalizeNewsletterEmail('reader@invalid')).toBeNull();
    expect(normalizeNewsletterEmail('')).toBeNull();
  });

  it('creates stable non-reversible email index identifiers', () => {
    const first = newsletterEmailIndexId('reader@example.com');
    const second = newsletterEmailIndexId('reader@example.com');
    expect(first).toBe(second);
    expect(first).toHaveLength(64);
    expect(first).not.toContain('reader');
  });

  it('deduplicates and bounds interests while preserving display text', () => {
    expect(sanitizeNewsletterInterests([' Faith ', 'faith', '', 2, 'Life   & Reflection']))
      .toEqual(['Faith', 'Life & Reflection']);
    expect(sanitizeNewsletterInterests(Array.from({ length: 25 }, (_, index) => `Topic ${index}`)))
      .toHaveLength(20);
  });

  it('sanitizes optional subscriber names', () => {
    expect(sanitizeSubscriberName('  Amina   N. ')).toBe('Amina N.');
    expect(sanitizeSubscriberName('   ')).toBeUndefined();
  });

  it('round-trips unsubscribe capabilities and rejects tampering', () => {
    const subscriberId = 'sub_1234567890abcdef';
    const token = createNewsletterUnsubscribeToken(subscriberId, SECRET);
    expect(verifyNewsletterUnsubscribeToken(token, SECRET)).toEqual({ subscriberId });
    expect(verifyNewsletterUnsubscribeToken(`${token}x`, SECRET)).toBeNull();
    expect(verifyNewsletterUnsubscribeToken(token, `${SECRET}-different`)).toBeNull();
  });

  it('fails closed in production when no signing secret is configured', () => {
    process.env.VERCEL = '1';
    const previousNewsletter = process.env.NEWSLETTER_SIGNING_SECRET;
    const previousSession = process.env.SESSION_SIGNING_SECRET;
    delete process.env.NEWSLETTER_SIGNING_SECRET;
    delete process.env.SESSION_SIGNING_SECRET;
    try {
      expect(() => createNewsletterUnsubscribeToken('sub_1234567890abcdef'))
        .toThrow('NEWSLETTER_SIGNING_SECRET');
      expect(verifyNewsletterUnsubscribeToken('v1.sub_1234567890abcdef.fake')).toBeNull();
    } finally {
      if (previousNewsletter === undefined) delete process.env.NEWSLETTER_SIGNING_SECRET;
      else process.env.NEWSLETTER_SIGNING_SECRET = previousNewsletter;
      if (previousSession === undefined) delete process.env.SESSION_SIGNING_SECRET;
      else process.env.SESSION_SIGNING_SECRET = previousSession;
    }
  });
});
