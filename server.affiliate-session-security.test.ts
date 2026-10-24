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

const literaryCircleDashboardFixture = {
  enabled: true,
  foundingMember: true,
  complimentaryAccessStatus: 'active' as const,
  currentTier: {
    id: 'literary-partner',
    name: 'Literary Partner',
    description: 'Approved Literary Circle membership.',
    rank: 1,
    monthlyVerifiedSalesThreshold: 0,
    proposedCommissionRate: 15,
    enabled: true
  },
  monthlyVerifiedSales: 0,
  lifetimeVerifiedSales: 0,
  progressToNextTierPercent: 100,
  salesToNextTier: 0,
  onboarding: activeLiteraryCircleMembership.onboarding,
  introductoryPeriodActive: true,
  commissionPolicyStatus: 'draft' as const,
  community: {
    enabled: true,
    title: 'Stale private title',
    description: 'Stale private description',
    posts: [{
      id: 'stale-private-post',
      type: 'announcement' as const,
      title: 'Stale private post',
      body: 'This must never leave the cached dashboard.',
      isPublished: true,
      order: 0
    }]
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
  processPayout: vi.fn(),
  updateCommissionStatus: vi.fn(),
  getCampaigns: vi.fn(),
  getCampaignsFresh: vi.fn(),
  getAuditLogs: vi.fn(),
  getAuditLogsFresh: vi.fn(),
  getAdminAffiliateAnalytics: vi.fn(),
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
  hasComplimentaryCatalogueAccess: vi.fn(),
  rememberCommittedAudit: vi.fn()
}));

const resourceMocks = vi.hoisted(() => ({
  getFresh: vi.fn(),
  project: vi.fn(),
  save: vi.fn(),
  associateImage: vi.fn(),
  removeImage: vi.fn()
}));

const notificationPreferenceMocks = vi.hoisted(() => ({
  getFresh: vi.fn(),
  save: vi.fn(),
  optOut: vi.fn(),
}));

const approvalMocks = vi.hoisted(() => ({
  approve: vi.fn(),
}));

