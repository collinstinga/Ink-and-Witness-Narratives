import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';

type Ref = { id: string; path: string; collectionName: string };
type Query = { collectionName: string; filters: Array<[string, unknown]>; limitCount: number };
const mock = vi.hoisted(() => {
  const documents = new Map<string, any>();
  const commits: string[][] = [];
  let queue = Promise.resolve(); let failCommit = false; let failAudit = false;
  let target: { projectId: string; firestoreDatabaseId: string } | null = { projectId: 'ink-witness-staging-20261024', firestoreDatabaseId: '(default)' };
  const clone = (value: any) => value === undefined ? undefined : structuredClone(value);
  const ref = (collectionName: string, id: string): Ref => ({ collectionName, id, path: `${collectionName}/${id}` });
  const read = (item: Ref | Query): any => {
    if ('path' in item) return { id: item.id, exists: documents.has(item.path), data: () => clone(documents.get(item.path)) };
    return { readTime: { toMillis: () => Date.parse('2026-10-26T08:00:00.000Z') }, docs: [...documents].filter(([key, value]) => key.startsWith(`${item.collectionName}/`) && item.filters.every(([field, expected]) => value[field] === expected))
      .slice(0, item.limitCount).map(([key, value]) => ({ id: key.slice(item.collectionName.length + 1), exists: true, data: () => clone(value) })) };
  };
  const query = (collectionName: string, filters: Array<[string, unknown]> = [], limitCount = Infinity): any => ({
    collectionName, filters, limitCount,
    doc: (id: string) => ({ ...ref(collectionName, id), get: async () => read(ref(collectionName, id)) }),
    limit: (count: number) => query(collectionName, filters, count),
    where: (field: string, operator: string, expected: unknown) => {
      if (operator !== '==') throw new Error('unexpected query operator');
      return query(collectionName, [...filters, [field, expected]], limitCount);
    },
    get: async () => read({ collectionName, filters, limitCount }),
  });
  const runTransaction = vi.fn(async (operation: (transaction: any) => Promise<any>) => {
    let release!: () => void; const previous = queue; queue = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      const writes: Array<{ ref: Ref; value: any; create: boolean }> = [];
      const result = await operation({
        get: async (item: Ref | Query) => { if (writes.length) throw new Error('All reads must precede writes'); return read(item); },
        set: (item: Ref, value: any, options: any) => {
          if (options?.merge !== false) throw new Error('Summary replacement must be explicit');
          writes.push({ ref: item, value: clone(value), create: false });
        },
        create: (item: Ref, value: any) => {
          if (documents.has(item.path)) throw new Error('already exists');
          if (failAudit && item.collectionName === 'affiliate_audit') { failAudit = false; throw new Error('private audit failure'); }
          writes.push({ ref: item, value: clone(value), create: true });
        },
      });
      if (failCommit) { failCommit = false; throw new Error('private commit failure secret recipient'); }
      for (const write of writes) if (write.create && documents.has(write.ref.path)) throw new Error('create conflict');
      for (const write of writes) documents.set(write.ref.path, write.value);
      if (writes.length) commits.push(writes.map(write => write.ref.path));
      return result;
    } finally { release(); }
  });
  return { documents, commits, runTransaction, db: { collection: query, runTransaction },
    target: () => target,
    setTarget(value: typeof target) { target = value; },
    failCommit() { failCommit = true; }, failAudit() { failAudit = true; },
    reset() { documents.clear(); commits.length = 0; queue = Promise.resolve(); failCommit = false; failAudit = false;
      target = { projectId: 'ink-witness-staging-20261024', firestoreDatabaseId: '(default)' }; runTransaction.mockClear(); },
  };
});
vi.mock('./db.js', () => ({ getFirestoreClientTarget: () => mock.target() }));
import {
  AFFILIATE_FINANCIAL_ADJUSTMENT_COLLECTIONS as COLLECTIONS,
  AffiliateFinancialAdjustmentError,
  createAffiliateRefundAdjustment, reverseAffiliateRefundAdjustment,
  recordAffiliateDirectCost, reverseAffiliateDirectCost,
  readAffiliateAdjustmentWallet, readAffiliateDirectCostSummary,
  projectAffiliateAdjustedAvailableBalance, getAffiliateFinancialAdjustmentOverview,
  readAffiliateFinancialAdjustmentOverview, readAffiliateRefundQualificationEvidence,
} from './affiliateFinancialAdjustments.js';

