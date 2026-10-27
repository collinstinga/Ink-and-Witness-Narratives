import crypto from 'crypto';
import { describe, expect, it, vi } from 'vitest';
import type { AffiliateSaleCommission } from '../types.js';
import {
  AFFILIATE_FINANCIAL_READ_LIMITS, AffiliateFinancialReadError,
  affiliateFinancialTotals, readAffiliateFinancialSnapshot,
} from './affiliateFinancialRead.js';

vi.mock('./db.js', () => ({ getFirestoreClientTarget: () => ({ projectId: 'ink-witness-staging-20261024', firestoreDatabaseId: '(default)' }) }));

function fakeDatabase(seed: Record<string, Record<string, any>>, options: { missingReadTime?: boolean; inconsistentReadTime?: boolean } = {}) {
  const records = new Map(Object.entries(seed));
  const reads: Array<{ path: string; where?: string; limit?: number }> = [];
  const transactionOptions: any[] = [];
  const writes = vi.fn();
  const time = (path: string) => options.missingReadTime ? {} : { readTime: {
    toMillis: () => Date.parse(options.inconsistentReadTime && path === 'affiliate_commissions' ? '2026-10-27T08:00:01.000Z' : '2026-10-27T08:00:00.000Z'),
  } };
  const collection = (path: string, where?: [string, unknown], limit?: number): any => ({
    path, whereClause: where, readLimit: limit,
    doc: (id: string) => ({ path: `${path}/${id}`, isDocument: true, id }),
    where: (field: string, operation: string, value: unknown) => {
      expect(operation).toBe('==');
      return collection(path, [field, value], limit);
    },
    orderBy: () => collection(path, where, limit),
    limit: (value: number) => collection(path, where, value),
  });
  const db = {
    collection,
    runTransaction: vi.fn(async (operation: (transaction: any) => Promise<any>, options: any) => {
      transactionOptions.push(options);
      // Every transaction reads one isolated snapshot, like a Firestore read-only transaction.
      const snapshot = new Map(records);
      return operation({ create: writes, set: writes, update: writes, delete: writes,
        get: async (reference: any) => {
          reads.push({ path: reference.path, where: reference.whereClause?.[0], limit: reference.readLimit });
          if (reference.isDocument) {
            const data = snapshot.get(reference.path);
            return { exists: data !== undefined, id: reference.id, data: () => data, ...time(reference.path) };
          }
          return { ...time(reference.path), docs: [...snapshot].filter(([path, value]) => path.startsWith(`${reference.path}/`)
            && (!reference.whereClause || value[reference.whereClause[0]] === reference.whereClause[1]))
            .slice(0, reference.readLimit).map(([path, value]) => ({ id: path.split('/').at(-1), data: () => value })) };
        },
      });
    }),
  };
  return { db: db as any, records, reads, transactionOptions, writes };
}

const settings = { minPayoutThresholdKes: 500, defaultCommissionRate: 15 };
const baseSeed = {
  'site_configs/affiliate_settings': settings,
  'affiliates/own': { id: 'spoofed', name: 'Own', walletRevision: 3, balanceAvailableKes: 150 },
  'affiliates/other': { id: 'other', name: 'Private other', balanceAvailableKes: 900 },
  'affiliate_commissions/c1': { affiliateId: 'own', commissionAmountKes: 150 },
  'affiliate_commissions/c2': { affiliateId: 'other', receiptNumber: 'OTHER-PRIVATE' },
  'affiliate_payouts/p1': { affiliateId: 'own', amountKes: 100 },
  'affiliate_payouts/p2': { affiliateId: 'other', paymentReference: 'OTHER-PAYOUT' },
};

