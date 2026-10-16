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

const activeLiteraryCircleMembership = {
  schemaVersion: 1 as const,
  memberSince: '2026-09-06T00:00:00.000Z',
  foundingMember: true,
  foundingRecognizedAt: '2026-09-06T00:00:00.000Z',
  complimentaryAccess: {
    status: 'active' as const,
    scope: 'all_published' as const,
    grantedAt: '2026-09-06T00:00:00.000Z',
    updatedAt: '2026-09-06T00:00:00.000Z',
    updatedBy: 'migration:test'
  },
  tier: {
    id: 'literary-partner',
    assignedAt: '2026-09-06T00:00:00.000Z',
    source: 'default' as const,
    policyVersion: 1
  },
  onboarding: {
    version: 1,
    audience: 'existing_upgrade' as const,
    status: 'not_started' as const,
    completedStepIds: [],
    welcomeRequired: true
  }
};

const publicArticleFixture = {
  id: 'art-public-1',
  title: 'Public Summary Test',
  subtitle: 'Subtitle',
  slug: 'public-summary-test',
  excerpt: 'Safe excerpt',
  synopsis: 'Safe synopsis',
  content: 'PAID BODY MUST NEVER APPEAR IN A PUBLIC COLLECTION RESPONSE',
  category: 'Essays',
  categories: ['Essays'],
  topics: ['life'],
  status: 'published' as const,
  isPaid: true,
  priceKes: 300,
  readTimeMinutes: 4,
  publishedAt: '2026-09-09',
  createdAt: '2026-09-09T00:00:00.000Z',
  updatedAt: '2026-09-09T01:00:00.000Z',
  coverImage: 'data:image/jpeg;base64,AAA',
  coverImageOriginal: 'data:image/jpeg;base64,PRIVATE-ORIGINAL',
  downloadsCount: 0,
  previewParagraphs: ['Safe preview'],
  tags: ['Test']
};

const affiliateMocks = vi.hoisted(() => ({
  verifyAffiliateSession: vi.fn(),
  createAffiliateSession: vi.fn(),
  invalidateAffiliateSession: vi.fn(),
  getAffiliateByEmail: vi.fn(),
  getAffiliateByCode: vi.fn(),
  getAffiliateById: vi.fn(),
  getAffiliateByIdFresh: vi.fn(),
  getCommissions: vi.fn(),
  getPayouts: vi.fn(),
  getCampaigns: vi.fn(),
  getAuditLogs: vi.fn(),
  createAffiliate: vi.fn(),
  updateAffiliate: vi.fn(),
  updateAffiliateCredential: vi.fn(),
  setAffiliateStatus: vi.fn(),
  toggleAffiliateLinks: vi.fn(),
  getAffiliateDashboard: vi.fn(),
  getSettings: vi.fn(),
  getSettingsFresh: vi.fn(),
  saveSettings: vi.fn(),
  getLiteraryCircleSettings: vi.fn(),
  getLiteraryCircleSettingsFresh: vi.fn(),
  saveLiteraryCircleSettings: vi.fn(),
  updateLiteraryCircleMembership: vi.fn(),
  updateLiteraryCircleOnboarding: vi.fn(),
  hasComplimentaryCatalogueAccess: vi.fn()
}));

