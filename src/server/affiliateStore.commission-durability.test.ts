import crypto from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type FakeRef = { collectionName: string; id: string; key: string };
type FakeQuery = { kind: 'query'; collectionName: string; field: string; value: unknown; limitCount: number };
type IncrementSentinel = { __operation: 'increment'; amount: number };

const firestoreMock = vi.hoisted(() => {
  const documents = new Map<string, any>();
  let queue: Promise<void> = Promise.resolve();
  let failNextCommit = false;

  const clone = (value: any) => value === undefined ? undefined : structuredClone(value);
  const isIncrement = (value: unknown): value is IncrementSentinel =>
    Boolean(value && typeof value === 'object' && (value as IncrementSentinel).__operation === 'increment');
  const makeRef = (collectionName: string, id: string): FakeRef => ({
    collectionName,
    id,
    key: `${collectionName}/${id}`
  });
  const queryRead = vi.fn(async (collectionName: string, limitCount: number) => ({
    docs: Array.from(documents.entries())
      .filter(([key]) => key.startsWith(`${collectionName}/`)).slice(0, limitCount)
      .map(([key, value]) => ({ id: key.slice(collectionName.length + 1), data: () => clone(value) })),
  }));
  const collection = (collectionName: string) => ({
    doc: (id: string): FakeRef => makeRef(collectionName, id),
    limit: (count: number) => ({ get: () => queryRead(collectionName, count) }),
    where: (field: string, _operator: string, value: unknown) => ({
      limit: (limitCount: number): FakeQuery => ({ kind: 'query', collectionName, field, value, limitCount })
    })
  });
  const runTransaction = vi.fn(async (operation: (transaction: any) => Promise<any>) => {
    let release!: () => void;
    const previous = queue;
    queue = new Promise<void>(resolve => { release = resolve; });
    await previous;

    try {
      const writes: Array<
        | { operation: 'create'; ref: FakeRef; data: any }
        | { operation: 'set'; ref: FakeRef; data: any; merge: boolean }
      > = [];
      const result = await operation({
        get: async (ref: FakeRef | FakeQuery) => {
          if ('kind' in ref) {
            const prefix = `${ref.collectionName}/`;
            return {
              docs: Array.from(documents.entries())
                .filter(([key, value]) => key.startsWith(prefix) && value?.[ref.field] === ref.value)
                .slice(0, ref.limitCount)
                .map(([key, value]) => {
                  const documentRef = makeRef(ref.collectionName, key.slice(prefix.length));
                  return {
                    id: documentRef.id,
                    ref: documentRef,
                    exists: true,
                    data: () => clone(value)
                  };
                })
            };
          }
          return {
            id: ref.id,
            ref,
            exists: documents.has(ref.key),
            data: () => clone(documents.get(ref.key))
          };
        },
        create: (ref: FakeRef, data: any) => {
          if (documents.has(ref.key)) throw new Error('document already exists');
          writes.push({ operation: 'create', ref, data: clone(data) });
        },
        set: (ref: FakeRef, data: any, options?: { merge?: boolean }) => {
          writes.push({ operation: 'set', ref, data: clone(data), merge: Boolean(options?.merge) });
        }
      });

      if (failNextCommit) {
        failNextCommit = false;
        throw new Error('injected commission commit failure');
      }

      for (const write of writes) {
        const existing = write.operation === 'set' && write.merge
          ? clone(documents.get(write.ref.key) || {})
          : {};
        const next = { ...existing };
        for (const [field, value] of Object.entries(write.data)) {
          next[field] = isIncrement(value)
            ? (Number(existing[field]) || 0) + value.amount
            : clone(value);
        }
        documents.set(write.ref.key, next);
      }
      return result;
    } finally {
      release();
    }
  });

  return {
    documents,
    db: { collection, runTransaction },
    runTransaction,
    queryRead,
    reset() {
      documents.clear();
      queue = Promise.resolve();
      failNextCommit = false;
      runTransaction.mockClear();
      queryRead.mockClear();
    },
    failCommit() {
      failNextCommit = true;
    }
  };
});

const fsMock = vi.hoisted(() => ({
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  renameSync: vi.fn()
}));

vi.mock('fs', () => ({ default: fsMock, ...fsMock }));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    increment: (amount: number): IncrementSentinel => ({ __operation: 'increment', amount })
  }
}));

vi.mock('./db.js', () => ({
  getDb: vi.fn(() => firestoreMock.db),
  getFirestoreDoc: vi.fn(async (collectionName: string, id: string) =>
    structuredClone(firestoreMock.documents.get(`${collectionName}/${id}`) ?? null)
  ),
  getAllFirestoreDocs: vi.fn(async (collectionName: string) => {
    const prefix = `${collectionName}/`;
    return Array.from(firestoreMock.documents.entries())
      .filter(([key]) => key.startsWith(prefix))
      .map(([, value]) => structuredClone(value));
  }),
  setFirestoreDoc: vi.fn(async (collectionName: string, id: string, data: any) => {
    const key = `${collectionName}/${id}`;
    firestoreMock.documents.set(key, {
      ...(firestoreMock.documents.get(key) || {}),
      ...structuredClone(data)
    });
  }),
  replaceFirestoreDoc: vi.fn(async (collectionName: string, id: string, data: any) => {
    firestoreMock.documents.set(`${collectionName}/${id}`, structuredClone(data));
  }),
  updateFirestoreDoc: vi.fn(async () => undefined),
  deleteFirestoreDoc: vi.fn(async () => undefined)
}));

