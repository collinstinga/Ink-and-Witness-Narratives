import crypto from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  const collection = (collectionName: string) => ({
    doc: (id: string): FakeRef => makeRef(collectionName, id),
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
    reset() {
      documents.clear();
      queue = Promise.resolve();
      failNextCommit = false;
      runTransaction.mockClear();
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
  updateFirestoreDoc: vi.fn(async () => undefined),
  deleteFirestoreDoc: vi.fn(async () => undefined)
}));

import { affiliateStore } from './affiliateStore.js';

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

describe('affiliate commission durability', () => {
  beforeEach(async () => {
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
});