describe('authoritative affiliate financial reads', () => {
  it('reads immutable overlays inside the same snapshot and never exposes raw evidence', async () => {
    const affiliateId = 'own';
    const walletId = `affiliate_${crypto.createHash('sha256').update(JSON.stringify(affiliateId)).digest('hex')}`;
    const fake = fakeDatabase({ ...baseSeed, [`affiliate_financial_adjustment_summaries/${walletId}`]: {
      schemaVersion: 1, kind: 'affiliate', affiliateId, revision: 1, walletDeltaKes: -200, refundedMinor: 100_000, adjustmentCount: 1,
    } });
    const result = await readAffiliateFinancialSnapshot({ db: fake.db, affiliateId,
      adjustmentsContext: { db: fake.db, expectedProjectId: 'ink-witness-staging-20261024', expectedDatabaseId: '(default)', actor: 'Authenticated server read' } });
    expect(result).toMatchObject({ observedThrough: '2026-10-27T08:00:00.000Z',
      adjustmentWallets: { own: { walletDeltaKes: -200, revision: 1 } },
      financialAdjustments: { asOf: '2026-10-27T08:00:00.000Z', directCostScope: 'unavailable_for_affiliate_filter' } });
    expect(fake.transactionOptions).toEqual([{ readOnly: true }]);
    expect(fake.writes).not.toHaveBeenCalled();
  });

  it('withholds provenance on missing metadata and rejects inconsistent snapshot times', async () => {
    const missing = fakeDatabase(baseSeed, { missingReadTime: true });
    expect((await readAffiliateFinancialSnapshot({ db: missing.db }))?.observedThrough).toBeUndefined();
    const inconsistent = fakeDatabase(baseSeed, { inconsistentReadTime: true });
    await expect(readAffiliateFinancialSnapshot({ db: inconsistent.db })).rejects.toThrow(/one authoritative snapshot/);
    await expect(readAffiliateFinancialSnapshot({ db: missing.db, adjustmentsContext: { db: missing.db,
      expectedProjectId: 'ink-witness-staging-20261024', expectedDatabaseId: '(default)', actor: 'Server read' } })).rejects.toThrow(/no cached balances/);
  });
  it('uses a read-only consistent snapshot and scoped queries for the affiliate dashboard', async () => {
    const fake = fakeDatabase(baseSeed);
    const result = await readAffiliateFinancialSnapshot({ db: fake.db, affiliateId: 'own' });
    expect(result).toMatchObject({ affiliates: [{ id: 'own', walletRevision: 3 }],
      commissions: [{ id: 'c1', affiliateId: 'own' }], payouts: [{ id: 'p1', affiliateId: 'own' }], settings });
    expect(JSON.stringify(result)).not.toContain('OTHER-PRIVATE');
    expect(JSON.stringify(result)).not.toContain('OTHER-PAYOUT');
    expect(fake.reads.filter(read => read.path === 'affiliate_commissions' || read.path === 'affiliate_payouts'))
      .toEqual([expect.objectContaining({ where: 'affiliateId' }), expect.objectContaining({ where: 'affiliateId' })]);
    expect(fake.transactionOptions).toEqual([{ readOnly: true }]);
    expect(fake.writes).not.toHaveBeenCalled();
  });

  it('reads changed financial records on the next request instead of a startup snapshot', async () => {
    const fake = fakeDatabase(baseSeed);
    expect((await readAffiliateFinancialSnapshot({ db: fake.db, affiliateId: 'own' }))?.affiliates[0].balanceAvailableKes).toBe(150);
    fake.records.set('affiliates/own', { ...baseSeed['affiliates/own'], balanceAvailableKes: 50, walletRevision: 4 });
    expect((await readAffiliateFinancialSnapshot({ db: fake.db, affiliateId: 'own' }))?.affiliates[0])
      .toMatchObject({ balanceAvailableKes: 50, walletRevision: 4 });
  });

  it('returns missing accounts without reading their ledger or substituting a cached account', async () => {
    const fake = fakeDatabase(baseSeed);
    expect(await readAffiliateFinancialSnapshot({ db: fake.db, affiliateId: 'missing' })).toBeNull();
    expect(fake.reads).toEqual([{ path: 'affiliates/missing', where: undefined, limit: undefined }]);
  });

  it('caps every full admin ledger and includes an overflow probe rather than returning partial totals', async () => {
    const fake = fakeDatabase(baseSeed);
    const result = await readAffiliateFinancialSnapshot({ db: fake.db });
    expect(result?.affiliates).toHaveLength(2);
    for (const [collection, key] of [
      ['affiliates', 'affiliates'], ['affiliate_commissions', 'commissions'],
      ['affiliate_payouts', 'payouts'], ['affiliate_campaigns', 'campaigns'],
    ] as const) expect(fake.reads).toContainEqual(expect.objectContaining({ path: collection, limit: AFFILIATE_FINANCIAL_READ_LIMITS[key] + 1 }));
    for (let index = 0; index <= AFFILIATE_FINANCIAL_READ_LIMITS.affiliates; index += 1) {
      fake.records.set(`affiliates/overflow-${index}`, { name: 'Overflow' });
    }
    await expect(readAffiliateFinancialSnapshot({ db: fake.db })).rejects.toThrow('partial totals were not displayed');
    expect(fake.writes).not.toHaveBeenCalled();
  });

  it('fails closed on provider failure or a deleted settings document without exposing provider details', async () => {
    const fake = fakeDatabase(baseSeed);
    fake.db.runTransaction.mockRejectedValueOnce(new Error('secret provider payload'));
    await expect(readAffiliateFinancialSnapshot({ db: fake.db })).rejects.toThrow('no cached balances were substituted');
    fake.records.delete('site_configs/affiliate_settings');
    await expect(readAffiliateFinancialSnapshot({ db: fake.db })).rejects.toThrow('No previous payout policy was substituted');
  });

  it('retries an overlapping newer wallet commit once, and never returns a known regressed wallet', async () => {
    const fake = fakeDatabase(baseSeed);
    const isOutdated = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false);
    await expect(readAffiliateFinancialSnapshot({ db: fake.db, affiliateId: 'own', isOutdated })).resolves.not.toBeNull();
    expect(fake.db.runTransaction).toHaveBeenCalledTimes(2);
    await expect(readAffiliateFinancialSnapshot({ db: fake.db, affiliateId: 'own', isOutdated: () => true }))
      .rejects.toBeInstanceOf(AffiliateFinancialReadError);
    expect(fake.db.runTransaction).toHaveBeenCalledTimes(4);
  });

  it('rejects unsafe scopes before accessing the database', async () => {
    const fake = fakeDatabase(baseSeed);
    await expect(readAffiliateFinancialSnapshot({ db: fake.db, affiliateId: '../other' })).rejects.toThrow('valid affiliate');
    expect(fake.db.runTransaction).not.toHaveBeenCalled();
  });
});

