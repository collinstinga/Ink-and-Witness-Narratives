import crypto from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';

const mock = vi.hoisted(() => {
  const rows = new Map<string, any>();
  const commits: string[][] = [];
  let queue = Promise.resolve();
  let bound = true;
  const clone = (value: any) => value === undefined ? undefined : structuredClone(value);
  const readTime = { toMillis: () => Date.parse('2026-10-27T08:00:00.000Z') };
  const ref = (collectionName: string, id: string) => ({ collectionName, id, path: `${collectionName}/${id}` });
  const read = (target: any): any => {
    if (target.id) return { id: target.id, exists: rows.has(target.path), readTime, data: () => clone(rows.get(target.path)) };
    return { readTime, docs: [...rows].filter(([path, value]) => path.startsWith(`${target.collectionName}/`)
      && target.filters.every(([field, expected]: [string, unknown]) => value[field] === expected))
      .slice(0, target.maximum).map(([path, value]) => ({ id: path.slice(target.collectionName.length + 1), exists: true, readTime, data: () => clone(value) })) };
  };
  const collection = (collectionName: string, filters: Array<[string, unknown]> = [], maximum = Infinity): any => ({
    collectionName, filters, maximum, doc: (id: string) => ({ ...ref(collectionName, id), get: async () => read(ref(collectionName, id)) }),
    where: (field: string, operator: string, value: unknown) => {
      if (operator !== '==') throw new Error('Unexpected query operator');
      return collection(collectionName, [...filters, [field, value]], maximum);
    },
    limit: (value: number) => collection(collectionName, filters, value), orderBy: () => collection(collectionName, filters, maximum),
    get: async () => read({ collectionName, filters, maximum }),
  });
  const runTransaction = vi.fn(async (operation: (transaction: any) => Promise<any>) => {
    let release!: () => void; const previous = queue; queue = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      const writes: Array<{ target: any; value: any; merge: boolean; create: boolean }> = [];
      const result = await operation({
        get: async (target: any) => { if (writes.length) throw new Error('All reads must precede writes'); return read(target); },
        set: (target: any, value: any, options?: { merge?: boolean }) => writes.push({ target, value: clone(value), merge: options?.merge === true, create: false }),
        create: (target: any, value: any) => writes.push({ target, value: clone(value), merge: false, create: true }),
      });
      if (writes.some(write => write.create && rows.has(write.target.path))) throw new Error('Create conflict');
      for (const write of writes) rows.set(write.target.path, { ...(write.merge ? clone(rows.get(write.target.path)) : {}), ...write.value });
      if (writes.length) commits.push(writes.map(write => write.target.path));
      return result;
    } finally { release(); }
  });
  const db = { collection, runTransaction };
  return { rows, commits, db, bound: () => bound, setBound(value: boolean) { bound = value; },
    reset() { rows.clear(); commits.length = 0; queue = Promise.resolve(); bound = true; runTransaction.mockClear(); } };
});
vi.mock('fs', () => ({ default: { existsSync: () => false, mkdirSync: vi.fn(), readFileSync: vi.fn(), writeFileSync: vi.fn(), renameSync: vi.fn() } }));
vi.mock('./db.js', () => ({
  getDb: () => mock.db,
  resolveFirestoreTargetConfig: () => ({ projectId: 'ink-witness-staging-20261024', firestoreDatabaseId: '(default)' }),
  getFirestoreClientTarget: () => mock.bound() ? ({ projectId: 'ink-witness-staging-20261024', firestoreDatabaseId: '(default)' }) : null,
  getFirestoreDoc: async (name: string, id: string) => structuredClone(mock.rows.get(`${name}/${id}`) || null),
  getAllFirestoreDocs: async (name: string) => [...mock.rows].filter(([path]) => path.startsWith(`${name}/`)).map(([, value]) => structuredClone(value)),
  setFirestoreDoc: vi.fn(), replaceFirestoreDoc: vi.fn(), updateFirestoreDoc: vi.fn(), deleteFirestoreDoc: vi.fn(),
}));
import { affiliateStore } from './affiliateStore.js';
import { createAffiliateRefundAdjustment, reverseAffiliateRefundAdjustment, AFFILIATE_FINANCIAL_ADJUSTMENT_COLLECTIONS as COLLECTIONS } from './affiliateFinancialAdjustments.js';

const affiliateId = 'original_partner';
const context = { db: mock.db as unknown as Firestore, expectedProjectId: 'ink-witness-staging-20261024', expectedDatabaseId: '(default)',
  actor: 'Authenticated writer', clock: () => new Date('2026-10-27T08:00:00.000Z') };