import { affiliateStore } from './affiliateStore.js';
import { createLiteraryCircleMembership, DEFAULT_LITERARY_CIRCLE_SETTINGS } from './literaryCircle.js';

const now = '2026-09-08T08:00:00.000Z';
const affiliate = {
  id: 'affiliate_1',
  affiliateCode: 'AFFILIATE1',
  name: 'Durable Affiliate',
  email: 'affiliate@example.test',
  phone: '254700000001',
  status: 'active',
  payoutMethod: 'mpesa',
  payoutDetails: { mpesaPhone: '254700000001' },
  totalClicks: 0,
  uniqueVisitors: 0,
  totalSalesCount: 0,
  totalRevenueKes: 0,
  totalCommissionEarnedKes: 0,
  totalCommissionPaidKes: 0,
  balanceAvailableKes: 0,
  balancePendingKes: 0,
  createdAt: now,
  updatedAt: now
};
const campaign = {
  id: 'campaign_1',
  code: 'LAUNCH',
  name: 'Launch campaign',
  commissionRate: 20,
  attributionDays: 30,
  eligiblePieceIds: ['article_1'],
  startDate: '2026-09-01T00:00:00.000Z',
  endDate: '2026-10-01T00:00:00.000Z',
  isActive: true,
  clicksCount: 0,
  salesCount: 0,
  revenueKes: 0,
  commissionsKes: 0,
  createdAt: now
};

function confirmedAffiliateTransaction() {
  return {
    id: 'tx_checkout_commission_1',
    checkoutRequestId: 'checkout_commission_1',
    merchantRequestId: 'merchant_commission_1',
    articleId: 'article_1',
    articleTitle: 'Commission durability test',
    phoneNumber: '254712345678',
    amount: 500,
    currency: 'KES',
    paymentMethod: 'mpesa',
    type: 'PURCHASE',
    status: 'CONFIRMED',
    mpesaReceiptNumber: 'SIA7654321',
    affiliateCode: affiliate.affiliateCode,
    campaignCode: campaign.code,
    createdAt: now
  } as const;
}

const v2ClaimId = 'c'.repeat(64);
const v2IssuedAt = Date.parse('2026-09-07T08:00:00.000Z');
const v2ExpiresAt = Date.parse('2026-10-07T08:00:00.000Z');

function confirmedV2AffiliateTransaction() {
  return {
    ...confirmedAffiliateTransaction(),
    affiliateAttributionVersion: 2 as const,
    affiliateAttributionClaimId: v2ClaimId,
    affiliateAttributionAt: new Date(v2IssuedAt).toISOString(),
    affiliateAttributionExpiresAt: new Date(v2ExpiresAt).toISOString()
  };
}

function confirmedSubscriptionTransaction(
  checkoutRequestId: string,
  subscriptionRenewal: boolean | undefined
) {
  const transaction = {
    ...confirmedAffiliateTransaction(),
    id: `tx_${checkoutRequestId}`,
    checkoutRequestId,
    merchantRequestId: `merchant_${checkoutRequestId}`,
    articleId: 'subscription:first-chapter-3-months',
    articleTitle: 'The First Chapter',
    purchaseKind: 'subscription' as const,
    subscriptionPlanId: 'first-chapter-3-months',
    campaignCode: undefined,
    mpesaReceiptNumber: `RECEIPT-${checkoutRequestId}`,
    confirmedAt: now,
  };
  return subscriptionRenewal === undefined
    ? transaction
    : { ...transaction, subscriptionRenewal };
}

function activeRenewalPolicy(overrides: Record<string, unknown> = {}) {
  return {
    ...structuredClone(DEFAULT_LITERARY_CIRCLE_SETTINGS),
    commissionPolicy: {
      status: 'active' as const,
      version: 7,
      effectiveAt: '2026-01-01T00:00:00.000Z',
      subscriptionRenewalsEligible: true,
      ...overrides
    }
  };
}

function consumedV2Claim(overrides: Record<string, unknown> = {}) {
  const transaction = confirmedV2AffiliateTransaction();
  return {
    version: 1,
    status: 'consumed',
    affiliateCode: affiliate.affiliateCode.toLowerCase(),
    campaignCode: campaign.code.toLowerCase(),
    checkoutArticleId: transaction.articleId,
    channel: 'mpesa',
    issuedAt: v2IssuedAt,
    expiresAt: v2ExpiresAt,
    claimedAt: v2IssuedAt,
    consumedAt: v2IssuedAt + 1_000,
    checkoutRequestId: transaction.checkoutRequestId,
    ...overrides
  };
}