const context = { db: mock.db as unknown as Firestore, expectedProjectId: 'ink-witness-staging-20261024', expectedDatabaseId: '(default)', actor: 'Authenticated writer',
  clock: () => new Date('2026-10-26T08:00:00.000Z') };
const affiliateId = 'original_affiliate';
const commissionId = 'original_commission';
const transactionId = 'original_transaction';
const base = { expectedRevision: 0, idempotencyKey: 'idempotency_key_0001', confirmationReference: 'BANK-REFUND-0001', currency: 'KES', confirmedByWriter: true };
const refund = (overrides: Record<string, unknown> = {}) => ({ ...base, commissionId, refundedAmountKes: 1_000, reason: 'refund', ...overrides });
const cost = (overrides: Record<string, unknown> = {}) => ({ ...base, transactionId, amountKes: 25.25, category: 'payment_fee', confirmationReference: 'FEE-STATEMENT-0001', ...overrides });
const correction = (entryId: string, overrides: Record<string, unknown> = {}) => ({ ...base, entryId, expectedRevision: 1,
  idempotencyKey: 'correction_key_0001', confirmationReference: 'CONFIRMED-CORRECTION-0001', ...overrides });
const commission = () => mock.documents.get(`affiliate_commissions/${commissionId}`);
const account = () => mock.documents.get(`affiliates/${affiliateId}`);
const payment = () => mock.documents.get('transactions/original_checkout');
const payout = () => mock.documents.get('affiliate_payouts/original_payout');
const snapshot = () => structuredClone([...mock.documents]);
const originalRows = () => [...mock.documents].filter(([key]) => !Object.values(COLLECTIONS).some(collection => key.startsWith(`${collection}/`)));
function seed(paidKes = 200) {
  mock.documents.set(`affiliates/${affiliateId}`, { id: affiliateId, affiliateCode: 'ORIGINAL9', balanceAvailableKes: 100, balancePendingKes: 0,
    totalCommissionEarnedKes: 200, totalCommissionPaidKes: paidKes, createdAt: '2026-09-01T00:00:00.000Z', privateLegacyField: 'preserve' });
  mock.documents.set(`affiliate_commissions/${commissionId}`, { id: commissionId, affiliateId, affiliateCode: 'ORIGINAL9', transactionId,
    checkoutRequestId: 'original_checkout', articleId: 'original_piece', receiptNumber: 'PAYMENTRECEIPT', saleAmountKes: 1_000,
    commissionAmountKes: 200, currency: 'KES', status: paidKes === 200 ? 'PAID' : 'APPROVED', walletLedgerVersion: 1,
    payoutPaidKes: paidKes, payoutReservedKes: 0, paymentMethod: 'mpesa', createdAt: '2026-10-01T00:00:00.000Z' });
  mock.documents.set('transactions/original_checkout', { id: transactionId, checkoutRequestId: 'original_checkout', articleId: 'original_piece',
    amount: 1_000, currency: 'KES', type: 'PURCHASE', status: 'CONFIRMED', paymentMethod: 'mpesa', mpesaReceiptNumber: 'PAYMENTRECEIPT',
    affiliateCode: 'ORIGINAL9', saleChannel: 'AFFILIATE', confirmedAt: '2026-10-01T00:00:00.000Z', buyer: { userId: 'PRIVATE_BUYER' },
    callbackCapabilityHash: 'PRIVATE_CALLBACK_HASH' });
  mock.documents.set('affiliate_payouts/original_payout', { id: 'original_payout', affiliateId, status: 'PAID', paymentReference: 'VERIFIED-PAID-REF',
    amountKes: paidKes, commissionIds: [commissionId], allocations: [{ commissionId, amountKes: paidKes }], walletLedgerVersion: 1 });
  mock.documents.set('reader_licenses/never_touch', { originalLicense: true, readerId: 'PRIVATE_BUYER' });
  mock.documents.set('affiliate_clicks/never_touch', { historicalClicks: 65 });
}
beforeEach(() => { vi.unstubAllEnvs(); mock.reset(); seed(); });