const request = { expectedRevision: 0, idempotencyKey: 'refund_integration_0001', confirmationReference: 'PRIVATE-EXTERNAL-REFUND-1',
  currency: 'KES', confirmedByWriter: true, commissionId: 'paid_original', refundedAmountKes: 1_000, reason: 'refund' };
const account = () => mock.rows.get(`affiliates/${affiliateId}`);
const preservedRows = () => structuredClone([...mock.rows].filter(([path]) => path.startsWith('reader_licenses/') || path.startsWith('transactions/')
  || path === 'affiliate_commissions/paid_original' || path === 'affiliate_payouts/paid_original'));
function walletSummary(delta: number) {
  const id = `affiliate_${crypto.createHash('sha256').update(JSON.stringify(affiliateId)).digest('hex')}`;
  mock.rows.set(`${COLLECTIONS.summaries}/${id}`, { schemaVersion: 1, kind: 'affiliate', affiliateId, revision: 1,
    walletDeltaKes: delta, refundedMinor: Math.abs(delta) * 500, adjustmentCount: 1 });
}

beforeEach(async () => {
  vi.unstubAllEnvs(); vi.stubEnv('VERCEL', '1'); vi.stubEnv('AFFILIATE_BUYER_ANALYTICS_MODE', 'off');
  vi.stubEnv('AFFILIATE_NOTIFICATION_EVENT_MODE', 'off'); vi.stubEnv('AFFILIATE_CLICK_LEDGER_MODE', 'off');
  mock.reset();
  mock.rows.set(`affiliates/${affiliateId}`, { id: affiliateId, name: 'Original partner', affiliateCode: 'ORIGINAL9', email: 'private@example.test',
    phone: '254700000001', status: 'active', payoutMethod: 'mpesa', payoutDetails: { mpesaPhone: '254700000001' }, totalClicks: 0,
    totalSalesCount: 3, totalRevenueKes: 11_000, totalCommissionEarnedKes: 2_200, totalCommissionPaidKes: 200,
    balanceAvailableKes: 2_000, balancePendingKes: 0, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' });
  mock.rows.set('site_configs/affiliate_settings', { minPayoutThresholdKes: 500, defaultCommissionRate: 15 });
  for (const id of ['unpaid_a', 'unpaid_b']) mock.rows.set(`affiliate_commissions/${id}`, { id, affiliateId, affiliateCode: 'ORIGINAL9',
    transactionId: `tx_${id}`, articleId: `piece_${id}`, receiptNumber: `RECEIPT_${id}`, commissionAmountKes: 1_000,
    saleAmountKes: 5_000, commissionRate: 20, grossCreatorRevenueKes: 4_000, paymentMethod: 'mpesa', status: 'APPROVED', createdAt: '2026-10-02T08:00:00.000Z' });
  mock.rows.set('affiliate_commissions/paid_original', { id: 'paid_original', affiliateId, affiliateCode: 'ORIGINAL9', transactionId: 'paid_tx',
    checkoutRequestId: 'paid_checkout', articleId: 'original_piece', saleAmountKes: 1_000, commissionAmountKes: 200, commissionRate: 20,
    grossCreatorRevenueKes: 800, receiptNumber: 'PRIVATE-PAYMENT-RECEIPT', status: 'PAID', walletLedgerVersion: 1, payoutPaidKes: 200,
    payoutReservedKes: 0, paymentMethod: 'mpesa', createdAt: '2026-10-01T08:00:00.000Z' });
  mock.rows.set('transactions/paid_checkout', { id: 'paid_tx', checkoutRequestId: 'paid_checkout', articleId: 'original_piece', amount: 1_000,
    status: 'CONFIRMED', type: 'PURCHASE', paymentMethod: 'mpesa', mpesaReceiptNumber: 'PRIVATE-PAYMENT-RECEIPT',
    affiliateCode: 'ORIGINAL9', saleChannel: 'AFFILIATE', confirmedAt: '2026-10-01T08:00:00.000Z', buyer: { userId: 'PRIVATE_BUYER' } });
  mock.rows.set('affiliate_payouts/paid_original', { id: 'paid_original', affiliateId, amountKes: 200, status: 'PAID',
    paymentReference: 'PRIVATE-PAID-PROOF', commissionIds: ['paid_original'], allocations: [{ commissionId: 'paid_original', amountKes: 200 }], walletLedgerVersion: 1 });
  mock.rows.set('reader_licenses/preserved', { paid: true, readerId: 'PRIVATE_BUYER', articleId: 'original_piece' });
  await affiliateStore.init();
});

describe('integrated immutable adjustments and payout fencing', () => {
  it('limits requests to effective funds and deducts reservations only from the original baseline', async () => {
    const originals = preservedRows();
    await createAffiliateRefundAdjustment(context, request);
    await expect(affiliateStore.requestPayout(affiliateId, 1_900)).rejects.toThrow(/available balance/);
    const payout = await affiliateStore.requestPayout(affiliateId);
    expect(payout.amountKes).toBe(1_800);
    expect(account()).toMatchObject({ balanceAvailableKes: 200, balanceReservedKes: 1_800 });
    await affiliateStore.processPayout(payout.id, 'approve');
    await affiliateStore.processPayout(payout.id, 'mark_paid', 'VERIFIED-NEW-PAYOUT');
    const dashboard = await affiliateStore.getAffiliateDashboardFresh(affiliateId);
    expect(dashboard).toMatchObject({ availableBalanceKes: 0, commissionEarnedKes: 2_200,
      financialAdjustments: { walletAdjustmentKes: -200, adjustmentDebtKes: 0, revision: 1, asOf: '2026-10-27T08:00:00.000Z' } });
    expect(preservedRows()).toEqual(originals);
  });

  it('blocks approval and confirmation after a changed debit but permits cancellation while in debt', async () => {
    const payout = await affiliateStore.requestPayout(affiliateId, 1_500);
    walletSummary(-2_100);
    const before = structuredClone([...mock.rows]);
    await expect(affiliateStore.processPayout(payout.id, 'approve')).rejects.toThrow(/Cancel the reservation/);
    expect([...mock.rows]).toEqual(before);
    // A previously approved request is checked again at writer confirmation.
    mock.rows.get(`affiliate_payouts/${payout.id}`).status = 'APPROVED';
    await expect(affiliateStore.processPayout(payout.id, 'mark_paid', 'VERIFIED-NEW-PAYOUT')).rejects.toThrow(/Cancel the reservation/);
    await affiliateStore.processPayout(payout.id, 'reject');
    expect(account()).toMatchObject({ balanceAvailableKes: 2_000, balanceReservedKes: 0, activePayoutId: null, totalCommissionPaidKes: 200 });
    expect(await affiliateStore.getAffiliateDashboardFresh(affiliateId)).toMatchObject({ availableBalanceKes: 0,
      financialAdjustments: { adjustmentDebtKes: 100, walletAdjustmentKes: -2_100 } });
  });

  it.each([true, false])('fences racing requests and refunds in either commit order (%s)', async adjustmentFirst => {
    const originals = preservedRows();
    const operations = adjustmentFirst
      ? [createAffiliateRefundAdjustment(context, request), affiliateStore.requestPayout(affiliateId, 1_900)]
      : [affiliateStore.requestPayout(affiliateId, 1_900), createAffiliateRefundAdjustment(context, request)];
    const results = await Promise.allSettled(operations);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(mock.commits).toHaveLength(1);
    expect(preservedRows()).toEqual(originals);
  });

  it('reads fresh overlay debt after cache startup and restores funds only by immutable correction', async () => {
    account().balanceAvailableKes = 100;
    const first = await createAffiliateRefundAdjustment(context, request);
    expect(await affiliateStore.getAffiliateDashboardFresh(affiliateId)).toMatchObject({ availableBalanceKes: 0,
      financialAdjustments: { adjustmentDebtKes: 100, refundAmountKes: 1_000 } });
    await reverseAffiliateRefundAdjustment(context, { expectedRevision: 1, idempotencyKey: 'correction_integration_1', entryId: first.entryId,
      confirmationReference: 'CORRECTION-PROOF', currency: 'KES', confirmedByWriter: true });
    const snapshot = await affiliateStore.getAffiliateDashboardFresh(affiliateId);
    expect(snapshot).toMatchObject({ availableBalanceKes: 100, financialAdjustments: { adjustmentDebtKes: 0, revision: 2, walletAdjustmentKes: 0 } });
    expect(JSON.stringify(snapshot?.financialAdjustments)).not.toMatch(/PRIVATE|Authenticated writer/);
  });

  it('requires the reviewed bound SDK for payout requests and fresh views without a cached fallback', async () => {
    mock.setBound(false);
    await expect(affiliateStore.requestPayout(affiliateId, 500)).rejects.toThrow(/No local fallback/);
    await expect(affiliateStore.getAffiliateDashboardFresh(affiliateId)).rejects.toThrow(/no cached balances/);
    expect(mock.commits).toHaveLength(0);
  });
});
