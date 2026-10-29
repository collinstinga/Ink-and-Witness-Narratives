import { describe, expect, it, vi } from 'vitest';
import type { UserRecord } from '../types.js';
import { NewsletterProviderConfigurationError, NewsletterProviderError } from './newsletterEmail.js';
import { deliverReaderPasswordResetEmail } from './readerPasswordResetDelivery.js';
import { hashPasswordResetToken } from './passwordResetSecurity.js';

const token = `pr1_${'a'.repeat(43)}`;
const user: UserRecord = { id: 'user_synthetic_reader', role: 'client', name: 'Synthetic reader', email: 'reader@example.invalid',
  passwordHash: '$argon2id$private', createdAt: '2026-10-29T00:00:00.000Z' };
function fixture() {
  const service = { issue: vi.fn(async (_id: string) => ({ token, expiresAt: Date.now() + 3_600_000 })), discard: vi.fn(async (_token: unknown) => {}) };
  const sendEmail = vi.fn(async (_input: any) => ({ providerMessageId: 'private-provider-id' }));
  const send = () => deliverReaderPasswordResetEmail({ user, baseUrl: 'https://www.inkandwitness-narratives.co.ke', service, sendEmail });
  return { service, sendEmail, send };
}

describe('reader reset delivery acceptance versus uncertain outcomes', () => {
  it('sends exactly one email with the canonical public reset path and hash-only idempotency key', async () => {
    const h = fixture(); expect(await h.send()).toBe('accepted');
    expect(h.service.issue).toHaveBeenCalledExactlyOnceWith(user.id); expect(h.sendEmail).toHaveBeenCalledOnce(); expect(h.service.discard).not.toHaveBeenCalled();
    const sent = h.sendEmail.mock.calls[0][0];
    expect(sent.to).toBe(user.email); expect(sent.html).toContain(`https://www.inkandwitness-narratives.co.ke/password-reset?token=${token}`);
    expect(sent.idempotencyKey).toBe(`reader-password-reset-${hashPasswordResetToken(token)}`);
    expect(sent.idempotencyKey).not.toContain(token);
  });

  it.each([408, 409, 425, 500, 502, 503])('keeps the one-use link active after uncertain provider status %i without resending', async status => {
    const h = fixture(); h.sendEmail.mockRejectedValueOnce(new NewsletterProviderError('Synthetic uncertain delivery', status));
    expect(await h.send()).toBe('unconfirmed'); expect(h.service.issue).toHaveBeenCalledOnce(); expect(h.sendEmail).toHaveBeenCalledOnce(); expect(h.service.discard).not.toHaveBeenCalled();
  });

  it('keeps an accepted-but-unacknowledged capability usable if the email arrives after a network timeout', async () => {
    const h = fixture(); h.sendEmail.mockRejectedValueOnce(new Error('Synthetic network timeout after possible acceptance'));
    expect(await h.send()).toBe('unconfirmed'); expect(h.service.discard).not.toHaveBeenCalled(); expect(h.sendEmail).toHaveBeenCalledOnce();
  });

  it.each([400, 401, 403, 404, 413, 415, 422, 429])('discards an undelivered capability after definite provider rejection %i', async status => {
    const h = fixture(), error = new NewsletterProviderError('Synthetic rejected message', status);
    h.sendEmail.mockRejectedValueOnce(error);
    await expect(h.send()).rejects.toBe(error);
    expect(h.service.discard).toHaveBeenCalledExactlyOnceWith(token); expect(h.service.issue).toHaveBeenCalledOnce(); expect(h.sendEmail).toHaveBeenCalledOnce();
  });

  it('also discards capabilities on a definite pre-send configuration failure', async () => {
    const h = fixture(); h.sendEmail.mockRejectedValueOnce(new NewsletterProviderConfigurationError());
    await expect(h.send()).rejects.toBeInstanceOf(NewsletterProviderConfigurationError); expect(h.service.discard).toHaveBeenCalledExactlyOnceWith(token);
  });

  it('does not falsely acknowledge revocation when definite-rejection cleanup fails', async () => {
    const h = fixture(); h.sendEmail.mockRejectedValueOnce(new NewsletterProviderError('Rejected', 422));
    h.service.discard.mockRejectedValueOnce(new Error('Synthetic cleanup unavailable'));
    await expect(h.send()).rejects.toThrow('cleanup unavailable'); expect(h.sendEmail).toHaveBeenCalledOnce();
  });

  it('cannot issue a reader-purpose reset for the writer account', async () => {
    const h = fixture();
    await expect(deliverReaderPasswordResetEmail({ user: { ...user, role: 'admin' }, baseUrl: 'https://www.inkandwitness-narratives.co.ke',
      service: h.service, sendEmail: h.sendEmail })).rejects.toThrow(/Only reader/);
    expect(h.service.issue).not.toHaveBeenCalled(); expect(h.sendEmail).not.toHaveBeenCalled();
  });
});
