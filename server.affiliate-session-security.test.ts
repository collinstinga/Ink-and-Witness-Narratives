import http, { Server } from 'http';
import { AddressInfo } from 'net';
import { readFileSync } from 'fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.VERCEL = '1';
  process.env.NODE_ENV = 'test';
});

const privateAffiliate = {
  id: 'aff_test_1',
  affiliateCode: 'TEST123',
  name: 'Test Affiliate',
  email: 'affiliate@example.test',
  phone: '254700000001',
  passwordHash: '$argon2id$test-hash',
  sessionVersion: 'a'.repeat(64),
  status: 'active' as const,
  payoutMethod: 'mpesa' as const,
  payoutDetails: { mpesaPhone: '254700000001', mpesaName: 'Test Affiliate' },
  totalClicks: 0,
  uniqueVisitors: 0,
  totalSalesCount: 0,
  totalRevenueKes: 0,
  totalCommissionEarnedKes: 0,
  totalCommissionPaidKes: 0,
  balanceAvailableKes: 0,
  balancePendingKes: 0,
  createdAt: '2026-09-06T00:00:00.000Z',
  updatedAt: '2026-09-06T00:00:00.000Z'
};

const affiliateMocks = vi.hoisted(() => ({
  verifyAffiliateSession: vi.fn(),
  createAffiliateSession: vi.fn(),
  invalidateAffiliateSession: vi.fn(),
  getAffiliateByEmail: vi.fn(),
  getAffiliateByCode: vi.fn(),
  getAffiliateById: vi.fn(),
  getAffiliateByIdFresh: vi.fn(),
  createAffiliate: vi.fn(),
  updateAffiliate: vi.fn(),
  updateAffiliateCredential: vi.fn(),
  setAffiliateStatus: vi.fn(),
  toggleAffiliateLinks: vi.fn(),
  getAffiliateDashboard: vi.fn(),
  getSettings: vi.fn()
}));