function commission(id: string, patch: Partial<AffiliateSaleCommission> = {}): AffiliateSaleCommission {
  return { id, affiliateId: 'own', receiptNumber: `receipt-${id}`, createdAt: '2026-10-24T09:00:00Z',
    saleAmountKes: 500, commissionAmountKes: 100, status: 'APPROVED', ...patch } as AffiliateSaleCommission;
}

describe('verified financial dashboard totals', () => {
  it('excludes reversed/rejected/invalid and duplicate rows from sales without deleting those ledger rows', () => {
    const ledger = [commission('one'), commission('duplicate', { receiptNumber: 'receipt-one', status: 'PENDING' }),
      commission('reversed', { status: 'REVERSED' }), commission('rejected', { status: 'REJECTED' }),
      commission('invalid', { createdAt: 'not-a-date' }), commission('complimentary', { saleAmountKes: 0 })];
    expect(affiliateFinancialTotals(ledger)).toMatchObject({ sales: 1, revenueKes: 500, earnedKes: 100 });
    expect(ledger).toHaveLength(6);
    expect(ledger[2].status).toBe('REVERSED');
  });

  it('separates actually paid, reserved, pending and currently available approved portions', () => {
    const totals = affiliateFinancialTotals([
      commission('partial', { walletLedgerVersion: 1, payoutPaidKes: 25, payoutReservedKes: 40 }),
      commission('pending', { status: 'PENDING', commissionAmountKes: 80 }),
      commission('paid', { status: 'PAID', commissionAmountKes: 70 }),
    ]);
    expect(totals).toMatchObject({ sales: 3, earnedKes: 250, paidKes: 95, reservedKes: 40, pendingKes: 80, approvedKes: 35 });
  });
});