describe('immutable paid-commission refund accounting', () => {
  it('records a compensating debit with audit and exact joined evidence, never rewrites original rows', async () => {
    const originals = structuredClone(originalRows());
    const saved = await createAffiliateRefundAdjustment(context, refund());
    expect(saved).toMatchObject({ status: 'recorded', kind: 'refund', affiliateId, wallet: { revision: 1, walletDeltaKes: -200,
      refundAmountKes: 1_000, negativeBalancePolicy: 'offset_future_available_balance' }, providerOperationPerformed: false, accessPermissionsChanged: false });
    expect(originalRows()).toEqual(originals);
    expect(mock.commits).toHaveLength(1); expect(mock.commits[0]).toHaveLength(5);
    const entry = mock.documents.get(`${COLLECTIONS.entries}/${saved.entryId}`);
    expect(entry).toMatchObject({ amountMinor: 100_000, walletDeltaKes: -200, confirmationMethod: 'writer_confirmed', createdBy: context.actor });
    expect(JSON.stringify(entry)).not.toContain('PRIVATE_');
    const audit = mock.documents.get(`${COLLECTIONS.audits}/aud_${saved.entryId}`);
    expect(JSON.stringify(audit)).not.toContain('BANK-REFUND-0001');
    expect(projectAffiliateAdjustedAvailableBalance(100, saved.wallet!)).toEqual({ availableBalanceKes: 0, adjustmentDebtKes: 100, walletAdjustmentKes: -200 });
  });
  it('supports part-paid commissions but rejects their reserved payout before any changes', async () => {
    mock.reset(); seed(75);
    expect((await createAffiliateRefundAdjustment(context, refund({ refundedAmountKes: 500 }))).wallet?.walletDeltaKes).toBe(-100);
    mock.reset(); seed(75); commission().payoutReservedKes = 10; commission().reservedPayoutId = 'pending_payout';
    const before = snapshot();
    await expect(createAffiliateRefundAdjustment(context, refund())).rejects.toThrow(/reservation/);
    expect(snapshot()).toEqual(before);
  });
  it('returns an exact idempotent replay without repeating debit or audit', async () => {
    const request = refund(); const first = await createAffiliateRefundAdjustment(context, request);
    const before = snapshot(); const again = await createAffiliateRefundAdjustment(context, request);
    expect(again).toEqual({ ...first, status: 'already_recorded' }); expect(snapshot()).toEqual(before); expect(mock.commits).toHaveLength(1);
  });
  it('serializes duplicate callbacks and competing different adjustments', async () => {
    const [a, b] = await Promise.all([createAffiliateRefundAdjustment(context, refund()), createAffiliateRefundAdjustment(context, refund())]);
    expect([a.status, b.status].sort()).toEqual(['already_recorded', 'recorded']);
    mock.reset(); seed();
    const outcomes = await Promise.allSettled([createAffiliateRefundAdjustment(context, refund({ refundedAmountKes: 600 })),
      createAffiliateRefundAdjustment(context, refund({ refundedAmountKes: 600, idempotencyKey: 'different_key_0002', confirmationReference: 'SECOND-PROOF' }))]);
    expect(outcomes.filter(item => item.status === 'fulfilled')).toHaveLength(1);
    expect(mock.commits).toHaveLength(1);
  });
  it('refuses reused evidence under a new key and changed bodies under an old key', async () => {
    await createAffiliateRefundAdjustment(context, refund({ refundedAmountKes: 400 })); const before = snapshot();
    await expect(createAffiliateRefundAdjustment(context, refund({ expectedRevision: 1, idempotencyKey: 'different_key_0002' }))).rejects.toThrow(/changed/);
    await expect(createAffiliateRefundAdjustment(context, refund({ refundedAmountKes: 300 }))).rejects.toThrow(/changed/);
    expect(snapshot()).toEqual(before);
  });
  it('caps cumulative confirmed refunds and derives cumulative commission rounding exactly once', async () => {
    commission().commissionAmountKes = 201; commission().payoutPaidKes = 201; payout().amountKes = 201; payout().allocations[0].amountKes = 201;
    const first = await createAffiliateRefundAdjustment(context, refund({ refundedAmountKes: 333.33 }));
    expect(first.wallet?.walletDeltaKes).toBe(-67);
    const second = await createAffiliateRefundAdjustment(context, refund({ refundedAmountKes: 333.33, expectedRevision: 1,
      idempotencyKey: 'partial_refund_0002', confirmationReference: 'PARTIAL-REFUND-2' }));
    expect(second.wallet?.walletDeltaKes).toBe(-134);
    const third = await createAffiliateRefundAdjustment(context, refund({ refundedAmountKes: 333.34, expectedRevision: 2,
      idempotencyKey: 'partial_refund_0003', confirmationReference: 'PARTIAL-REFUND-3' }));
    expect(third.wallet?.walletDeltaKes).toBe(-201);
    const before = snapshot();
    await expect(createAffiliateRefundAdjustment(context, refund({ refundedAmountKes: 0.01, expectedRevision: 3,
      idempotencyKey: 'partial_refund_0004', confirmationReference: 'PARTIAL-REFUND-4' }))).rejects.toThrow(/exceed/);
    expect(snapshot()).toEqual(before);
  });
  it('compensates a mistaken refund exactly once without changing its original entry or payout', async () => {
    const first = await createAffiliateRefundAdjustment(context, refund());
    const original = structuredClone(mock.documents.get(`${COLLECTIONS.entries}/${first.entryId}`));
    const corrected = await reverseAffiliateRefundAdjustment(context, correction(first.entryId));
    expect(corrected.wallet).toMatchObject({ revision: 2, walletDeltaKes: 0, refundAmountKes: 0 });
    expect(mock.documents.get(`${COLLECTIONS.entries}/${first.entryId}`)).toEqual(original);
    expect(payout().status).toBe('PAID');
    const before = snapshot();
    await expect(reverseAffiliateRefundAdjustment(context, correction(first.entryId, { expectedRevision: 2,
      idempotencyKey: 'correction_key_0002', confirmationReference: 'CORRECTION-2' }))).rejects.toThrow(/changed/);
    expect(snapshot()).toEqual(before);
  });
  it('can compensate an earlier partial refund after another valid partial refund', async () => {
    const a = await createAffiliateRefundAdjustment(context, refund({ refundedAmountKes: 300 }));
    await createAffiliateRefundAdjustment(context, refund({ refundedAmountKes: 200, expectedRevision: 1,
      idempotencyKey: 'partial_refund_0002', confirmationReference: 'PARTIAL-REFUND-2' }));
    const result = await reverseAffiliateRefundAdjustment(context, correction(a.entryId, { expectedRevision: 2 }));
    expect(result.wallet).toMatchObject({ walletDeltaKes: -40, refundAmountKes: 200 });
    expect(await getAffiliateFinancialAdjustmentOverview(context)).toMatchObject({ asOf: '2026-10-26T08:00:00.000Z',
      refundedPurchaseKes: 200, commissionClawbackKes: 40, purchaseAdjustments: [{ transactionId, refundedPurchaseKes: 200, commissionClawbackKes: 40 }] });
  });
  it('does not publish any entry when commit or immutable audit creation fails', async () => {
    const before = snapshot(); mock.failCommit();
    await expect(createAffiliateRefundAdjustment(context, refund())).rejects.toMatchObject({ statusCode: 503 }); expect(snapshot()).toEqual(before);
    mock.failAudit(); await expect(createAffiliateRefundAdjustment(context, refund())).rejects.toMatchObject({ statusCode: 503 }); expect(snapshot()).toEqual(before);
    expect((await createAffiliateRefundAdjustment(context, refund())).status).toBe('recorded');
  });
  it.each([
    ['unpaid', () => { commission().status = 'APPROVED'; commission().payoutPaidKes = 0; }],
    ['reserved account', () => { account().activePayoutId = 'active_payout'; account().balanceReservedKes = 20; }],
    ['missing payout proof', () => { mock.documents.delete('affiliate_payouts/original_payout'); }],
    ['mismatched payout amount', () => { payout().allocations[0].amountKes = 199; }],
    ['missing receipt', () => { payout().paymentReference = ''; }],
    ['unsettled source', () => { payment().status = 'PENDING'; }],
    ['wrong transaction identity', () => { payment().id = 'other_transaction'; }],
    ['wrong source affiliate', () => { payment().affiliateCode = 'OTHER'; }],
    ['wrong purchase', () => { payment().articleId = 'different_piece'; }],
    ['wrong purchase amount', () => { payment().amount = 999; }],
    ['wrong receipt', () => { payment().mpesaReceiptNumber = 'OTHER'; }],
    ['foreign currency', () => { payment().currency = 'USD'; }],
    ['source seed', () => { payment().isSeed = true; }],
    ['direct sale', () => { payment().saleChannel = 'DIRECT'; }],
    ['missing settlement time', () => { delete payment().confirmedAt; }],
    ['future settlement', () => { payment().confirmedAt = '2027-01-01T00:00:00.000Z'; }],
    ['duplicate commission', () => { mock.documents.set('affiliate_commissions/duplicate', { ...commission(), id: 'duplicate' }); }],
    ['duplicate payout receipt', () => { commission().payoutPaidKes = 200; payout().amountKes = 100; payout().allocations[0].amountKes = 100;
      mock.documents.set('affiliate_payouts/duplicate', { ...payout(), id: 'duplicate' }); }],
    ['ambiguous legacy payout', () => { delete payout().walletLedgerVersion; delete payout().allocations; payout().commissionIds.push('other_commission'); }],
  ] as const)('rejects %s before any write', async (_label, modify) => {
    modify(); const before = snapshot();
    await expect(createAffiliateRefundAdjustment(context, refund())).rejects.toBeInstanceOf(AffiliateFinancialAdjustmentError);
    expect(snapshot()).toEqual(before); expect(mock.commits).toHaveLength(0);
  });
  it('preserves unversioned legacy paid records and accepts only unambiguous joined single-commission payout proof', async () => {
    delete commission().walletLedgerVersion; delete commission().payoutPaidKes; delete commission().payoutReservedKes;
    delete commission().currency; delete payment().currency; delete payout().walletLedgerVersion; delete payout().allocations;
    const originals = structuredClone(originalRows());
    expect((await createAffiliateRefundAdjustment(context, refund())).wallet?.walletDeltaKes).toBe(-200);
    expect(originalRows()).toEqual(originals);
  });
});