describe('affiliate commission durability', () => {
  afterEach(() => { vi.unstubAllEnvs(); });
  beforeEach(async () => {
    vi.stubEnv('AFFILIATE_BUYER_ANALYTICS_MODE', 'off');
    process.env.VERCEL = '1';
    firestoreMock.reset();
    firestoreMock.documents.set('site_configs/affiliate_settings', {
      defaultCommissionRate: 15,
      minPayoutThresholdKes: 1000,
      defaultAttributionDays: 30,
      allowTipsCommission: false,
      autoApproveCommissions: true,
      autoApproveDelayHours: 0,
      enablePublicLeaderboard: false,
      allowSelfRegistration: true,
      pieceCommissionOverrides: {}
    });
    firestoreMock.documents.set(`affiliates/${affiliate.id}`, structuredClone(affiliate));
    firestoreMock.documents.set(`affiliate_campaigns/${campaign.id}`, structuredClone(campaign));
    await affiliateStore.init();
  });

  function enableBuyerAnalytics() {
    vi.stubEnv('AFFILIATE_BUYER_ANALYTICS_MODE', 'enabled');
    vi.stubEnv('AFFILIATE_BUYER_ANALYTICS_ACTIVE_KEY_ID', 'test-key');
    vi.stubEnv('AFFILIATE_BUYER_ANALYTICS_KEYS_JSON', JSON.stringify({ 'test-key': Buffer.alloc(32, 73).toString('base64') }));
  }

  it('adds private buyer evidence in the existing atomic sale and never backfills callback replays', async () => {
    enableBuyerAnalytics();
    const transaction = confirmedAffiliateTransaction();
    const first = await affiliateStore.recordAffiliateSale(transaction, affiliate.affiliateCode, campaign.code);
    expect(first?.affiliateBuyerAnalytics?.keys[0].buyerKey).toMatch(/^abk1_/);
    expect(affiliateStore.getCommissions()[0]).not.toHaveProperty('affiliateBuyerAnalytics');
    expect(affiliateStore.getAdminAffiliatesSummary().recentSales[0]).not.toHaveProperty('affiliateBuyerAnalytics');
    expect(await affiliateStore.updateCommissionStatus(first!.id, first!.status)).not.toHaveProperty('affiliateBuyerAnalytics');
    expect(JSON.stringify(affiliateStore.getAuditLogs())).not.toContain('affiliateBuyerAnalytics');
    expect([...firestoreMock.documents.keys()].filter(key => key.startsWith('affiliate_commissions/'))).toEqual([`affiliate_commissions/${first!.id}`]);
    vi.stubEnv('AFFILIATE_BUYER_ANALYTICS_KEYS_JSON', JSON.stringify({ 'test-key': Buffer.alloc(32, 81).toString('base64') }));
    expect(await affiliateStore.recordAffiliateSale(transaction, affiliate.affiliateCode, campaign.code)).toEqual(first);
    expect(firestoreMock.documents.get(`affiliates/${affiliate.id}`)?.totalCommissionEarnedKes).toBe(100);
  });

  it('leaves neither buyer evidence nor financial increments when the atomic sale commit fails', async () => {
    enableBuyerAnalytics();
    const before = structuredClone([...firestoreMock.documents]);
    firestoreMock.failCommit();
    await expect(affiliateStore.recordAffiliateSale(confirmedAffiliateTransaction(), affiliate.affiliateCode, campaign.code)).rejects.toThrow('injected commission commit failure');
    expect([...firestoreMock.documents]).toEqual(before);
    expect((await affiliateStore.recordAffiliateSale(confirmedAffiliateTransaction(), affiliate.affiliateCode, campaign.code))?.affiliateBuyerAnalytics).toBeDefined();
  });

  it('reads no buyer history when disabled and uses fresh bounded evidence rather than cached commission identity when enabled', async () => {
    await affiliateStore.recordAffiliateSale(confirmedAffiliateTransaction(), affiliate.affiliateCode, campaign.code);
    const disabled = await affiliateStore.getAdminAffiliateAnalytics({ startDate: '2026-09-01', endDate: '2026-09-30' });
    expect(disabled.buyerMetrics).toMatchObject({ coverage: 'unavailable', reason: 'not_enabled' });
    expect(firestoreMock.queryRead).not.toHaveBeenCalled();
    enableBuyerAnalytics();
    const freshTx = { ...confirmedAffiliateTransaction(), checkoutRequestId: 'fresh_checkout', id: 'fresh_tx', mpesaReceiptNumber: 'FRESH_RECEIPT' };
    const fresh = await affiliateStore.recordAffiliateSale(freshTx, affiliate.affiliateCode, campaign.code);
    const legacyId = `com_tx_${crypto.createHash('sha256').update(confirmedAffiliateTransaction().checkoutRequestId).digest('hex').slice(0, 40)}`;
    // Simulate a change committed by another instance: this process's cached legacy record remains stale.
    firestoreMock.documents.delete(`affiliate_commissions/${legacyId}`);
    const report = await affiliateStore.getAdminAffiliateAnalytics({ startDate: '2026-09-01', endDate: '2026-09-30' });
    expect(firestoreMock.queryRead).toHaveBeenCalledWith('affiliate_commissions', 10_001);
    expect(report.totals.verifiedSales).toBe(1);
    expect(report.buyerMetrics).toMatchObject({ coverage: 'complete', uniquePayingReaders: 1, newAffiliateAcquiredReaders: 1, reason: 'complete' });
    expect(JSON.stringify(report)).not.toContain(fresh?.affiliateBuyerAnalytics?.keys[0].buyerKey);
  });

  it('withholds buyer metrics on a failed or truncated fresh history query without breaking financial reporting', async () => {
    enableBuyerAnalytics();
    await affiliateStore.recordAffiliateSale(confirmedAffiliateTransaction(), affiliate.affiliateCode, campaign.code);
    firestoreMock.queryRead.mockRejectedValueOnce(new Error('private database failure'));
    const failed = await affiliateStore.getAdminAffiliateAnalytics({ startDate: '2026-09-01', endDate: '2026-09-30' });
    expect(failed.buyerMetrics).toMatchObject({ coverage: 'unavailable', uniquePayingReaders: null, reason: 'query_failed' });
    expect(failed.totals.verifiedSales).toBe(1);
    firestoreMock.queryRead.mockResolvedValueOnce({ docs: Array.from({ length: 10_001 }, () => ({ id: '', data: () => ({}) })) });
    const truncated = await affiliateStore.getAdminAffiliateAnalytics({ startDate: '2026-09-01', endDate: '2026-09-30' });
    expect(truncated.buyerMetrics).toMatchObject({ coverage: 'unavailable', uniquePayingReaders: null, reason: 'truncated' });
  });

  async function automaticTierPolicy() {
    const settings = structuredClone(DEFAULT_LITERARY_CIRCLE_SETTINGS);
    settings.enabled = true;
    settings.commissionPolicy = { status: 'active', version: 8, effectiveAt: '2026-01-01T00:00:00.000Z', subscriptionRenewalsEligible: false };
    settings.tiers.find(tier => tier.id === 'literary-ambassador')!.monthlyVerifiedSalesThreshold = 2;
    firestoreMock.documents.set('site_configs/affiliate_literary_circle', settings);
    firestoreMock.documents.set(`affiliates/${affiliate.id}`, {
      ...structuredClone(affiliate),
      literaryCircle: createLiteraryCircleMembership({ now, settings, actor: 'Writer', foundingMember: true, audience: 'existing_upgrade' }),
    });
    await affiliateStore.init();
  }

  function tierSale(index: number) {
    return { ...confirmedAffiliateTransaction(), campaignCode: undefined,
      checkoutRequestId: `checkout_tier_${index}`, id: `tx_tier_${index}`, mpesaReceiptNumber: `TIER-${index}` };
  }

  it('atomically snapshots a real automatic threshold crossing exactly once across concurrent sales and retries', async () => {
    await automaticTierPolicy();
    const [first, second] = await Promise.all([
      affiliateStore.recordAffiliateSale(tierSale(1), affiliate.affiliateCode),
      affiliateStore.recordAffiliateSale(tierSale(2), affiliate.affiliateCode),
    ]);
    expect(first?.literaryCircleTierTransition).toBeUndefined();
    expect(second?.literaryCircleTierTransition).toMatchObject({
      schemaVersion: 1, periodKey: '2026-09', policyVersion: 8,
      fromTierId: 'literary-partner', toTierId: 'literary-ambassador',
      verifiedSalesBefore: 1, verifiedSalesAfter: 2, threshold: 2,
      qualifyingCommissionIds: [first?.id],
    });
    expect(await affiliateStore.recordAffiliateSale(tierSale(2), affiliate.affiliateCode)).toEqual(second);
    const third = await affiliateStore.recordAffiliateSale(tierSale(3), affiliate.affiliateCode);
    expect(third?.literaryCircleTierTransition).toBeUndefined();
    expect(firestoreMock.documents.get(`affiliates/${affiliate.id}`)).toMatchObject({ totalSalesCount: 3, totalRevenueKes: 1500, totalCommissionEarnedKes: 275, balanceAvailableKes: 275 });
  });

  it('leaves no transition or financial increments after a failed commit and safely retries', async () => {
    await automaticTierPolicy();
    await affiliateStore.recordAffiliateSale(tierSale(1), affiliate.affiliateCode);
    const before = structuredClone([...firestoreMock.documents]);
    firestoreMock.failCommit();
    await expect(affiliateStore.recordAffiliateSale(tierSale(2), affiliate.affiliateCode)).rejects.toThrow('injected commission commit failure');
    expect([...firestoreMock.documents]).toEqual(before);
    expect((await affiliateStore.recordAffiliateSale(tierSale(2), affiliate.affiliateCode))?.literaryCircleTierTransition?.threshold).toBe(2);
  });

  it('does not repeat a milestone after a prior sale is reversed and the threshold is crossed again', async () => {
    await automaticTierPolicy();
    const first = await affiliateStore.recordAffiliateSale(tierSale(1), affiliate.affiliateCode);
    const second = await affiliateStore.recordAffiliateSale(tierSale(2), affiliate.affiliateCode);
    expect(second?.literaryCircleTierTransition).toBeDefined();
    firestoreMock.documents.get(`affiliate_commissions/${first!.id}`).status = 'REVERSED';
    expect((await affiliateStore.recordAffiliateSale(tierSale(3), affiliate.affiliateCode))?.literaryCircleTierTransition).toBeUndefined();
  });

  it('creates one deterministic commission and increments affiliate and campaign totals once across concurrent retries', async () => {
    const transaction = confirmedAffiliateTransaction();

    const [first, second] = await Promise.all([
      affiliateStore.recordAffiliateSale(transaction, affiliate.affiliateCode, campaign.code),
      affiliateStore.recordAffiliateSale(transaction, affiliate.affiliateCode, campaign.code)
    ]);
    const third = await affiliateStore.recordAffiliateSale(
      transaction,
      affiliate.affiliateCode,
      campaign.code
    );

    const expectedId = `com_tx_${crypto.createHash('sha256')
      .update(transaction.checkoutRequestId)
      .digest('hex')
      .slice(0, 40)}`;
    expect(first?.id).toBe(expectedId);
    expect(second?.id).toBe(expectedId);
    expect(third?.id).toBe(expectedId);
    expect(Array.from(firestoreMock.documents.keys()).filter(key =>
      key.startsWith('affiliate_commissions/')
    )).toEqual([`affiliate_commissions/${expectedId}`]);

    expect(firestoreMock.documents.get(`affiliates/${affiliate.id}`)).toMatchObject({
      totalSalesCount: 1,
      totalRevenueKes: 500,
      totalCommissionEarnedKes: 100,
      balanceAvailableKes: 100,
      balancePendingKes: 0
    });
    expect(firestoreMock.documents.get(`affiliate_campaigns/${campaign.id}`)).toMatchObject({
      salesCount: 1,
      revenueKes: 500,
      commissionsKes: 100
    });
  });

  it('does not move a newer verified-sale timestamp backwards when reconciling an older sale', async () => {
    const newerVerifiedSaleAt = '2026-09-12T08:00:00.000Z';
    firestoreMock.documents.set(`affiliates/${affiliate.id}`, {
      ...structuredClone(affiliate),
      lastVerifiedSaleAt: newerVerifiedSaleAt
    });

    const transaction = {
      ...confirmedAffiliateTransaction(),
      createdAt: '2026-09-05T08:00:00.000Z'
    };
    const commission = await affiliateStore.recordAffiliateSale(
      transaction,
      affiliate.affiliateCode,
      campaign.code
    );

    expect(commission?.createdAt).toBe(transaction.createdAt);
    expect(firestoreMock.documents.get(`affiliates/${affiliate.id}`)?.lastVerifiedSaleAt)
      .toBe(newerVerifiedSaleAt);
  });

  it('creates a v2 commission only when the consumed one-time claim matches the sale exactly', async () => {
    const transaction = confirmedV2AffiliateTransaction();
    firestoreMock.documents.set(
      `affiliate_attribution_claims/${v2ClaimId}`,
      consumedV2Claim()
    );

    const commission = await affiliateStore.recordAffiliateSale(
      transaction,
      affiliate.affiliateCode,
      campaign.code
    );

    expect(commission).toMatchObject({
      checkoutRequestId: transaction.checkoutRequestId,
      affiliateCode: affiliate.affiliateCode,
      commissionAmountKes: 100
    });
    expect(firestoreMock.documents.get(`affiliates/${affiliate.id}`)).toMatchObject({
      totalSalesCount: 1,
      totalCommissionEarnedKes: 100
    });
  });

  it.each([
    ['missing claim', null],
    ['unconsumed claim', { status: 'claimed', checkoutRequestId: undefined }],
    ['another checkout', { checkoutRequestId: 'checkout_other' }],
    ['another affiliate', { affiliateCode: 'another_affiliate' }],
    ['another campaign', { campaignCode: 'another_campaign' }],
    ['another piece', { checkoutArticleId: 'article_other' }],
    ['another channel', { channel: 'bank' }],
    ['another issue time', { issuedAt: v2IssuedAt - 1 }],
    ['another expiry time', { expiresAt: v2ExpiresAt + 1 }]
  ])('rejects a v2 commission bound to %s', async (_label, claimOverrides) => {
    const transaction = confirmedV2AffiliateTransaction();
    if (claimOverrides) {
      firestoreMock.documents.set(
        `affiliate_attribution_claims/${v2ClaimId}`,
        consumedV2Claim(claimOverrides)
      );
    }

    await expect(affiliateStore.recordAffiliateSale(
      transaction,
      affiliate.affiliateCode,
      campaign.code
    )).resolves.toBeNull();

    expect(Array.from(firestoreMock.documents.keys()).some(key =>
      key.startsWith('affiliate_commissions/')
    )).toBe(false);
    expect(firestoreMock.documents.get(`affiliates/${affiliate.id}`)).toMatchObject({
      totalSalesCount: 0,
      totalCommissionEarnedKes: 0,
      balanceAvailableKes: 0
    });
  });

  it('publishes no commission or counter changes after an atomic commit failure and credits one sale on retry', async () => {
    const transaction = confirmedAffiliateTransaction();
    firestoreMock.failCommit();

    await expect(
      affiliateStore.recordAffiliateSale(transaction, affiliate.affiliateCode, campaign.code)
    ).rejects.toThrow('injected commission commit failure');

    expect(Array.from(firestoreMock.documents.keys()).some(key =>
      key.startsWith('affiliate_commissions/')
    )).toBe(false);
    expect(firestoreMock.documents.get(`affiliates/${affiliate.id}`)).toMatchObject({
      totalSalesCount: 0,
      totalRevenueKes: 0,
      totalCommissionEarnedKes: 0,
      balanceAvailableKes: 0
    });
    expect(firestoreMock.documents.get(`affiliate_campaigns/${campaign.id}`)).toMatchObject({
      salesCount: 0,
      revenueKes: 0,
      commissionsKes: 0
    });
    expect(affiliateStore.getCommissions({ transactionId: transaction.id })).toEqual([]);

    const recovered = await affiliateStore.recordAffiliateSale(
      transaction,
      affiliate.affiliateCode,
      campaign.code
    );
    expect(recovered?.commissionAmountKes).toBe(100);
    expect(firestoreMock.documents.get(`affiliates/${affiliate.id}`)).toMatchObject({
      totalSalesCount: 1,
      totalRevenueKes: 500,
      totalCommissionEarnedKes: 100,
      balanceAvailableKes: 100
    });
    expect(firestoreMock.documents.get(`affiliate_campaigns/${campaign.id}`)).toMatchObject({
      salesCount: 1,
      revenueKes: 500,
      commissionsKes: 100
    });
  });

  it('rejects a checkout created after its signed attribution expired', async () => {
    const transaction = {
      ...confirmedAffiliateTransaction(),
      affiliateAttributionAt: '2026-09-01T08:00:00.000Z',
      affiliateAttributionExpiresAt: '2026-09-07T08:00:00.000Z'
    };

    await expect(
      affiliateStore.recordAffiliateSale(transaction, affiliate.affiliateCode, campaign.code)
    ).resolves.toBeNull();
    expect(firestoreMock.runTransaction).not.toHaveBeenCalled();
    expect(Array.from(firestoreMock.documents.keys()).some(key =>
      key.startsWith('affiliate_commissions/')
    )).toBe(false);
  });

  it('honours a campaign click made inside its dates through the signed attribution window', async () => {
    firestoreMock.documents.set(`affiliate_campaigns/${campaign.id}`, {
      ...structuredClone(campaign),
      endDate: '2026-09-05T23:59:59.000Z'
    });
    const transaction = {
      ...confirmedAffiliateTransaction(),
      affiliateAttributionAt: '2026-09-04T08:00:00.000Z',
      affiliateAttributionExpiresAt: '2026-10-04T08:00:00.000Z'
    };

    const commission = await affiliateStore.recordAffiliateSale(
      transaction,
      affiliate.affiliateCode,
      campaign.code
    );

    expect(commission).toMatchObject({ commissionRate: 20, commissionAmountKes: 100 });
  });

  it('falls back to the bounded base rate when a campaign was not valid at click time', async () => {
    const transaction = {
      ...confirmedAffiliateTransaction(),
      affiliateAttributionAt: '2026-08-20T08:00:00.000Z',
      affiliateAttributionExpiresAt: '2026-09-19T08:00:00.000Z'
    };

    const commission = await affiliateStore.recordAffiliateSale(
      transaction,
      affiliate.affiliateCode,
      campaign.code
    );

    expect(commission).toMatchObject({
      commissionRate: 15,
      commissionAmountKes: 75,
      campaignCode: undefined
    });
  });

  it('credits a first subscription payment once and snapshots that it was not a renewal', async () => {
    const transaction = confirmedSubscriptionTransaction('checkout_subscription_first', false);

    const first = await affiliateStore.recordAffiliateSale(transaction, affiliate.affiliateCode);
    const retry = await affiliateStore.recordAffiliateSale(transaction, affiliate.affiliateCode);

    expect(first).toMatchObject({
      purchaseKind: 'subscription',
      subscriptionPlanId: 'first-chapter-3-months',
      subscriptionRenewal: false,
      commissionRate: 15,
      commissionAmountKes: 75,
      commissionRateSource: 'global_default'
    });
    expect(retry).toEqual(first);
    expect(Array.from(firestoreMock.documents.keys()).filter(key =>
      key.startsWith('affiliate_commissions/')
    )).toHaveLength(1);
    expect(firestoreMock.documents.get(`affiliates/${affiliate.id}`)).toMatchObject({
      totalSalesCount: 1,
      totalRevenueKes: 500,
      totalCommissionEarnedKes: 75,
      balanceAvailableKes: 75
    });
  });

  it('fails closed for an ambiguous subscription and skips renewals under the default draft policy', async () => {
    const ambiguous = confirmedSubscriptionTransaction('checkout_subscription_ambiguous', undefined);
    const renewal = confirmedSubscriptionTransaction('checkout_subscription_renewal_default', true);

    await expect(affiliateStore.recordAffiliateSale(ambiguous, affiliate.affiliateCode)).resolves.toBeNull();
    const [first, second] = await Promise.all([
      affiliateStore.recordAffiliateSale(renewal, affiliate.affiliateCode),
      affiliateStore.recordAffiliateSale(renewal, affiliate.affiliateCode)
    ]);

    expect(first).toBeNull();
    expect(second).toBeNull();
    expect(Array.from(firestoreMock.documents.keys()).some(key =>
      key.startsWith('affiliate_commissions/')
    )).toBe(false);
    expect(firestoreMock.documents.get(`affiliates/${affiliate.id}`)).toMatchObject({
      totalSalesCount: 0,
      totalRevenueKes: 0,
      totalCommissionEarnedKes: 0,
      balanceAvailableKes: 0
    });
  });

  it('does not enable renewal commissions from a draft or future-effective policy', async () => {
    const renewal = confirmedSubscriptionTransaction('checkout_subscription_renewal_future', true);
    firestoreMock.documents.set('site_configs/affiliate_literary_circle', {
      ...activeRenewalPolicy(),
      commissionPolicy: {
        status: 'draft',
        version: 7,
        subscriptionRenewalsEligible: true
      }
    });
    await expect(affiliateStore.recordAffiliateSale(renewal, affiliate.affiliateCode)).resolves.toBeNull();

    firestoreMock.documents.set(
      'site_configs/affiliate_literary_circle',
      activeRenewalPolicy({ effectiveAt: '2026-09-09T00:00:00.000Z' })
    );
    await expect(affiliateStore.recordAffiliateSale(renewal, affiliate.affiliateCode)).resolves.toBeNull();
    expect(Array.from(firestoreMock.documents.keys()).some(key =>
      key.startsWith('affiliate_commissions/')
    )).toBe(false);
  });

  it('credits one renewal only under an active effective policy and preserves its immutable snapshot', async () => {
    firestoreMock.documents.set(
      'site_configs/affiliate_literary_circle',
      activeRenewalPolicy()
    );
    const transaction = confirmedSubscriptionTransaction('checkout_subscription_renewal_allowed', true);

    const [first, second] = await Promise.all([
      affiliateStore.recordAffiliateSale(transaction, affiliate.affiliateCode),
      affiliateStore.recordAffiliateSale(transaction, affiliate.affiliateCode)
    ]);
    const original = structuredClone(first);

    firestoreMock.documents.set('site_configs/affiliate_literary_circle', {
      ...activeRenewalPolicy({ subscriptionRenewalsEligible: false }),
      commissionPolicy: {
        ...activeRenewalPolicy({ subscriptionRenewalsEligible: false }).commissionPolicy,
        version: 8,
        subscriptionRenewalsEligible: false
      }
    });
    const retry = await affiliateStore.recordAffiliateSale(transaction, affiliate.affiliateCode);

    expect(first).toMatchObject({
      purchaseKind: 'subscription',
      subscriptionRenewal: true,
      commissionRate: 15,
      commissionAmountKes: 75,
      literaryCirclePolicyVersion: 7
    });
    expect(second).toEqual(first);
    expect(retry).toEqual(original);
    expect(Array.from(firestoreMock.documents.keys()).filter(key =>
      key.startsWith('affiliate_commissions/')
    )).toHaveLength(1);
    expect(firestoreMock.documents.get(`affiliates/${affiliate.id}`)).toMatchObject({
      totalSalesCount: 1,
      totalRevenueKes: 500,
      totalCommissionEarnedKes: 75,
      balanceAvailableKes: 75
    });
  });

  it('snapshots an explicitly activated manual Literary Circle tier without changing prior records', async () => {
    const membership = {
      schemaVersion: 1,
      memberSince: now,
      foundingMember: true,
      foundingRecognizedAt: now,
      complimentaryAccess: {
        status: 'active',
        scope: 'all_published',
        grantedAt: now,
        updatedAt: now,
        updatedBy: 'test'
      },
      tier: {
        id: 'literary-ambassador',
        assignedAt: now,
        source: 'manual',
        policyVersion: 4
      },
      onboarding: {
        version: 1,
        audience: 'existing_upgrade',
        status: 'completed',
        completedStepIds: [],
        welcomeRequired: false
      }
    };
    firestoreMock.documents.set(`affiliates/${affiliate.id}`, {
      ...structuredClone(affiliate),
      literaryCircle: membership
    });
    firestoreMock.documents.set('site_configs/affiliate_literary_circle', {
      schemaVersion: 1,
      enabled: true,
      defaultTierId: 'literary-partner',
      qualificationTimezone: 'Africa/Nairobi',
      introductoryPeriodDays: 30,
      onboardingVersion: 1,
      tiers: [
        {
          id: 'literary-partner',
          name: 'Literary Partner',
          description: 'Base',
          rank: 1,
          monthlyVerifiedSalesThreshold: 0,
          proposedCommissionRate: 15,
          enabled: true
        },
        {
          id: 'literary-ambassador',
          name: 'Literary Ambassador',
          description: 'Ambassador',
          rank: 2,
          monthlyVerifiedSalesThreshold: 10,
          proposedCommissionRate: 20,
          enabled: true
        }
      ],
      commissionPolicy: {
        status: 'active',
        version: 4,
        effectiveAt: '2026-01-01T00:00:00.000Z',
        subscriptionRenewalsEligible: false
      },
      community: { enabled: false, title: 'Circle', description: 'Private' }
    });
    await affiliateStore.init();
    const transaction = {
      ...confirmedAffiliateTransaction(),
      campaignCode: undefined
    };

    const commission = await affiliateStore.recordAffiliateSale(
      transaction,
      affiliate.affiliateCode
    );

    expect(commission).toMatchObject({
      commissionRate: 20,
      commissionAmountKes: 100,
      commissionRateSource: 'literary_circle_tier',
      literaryCircleTierId: 'literary-ambassador',
      literaryCirclePolicyVersion: 4,
      purchaseKind: 'piece'
    });
  });

  it('prices a delayed settlement with the policy version effective when the sale occurred', async () => {
    const membership = {
      schemaVersion: 1,
      memberSince: now,
      foundingMember: true,
      complimentaryAccess: {
        status: 'active',
        scope: 'all_published',
        grantedAt: now,
        updatedAt: now,
        updatedBy: 'test'
      },
      tier: {
        id: 'literary-ambassador',
        assignedAt: now,
        source: 'manual',
        policyVersion: 4
      },
      onboarding: {
        version: 1,
        audience: 'existing_upgrade',
        status: 'completed',
        completedStepIds: [],
        welcomeRequired: false
      }
    };
    const oldTiers = [
      {
        id: 'literary-partner', name: 'Partner', description: 'Base', rank: 1,
        monthlyVerifiedSalesThreshold: 0, proposedCommissionRate: 15, enabled: true
      },
      {
        id: 'literary-ambassador', name: 'Ambassador', description: 'Ambassador', rank: 2,
        monthlyVerifiedSalesThreshold: 10, proposedCommissionRate: 20, enabled: true
      }
    ];
    firestoreMock.documents.set(`affiliates/${affiliate.id}`, {
      ...structuredClone(affiliate),
      literaryCircle: membership
    });
    firestoreMock.documents.set('site_configs/affiliate_literary_circle', {
      schemaVersion: 1,
      enabled: true,
      defaultTierId: 'literary-partner',
      qualificationTimezone: 'Africa/Nairobi',
      introductoryPeriodDays: 30,
      onboardingVersion: 1,
      tiers: oldTiers.map(tier => tier.id === 'literary-ambassador'
        ? { ...tier, proposedCommissionRate: 25 }
        : tier),
      commissionPolicy: {
        status: 'active',
        version: 5,
        effectiveAt: '2026-09-10T00:00:00.000Z',
        subscriptionRenewalsEligible: false
      },
      commissionPolicyHistory: [{
        version: 4,
        status: 'active',
        effectiveAt: '2026-01-01T00:00:00.000Z',
        defaultTierId: 'literary-partner',
        tiers: oldTiers,
        subscriptionRenewalsEligible: false,
        confirmedAt: '2026-01-01T00:00:00.000Z',
        confirmedBy: 'Writer'
      }],
      community: { enabled: false, title: 'Circle', description: 'Private' }
    });
    await affiliateStore.init();

    const commission = await affiliateStore.recordAffiliateSale({
      ...confirmedAffiliateTransaction(),
      campaignCode: undefined,
      createdAt: '2026-09-08T08:00:00.000Z'
    }, affiliate.affiliateCode);

    expect(commission).toMatchObject({
      commissionRate: 20,
      commissionAmountKes: 100,
      literaryCircleTierId: 'literary-ambassador',
      literaryCirclePolicyVersion: 4
    });
  });
});
