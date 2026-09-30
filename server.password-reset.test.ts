import { readFileSync } from 'fs';
import http, { Server } from 'http';
import { AddressInfo } from 'net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.NODE_ENV = 'test';
  process.env.SESSION_SIGNING_SECRET = 'password-reset-route-test-secret-with-32-plus-characters';
  delete process.env.PUBLIC_BASE_URL;
  delete process.env.APP_BASE_URL;
  delete process.env.APP_URL;
  delete process.env.VITE_PUBLIC_BASE_URL;
});

const reader = vi.hoisted(() => ({
  id: 'user_reader_12345678',
  email: 'reader@example.test',
  name: 'Test Reader',
  role: 'client' as const,
  passwordHash: '$argon2id$old-password-hash',
  createdAt: '2026-09-01T00:00:00.000Z'
}));

const storeMocks = vi.hoisted(() => {
  const known = {
    init: vi.fn(async () => undefined),
    ensureUsersHydrated: vi.fn(async () => undefined),
    getFreshUserByEmail: vi.fn(),
    applyPasswordResetUser: vi.fn(async () => undefined)
  };
  const fallback = new Map<PropertyKey, ReturnType<typeof vi.fn>>();
  return new Proxy(known as Record<PropertyKey, any>, {
    get(target, property) {
      if (property in target) return target[property];
      if (!fallback.has(property)) fallback.set(property, vi.fn());
      return fallback.get(property);
    }
  });
});

const passwordResetMocks = vi.hoisted(() => ({
  issue: vi.fn(),
  isActive: vi.fn(),
  consume: vi.fn(),
  discard: vi.fn()
}));

const newsletterEmailMocks = vi.hoisted(() => ({
  buildReaderPasswordResetEmail: vi.fn(() => ({
    subject: 'Reset your reader password',
    html: '<p>Reset link</p>',
    text: 'Reset link'
  })),
  sendNewsletterEmail: vi.fn(async () => ({ id: 'email_1' }))
}));

const authMocks = vi.hoisted(() => ({
  hashPassword: vi.fn(async () => '$argon2id$mock-password-hash'),
  verifyPassword: vi.fn(async () => false),
  validatePasswordStrength: vi.fn(() => ({ valid: true }))
}));

vi.mock('./src/server/store.js', () => ({
  HomepageSaveConflictError: class HomepageSaveConflictError extends Error {},
  store: storeMocks
}));
vi.mock('./src/server/passwordResetStore.js', () => ({ passwordResetStore: passwordResetMocks }));
vi.mock('./src/server/auth.js', () => authMocks);
vi.mock('./src/server/newsletterEmail.js', () => ({
  buildNewsletterCampaignEmail: vi.fn(() => ({ subject: '', html: '', text: '' })),
  buildNewsletterConfirmationEmail: vi.fn(() => ({ subject: '', html: '', text: '' })),
  buildReaderPasswordResetEmail: newsletterEmailMocks.buildReaderPasswordResetEmail,
  isRetryableNewsletterProviderError: vi.fn(() => false),
  isNewsletterProviderConfigured: vi.fn(() => true),
  NewsletterProviderConfigurationError: class NewsletterProviderConfigurationError extends Error {},
  sendNewsletterEmail: newsletterEmailMocks.sendNewsletterEmail
}));
vi.mock('./src/server/mpesa.js', () => ({
  initiateStkPush: vi.fn(),
  handleDarajaCallback: vi.fn(),
  queryPaymentStatus: vi.fn(),
  verifyManualReceipt: vi.fn(),
  getDarajaAccessToken: vi.fn(),
  formatKenyanPhone: vi.fn((value: unknown) => String(value || '')),
  maskPhone: vi.fn(() => '254700***001')
}));

import { createApp } from './server.js';