describe('separate known direct-cost accounting', () => {
  it('records exact cents and reports only known costs, not net profit or provider activity', async () => {
    const originals = structuredClone(originalRows());
    const saved = await recordAffiliateDirectCost(context, cost());
    expect(saved.directCosts).toEqual({ revision: 1, knownDirectCostsKes: 25.25, costCount: 1 });
    expect(originalRows()).toEqual(originals);
    expect(await readAffiliateDirectCostSummary(context, transactionId)).toEqual(saved.directCosts);
    const overview = await getAffiliateFinancialAdjustmentOverview(context);
    expect(overview).toMatchObject({ directCosts: [{ transactionId, knownDirectCostsKes: 25.25 }], costCoverage: 'known_recorded_costs_only', netProfitClaimed: false });
    expect(JSON.stringify(overview)).not.toMatch(/PRIVATE_|FEE-STATEMENT|PAYMENTRECEIPT|Authenticated writer/);
  });
  it('supports repeated distinct cost evidence and exact once-only full corrections', async () => {
    const first = await recordAffiliateDirectCost(context, cost());
    await recordAffiliateDirectCost(context, cost({ amountKes: 12.01, category: 'other', expectedRevision: 1,
      idempotencyKey: 'second_cost_key_0002', confirmationReference: 'INVOICE-0002' }));
    const corrected = await reverseAffiliateDirectCost(context, correction(first.entryId, { expectedRevision: 2 }));
    expect(corrected.directCosts).toEqual({ revision: 3, knownDirectCostsKes: 12.01, costCount: 3 });
    const before = snapshot();
    expect((await reverseAffiliateDirectCost(context, correction(first.entryId, { expectedRevision: 2 }))).status).toBe('already_recorded');
    expect(snapshot()).toEqual(before);
  });
  it('rejects duplicate costs and costs exceeding the settled source amount', async () => {
    await recordAffiliateDirectCost(context, cost()); const before = snapshot();
    await expect(recordAffiliateDirectCost(context, cost({ expectedRevision: 1, idempotencyKey: 'different_cost_0002' }))).rejects.toThrow(/changed/);
    await expect(recordAffiliateDirectCost(context, cost({ expectedRevision: 1, amountKes: 1_000,
      idempotencyKey: 'different_cost_0002', confirmationReference: 'OTHER-REF' }))).rejects.toThrow(/settled purchase/);
    expect(snapshot()).toEqual(before);
  });
  it('claims external financial evidence globally across refunds and costs', async () => {
    await createAffiliateRefundAdjustment(context, refund());
    const before = snapshot();
    await expect(recordAffiliateDirectCost(context, cost({ confirmationReference: base.confirmationReference }))).rejects.toThrow(/changed/);
    expect(snapshot()).toEqual(before);
  });
  it('refuses duplicate payment identities rather than selecting an arbitrary source', async () => {
    mock.documents.set('transactions/duplicate_checkout', { ...payment(), checkoutRequestId: 'duplicate_checkout' });
    const before = snapshot(); await expect(recordAffiliateDirectCost(context, cost())).rejects.toThrow(/duplicated/); expect(snapshot()).toEqual(before);
  });
  it('cannot turn a refund entry into a cost correction or correct a correction', async () => {
    const first = await createAffiliateRefundAdjustment(context, refund());
    await expect(reverseAffiliateDirectCost(context, correction(first.entryId))).rejects.toThrow(/original entry/);
    const fixed = await reverseAffiliateRefundAdjustment(context, correction(first.entryId));
    await expect(reverseAffiliateRefundAdjustment(context, correction(fixed.entryId, { expectedRevision: 2, idempotencyKey: 'third_correction_0003', confirmationReference: 'THIRD-CORRECTION' }))).rejects.toThrow(/original entry/);
  });
});