const affiliateErrorMocks = vi.hoisted(() => ({
  LiteraryCircleSettingsConflictError: class LiteraryCircleSettingsConflictError extends Error {
    constructor() {
      super('Literary Circle settings changed since this editor was opened. Reload the latest settings before saving again.');
      this.name = 'LiteraryCircleSettingsConflictError';
    }
  }
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
  LiteraryCircleSettingsConflictError: affiliateErrorMocks.LiteraryCircleSettingsConflictError,
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
vi.mock('./src/server/literaryCircleResources.js', () => ({
  getLiteraryCircleResourceLibraryFresh: resourceMocks.getFresh,
  projectLiteraryCircleResourcesForAffiliate: resourceMocks.project,
  saveLiteraryCircleResourceLibrary: resourceMocks.save,
  associateLiteraryCircleResourceImage: resourceMocks.associateImage,
  removeLiteraryCircleResourceImage: resourceMocks.removeImage,
  LiteraryCircleResourcesConflictError: class LiteraryCircleResourcesConflictError extends Error {
    readonly code = 'LITERARY_CIRCLE_RESOURCES_CONFLICT';
  },
  LiteraryCircleResourcesValidationError: class LiteraryCircleResourcesValidationError extends Error {
    readonly code = 'LITERARY_CIRCLE_RESOURCES_INVALID';
  }
}));
vi.mock('./src/server/affiliateNotificationPreferences.js', () => ({
  AFFILIATE_MARKETING_DISCLOSURE_VERSION: 'literary-circle-marketing-2026-10-v1',
  AffiliateNotificationPreferencesConflictError: class AffiliateNotificationPreferencesConflictError extends Error {},
  AffiliateNotificationPreferencesNotFoundError: class AffiliateNotificationPreferencesNotFoundError extends Error {},
  AffiliateNotificationPreferencesValidationError: class AffiliateNotificationPreferencesValidationError extends Error {},
  getAffiliateNotificationPreferencesFresh: notificationPreferenceMocks.getFresh,
  saveAffiliateNotificationPreferences: notificationPreferenceMocks.save,
  optOutAffiliateMarketingByToken: notificationPreferenceMocks.optOut,
  normalizeAffiliateNotificationPreferences: (value: unknown) => value || {
    schemaVersion: 1,
    revision: 0,
    marketingConsent: 'unknown',
    releaseUpdates: false,
    campaignUpdates: false,
    inactivityReminders: false,
    exclusiveOpportunities: false,
    commissionAlerts: true,
    tierAlerts: true,
    allMarketingOptOut: true,
  },
}));
vi.mock('./src/server/affiliateApproval.js', () => ({
  AffiliateApprovalNotFoundError: class AffiliateApprovalNotFoundError extends Error {},
  AffiliateApprovalValidationError: class AffiliateApprovalValidationError extends Error {},
  approveAffiliateAccount: approvalMocks.approve,
  hasValidAffiliateWriterApproval: (value: any) => Boolean(
    value?.approvedAt
    && Number.isFinite(Date.parse(value.approvedAt))
    && typeof value?.approvedBy === 'string'
    && value.approvedBy.trim()
  ),
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
    affiliateMocks.getCampaignsFresh.mockResolvedValue([]);
    affiliateMocks.getAuditLogs.mockReturnValue([]);
    affiliateMocks.getAuditLogsFresh.mockResolvedValue([]);
    affiliateMocks.getAdminAffiliateAnalytics.mockReturnValue({ report: 'aggregate-only' });
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
    const resourceLibrary = {
      schemaVersion: 1,
      revision: 2,
      enabled: true,
      title: 'Partner campaign desk',
      description: 'Approved materials.',
      items: [{
        id: 'resource-one',
        kind: 'social_copy',
        title: 'Approved caption',
        body: 'Current approved copy.',
        destination: { kind: 'piece', id: publicArticleFixture.id },
        isPublished: true,
        order: 0,
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-02T00:00:00.000Z'
      }]
    };
    resourceMocks.getFresh.mockResolvedValue(resourceLibrary);
    resourceMocks.project.mockImplementation(value => value);
    resourceMocks.save.mockResolvedValue({ library: resourceLibrary, audit: { id: 'audit-resource-save' } });
    resourceMocks.associateImage.mockResolvedValue({
      library: resourceLibrary,
      asset: { id: 'asset-one', shareable: false },
      audit: { id: 'audit-resource-image' }
    });
    resourceMocks.removeImage.mockResolvedValue({
      library: resourceLibrary,
      retainedShareableAsset: false,
      audit: { id: 'audit-resource-remove' }
    });
    notificationPreferenceMocks.getFresh.mockResolvedValue({
      schemaVersion: 1,
      revision: 0,
      marketingConsent: 'unknown',
      releaseUpdates: false,
      campaignUpdates: false,
      inactivityReminders: false,
      exclusiveOpportunities: false,
      commissionAlerts: true,
      tierAlerts: true,
      allMarketingOptOut: true,
    });
    notificationPreferenceMocks.save.mockResolvedValue({
      preferences: {
        schemaVersion: 1,
        revision: 1,
        marketingConsent: 'denied',
        releaseUpdates: false,
        campaignUpdates: false,
        inactivityReminders: false,
        exclusiveOpportunities: false,
        commissionAlerts: true,
        tierAlerts: true,
        allMarketingOptOut: true,
      },
      audit: { id: 'audit-notification-preferences' },
    });
    notificationPreferenceMocks.optOut.mockResolvedValue({ accepted: true, changed: false });
    approvalMocks.approve.mockResolvedValue({
      affiliate: {
        ...privateAffiliate,
        approvedAt: '2026-10-19T00:00:00.000Z',
        approvedBy: 'Admin (Test Admin)',
      },
      audit: { id: 'audit-writer-approval' },
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

  it('keeps self-registration pending and does not create an authenticated session before writer approval', async () => {
    affiliateMocks.createAffiliate.mockResolvedValueOnce({ ...privateAffiliate, status: 'pending' });
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

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      success: true,
      pendingApproval: true,
      affiliate: { status: 'pending' }
    });
    expect(affiliateMocks.createAffiliate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending' }),
      'Self-Registered'
    );
    expect(affiliateMocks.createAffiliateSession).not.toHaveBeenCalled();
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('loads and saves notification choices for the authenticated affiliate identity', async () => {
    const read = await fetch(`${baseUrl}/api/affiliate/notifications/preferences`, {
      headers: { cookie: validCookie }
    });
    const update = {
      expectedRevision: 0,
      marketingConsent: false,
      releaseUpdates: false,
      campaignUpdates: false,
      inactivityReminders: false,
      exclusiveOpportunities: false,
      commissionAlerts: true,
      tierAlerts: true,
    };
    const write = await fetch(`${baseUrl}/api/affiliate/notifications/preferences`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        cookie: validCookie,
        origin: baseUrl,
        'sec-fetch-site': 'same-origin'
      },
      body: JSON.stringify(update)
    });

    expect(read.status).toBe(200);
    expect(write.status).toBe(200);
    expect(notificationPreferenceMocks.getFresh).toHaveBeenCalledWith(privateAffiliate.id);
    expect(notificationPreferenceMocks.save).toHaveBeenCalledWith(
      privateAffiliate.id,
      update,
      `Affiliate (${privateAffiliate.name})`
    );
    expect(affiliateMocks.rememberCommittedAudit).toHaveBeenCalledWith({ id: 'audit-notification-preferences' });
  });

  it('accepts a signed marketing opt-out without exposing affiliate identity', async () => {
    notificationPreferenceMocks.optOut.mockResolvedValueOnce({
      accepted: true,
      changed: true,
      affiliateId: privateAffiliate.id,
      audit: { id: 'audit-signed-opt-out' },
    });
    const response = await fetch(`${baseUrl}/api/affiliate/notifications/unsubscribe`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: baseUrl,
        'sec-fetch-site': 'same-origin'
      },
      body: JSON.stringify({ token: 'signed-capability' })
    });
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(202);
    expect(body).toEqual({ accepted: true });
    expect(JSON.stringify(body)).not.toContain(privateAffiliate.id);
    expect(notificationPreferenceMocks.optOut).toHaveBeenCalledWith('signed-capability');
    expect(affiliateMocks.rememberCommittedAudit).toHaveBeenCalledWith({ id: 'audit-signed-opt-out' });
    expect(affiliateMocks.getAffiliateByIdFresh).toHaveBeenCalledWith(privateAffiliate.id);
  });

  it('requires an empty admin-only request for explicit writer approval', async () => {
    const rejected = await fetch(`${baseUrl}/api/admin/affiliates/${privateAffiliate.id}/approval`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `iw_session=${adminSessionToken}`,
        origin: baseUrl,
        'sec-fetch-site': 'same-origin'
      },
      body: JSON.stringify({ approvedAt: 'attacker-controlled' })
    });

    expect(rejected.status).toBe(400);
    expect(approvalMocks.approve).not.toHaveBeenCalled();

    const approvedAffiliate = {
      ...privateAffiliate,
      approvedAt: '2026-10-19T00:00:00.000Z',
      approvedBy: 'Admin (Test Admin)',
    };
    affiliateMocks.getAffiliateByIdFresh.mockResolvedValueOnce(approvedAffiliate);
    const approved = await fetch(`${baseUrl}/api/admin/affiliates/${privateAffiliate.id}/approval`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `iw_session=${adminSessionToken}`,
        origin: baseUrl,
        'sec-fetch-site': 'same-origin'
      },
      body: JSON.stringify({})
    });

    expect(approved.status).toBe(200);
    expect(approvalMocks.approve).toHaveBeenCalledWith(privateAffiliate.id, 'Admin (Test Admin)');
    expect(await approved.json()).toMatchObject({
      success: true,
      affiliate: { approvedBy: 'Admin (Test Admin)' }
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

  it.each(['commission', 'payout'] as const)('awaits the %s financial commit before returning success', async kind => {
    let entered!: () => void;
    const reached = new Promise<void>(resolve => { entered = resolve; });
    let commit!: (value: any) => void;
    const pending = new Promise(resolve => { commit = resolve; });
    const operation = kind === 'commission' ? affiliateMocks.updateCommissionStatus : affiliateMocks.processPayout;
    operation.mockImplementationOnce(() => { entered(); return pending; });
    let acknowledged = false;
    const responsePromise = fetch(`${baseUrl}/api/admin/affiliates/${kind === 'commission' ? 'commissions/commission_one/status' : 'payouts/payout_one/process'}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `iw_session=${adminSessionToken}`,
        origin: baseUrl, 'sec-fetch-site': 'same-origin' },
      body: JSON.stringify(kind === 'commission' ? { status: 'reversed', reason: 'Confirmed refund' }
        : { action: 'pay', paymentReference: 'RECEIPT-VERIFIED' })
    }).then(value => { acknowledged = true; return value; });
    await reached;
    expect(acknowledged).toBe(false);
    commit(kind === 'commission' ? { id: 'commission_one', receiptNumber: 'SALE1', status: 'REVERSED' }
      : { id: 'payout_one', status: 'PAID' });
    const response = await responsePromise;
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true });
    if (kind === 'commission') expect(operation).toHaveBeenCalledWith('commission_one', 'REVERSED', 'Admin (Jake)', 'Confirmed refund');
    else expect(operation).toHaveBeenCalledWith('payout_one', 'mark_paid', 'RECEIPT-VERIFIED', undefined, 'Admin (Jake)');
  });

  it('protects notification operations and cron jobs before any runtime work', async () => {
    const anonymous = await fetch(`${baseUrl}/api/admin/affiliates/notifications/runtime`);
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get('cache-control')).toContain('no-store');
    const affiliate = await fetch(`${baseUrl}/api/admin/affiliates/notifications/runtime`, {
      headers: { cookie: validCookie }
    });
    expect([401, 403]).toContain(affiliate.status);
    const cron = await fetch(`${baseUrl}/api/internal/affiliate-notifications/dispatch`);
    expect(cron.status).toBe(401);
    expect(cron.headers.get('cache-control')).toContain('no-store');
  });

  it('rejects runtime recipient and clock injection even from an administrator', async () => {
    const response = await fetch(`${baseUrl}/api/admin/affiliates/notifications/runtime`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `iw_session=${adminSessionToken}`,
        origin: baseUrl, 'sec-fetch-site': 'same-origin' },
      body: JSON.stringify({ mode: 'dispatch', recipient: 'other@example.test', now: '2099-01-01' })
    });
    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it('blocks a cross-site notification dispatch before authentication work', async () => {
    const response = await fetch(`${baseUrl}/api/admin/affiliates/notifications/runtime`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `iw_session=${adminSessionToken}`,
        origin: 'https://untrusted.example', 'sec-fetch-site': 'cross-site' },
      body: JSON.stringify({ mode: 'dispatch' })
    });
    expect(response.status).toBe(403);
  });

  it('returns a reloadable conflict instead of overwriting newer Literary Circle settings', async () => {
    const getResponse = await fetch(`${baseUrl}/api/admin/affiliates/literary-circle/settings`, {
      headers: { cookie: `iw_session=${adminSessionToken}` }
    });
    const current = (await getResponse.json() as Record<string, any>).settings;
    affiliateMocks.saveLiteraryCircleSettings.mockRejectedValueOnce(
      new affiliateErrorMocks.LiteraryCircleSettingsConflictError()
    );

    const response = await fetch(`${baseUrl}/api/admin/affiliates/literary-circle/settings`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        cookie: `iw_session=${adminSessionToken}`,
        origin: baseUrl,
        'sec-fetch-site': 'same-origin'
      },
      body: JSON.stringify({ ...current, introductoryPeriodDays: 42 })
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      success: false,
      code: 'LITERARY_CIRCLE_SETTINGS_CONFLICT',
      error: expect.stringMatching(/reload the latest settings/i)
    });
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
    expect(affiliateMocks.getCampaignsFresh).toHaveBeenCalled();
    expect(affiliateMocks.getAuditLogsFresh).toHaveBeenCalled();

    const detailResponse = await fetch(`${baseUrl}/api/admin/affiliates/${privateAffiliate.id}`, {
      headers: { cookie: `iw_session=${adminSessionToken}` }
    });
    expect(detailResponse.status).toBe(200);
    expect(affiliateMocks.getAffiliateById).toHaveBeenCalledWith(privateAffiliate.id);
  });

  it('keeps aggregate affiliate analytics writer-only, no-store, and query allow-listed', async () => {
    const anonymous = await fetch(`${baseUrl}/api/admin/affiliates/analytics`);
    expect(anonymous.status).toBe(401);
    expect(affiliateMocks.getAdminAffiliateAnalytics).not.toHaveBeenCalled();

    const response = await fetch(
      `${baseUrl}/api/admin/affiliates/analytics?startDate=2026-10-01&endDate=2026-10-20&affiliateId=aff_test_1&purchaseKind=piece&readerEmail=private%40example.test&buyerKey=abk1_private`,
      { headers: { cookie: `iw_session=${adminSessionToken}` } },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ report: 'aggregate-only' });
    expect(affiliateMocks.getAdminAffiliateAnalytics).toHaveBeenCalledWith({
      startDate: '2026-10-01',
      endDate: '2026-10-20',
      filters: {
        affiliateId: 'aff_test_1',
        purchaseKind: 'piece',
      },
    });

    affiliateMocks.getAdminAffiliateAnalytics.mockClear();
    const invalid = await fetch(`${baseUrl}/api/admin/affiliates/analytics?purchaseKind=tip`, {
      headers: { cookie: `iw_session=${adminSessionToken}` },
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({
      error: 'Purchase type must be piece, bundle, or subscription.',
    });
    expect(affiliateMocks.getAdminAffiliateAnalytics).not.toHaveBeenCalled();
  });

  it('loads admin affiliate audits from the shared store and fails closed if that read is unavailable', async () => {
    affiliateMocks.getAuditLogsFresh.mockResolvedValueOnce([{
      id: 'audit-shared-1',
      timestamp: '2026-10-18T08:00:00.000Z',
      actor: 'Writer',
      action: 'literary_circle_resources_saved',
      targetType: 'resource',
      summary: 'Shared committed audit'
    }]);
    const response = await fetch(`${baseUrl}/api/admin/affiliates/audit-logs?limit=25`, {
      headers: { cookie: `iw_session=${adminSessionToken}` }
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.json()).toEqual([expect.objectContaining({ id: 'audit-shared-1' })]);
    expect(affiliateMocks.getAuditLogsFresh).toHaveBeenCalledWith(25);

    affiliateMocks.getAuditLogsFresh.mockRejectedValueOnce(new Error('private firestore detail'));
    const unavailable = await fetch(`${baseUrl}/api/admin/affiliates/audit-logs`, {
      headers: { cookie: `iw_session=${adminSessionToken}` }
    });
    expect(unavailable.status).toBe(503);
    expect(JSON.stringify(await unavailable.json())).not.toContain('private firestore detail');
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

  it('never releases private community content through the cached dashboard payload', async () => {
    affiliateMocks.getAffiliateDashboard.mockReturnValue({
      affiliate: privateAffiliate,
      sales: [],
      literaryCircle: literaryCircleDashboardFixture
    });

    const response = await fetch(`${baseUrl}/api/affiliate/dashboard`, {
      headers: { cookie: validCookie }
    });
    const body = await response.json() as Record<string, any>;

    expect(response.status).toBe(200);
    expect(body.literaryCircle.community).toEqual({
      enabled: false,
      title: '',
      description: '',
      posts: []
    });
    expect(JSON.stringify(body)).not.toContain('Stale private post');
    expect(JSON.stringify(body)).not.toContain('Stale private description');
  });

  it('returns only fresh, currently published private community posts', async () => {
    affiliateMocks.verifyAffiliateSession.mockResolvedValue({
      ...privateAffiliate,
      literaryCircle: activeLiteraryCircleMembership
    });
    affiliateMocks.getAffiliateDashboard.mockReturnValue({
      affiliate: privateAffiliate,
      sales: [],
      literaryCircle: literaryCircleDashboardFixture
    });
    affiliateMocks.getLiteraryCircleSettingsFresh.mockResolvedValue({
      schemaVersion: 1,
      enabled: true,
      defaultTierId: 'literary-partner',
      qualificationTimezone: 'Africa/Nairobi',
      introductoryPeriodDays: 30,
      onboardingVersion: 1,
      tiers: [literaryCircleDashboardFixture.currentTier],
      commissionPolicy: {
        status: 'draft',
        version: 1,
        subscriptionRenewalsEligible: false
      },
      community: {
        enabled: true,
        title: 'Fresh private desk',
        description: 'Current partner guidance.',
        posts: [
          { id: 'visible', type: 'announcement', title: 'Visible note', body: 'Current guidance.', isPublished: true, order: 0 },
          { id: 'draft', type: 'announcement', title: 'Draft note', body: 'Not released.', isPublished: false, order: 1 },
          { id: 'future', type: 'release_preview', title: 'Future note', body: 'Not started.', isPublished: true, order: 2, publishedAt: '2999-01-01T00:00:00.000Z' },
          { id: 'expired', type: 'announcement', title: 'Expired note', body: 'No longer available.', isPublished: true, order: 3, expiresAt: '2020-01-01T00:00:00.000Z' }
        ]
      }
    });

    const response = await fetch(`${baseUrl}/api/affiliate/literary-circle/community`, {
      headers: { cookie: validCookie }
    });
    const body = await response.json() as Record<string, any>;
    const responseText = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('private');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('cdn-cache-control')).toBe('no-store');
    expect(response.headers.get('vercel-cdn-cache-control')).toBe('no-store');
    expect(body.literaryCircle.community.posts.map((post: Record<string, unknown>) => post.id)).toEqual(['visible']);
    expect(body.literaryCircle.community.title).toBe('Fresh private desk');
    expect(responseText).not.toContain('Draft note');
    expect(responseText).not.toContain('Future note');
    expect(responseText).not.toContain('Expired note');
    expect(affiliateMocks.getLiteraryCircleSettingsFresh).toHaveBeenCalledTimes(1);
    expect(affiliateMocks.verifyAffiliateSession).toHaveBeenCalledWith(expect.any(String), { forceFresh: true });
  });

  it('fails closed without stale community content when the fresh settings read fails', async () => {
    affiliateMocks.getLiteraryCircleSettingsFresh.mockRejectedValueOnce(new Error('private firestore detail'));

    const response = await fetch(`${baseUrl}/api/affiliate/literary-circle/community`, {
      headers: { cookie: validCookie }
    });
    const body = await response.json() as Record<string, any>;
    const responseText = JSON.stringify(body);

    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(body.error).toMatch(/temporarily unavailable/i);
    expect(responseText).not.toContain('private firestore detail');
    expect(responseText).not.toContain('Stale private post');
    expect(body).not.toHaveProperty('literaryCircle');
  });

  it('stops before reading private settings when the force-fresh session check fails', async () => {
    affiliateMocks.verifyAffiliateSession.mockResolvedValueOnce(null);

    const response = await fetch(`${baseUrl}/api/affiliate/literary-circle/community`, {
      headers: { cookie: validCookie }
    });
    const body = await response.json() as Record<string, any>;

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ success: false, code: 'SESSION_EXPIRED' });
    expect(affiliateMocks.verifyAffiliateSession).toHaveBeenCalledTimes(1);
    expect(affiliateMocks.verifyAffiliateSession).toHaveBeenCalledWith(expect.any(String), { forceFresh: true });
    expect(affiliateMocks.getLiteraryCircleSettingsFresh).not.toHaveBeenCalled();
  });

  it('does not read private community settings without an affiliate session', async () => {
    const response = await fetch(`${baseUrl}/api/affiliate/literary-circle/community`);
    const body = await response.json() as Record<string, any>;

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ success: false, code: 'AUTH_REQUIRED' });
    expect(affiliateMocks.getLiteraryCircleSettingsFresh).not.toHaveBeenCalled();
  });

  it('limits fresh private-community reads per authenticated affiliate account', async () => {
    const rateLimitedAffiliate = {
      ...privateAffiliate,
      id: 'aff_rate_limited',
      literaryCircle: activeLiteraryCircleMembership
    };
    affiliateMocks.verifyAffiliateSession.mockResolvedValue(rateLimitedAffiliate);
    affiliateMocks.getAffiliateDashboard.mockReturnValue({
      affiliate: rateLimitedAffiliate,
      sales: [],
      literaryCircle: literaryCircleDashboardFixture
    });

    const statuses: number[] = [];
    let finalResponse: Response | undefined;
    for (let index = 0; index < 13; index += 1) {
      finalResponse = await fetch(`${baseUrl}/api/affiliate/literary-circle/community`, {
        headers: { cookie: validCookie }
      });
      statuses.push(finalResponse.status);
    }

    expect(statuses.slice(0, 12)).toEqual(Array(12).fill(200));
    expect(statuses[12]).toBe(429);
    expect(finalResponse?.headers.get('cache-control')).toContain('no-store');
    expect(affiliateMocks.getLiteraryCircleSettingsFresh).toHaveBeenCalledTimes(12);
  });

  it('returns promotional resources only after one fresh affiliate check with no-store headers', async () => {
    affiliateMocks.verifyAffiliateSession.mockResolvedValue({
      ...privateAffiliate,
      acceptedTerms: true,
      literaryCircle: activeLiteraryCircleMembership
    });

    const response = await fetch(`${baseUrl}/api/affiliate/literary-circle/resources`, {
      headers: { cookie: validCookie }
    });
    const body = await response.json() as Record<string, any>;

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('cdn-cache-control')).toBe('no-store');
    expect(response.headers.get('vercel-cdn-cache-control')).toBe('no-store');
    expect(response.headers.get('x-robots-tag')).toContain('noarchive');
    expect(body.library.items).toHaveLength(1);
    expect(body.library).not.toHaveProperty('updatedBy');
    expect(affiliateMocks.verifyAffiliateSession).toHaveBeenCalledWith(expect.any(String), { forceFresh: true });
    expect(affiliateMocks.getLiteraryCircleSettingsFresh).toHaveBeenCalledTimes(1);
    expect(resourceMocks.getFresh).toHaveBeenCalledTimes(1);
  });

  it('stops before resource reads for anonymous or terms-incomplete affiliates', async () => {
    const anonymousResponse = await fetch(`${baseUrl}/api/affiliate/literary-circle/resources`);
    expect(anonymousResponse.status).toBe(401);
    expect(resourceMocks.getFresh).not.toHaveBeenCalled();

    affiliateMocks.verifyAffiliateSession.mockResolvedValueOnce({
      ...privateAffiliate,
      acceptedTerms: false
    });
    const termsResponse = await fetch(`${baseUrl}/api/affiliate/literary-circle/resources`, {
      headers: { cookie: validCookie }
    });
    expect(termsResponse.status).toBe(403);
    expect(resourceMocks.getFresh).not.toHaveBeenCalled();
    expect(affiliateMocks.getLiteraryCircleSettingsFresh).not.toHaveBeenCalled();
  });

  it('does not disclose promotional resources to legacy or revoked Literary Circle accounts', async () => {
    affiliateMocks.verifyAffiliateSession.mockResolvedValueOnce({
      ...privateAffiliate,
      acceptedTerms: true
    });
    const legacyResponse = await fetch(`${baseUrl}/api/affiliate/literary-circle/resources`, {
      headers: { cookie: validCookie }
    });
    expect(legacyResponse.status).toBe(403);
    expect(resourceMocks.getFresh).not.toHaveBeenCalled();
    expect(affiliateMocks.getLiteraryCircleSettingsFresh).not.toHaveBeenCalled();

    affiliateMocks.verifyAffiliateSession.mockResolvedValueOnce({
      ...privateAffiliate,
      acceptedTerms: true,
      literaryCircle: {
        ...activeLiteraryCircleMembership,
        complimentaryAccess: {
          ...activeLiteraryCircleMembership.complimentaryAccess,
          status: 'revoked'
        }
      }
    });
    const revokedResponse = await fetch(`${baseUrl}/api/affiliate/literary-circle/resources`, {
      headers: { cookie: validCookie }
    });
    expect(revokedResponse.status).toBe(403);
    expect(resourceMocks.getFresh).not.toHaveBeenCalled();
    expect(affiliateMocks.getLiteraryCircleSettingsFresh).not.toHaveBeenCalled();
  });

  it('fails closed without stale resource metadata when a fresh resource read fails', async () => {
    affiliateMocks.verifyAffiliateSession.mockResolvedValue({
      ...privateAffiliate,
      acceptedTerms: true,
      literaryCircle: activeLiteraryCircleMembership
    });
    resourceMocks.getFresh.mockRejectedValueOnce(new Error('private resource firestore detail'));

    const response = await fetch(`${baseUrl}/api/affiliate/literary-circle/resources`, {
      headers: { cookie: validCookie }
    });
    const body = await response.json() as Record<string, any>;

    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(JSON.stringify(body)).not.toContain('private resource firestore detail');
    expect(body).not.toHaveProperty('library');
  });

  it('authenticates the large promotional-artwork route before parsing its body', async () => {
    const response = await fetch(`${baseUrl}/api/admin/affiliates/literary-circle/resource-image`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{malformed-json'
    });

    expect(response.status).toBe(401);
    expect(resourceMocks.associateImage).not.toHaveBeenCalled();
  });

  it('publishes an admin resource mutation only after its transactional audit is committed', async () => {
    const response = await fetch(`${baseUrl}/api/admin/affiliates/literary-circle/resources`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        cookie: `iw_session=${adminSessionToken}`,
        origin: baseUrl,
        'sec-fetch-site': 'same-origin'
      },
      body: JSON.stringify({ schemaVersion: 1, revision: 2, enabled: true, title: 'Desk', description: 'Approved.', items: [] })
    });

    expect(response.status).toBe(200);
    expect(resourceMocks.save).toHaveBeenCalledWith(expect.objectContaining({ revision: 2 }), 'Admin (Test Admin)', 2);
    expect(affiliateMocks.rememberCommittedAudit).toHaveBeenCalledWith({ id: 'audit-resource-save' });
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