describe('reader password-reset routes', () => {
  let server: Server;
  let baseUrl: string;
  const token = `pr1_${'A'.repeat(43)}`;

  beforeAll(async () => {
    const app = await createApp();
    server = http.createServer(app);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  }, 60_000);

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    storeMocks.getFreshUserByEmail.mockImplementation(async (email: string) =>
      email === reader.email ? { ...reader } : null
    );
    passwordResetMocks.issue.mockResolvedValue({
      token,
      expiresAt: Date.now() + 60 * 60 * 1000
    });
    passwordResetMocks.isActive.mockResolvedValue(true);
    passwordResetMocks.consume.mockResolvedValue({
      user: { ...reader, passwordHash: '$argon2id$mock-password-hash' },
      resetAt: '2026-09-30T10:00:00.000Z'
    });
  });

  it('serves the single-use reset form and maps the friendly production URL to it', async () => {
    const response = await fetch(`${baseUrl}/api/auth/password-reset?token=${token}`);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(body).toContain('Choose a new password');
    expect(body).toContain('action="/api/auth/password-reset"');
    expect(body).toContain(`value="${token}"`);
    expect(passwordResetMocks.isActive).toHaveBeenCalledWith(token);

    const config = JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url), 'utf8')) as {
      rewrites?: Array<{ source: string; destination: string }>;
    };
    expect(config.rewrites).toContainEqual({
      source: '/password-reset',
      destination: '/api/index?path=auth/password-reset'
    });
  });

  it('consumes a valid form token, updates the reader, and clears the old session cookie', async () => {
    const response = await fetch(`${baseUrl}/api/auth/password-reset`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: baseUrl,
        cookie: `iw_session=sess_${'a'.repeat(64)}`
      },
      body: new URLSearchParams({
        token,
        password: 'NewReaderPassword9!',
        confirmPassword: 'NewReaderPassword9!'
      })
    });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(body).toContain('Password updated');
    expect(authMocks.hashPassword).toHaveBeenCalledWith('NewReaderPassword9!');
    expect(passwordResetMocks.consume).toHaveBeenCalledWith(
      token,
      '$argon2id$mock-password-hash'
    );
    expect(storeMocks.applyPasswordResetUser).toHaveBeenCalledWith(expect.objectContaining({
      id: reader.id,
      email: reader.email,
      passwordHash: '$argon2id$mock-password-hash'
    }));
    expect(response.headers.get('set-cookie')).toContain('iw_session=;');
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(response.headers.get('set-cookie')).toContain('SameSite=Lax');
    expect(response.headers.get('set-cookie')).toContain('Path=/');
  });

  it('rejects an expired link before rendering a password form', async () => {
    passwordResetMocks.isActive.mockResolvedValueOnce(false);

    const response = await fetch(`${baseUrl}/api/auth/password-reset?token=${token}`);
    const body = await response.text();

    expect(response.status).toBe(410);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(body).toContain('expired or has already been used');
    expect(body).not.toContain('name="password"');
  });

  it('rejects a token that was already consumed without changing the cached reader', async () => {
    passwordResetMocks.consume.mockResolvedValueOnce(null);

    const response = await fetch(`${baseUrl}/api/auth/password-reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        token,
        password: 'NewReaderPassword9!',
        confirmPassword: 'NewReaderPassword9!'
      })
    });

    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({
      success: false,
      error: 'This password reset link has expired or has already been used. Request a new link.'
    });
    expect(storeMocks.applyPasswordResetUser).not.toHaveBeenCalled();
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('returns the same public response for an existing and a nonexistent reader', async () => {
    const requestReset = (email: string) => fetch(`${baseUrl}/api/auth/password-reset/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email })
    });

    const existingResponse = await requestReset(reader.email);
    const existingBody = await existingResponse.json();
    const missingResponse = await requestReset('nobody@example.test');
    const missingBody = await missingResponse.json();

    expect(existingResponse.status).toBe(202);
    expect(missingResponse.status).toBe(202);
    expect(existingBody).toEqual(missingBody);
    expect(existingBody).toEqual({
      success: true,
      message: 'If a reader account exists for that email, a password reset link has been sent.'
    });
    expect(existingResponse.headers.get('cache-control')).toContain('no-store');
    expect(missingResponse.headers.get('cache-control')).toContain('no-store');
    expect(storeMocks.ensureUsersHydrated).not.toHaveBeenCalled();
    expect(passwordResetMocks.issue).toHaveBeenCalledTimes(1);
    expect(newsletterEmailMocks.sendNewsletterEmail).toHaveBeenCalledTimes(1);
    expect(newsletterEmailMocks.sendNewsletterEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: reader.email,
      idempotencyKey: expect.stringMatching(/^reader-password-reset-[a-f0-9]{64}$/)
    }));
    expect(newsletterEmailMocks.buildReaderPasswordResetEmail).toHaveBeenCalledWith({
      name: reader.name,
      resetUrl: `${baseUrl}/password-reset?token=${token}`,
      expiresInMinutes: 60
    });
  });

  it('invalidates the issued capability when email delivery fails without revealing the account', async () => {
    const deliveryEmail = 'delivery-failure@example.test';
    storeMocks.getFreshUserByEmail.mockImplementationOnce(async () => ({
      ...reader,
      email: deliveryEmail
    }));
    newsletterEmailMocks.sendNewsletterEmail.mockRejectedValueOnce(new Error('provider unavailable'));

    const response = await fetch(`${baseUrl}/api/auth/password-reset/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: deliveryEmail })
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      success: true,
      message: 'If a reader account exists for that email, a password reset link has been sent.'
    });
    expect(passwordResetMocks.discard).toHaveBeenCalledWith(token);
  });

  it('lets an authenticated writer send the reset link without choosing the reader password', async () => {
    (storeMocks as any).getAuthSession.mockResolvedValueOnce({
      storageVersion: 2,
      userId: 'user_admin_12345678',
      role: 'admin',
      email: 'writer@example.test',
      name: 'Writer',
      createdAt: Date.now() - 1_000,
      expiresAt: Date.now() + 60_000
    });

    const response = await fetch(`${baseUrl}/api/admin/readers/password-reset`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: baseUrl,
        cookie: `iw_session=sess_${'b'.repeat(64)}`
      },
      body: JSON.stringify({ email: reader.email })
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      success: true,
      message: 'A secure password reset link was sent to the reader. You cannot view or set their password.'
    });
    expect(newsletterEmailMocks.sendNewsletterEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: reader.email
    }));
  });
});