describe('strict boundaries, safe reads and bounded accounting', () => {
  it.each([0, -1, NaN, Infinity, 1.001, 1.00000000001, 1_000_000.01, '500', null])('rejects invalid amount %s', async value => {
    const before = snapshot(); await expect(recordAffiliateDirectCost(context, cost({ amountKes: value }))).rejects.toBeInstanceOf(AffiliateFinancialAdjustmentError); expect(snapshot()).toEqual(before);
  });
  it.each([
    { confirmedByWriter: false }, { confirmedByWriter: 'true' }, { currency: 'USD' }, { currency: 'kes' },
    { expectedRevision: -1 }, { expectedRevision: '0' }, { idempotencyKey: 'short' }, { confirmationReference: 'NEW\nHEADER' },
    { affiliateId: 'arbitrary_affiliate' }, { walletDeltaKes: -1 }, { now: '2026-01-01T00:00:00Z' }, { providerVerified: true },
  ])('rejects unauthorized request shape %#', async patch => {
    const before = snapshot(); await expect(createAffiliateRefundAdjustment(context, refund(patch))).rejects.toBeInstanceOf(AffiliateFinancialAdjustmentError); expect(snapshot()).toEqual(before);
  });
  it('rejects missing revision, source ID or confirmation before a transaction', async () => {
    const request = refund(); delete (request as any).expectedRevision;
    await expect(createAffiliateRefundAdjustment(context, request)).rejects.toThrow(/explicit/);
    expect(mock.runTransaction).not.toHaveBeenCalled();
  });
  it('checks actual bound SDK target and emulator state before any database access', async () => {
    mock.setTarget(null); await expect(createAffiliateRefundAdjustment(context, refund())).rejects.toMatchObject({ code: 'AFFILIATE_ADJUSTMENT_TARGET_MISMATCH' });
    mock.setTarget({ projectId: 'other-project', firestoreDatabaseId: '(default)' }); await expect(recordAffiliateDirectCost(context, cost())).rejects.toThrow(/reviewed database/);
    mock.setTarget({ projectId: context.expectedProjectId, firestoreDatabaseId: '(default)' }); vi.stubEnv('FIRESTORE_EMULATOR_HOST', 'localhost:8080');
    await expect(readAffiliateAdjustmentWallet(context, affiliateId)).rejects.toThrow(/reviewed database/);
    expect(mock.runTransaction).not.toHaveBeenCalled();
  });
  it('returns zero overlays for untouched legacy accounts with no bootstrap writes', async () => {
    const before = snapshot();
    expect(await readAffiliateAdjustmentWallet(context, affiliateId)).toMatchObject({ revision: 0, walletDeltaKes: 0, refundAmountKes: 0 });
    expect(await readAffiliateDirectCostSummary(context, transactionId)).toEqual({ revision: 0, knownDirectCostsKes: 0, costCount: 0 });
    expect(snapshot()).toEqual(before); expect(mock.commits).toHaveLength(0);
  });
  it('reads the effective balance inside a caller-owned transaction with no hidden writes', async () => {
    await createAffiliateRefundAdjustment(context, refund({ refundedAmountKes: 300 }));
    const result = await mock.db.runTransaction(async transaction => projectAffiliateAdjustedAvailableBalance(100,
      await readAffiliateAdjustmentWallet(context, affiliateId, transaction)));
    expect(result).toEqual({ availableBalanceKes: 40, adjustmentDebtKes: 0, walletAdjustmentKes: -60 }); expect(mock.commits).toHaveLength(1);
  });
  it('projects safe overview and exact net refund qualification in the caller snapshot', async () => {
    const first = await createAffiliateRefundAdjustment(context, refund({ refundedAmountKes: 300 }));
    await createAffiliateRefundAdjustment(context, refund({ expectedRevision: 1, refundedAmountKes: 200,
      idempotencyKey: 'qualification_refund_2', confirmationReference: 'QUALIFICATION-2' }));
    await reverseAffiliateRefundAdjustment(context, correction(first.entryId, { expectedRevision: 2 }));
    const before = snapshot();
    await mock.db.runTransaction(async transaction => {
      const overview = await readAffiliateFinancialAdjustmentOverview(context, transaction);
      expect(overview).toMatchObject({ asOf: '2026-10-26T08:00:00.000Z', refundedPurchaseKes: 200 });
      expect(overview.entries.find(row => row.entryId === first.entryId)).toMatchObject({ reason: 'refund' });
      expect(await readAffiliateRefundQualificationEvidence(context, transaction, affiliateId)).toEqual([{ commissionId, refundedPurchaseKes: 200 }]);
      expect(JSON.stringify(overview)).not.toMatch(/PRIVATE_|BANK-REFUND|PAYMENTRECEIPT|Authenticated writer/);
    });
    expect(snapshot()).toEqual(before);
  });
  it('uses only refunds known at the sale time and later corrections restore prospective qualification', async () => {
    const first = await createAffiliateRefundAdjustment(context, refund());
    await reverseAffiliateRefundAdjustment({ ...context, clock: () => new Date('2026-10-27T08:00:00.000Z') }, correction(first.entryId));
    await mock.db.runTransaction(async transaction => {
      expect(await readAffiliateRefundQualificationEvidence(context, transaction, affiliateId, '2026-10-25T08:00:00.000Z')).toEqual([]);
      expect(await readAffiliateRefundQualificationEvidence(context, transaction, affiliateId, '2026-10-26T09:00:00.000Z'))
        .toEqual([{ commissionId, refundedPurchaseKes: 1_000 }]);
      expect(await readAffiliateRefundQualificationEvidence(context, transaction, affiliateId, '2026-10-28T08:00:00.000Z'))
        .toEqual([{ commissionId, refundedPurchaseKes: 0 }]);
    });
  });
  it('rejects corrupted overlay summaries instead of reopening original commissions', async () => {
    await createAffiliateRefundAdjustment(context, refund());
    const row = [...mock.documents].find(([key, value]) => key.startsWith(`${COLLECTIONS.summaries}/`) && value.kind === 'affiliate')!;
    row[1].walletDeltaKes = 10;
    await expect(readAffiliateAdjustmentWallet(context, affiliateId)).rejects.toThrow(/reconciliation/);
    await expect(createAffiliateRefundAdjustment(context, refund())).rejects.toThrow(/reconciliation/);
  });
  it('does not accept an old replay when its durable summary has disappeared', async () => {
    await createAffiliateRefundAdjustment(context, refund());
    for (const [key, value] of mock.documents) if (value.kind === 'affiliate' && key.startsWith(`${COLLECTIONS.summaries}/`)) mock.documents.delete(key);
    await expect(createAffiliateRefundAdjustment(context, refund())).rejects.toThrow(/reconciliation/);
  });
  it('bounds reporting instead of presenting a truncated total', async () => {
    const saved = await recordAffiliateDirectCost(context, cost()); const record = mock.documents.get(`${COLLECTIONS.entries}/${saved.entryId}`);
    for (let index = 0; index < 501; index++) {
      const id = `afa1_${index.toString(16).padStart(64, '0')}`; mock.documents.set(`${COLLECTIONS.entries}/${id}`, { ...record, id });
    }
    await expect(getAffiliateFinancialAdjustmentOverview(context)).rejects.toThrow(/paginated/);
  });
  it('freezes request inputs before asynchronous transaction work', async () => {
    const request = refund({ refundedAmountKes: 400 }); const pending = createAffiliateRefundAdjustment(context, request);
    request.refundedAmountKes = 900; request.confirmationReference = 'MUTATED';
    expect((await pending).wallet).toMatchObject({ walletDeltaKes: -80, refundAmountKes: 400 });
  });
});