const storeMocks = vi.hoisted(() => {
  const getArticles = vi.fn((_includeDrafts?: boolean): any[] => []);
  const getArticleById = vi.fn((_id: string, _includeDrafts?: boolean): any => undefined);
  const known = {
    init: vi.fn(async () => undefined),
    getAuthSession: vi.fn(),
    getArticles,
    getFreshArticles: vi.fn(async (includeDrafts?: boolean, _forceRefresh?: boolean) => getArticles(includeDrafts)),
    getArticleById,
    getFreshArticleById: vi.fn(async (id: string, includeDrafts?: boolean, _forceRefresh?: boolean) => getArticleById(id, includeDrafts)),
    refreshPublicMetadata: vi.fn(async () => undefined),
    getAuthorProfile: vi.fn(),
    getCategories: vi.fn(),
    getTopics: vi.fn(),
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

vi.mock('./src/server/store.js', () => ({
  store: storeMocks,
  HomepageSaveConflictError: class HomepageSaveConflictError extends Error {
    readonly code = 'HOMEPAGE_SAVE_CONFLICT';

    constructor() {
      super('Homepage settings changed since you loaded them. Reload the latest settings before saving again.');
    }
  }
}));
vi.mock('./src/server/affiliateStore.js', () => ({
  affiliateStore: affiliateMocks,
  AffiliateSettingsValidationError: class AffiliateSettingsValidationError extends Error {},
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
    affiliateMocks.getCommissions.mockReturnValue([]);
    affiliateMocks.getPayouts.mockReturnValue([]);
    affiliateMocks.getCampaigns.mockReturnValue([]);
    affiliateMocks.getAuditLogs.mockReturnValue([]);
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
    storeMocks.getArticles.mockReturnValue([{ ...publicArticleFixture }]);
    storeMocks.getArticleById.mockReturnValue({ ...publicArticleFixture });
    storeMocks.getMpesaSettings.mockReturnValue({ defaultPriceKes: 300 });
    storeMocks.getAuthorProfile.mockReturnValue({ name: 'Jake' });
    storeMocks.getCategories.mockReturnValue([{ id: 'category-1', name: 'Essays', order: 1 }]);
    storeMocks.getTopics.mockReturnValue([{ id: 'topic-1', name: 'Memory', slug: 'memory' }]);
    storeMocks.getHomepageConfig.mockReturnValue({
      config: { welcomeBackground: {}, mostSellingPieceIds: [] },
      startHerePieces: [{ ...publicArticleFixture }],
      mostSellingPieces: [{ ...publicArticleFixture }],
      pieceOfTheWeek: { ...publicArticleFixture },
      autoRankedPieces: [{ ...publicArticleFixture }],
      categories: []
    });
    storeMocks.getFreshHomepageConfig.mockImplementation(async () => storeMocks.getHomepageConfig());
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
    affiliateMocks.getSettingsFresh.mockResolvedValue({
      allowSelfRegistration: true,
      minPayoutThresholdKes: 1000,
      defaultCommissionRate: 15
    });
    affiliateMocks.saveSettings.mockImplementation(async patch => ({
      allowSelfRegistration: true,
      defaultCommissionRate: 15,
      minPayoutThresholdKes: Number(patch.minPayoutThresholdKes)
    }));
    const literaryCircleSettings = {
      schemaVersion: 1,
      enabled: true,
      defaultTierId: 'literary-partner',
      qualificationTimezone: 'Africa/Nairobi',
      introductoryPeriodDays: 30,
      onboardingVersion: 1,
      tiers: [{
        id: 'literary-partner',
        name: 'Literary Partner',
        description: 'Approved Literary Circle membership.',
        rank: 1,
        monthlyVerifiedSalesThreshold: 0,
        proposedCommissionRate: 15,
        enabled: true
      }],
      commissionPolicy: {
        status: 'draft',
        version: 1,
        subscriptionRenewalsEligible: false
      },
      community: {
        enabled: false,
        title: 'The Ink & Witness Literary Circle',
        description: 'Private partner updates.'
      }
    };
    affiliateMocks.getLiteraryCircleSettings.mockReturnValue(literaryCircleSettings);
    affiliateMocks.getLiteraryCircleSettingsFresh.mockResolvedValue(literaryCircleSettings);
    affiliateMocks.saveLiteraryCircleSettings.mockImplementation(async value => value);
    affiliateMocks.updateLiteraryCircleMembership.mockImplementation(async (_id, patch) => ({
      ...privateAffiliate,
      literaryCircle: {
        ...activeLiteraryCircleMembership,
        complimentaryAccess: {
          ...activeLiteraryCircleMembership.complimentaryAccess,
          ...(patch.complimentaryAccessStatus ? { status: patch.complimentaryAccessStatus } : {})
        }
      }
    }));
    affiliateMocks.updateLiteraryCircleOnboarding.mockImplementation(async () => ({
      ...privateAffiliate,
      literaryCircle: {
        ...activeLiteraryCircleMembership,
        onboarding: {
          ...activeLiteraryCircleMembership.onboarding,
          status: 'in_progress',
          completedStepIds: ['welcome'],
          welcomeRequired: false
        }
      }
    }));
    affiliateMocks.hasComplimentaryCatalogueAccess.mockResolvedValue(true);
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

  it('routes affiliate settings saves before the dynamic affiliate ID route', async () => {
    affiliateMocks.getAffiliateById.mockImplementationOnce(id =>
      id === privateAffiliate.id ? { ...privateAffiliate } : undefined
    );

    const response = await fetch(`${baseUrl}/api/admin/affiliates/settings`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        cookie: `iw_session=${adminSessionToken}`,
        origin: baseUrl,
        'sec-fetch-site': 'same-origin'
      },
      body: JSON.stringify({ minPayoutThresholdKes: 500 })
    });
    const body = await response.json() as Record<string, any>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      settings: { minPayoutThresholdKes: 500 }
    });
    expect(affiliateMocks.saveSettings).toHaveBeenCalledWith(
      { minPayoutThresholdKes: 500 },
      'Admin (Jake)'
    );
    expect(affiliateMocks.getAffiliateById).not.toHaveBeenCalledWith('settings');
    expect(affiliateMocks.updateAffiliate).not.toHaveBeenCalled();
  });

  it('keeps proposed Literary Circle commission rates in draft without explicit activation', async () => {
    const getResponse = await fetch(`${baseUrl}/api/admin/affiliates/literary-circle/settings`, {
      headers: { cookie: `iw_session=${adminSessionToken}` }
    });
    const current = (await getResponse.json() as Record<string, any>).settings;

    const rejectedActivation = await fetch(`${baseUrl}/api/admin/affiliates/literary-circle/settings`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        cookie: `iw_session=${adminSessionToken}`,
        origin: baseUrl,
        'sec-fetch-site': 'same-origin'
      },
      body: JSON.stringify({
        ...current,
        commissionPolicy: {
          ...current.commissionPolicy,
          status: 'active',
          effectiveAt: '2026-10-20T00:00:00.000Z'
        }
      })
    });

    expect(getResponse.status).toBe(200);
    expect(rejectedActivation.status).toBe(409);
    expect(await rejectedActivation.json()).toMatchObject({
      code: 'COMMISSION_POLICY_CONFIRMATION_REQUIRED'
    });
    expect(affiliateMocks.saveLiteraryCircleSettings).not.toHaveBeenCalled();

    const draftSave = await fetch(`${baseUrl}/api/admin/affiliates/literary-circle/settings`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        cookie: `iw_session=${adminSessionToken}`,
        origin: baseUrl,
        'sec-fetch-site': 'same-origin'
      },
      body: JSON.stringify({ ...current, introductoryPeriodDays: 45 })
    });
    expect(draftSave.status).toBe(200);
    expect(affiliateMocks.saveLiteraryCircleSettings).toHaveBeenCalledWith(
      expect.objectContaining({ introductoryPeriodDays: 45 }),
      'Admin (Jake)'
    );
  });

  it('requires fresh confirmation before changing an already-active commission policy', async () => {
    const getResponse = await fetch(`${baseUrl}/api/admin/affiliates/literary-circle/settings`, {
      headers: { cookie: `iw_session=${adminSessionToken}` }
    });
    const draft = (await getResponse.json() as Record<string, any>).settings;
    const active = {
      ...draft,
      commissionPolicy: {
        ...draft.commissionPolicy,
        status: 'active',
        effectiveAt: '2026-10-20T00:00:00.000Z'
      }
    };
    const changed = {
      ...active,
      tiers: active.tiers.map((tier: Record<string, any>, index: number) => index === 0
        ? { ...tier, proposedCommissionRate: 16 }
        : tier)
    };
    affiliateMocks.getLiteraryCircleSettingsFresh.mockResolvedValueOnce(active);

    const rejected = await fetch(`${baseUrl}/api/admin/affiliates/literary-circle/settings`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        cookie: `iw_session=${adminSessionToken}`,
        origin: baseUrl,
        'sec-fetch-site': 'same-origin'
      },
      body: JSON.stringify(changed)
    });

    expect(rejected.status).toBe(409);
    expect(await rejected.json()).toMatchObject({
      code: 'COMMISSION_POLICY_CONFIRMATION_REQUIRED'
    });
    expect(affiliateMocks.saveLiteraryCircleSettings).not.toHaveBeenCalled();

    affiliateMocks.getLiteraryCircleSettingsFresh.mockResolvedValueOnce(active);
    const confirmed = await fetch(`${baseUrl}/api/admin/affiliates/literary-circle/settings`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        cookie: `iw_session=${adminSessionToken}`,
        origin: baseUrl,
        'sec-fetch-site': 'same-origin'
      },
      body: JSON.stringify({ ...changed, confirmCommissionPolicyActivation: true })
    });

    expect(confirmed.status).toBe(200);
    expect(affiliateMocks.saveLiteraryCircleSettings).toHaveBeenCalledWith(
      expect.objectContaining({ tiers: expect.any(Array) }),
      'Admin (Jake)'
    );
  });

  it('allows the writer to suspend complimentary access without exposing the general profile editor', async () => {
    const response = await fetch(`${baseUrl}/api/admin/affiliates/${privateAffiliate.id}/literary-circle`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        cookie: `iw_session=${adminSessionToken}`,
        origin: baseUrl,
        'sec-fetch-site': 'same-origin'
      },
      body: JSON.stringify({
        complimentaryAccessStatus: 'suspended',
        complimentaryAccessReason: 'Writer review',
        balanceAvailableKes: 0,
        foundingMember: false
      })
    });
    const body = await response.json() as Record<string, any>;

    expect(response.status).toBe(200);
    expect(body.affiliate.literaryCircle.complimentaryAccess.status).toBe('suspended');
    expect(affiliateMocks.updateLiteraryCircleMembership).toHaveBeenCalledWith(
      privateAffiliate.id,
      {
        complimentaryAccessStatus: 'suspended',
        complimentaryAccessReason: 'Writer review'
      },
      'Admin (Jake)'
    );
    expect(affiliateMocks.updateAffiliate).not.toHaveBeenCalled();
  });

  it('keeps named affiliate admin reads ahead of the dynamic affiliate detail route', async () => {
    for (const path of ['settings', 'commissions', 'payouts', 'campaigns', 'audit-logs']) {
      const response = await fetch(`${baseUrl}/api/admin/affiliates/${path}`, {
        headers: { cookie: `iw_session=${adminSessionToken}` }
      });
      expect(response.status, path).toBe(200);
      if (path === 'settings') {
        expect(response.headers.get('cache-control')).toBe('private, no-store');
      }
    }

    expect(affiliateMocks.getAffiliateById).not.toHaveBeenCalled();
    expect(affiliateMocks.getSettingsFresh).toHaveBeenCalled();
    expect(affiliateMocks.getCommissions).toHaveBeenCalled();
    expect(affiliateMocks.getPayouts).toHaveBeenCalled();
    expect(affiliateMocks.getCampaigns).toHaveBeenCalled();
    expect(affiliateMocks.getAuditLogs).toHaveBeenCalled();

    const detailResponse = await fetch(`${baseUrl}/api/admin/affiliates/${privateAffiliate.id}`, {
      headers: { cookie: `iw_session=${adminSessionToken}` }
    });
    expect(detailResponse.status).toBe(200);
    expect(affiliateMocks.getAffiliateById).toHaveBeenCalledWith(privateAffiliate.id);
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

  it('returns bounded public article summaries without paid bodies or original base64 images', async () => {
    const [articlesResponse, homepageResponse] = await Promise.all([
      fetch(`${baseUrl}/api/articles`),
      fetch(`${baseUrl}/api/homepage`)
    ]);
    const articles = await articlesResponse.json() as Record<string, any>[];
    const homepage = await homepageResponse.json() as Record<string, any>;

    expect(articlesResponse.status).toBe(200);
    expect(homepageResponse.status).toBe(200);
    expect(articles[0]).toMatchObject({ content: '', isUnlocked: false });
    expect(articles[0].coverImage).toMatch(/^\/api\/articles\/art-public-1\/cover\?v=/);
    expect(articles[0]).not.toHaveProperty('coverImageOriginal');
    expect(homepage).not.toHaveProperty('startHerePieces');
    expect(homepage).not.toHaveProperty('autoRankedPieces');
    expect(homepage.mostSellingPieces[0]).toMatchObject({ content: '', isUnlocked: false });
    expect(homepage.mostSellingPieces[0]).not.toHaveProperty('coverImageOriginal');
    expect(JSON.stringify(homepage)).not.toContain(publicArticleFixture.content);
  });

  it('unlocks a paid piece for an active Literary Circle affiliate without creating a purchase', async () => {
    affiliateMocks.verifyAffiliateSession.mockResolvedValueOnce({
      ...privateAffiliate,
      literaryCircle: activeLiteraryCircleMembership
    });

    const response = await fetch(`${baseUrl}/api/articles/${publicArticleFixture.id}`, {
      headers: { cookie: validCookie }
    });
    const body = await response.json() as Record<string, any>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      id: publicArticleFixture.id,
      isUnlocked: true,
      accessSource: 'AFFILIATE_COMPLIMENTARY',
      content: publicArticleFixture.content
    });
    expect(affiliateMocks.verifyAffiliateSession).toHaveBeenCalledWith(expect.any(String), { forceFresh: true });
    expect(storeMocks.confirmTransaction).not.toHaveBeenCalled();
    expect(storeMocks.savePurchasedToken).not.toHaveBeenCalled();
  });

  it('keeps a paid piece locked after Literary Circle access is suspended', async () => {
    affiliateMocks.verifyAffiliateSession.mockResolvedValueOnce({
      ...privateAffiliate,
      literaryCircle: {
        ...activeLiteraryCircleMembership,
        complimentaryAccess: {
          ...activeLiteraryCircleMembership.complimentaryAccess,
          status: 'suspended'
        }
      }
    });

    const response = await fetch(`${baseUrl}/api/articles/${publicArticleFixture.id}`, {
      headers: { cookie: validCookie }
    });
    const body = await response.json() as Record<string, any>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      id: publicArticleFixture.id,
      isUnlocked: false,
      content: ''
    });
    expect(body).not.toHaveProperty('accessSource');
  });

  it('fails closed when fresh Literary Circle access verification is unavailable', async () => {
    affiliateMocks.verifyAffiliateSession.mockRejectedValueOnce(new Error('quota exhausted'));

    const response = await fetch(`${baseUrl}/api/articles/${publicArticleFixture.id}`, {
      headers: { cookie: validCookie }
    });
    const body = await response.json() as Record<string, any>;

    expect(response.status).toBe(503);
    expect(body).toMatchObject({ error: expect.stringMatching(/temporarily unavailable/i) });
    expect(JSON.stringify(body)).not.toContain('quota exhausted');
    expect(JSON.stringify(body)).not.toContain(publicArticleFixture.content);
  });

  it('returns a compact complimentary library only after fresh Literary Circle verification', async () => {
    affiliateMocks.verifyAffiliateSession.mockResolvedValue({
      ...privateAffiliate,
      literaryCircle: activeLiteraryCircleMembership
    });

    const response = await fetch(`${baseUrl}/api/affiliate/literary-circle/library`, {
      headers: { cookie: validCookie }
    });
    const body = await response.json() as Record<string, any>;

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(body).toMatchObject({
      success: true,
      accessSource: 'AFFILIATE_COMPLIMENTARY',
      articles: [{
        id: publicArticleFixture.id,
        isUnlocked: true,
        content: '',
        accessSource: 'AFFILIATE_COMPLIMENTARY'
      }]
    });
    expect(affiliateMocks.verifyAffiliateSession).toHaveBeenCalledWith(expect.any(String), { forceFresh: true });
    expect(JSON.stringify(body)).not.toContain(publicArticleFixture.content);
  });

  it('persists only the authenticated affiliate onboarding progress fields', async () => {
    const response = await fetch(`${baseUrl}/api/affiliate/literary-circle/onboarding`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        cookie: validCookie,
        origin: baseUrl,
        'sec-fetch-site': 'same-origin'
      },
      body: JSON.stringify({
        completedStepId: 'welcome',
        complimentaryAccessStatus: 'active',
        commissionRate: 100
      })
    });
    const body = await response.json() as Record<string, any>;

    expect(response.status).toBe(200);
    expect(body.onboarding).toMatchObject({ completedStepIds: ['welcome'], welcomeRequired: false });
    expect(affiliateMocks.updateLiteraryCircleOnboarding).toHaveBeenCalledWith(
      privateAffiliate.id,
      { completedStepId: 'welcome' },
      `Affiliate (${privateAffiliate.name})`
    );
  });

  it('returns one coherent no-store bootstrap payload and checks the shared article version', async () => {
    const response = await fetch(`${baseUrl}/api/public/bootstrap`);
    const body = await response.json() as Record<string, any>;

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('cdn-cache-control')).toBe('no-store');
    expect(response.headers.get('vercel-cdn-cache-control')).toBe('no-store');
    expect(storeMocks.getFreshArticles).toHaveBeenCalledWith(false, true);
    expect(storeMocks.refreshPublicMetadata).toHaveBeenCalledTimes(1);
    expect(storeMocks.getFreshHomepageConfig).toHaveBeenCalledTimes(1);
    expect(body).toMatchObject({
      author: { name: 'Jake' },
      categories: [{ id: 'category-1', name: 'Essays' }],
      topics: [{ id: 'topic-1', name: 'Memory' }],
      newsletter: { doubleOptIn: true }
    });
    expect(body.articles[0]).toMatchObject({ content: '', isUnlocked: false });
    expect(body.articles[0]).not.toHaveProperty('coverImageOriginal');
    expect(JSON.stringify(body)).not.toContain(publicArticleFixture.content);
  });

  it('keeps legacy reading times visible and carries an explicit hidden setting to public summaries', async () => {
    storeMocks.getArticles.mockReturnValue([
      { ...publicArticleFixture },
      { ...publicArticleFixture, id: 'art-hidden-time', showReadTime: false }
    ]);

    const response = await fetch(`${baseUrl}/api/articles`);
    const articles = await response.json() as Record<string, any>[];

    expect(response.status).toBe(200);
    expect(articles.map(article => article.showReadTime)).toEqual([true, false]);
  });

  it('accepts a hidden reading time when a writer creates a piece', async () => {
    storeMocks.saveArticle.mockImplementationOnce(async (article: unknown) => article);

    const response = await fetch(`${baseUrl}/api/admin/articles`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `iw_session=${adminSessionToken}`,
        origin: baseUrl,
        'sec-fetch-site': 'same-origin'
      },
      body: JSON.stringify({
        title: 'An Unhurried Piece',
        content: 'A short passage.',
        status: 'draft',
        showReadTime: false
      })
    });

    expect(response.status).toBe(201);
    expect(storeMocks.saveArticle).toHaveBeenCalledWith(
      expect.objectContaining({ showReadTime: false }),
      true,
      'Initial creation'
    );
  });

  it('keeps the admin homepage GET response compact with oversized article bodies and image bytes', async () => {
    const privateBody = `PRIVATE_HOMEPAGE_BODY_${'x'.repeat(400_000)}`;
    const inlineCover = `data:image/jpeg;base64,INLINE_COVER_${'A'.repeat(400_000)}`;
    const originalCover = `data:image/jpeg;base64,PRIVATE_ORIGINAL_${'B'.repeat(400_000)}`;
    const largeArticle = {
      ...publicArticleFixture,
      content: privateBody,
      coverImage: inlineCover,
      coverImageOriginal: originalCover
    };
    storeMocks.getArticles.mockReturnValue([largeArticle]);
    storeMocks.getHomepageConfig.mockReturnValue({
      config: {
        welcomeBackground: {},
        mostSellingPieceIds: [largeArticle.id],
        pieceOfTheWeekId: largeArticle.id,
        updatedAt: '2026-09-09T01:00:00.000Z'
      },
      startHerePieces: [largeArticle],
      mostSellingPieces: [largeArticle],
      pieceOfTheWeek: largeArticle,
      autoRankedPieces: [largeArticle],
      categories: []
    });

    const response = await fetch(`${baseUrl}/api/admin/homepage`, {
      headers: { cookie: `iw_session=${adminSessionToken}` }
    });
    const responseText = await response.text();
    const body = JSON.parse(responseText) as Record<string, any>;

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(responseText.length).toBeLessThan(20_000);
    expect(responseText).not.toContain('PRIVATE_HOMEPAGE_BODY_');
    expect(responseText).not.toContain('INLINE_COVER_');
    expect(responseText).not.toContain('PRIVATE_ORIGINAL_');
    for (const article of [
      ...body.startHerePieces,
      ...body.mostSellingPieces,
      body.pieceOfTheWeek,
      ...body.autoRankedPieces,
      ...body.allPublishedPieces
    ]) {
      expect(article.content).toBe('');
      expect(article).not.toHaveProperty('coverImageOriginal');
      expect(article.coverImage).toMatch(/^\/api\/articles\/art-public-1\/cover\?v=/);
    }
  });

  it('keeps the admin homepage PUT success response compact after a versioned partial save', async () => {
    const largeArticle = {
      ...publicArticleFixture,
      content: `PRIVATE_SAVED_BODY_${'x'.repeat(400_000)}`,
      coverImage: `data:image/jpeg;base64,INLINE_SAVED_COVER_${'A'.repeat(400_000)}`,
      coverImageOriginal: `data:image/jpeg;base64,PRIVATE_SAVED_ORIGINAL_${'B'.repeat(400_000)}`
    };
    const savedHomepage = {
      config: {
        welcomeBackground: {},
        mostSellingPieceIds: [largeArticle.id],
        pieceOfTheWeekId: largeArticle.id,
        updatedAt: '2026-09-09T02:00:00.000Z'
      },
      startHerePieces: [largeArticle],
      mostSellingPieces: [largeArticle],
      pieceOfTheWeek: largeArticle,
      autoRankedPieces: [largeArticle],
      categories: []
    };
    storeMocks.getArticles.mockReturnValue([largeArticle]);
    storeMocks.saveHomepageConfig.mockResolvedValueOnce(savedHomepage);

    const response = await fetch(`${baseUrl}/api/admin/homepage`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        cookie: `iw_session=${adminSessionToken}`,
        origin: baseUrl,
        'sec-fetch-site': 'same-origin'
      },
      body: JSON.stringify({
        config: { pieceOfTheWeekId: largeArticle.id },
        expectedUpdatedAt: '2026-09-09T01:00:00.000Z'
      })
    });
    const responseText = await response.text();
    const body = JSON.parse(responseText) as Record<string, any>;

    expect(response.status).toBe(200);
    expect(storeMocks.saveHomepageConfig).toHaveBeenCalledWith(
      { pieceOfTheWeekId: largeArticle.id },
      '2026-09-09T01:00:00.000Z'
    );
    expect(responseText.length).toBeLessThan(20_000);
    expect(responseText).not.toContain('PRIVATE_SAVED_BODY_');
    expect(responseText).not.toContain('INLINE_SAVED_COVER_');
    expect(responseText).not.toContain('PRIVATE_SAVED_ORIGINAL_');
    expect(body).toMatchObject({ success: true, config: savedHomepage.config });
    for (const article of [
      ...body.startHerePieces,
      ...body.mostSellingPieces,
      body.pieceOfTheWeek,
      ...body.autoRankedPieces,
      ...body.allPublishedPieces
    ]) {
      expect(article.content).toBe('');
      expect(article).not.toHaveProperty('coverImageOriginal');
      expect(article.coverImage).toMatch(/^\/api\/articles\/art-public-1\/cover\?v=/);
    }
  });

  it('returns 409 for a stale admin homepage save instead of a successful acknowledgement', async () => {
    const { HomepageSaveConflictError } = await import('./src/server/store.js');
    storeMocks.saveHomepageConfig.mockRejectedValueOnce(new HomepageSaveConflictError());

    const response = await fetch(`${baseUrl}/api/admin/homepage`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        cookie: `iw_session=${adminSessionToken}`,
        origin: baseUrl,
        'sec-fetch-site': 'same-origin'
      },
      body: JSON.stringify({
        config: { pieceOfTheWeekId: publicArticleFixture.id },
        expectedUpdatedAt: '2026-09-09T00:00:00.000Z'
      })
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: 'HOMEPAGE_SAVE_CONFLICT',
      error: expect.stringMatching(/reload the latest settings/i)
    });
    expect(storeMocks.saveHomepageConfig).toHaveBeenCalledWith(
      { pieceOfTheWeekId: publicArticleFixture.id },
      '2026-09-09T00:00:00.000Z'
    );
  });
});