const storeMocks = vi.hoisted(() => {
  const known = {
    init: vi.fn(async () => undefined),
    getAuthSession: vi.fn(),
    affiliates: affiliateMocks
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

vi.mock('./src/server/store.js', () => ({ store: storeMocks }));
vi.mock('./src/server/affiliateStore.js', () => ({
  affiliateStore: affiliateMocks,
  sanitizeAffiliateForResponse: (value: Record<string, unknown>) => {
    const { passwordHash: _passwordHash, sessionVersion: _sessionVersion, ...safe } = value;
    return safe;
  }
}));
vi.mock('./src/server/affiliateCredentials.js', () => ({
  generateAffiliateTemporaryPassword: vi.fn(() => 'TemporaryPassword123!'),
  hashAffiliatePassword: vi.fn(async () => '$argon2id$new-hash'),
  rehashVerifiedAffiliatePassword: vi.fn(async () => '$argon2id$rehash'),
  validateAffiliatePasswordStrength: vi.fn(() => ({ valid: true })),
  verifyAffiliatePassword: vi.fn(async () => ({ valid: true, needsRehash: false }))
}));
vi.mock('./src/server/publicWriteSecurity.js', () => ({
  publicWriteValidators: new Proxy({}, {
    get: () => (_req: unknown, _res: unknown, next: () => void) => next()
  })
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

describe('affiliate session route boundaries', () => {
  let server: Server;
  let baseUrl: string;
  const validCookie = `iw_affiliate_session=aff_sess_v2_${'b'.repeat(64)}_${'c'.repeat(64)}`;
  const adminSessionToken = `sess_${'a'.repeat(64)}`;

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
    storeMocks.getAuthSession.mockResolvedValue({
      sessionId: adminSessionToken,
      userId: 'admin_1',
      email: 'admin@example.test',
      name: 'Test Admin',
      role: 'admin',
      expiresAt: Date.now() + 60_000
    });
    affiliateMocks.verifyAffiliateSession.mockResolvedValue({ ...privateAffiliate });
    affiliateMocks.createAffiliateSession.mockResolvedValue(`aff_sess_v2_${'d'.repeat(64)}_${'e'.repeat(64)}`);
    affiliateMocks.invalidateAffiliateSession.mockResolvedValue(undefined);
    affiliateMocks.getAffiliateByEmail.mockReturnValue({ ...privateAffiliate });
    affiliateMocks.getAffiliateByCode.mockReturnValue(undefined);
    affiliateMocks.getAffiliateById.mockReturnValue({ ...privateAffiliate });
    affiliateMocks.getAffiliateByIdFresh.mockResolvedValue({ ...privateAffiliate });
    affiliateMocks.createAffiliate.mockResolvedValue({ ...privateAffiliate });
    affiliateMocks.updateAffiliate.mockImplementation((_id, patch) => ({
      ...privateAffiliate,
      ...patch
    }));
    affiliateMocks.setAffiliateStatus.mockImplementation(async (_id, status) => ({
      ...privateAffiliate,
      status
    }));
    affiliateMocks.toggleAffiliateLinks.mockImplementation(async (_id, linksDisabled) => ({
      ...privateAffiliate,
      linksDisabled
    }));
    affiliateMocks.updateAffiliateCredential.mockResolvedValue({
      ...privateAffiliate,
      passwordHash: '$argon2id$new-hash',
      sessionVersion: 'f'.repeat(64)
    });
    affiliateMocks.getAffiliateDashboard.mockReturnValue({
      affiliate: {
        id: privateAffiliate.id,
        affiliateCode: privateAffiliate.affiliateCode,
        name: privateAffiliate.name,
        email: privateAffiliate.email,
        phone: privateAffiliate.phone,
        status: privateAffiliate.status
      }
    });
    affiliateMocks.getSettings.mockReturnValue({
      allowSelfRegistration: true,
      minPayoutThresholdKes: 1000,
      defaultCommissionRate: 15
    });
  });

  it('uses cacheable verification for GET and force-fresh verification for mutations', async () => {
    const read = await fetch(`${baseUrl}/api/affiliate/me`, {
      headers: { cookie: validCookie }
    });
    const mutation = await fetch(`${baseUrl}/api/affiliate/accept-terms`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: validCookie,
        origin: baseUrl,
        'sec-fetch-site': 'same-origin'
      },
      body: JSON.stringify({ termsVersion: '2026.1' })
    });

    expect(read.status).toBe(200);
    expect(mutation.status).toBe(200);
    expect(affiliateMocks.verifyAffiliateSession).toHaveBeenNthCalledWith(1, expect.any(String), { forceFresh: false });
    expect(affiliateMocks.verifyAffiliateSession).toHaveBeenNthCalledWith(2, expect.any(String), { forceFresh: true });
  });

  it('returns 401 and clears an invalid cookie without exposing private fields', async () => {
    affiliateMocks.verifyAffiliateSession.mockResolvedValueOnce(null);
    const response = await fetch(`${baseUrl}/api/affiliate/me`, {
      headers: { cookie: validCookie }
    });
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie')).toContain('iw_affiliate_session=;');
    expect(JSON.stringify(body)).not.toContain(privateAffiliate.passwordHash);
    expect(JSON.stringify(body)).not.toContain(privateAffiliate.sessionVersion);
  });

  it('distinguishes a Firestore outage from an invalid session and preserves the cookie', async () => {
    affiliateMocks.verifyAffiliateSession.mockRejectedValueOnce(new Error('quota exhausted'));
    const response = await fetch(`${baseUrl}/api/affiliate/me`, {
      headers: { cookie: validCookie }
    });
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(503);
    expect(body).toMatchObject({ code: 'AUTH_UNAVAILABLE' });
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(JSON.stringify(body)).not.toContain('quota exhausted');
  });

  it('does not return a session bearer in a successful login response', async () => {
    const issuedToken = `aff_sess_v2_${'1'.repeat(64)}_${'2'.repeat(64)}`;
    affiliateMocks.createAffiliateSession.mockResolvedValueOnce(issuedToken);
    const response = await fetch(`${baseUrl}/api/affiliate/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ login: privateAffiliate.email, password: 'CorrectPassword123!' })
    });
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(response.headers.get('set-cookie')).toContain('SameSite=Lax');
    expect(JSON.stringify(body)).not.toContain(issuedToken);
    expect(JSON.stringify(body)).not.toContain(privateAffiliate.passwordHash);
    expect(JSON.stringify(body)).not.toContain(privateAffiliate.sessionVersion);
  });

  it('reports a durable session creation failure after accepted login as retryable', async () => {
    affiliateMocks.createAffiliateSession.mockRejectedValueOnce(new Error('session write failed'));
    const response = await fetch(`${baseUrl}/api/affiliate/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ login: privateAffiliate.email, password: 'CorrectPassword123!' })
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ success: false, code: 'SESSION_UNAVAILABLE' });
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('reports registration partial success without inviting a duplicate account retry', async () => {
    affiliateMocks.createAffiliateSession.mockRejectedValueOnce(new Error('session write failed'));
    const response = await fetch(`${baseUrl}/api/affiliate/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: privateAffiliate.name,
        email: privateAffiliate.email,
        phone: privateAffiliate.phone,
        password: 'CorrectPassword123!',
        acceptedTerms: true
      })
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      success: false,
      accountCreated: true,
      code: 'ACCOUNT_CREATED_SESSION_UNAVAILABLE'
    });
  });

  it('reports password-change partial success and clears the now-invalid cookie', async () => {
    affiliateMocks.createAffiliateSession.mockRejectedValueOnce(new Error('session write failed'));
    const response = await fetch(`${baseUrl}/api/affiliate/change-password`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: validCookie,
        origin: baseUrl,
        'sec-fetch-site': 'same-origin'
      },
      body: JSON.stringify({ currentPassword: 'CorrectPassword123!', newPassword: 'NewCorrectPassword123!' })
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      success: false,
      passwordChanged: true,
      reauthenticate: true,
      code: 'PASSWORD_CHANGED_REAUTH_REQUIRED'
    });
    expect(response.headers.get('set-cookie')).toContain('iw_affiliate_session=;');
  });

  it('clears the browser cookie but reports failure if shared logout revocation fails', async () => {
    affiliateMocks.invalidateAffiliateSession.mockRejectedValueOnce(new Error('delete failed'));
    const response = await fetch(`${baseUrl}/api/affiliate/logout`, {
      method: 'POST',
      headers: {
        cookie: validCookie,
        origin: baseUrl,
        'sec-fetch-site': 'same-origin'
      }
    });

    expect(response.status).toBe(503);
    expect(response.headers.get('set-cookie')).toContain('iw_affiliate_session=;');
  });

  it('rejects a differing admin-submitted affiliate email before any profile update', async () => {
    const response = await fetch(`${baseUrl}/api/admin/affiliates/${privateAffiliate.id}`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        cookie: `iw_session=${adminSessionToken}`,
        origin: baseUrl,
        'sec-fetch-site': 'same-origin'
      },
      body: JSON.stringify({
        name: 'Should Not Be Applied',
        email: 'replacement@example.test'
      })
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: expect.stringMatching(/email cannot be changed/i)
    });
    expect(affiliateMocks.updateAffiliate).not.toHaveBeenCalled();
    expect(affiliateMocks.setAffiliateStatus).not.toHaveBeenCalled();
    expect(affiliateMocks.toggleAffiliateLinks).not.toHaveBeenCalled();
  });

  it('accepts an unchanged normalized email without forwarding identity mutation', async () => {
    const response = await fetch(`${baseUrl}/api/admin/affiliates/${privateAffiliate.id}`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        cookie: `iw_session=${adminSessionToken}`,
        origin: baseUrl,
        'sec-fetch-site': 'same-origin'
      },
      body: JSON.stringify({
        name: 'Updated Affiliate Name',
        email: '  AFFILIATE@EXAMPLE.TEST  '
      })
    });
    const body = await response.json() as Record<string, any>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      affiliate: {
        name: 'Updated Affiliate Name',
        email: privateAffiliate.email,
        affiliateCode: privateAffiliate.affiliateCode
      }
    });
    expect(affiliateMocks.updateAffiliate).toHaveBeenCalledWith(
      privateAffiliate.id,
      { name: 'Updated Affiliate Name' },
      'Admin (Jake)'
    );
  });

  it('keeps the general affiliate editor email visibly locked and out of its update payload', () => {
    const editorSource = readFileSync(
      new URL('./src/components/writer/AffiliatesAdminTab.tsx', import.meta.url),
      'utf8'
    );
    const saveHandler = editorSource.slice(
      editorSource.indexOf('const handleSaveEditAffiliate'),
      editorSource.indexOf('const handleToggleStatus')
    );
    const emailField = editorSource.slice(
      editorSource.indexOf('Login Email (identity locked)'),
      editorSource.indexOf('Phone Number (M-Pesa)')
    );

    expect(saveHandler).not.toMatch(/\bemail\s*:/);
    expect(emailField).toContain('readOnly');
    expect(emailField).toContain('aria-readonly="true"');
    expect(emailField).not.toContain('onChange=');
  });
});
