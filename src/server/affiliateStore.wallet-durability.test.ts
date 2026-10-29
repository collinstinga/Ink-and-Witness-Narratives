import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AffiliateAccount, AffiliateSaleCommission } from '../types.js';

type Ref = { collectionName: string; id: string; key: string };
type Query = { collectionName: string; filters: Array<[string, unknown]>; limitCount: number };
const mock = vi.hoisted(() => {
  const documents = new Map<string, any>();
  let queue = Promise.resolve();
  let failCommit = false;
  let failAudit = false;
  const commits: number[] = [];
  const clone = (value: any) => value === undefined ? undefined : structuredClone(value);
  const ref = (collectionName: string, id: string): Ref => ({ collectionName, id, key: `${collectionName}/${id}` });
  const read = (target: Ref | Query): any => {
    if ('key' in target) return { id: target.id, exists: documents.has(target.key), data: () => clone(documents.get(target.key)) };
    return { docs: [...documents.entries()]
      .filter(([key, value]) => key.startsWith(`${target.collectionName}/`) && target.filters.every(([field, expected]) => value[field] === expected))
      .slice(0, target.limitCount).map(([key, value]) => ({
        id: key.slice(target.collectionName.length + 1), exists: true, data: () => clone(value),
      })) };
  };
  const query = (collectionName: string, filters: Array<[string, unknown]> = [], limitCount = Infinity): any => ({
    collectionName, filters, limitCount,
    doc: (id: string) => ref(collectionName, id),
    where: (field: string, operator: string, value: unknown) => {
      if (operator !== '==') throw new Error('Unexpected query operator');
      return query(collectionName, [...filters, [field, value]], limitCount);
    },
    limit: (count: number) => query(collectionName, filters, count),
    get: async () => read({ collectionName, filters, limitCount }),
  });
  const runTransaction = vi.fn(async (operation: (transaction: any) => Promise<any>) => {
    let release!: () => void;
    const previous = queue;
    queue = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      const writes: Array<{ ref: Ref; data: any; merge: boolean }> = [];
      const result = await operation({
        get: async (target: Ref | Query) => {
          if (writes.length) throw new Error('All transaction reads must precede writes');
          return read(target);
        },
        set: (target: Ref, data: any, options?: { merge?: boolean }) => writes.push({ ref: target, data: clone(data), merge: options?.merge === true }),
        create: (target: Ref, data: any) => {
          if (failAudit && target.collectionName === 'affiliate_audit') { failAudit = false; throw new Error('injected audit rejection'); }
          if (documents.has(target.key)) throw new Error('already exists');
          writes.push({ ref: target, data: clone(data), merge: false });
        },
      });
      if (failCommit) { failCommit = false; throw new Error('injected private persistence failure'); }
      if (writes.length >= 450) throw new Error('Wallet transaction exceeds reviewed write bound');
      for (const write of writes) documents.set(write.ref.key, {
        ...(write.merge ? clone(documents.get(write.ref.key) || {}) : {}), ...write.data,
      });
      if (writes.length) commits.push(writes.length);
      return result;
    } finally { release(); }
  });
  const setDoc = vi.fn(async (collectionName: string, id: string, data: any) => {
    documents.set(`${collectionName}/${id}`, { ...(documents.get(`${collectionName}/${id}`) || {}), ...clone(data) });
  });
  return { documents, commits, runTransaction, setDoc, db: { collection: query, runTransaction },
    reset() { documents.clear(); commits.length = 0; queue = Promise.resolve(); failCommit = false; failAudit = false; setDoc.mockClear(); runTransaction.mockClear(); },
    failCommit() { failCommit = true; }, failAudit() { failAudit = true; },
  };
});
vi.mock('fs', () => ({ default: { existsSync: () => false, mkdirSync: vi.fn(), readFileSync: vi.fn(), writeFileSync: vi.fn(), renameSync: vi.fn() } }));
vi.mock('./db.js', () => ({
  getDb: () => mock.db,
  resolveFirestoreTargetConfig: () => ({ projectId: 'ink-witness-staging-20261024', firestoreDatabaseId: '(default)' }),
  getFirestoreClientTarget: () => ({ projectId: 'ink-witness-staging-20261024', firestoreDatabaseId: '(default)' }),
  getFirestoreDoc: async (collection: string, id: string) => structuredClone(mock.documents.get(`${collection}/${id}`) || null),
  getAllFirestoreDocs: async (collection: string) => [...mock.documents.entries()].filter(([key]) => key.startsWith(`${collection}/`)).map(([, value]) => structuredClone(value)),
  setFirestoreDoc: mock.setDoc, replaceFirestoreDoc: mock.setDoc, updateFirestoreDoc: mock.setDoc, deleteFirestoreDoc: vi.fn(),
}));
import { affiliateStore, MAX_WALLET_PAYOUT_COMMISSIONS } from './affiliateStore.js';

const account: AffiliateAccount = {
  id: 'affiliate_wallet', affiliateCode: 'WALLET1', name: 'Wallet Partner', email: 'wallet@example.test', phone: '254700000001',
  status: 'active', payoutMethod: 'mpesa', payoutDetails: { mpesaPhone: '254700000001' },
  totalClicks: 0, uniqueVisitors: 0, totalSalesCount: 2, totalRevenueKes: 10_000,
  totalCommissionEarnedKes: 2_000, totalCommissionPaidKes: 0, balanceAvailableKes: 2_000, balancePendingKes: 0,
  createdAt: '2026-10-01T08:00:00.000Z', updatedAt: '2026-10-01T08:00:00.000Z',
};
function commission(id: string, overrides: Partial<AffiliateSaleCommission> = {}): AffiliateSaleCommission {
  return { id, affiliateId: account.id, affiliateCode: account.affiliateCode, affiliateName: account.name,
    articleId: `piece_${id}`, articleTitle: 'Existing piece', transactionId: `tx_${id}`, receiptNumber: `RECEIPT_${id}`,
    saleAmountKes: 5_000, commissionRate: 20, commissionAmountKes: 1_000, grossCreatorRevenueKes: 4_000,
    paymentMethod: 'mpesa', status: 'APPROVED', createdAt: '2026-10-01T08:00:00.000Z', ...overrides };
}
const durableAccount = () => mock.documents.get(`affiliates/${account.id}`);
const durableCommission = (id: string) => mock.documents.get(`affiliate_commissions/${id}`);
const snapshot = () => structuredClone([...mock.documents]);

describe('atomic affiliate wallet and payout preservation', () => {
  afterEach(() => { vi.unstubAllEnvs(); });
  beforeEach(async () => {
    vi.stubEnv('VERCEL', '1'); vi.stubEnv('AFFILIATE_BUYER_ANALYTICS_MODE', 'off');
    vi.stubEnv('AFFILIATE_NOTIFICATION_EVENT_MODE', 'off'); vi.stubEnv('AFFILIATE_CLICK_LEDGER_MODE', 'off');
    mock.reset();
    mock.documents.set(`affiliates/${account.id}`, structuredClone(account));
    mock.documents.set('site_configs/affiliate_settings', { minPayoutThresholdKes: 500 });
    mock.documents.set('affiliate_commissions/com_a', commission('com_a'));
    mock.documents.set('affiliate_commissions/com_b', commission('com_b'));
    mock.documents.set('reader_licenses/preserved', { readerId: 'reader_1', pieceId: 'piece_1', paid: true });
    await affiliateStore.init();
  });

  it('serializes competing requests and atomically reserves only the requested portion with its audit', async () => {
    const requests = await Promise.allSettled([affiliateStore.requestPayout(account.id, 750), affiliateStore.requestPayout(account.id, 750)]);
    expect(requests.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const payout = requests.find(result => result.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof affiliateStore.requestPayout>>>;
    expect(payout.value.allocations).toEqual([{ commissionId: 'com_a', amountKes: 750 }]);
    expect(durableAccount()).toMatchObject({ balanceAvailableKes: 1_250, balanceReservedKes: 750,
      activePayoutId: payout.value.id, totalCommissionEarnedKes: 2_000, totalCommissionPaidKes: 0 });
    expect(durableCommission('com_a')).toMatchObject({ status: 'APPROVED', payoutPaidKes: 0, payoutReservedKes: 750, reservedPayoutId: payout.value.id });
    expect(durableCommission('com_b')).not.toHaveProperty('payoutReservedKes');
    expect(mock.commits).toEqual([4]);
    expect(mock.documents.get('reader_licenses/preserved')).toEqual({ readerId: 'reader_1', pieceId: 'piece_1', paid: true });
  });

  it('settles partial payouts once, preserves the remainder and reports actual paid earnings', async () => {
    const first = await affiliateStore.requestPayout(account.id, 750);
    await affiliateStore.processPayout(first.id, 'approve');
    const auditCount = affiliateStore.getAuditLogs().length;
    await affiliateStore.processPayout(first.id, 'approve');
    expect(affiliateStore.getAuditLogs()).toHaveLength(auditCount);
    const paid = await affiliateStore.processPayout(first.id, 'mark_paid', ' receipt-first ');
    const afterPaid = snapshot();
    expect(await affiliateStore.processPayout(first.id, 'mark_paid', 'RECEIPT-FIRST')).toEqual(paid);
    expect(snapshot()).toEqual(afterPaid);
    expect(durableCommission('com_a')).toMatchObject({ status: 'APPROVED', payoutPaidKes: 750, payoutReservedKes: 0, reservedPayoutId: null });
    expect(durableAccount()).toMatchObject({ balanceAvailableKes: 1_250, balanceReservedKes: 0, totalCommissionPaidKes: 750, activePayoutId: null });
    expect(paid).toMatchObject({ paymentReference: 'RECEIPT-FIRST', confirmationMethod: 'writer_confirmed' });
    const second = await affiliateStore.requestPayout(account.id, 500);
    expect(second.allocations).toEqual([{ commissionId: 'com_a', amountKes: 250 }, { commissionId: 'com_b', amountKes: 250 }]);
    await affiliateStore.processPayout(second.id, 'approve');
    await affiliateStore.processPayout(second.id, 'mark_paid', 'RECEIPT-SECOND');
    expect(durableCommission('com_a')).toMatchObject({ status: 'PAID', payoutPaidKes: 1_000, payoutId: second.id });
    expect(durableCommission('com_b')).toMatchObject({ status: 'APPROVED', payoutPaidKes: 250 });
    const dashboard = affiliateStore.getAffiliateDashboard(account.id)!;
    expect(dashboard).toMatchObject({ commissionPaidKes: 1_250, commissionApprovedKes: 750, availableBalanceKes: 750 });
    expect(affiliateStore.getAdminAffiliatesSummary()).toMatchObject({ paidCommissionsKes: 1_250, approvedCommissionsKes: 750, outstandingBalanceKes: 750 });
    expect((await affiliateStore.getAdminAffiliateAnalytics({ startDate: '2026-10-01', endDate: '2026-10-31' })).totals.commissionsPaidKes).toBe(1_250);
    expect(durableAccount().totalCommissionEarnedKes).toBe(2_000);
  });

  it.each(['reject', 'fail'] as const)('releases exact reservations on %s without changing paid history', async action => {
    const payout = await affiliateStore.requestPayout(account.id, 1_250);
    await affiliateStore.processPayout(payout.id, action, undefined, 'Writer declined');
    expect(durableAccount()).toMatchObject({ balanceAvailableKes: 2_000, balanceReservedKes: 0, activePayoutId: null, totalCommissionPaidKes: 0 });
    for (const id of ['com_a', 'com_b']) expect(durableCommission(id)).toMatchObject({ status: 'APPROVED', payoutPaidKes: 0, payoutReservedKes: 0, reservedPayoutId: null });
    const before = snapshot();
    await affiliateStore.processPayout(payout.id, action);
    expect(snapshot()).toEqual(before);
  });

  it('keeps all durable and cached financial state unchanged when request commit or audit fails', async () => {
    const before = snapshot();
    for (const injectFailure of [mock.failCommit, mock.failAudit]) {
      injectFailure();
      await expect(affiliateStore.requestPayout(account.id, 750)).rejects.toThrow(/could not be committed/i);
      expect(snapshot()).toEqual(before);
      expect(affiliateStore.getPayouts()).toEqual([]);
      expect(affiliateStore.getAffiliateById(account.id)?.balanceAvailableKes).toBe(2_000);
    }
  });

  it('rejects unapproved payment, missing receipt, different replay receipt and duplicate receipts across payouts', async () => {
    const payout = await affiliateStore.requestPayout(account.id, 1_000);
    await expect(affiliateStore.processPayout(payout.id, 'mark_paid', 'RECEIPT-A')).rejects.toThrow(/Approve this payout/i);
    await affiliateStore.processPayout(payout.id, 'approve');
    await expect(affiliateStore.processPayout(payout.id, 'mark_paid')).rejects.toThrow(/verified payment receipt/i);
    await affiliateStore.processPayout(payout.id, 'mark_paid', 'RECEIPT-A');
    await expect(affiliateStore.processPayout(payout.id, 'mark_paid', 'RECEIPT-B')).rejects.toThrow(/different reference/i);
    const next = await affiliateStore.requestPayout(account.id, 500);
    await affiliateStore.processPayout(next.id, 'approve');
    const before = snapshot();
    await expect(affiliateStore.processPayout(next.id, 'mark_paid', 'RECEIPT-A')).rejects.toThrow(/another payout/i);
    expect(snapshot()).toEqual(before);
  });

  it('rolls back paid settlement or approval if audit/commit fails', async () => {
    const payout = await affiliateStore.requestPayout(account.id, 750);
    const before = snapshot();
    mock.failCommit();
    await expect(affiliateStore.processPayout(payout.id, 'approve')).rejects.toThrow(/could not be committed/i);
    expect(snapshot()).toEqual(before);
    await affiliateStore.processPayout(payout.id, 'approve');
    const approved = snapshot();
    mock.failAudit();
    await expect(affiliateStore.processPayout(payout.id, 'mark_paid', 'RECEIPT-FAIL')).rejects.toThrow(/could not be committed/i);
    expect(snapshot()).toEqual(approved);
    expect(durableAccount().totalCommissionPaidKes).toBe(0);
  });

  it('allows releasing a newly flagged commission but refuses paying it', async () => {
    const payout = await affiliateStore.requestPayout(account.id, 750);
    await affiliateStore.processPayout(payout.id, 'approve');
    mock.documents.set('affiliate_commissions/com_a', { ...durableCommission('com_a'), fraudFlag: { flagged: true, reason: 'Review' } });
    const before = snapshot();
    await expect(affiliateStore.processPayout(payout.id, 'mark_paid', 'FLAGGED-RECEIPT')).rejects.toThrow(/linked commission changed/i);
    expect(snapshot()).toEqual(before);
    await affiliateStore.processPayout(payout.id, 'reject');
    expect(durableAccount()).toMatchObject({ balanceAvailableKes: 2_000, balanceReservedKes: 0, totalCommissionPaidKes: 0 });
    expect(durableCommission('com_a').fraudFlag.flagged).toBe(true);
    expect(durableCommission('com_a').reservedPayoutId).toBeNull();
  });

  it('preserves legacy receipt spelling while rejecting canonical duplicate settlement', async () => {
    mock.documents.set('affiliate_payouts/legacy_reference', { id: 'legacy_reference', status: 'PAID', paymentReference: ' legacy-Bank-Ref ' });
    const payout = await affiliateStore.requestPayout(account.id, 750);
    await affiliateStore.processPayout(payout.id, 'approve');
    const before = snapshot();
    await expect(affiliateStore.processPayout(payout.id, 'mark_paid', 'LEGACY-bank-ref')).rejects.toThrow(/another payout/i);
    expect(snapshot()).toEqual(before);
  });

  it('requires a create-only global canonical receipt audit claim in the financial transaction', async () => {
    const payout = await affiliateStore.requestPayout(account.id, 750);
    await affiliateStore.processPayout(payout.id, 'approve');
    await affiliateStore.processPayout(payout.id, 'mark_paid', ' Shared-Reference ');
    const claims = [...mock.documents.entries()].filter(([key]) => key.startsWith('affiliate_audit/aud_payout_receipt_'));
    expect(claims).toHaveLength(1);
    expect(claims[0][1]).toMatchObject({ action: 'payout_processed', targetId: payout.id });
    const next = await affiliateStore.requestPayout(account.id, 500);
    await affiliateStore.processPayout(next.id, 'approve');
    mock.documents.delete(`affiliate_payouts/${payout.id}`);
    const before = snapshot();
    await expect(affiliateStore.processPayout(next.id, 'mark_paid', 'shared-reference')).rejects.toThrow(/another payout/i);
    expect(snapshot()).toEqual(before);
  });

  it('records an off-site M-Pesa receipt, writer confirmation and payment time with the same atomic wallet commit', async () => {
    const requested = await affiliateStore.requestPayout(account.id, 750);
    await affiliateStore.processPayout(requested.id, 'approve', undefined, 'Approved for off-site transfer', 'Writer');
    const approved = affiliateStore.getAffiliateDashboard(account.id)!;
    expect(approved.payouts[0]).toMatchObject({ status: 'APPROVED', amountKes: 750 });
    expect(approved.commissionPaidKes).toBe(0);
    const paid = await affiliateStore.processPayout(requested.id, 'mark_paid', ' qk82910482 ', 'Transferred and checked off-site', 'Writer');
    expect(paid).toMatchObject({ status: 'PAID', amountKes: 750, paymentReference: 'QK82910482',
      confirmationMethod: 'writer_confirmed', notes: 'Transferred and checked off-site' });
    expect(Number.isFinite(Date.parse(paid.paidAt!))).toBe(true);
    const dashboard = affiliateStore.getAffiliateDashboard(account.id)!;
    expect(dashboard).toMatchObject({ commissionPaidKes: 750, availableBalanceKes: 1_250 });
    expect(dashboard.payouts[0]).toEqual(paid);
    const audit = [...mock.documents.entries()].find(([key]) => key.startsWith('affiliate_audit/aud_payout_receipt_'))?.[1];
    expect(audit).toMatchObject({ actor: 'Writer', action: 'payout_processed', targetId: paid.id,
      newValue: { status: 'PAID', amountKes: 750, paymentReference: 'QK82910482', confirmationMethod: 'writer_confirmed', payoutMethod: 'mpesa', paidAt: paid.paidAt } });
    const committed = snapshot();
    await affiliateStore.processPayout(paid.id, 'mark_paid', 'QK82910482', 'Retry after connection dropped', 'Writer');
    expect(snapshot()).toEqual(committed);
    expect(durableAccount().totalCommissionEarnedKes).toBe(2_000);
    expect(mock.documents.get('reader_licenses/preserved')).toEqual({ readerId: 'reader_1', pieceId: 'piece_1', paid: true });
  });

  it('approves and reverses fresh commission balances atomically without reducing historical earnings', async () => {
    mock.documents.set('affiliate_commissions/com_pending', commission('com_pending', { status: 'PENDING', commissionAmountKes: 500 }));
    mock.documents.set(`affiliates/${account.id}`, { ...durableAccount(), balancePendingKes: 500, totalCommissionEarnedKes: 2_500 });
    await affiliateStore.updateCommissionStatus('com_pending', 'APPROVED');
    expect(durableAccount()).toMatchObject({ balancePendingKes: 0, balanceAvailableKes: 2_500 });
    const afterApprove = snapshot();
    await affiliateStore.updateCommissionStatus('com_pending', 'APPROVED');
    expect(snapshot()).toEqual(afterApprove);
    await affiliateStore.updateCommissionStatus('com_pending', 'REVERSED', 'Writer', 'Refund confirmed');
    expect(durableAccount()).toMatchObject({ balanceAvailableKes: 2_000, totalCommissionEarnedKes: 2_500, totalCommissionReversedKes: 500 });
    await expect(affiliateStore.updateCommissionStatus('com_pending', 'APPROVED')).rejects.toThrow(/transition is not allowed/i);
  });

  it('does not clamp missing money or reverse reserved, partial-paid or paid commissions automatically', async () => {
    mock.documents.set('affiliate_commissions/com_pending', commission('com_pending', { status: 'PENDING', commissionAmountKes: 500 }));
    const before = snapshot();
    await expect(affiliateStore.updateCommissionStatus('com_pending', 'APPROVED')).rejects.toThrow(/does not cover/i);
    expect(snapshot()).toEqual(before);
    const payout = await affiliateStore.requestPayout(account.id, 750);
    await expect(affiliateStore.updateCommissionStatus('com_a', 'REVERSED')).rejects.toThrow(/Cancel the active payout/i);
    await affiliateStore.processPayout(payout.id, 'approve');
    await affiliateStore.processPayout(payout.id, 'mark_paid', 'RECEIPT-PARTIAL');
    await expect(affiliateStore.updateCommissionStatus('com_a', 'REVERSED')).rejects.toThrow(/Part-paid commissions need writer review/i);
    await expect(affiliateStore.updateCommissionStatus('com_b', 'PAID')).rejects.toThrow(/transition is not allowed/i);
  });

  it('preserves legacy paid records and refuses ambiguous legacy active payouts', async () => {
    const legacy = { id: 'legacy_paid', affiliateId: account.id, amountKes: 1_000, status: 'PAID', paymentReference: 'LEGACY-RECEIPT', commissionIds: ['legacy_commission'], requestedAt: account.createdAt };
    mock.documents.set('affiliate_payouts/legacy_paid', structuredClone(legacy));
    const before = snapshot();
    expect(await affiliateStore.processPayout('legacy_paid', 'mark_paid', 'legacy-receipt')).toEqual(legacy);
    expect(snapshot()).toEqual(before);
    mock.documents.set('affiliate_payouts/legacy_pending', { ...legacy, id: 'legacy_pending', status: 'PENDING' });
    const withLegacyPending = snapshot();
    await expect(affiliateStore.requestPayout(account.id, 750)).rejects.toThrow(/legacy.*review/i);
    await expect(affiliateStore.processPayout('legacy_pending', 'approve')).rejects.toThrow(/legacy payout needs writer reconciliation/i);
    expect(snapshot()).toEqual(withLegacyPending);
  });

  it('fails closed on changed reservations and bounded oversized unpaid histories', async () => {
    const payout = await affiliateStore.requestPayout(account.id, 750);
    mock.documents.set(`affiliates/${account.id}`, { ...durableAccount(), balanceReservedKes: 700 });
    const before = snapshot();
    await expect(affiliateStore.processPayout(payout.id, 'approve')).rejects.toThrow(/reservations do not match/i);
    expect(snapshot()).toEqual(before);
    mock.documents.set(`affiliates/${account.id}`, structuredClone(account));
    mock.documents.delete(`affiliate_payouts/${payout.id}`);
    mock.documents.delete('affiliate_commissions/com_a');
    mock.documents.delete('affiliate_commissions/com_b');
    for (let index = 0; index <= MAX_WALLET_PAYOUT_COMMISSIONS; index++) {
      const id = `com_bound_${index}`;
      mock.documents.set(`affiliate_commissions/${id}`, commission(id));
    }
    const oversized = snapshot();
    await expect(affiliateStore.requestPayout(account.id, 750)).rejects.toThrow(/More than 400 unpaid/i);
    expect(snapshot()).toEqual(oversized);
  });

  it('uses durable threshold/balance and cannot overwrite financial fields through a stale profile', async () => {
    mock.documents.set(`affiliates/${account.id}`, { ...durableAccount(), balanceAvailableKes: 1_500 });
    mock.documents.set('site_configs/affiliate_settings', { minPayoutThresholdKes: 800 });
    await expect(affiliateStore.requestPayout(account.id, 750)).rejects.toThrow(/configured minimum.*800/i);
    await expect(affiliateStore.requestPayout(account.id, 1_600)).rejects.toThrow(/available balance.*1,500/i);
    await expect(affiliateStore.updateAffiliate(account.id, { balanceAvailableKes: 50_000 })).rejects.toThrow(/cannot be changed through profile/i);
    await affiliateStore.updateAffiliate(account.id, { name: 'Renamed Partner' });
    expect(durableAccount()).toMatchObject({ name: 'Renamed Partner', balanceAvailableKes: 1_500 });
    expect(affiliateStore.getAffiliateById(account.id)).toMatchObject({ name: 'Renamed Partner', balanceAvailableKes: 1_500 });
    expect(mock.setDoc.mock.calls.some(call => call[0] === 'affiliates' && call[1] === account.id)).toBe(false);
  });

  it('keeps the maximum reviewed allocation below the transaction write limit', async () => {
    mock.documents.delete('affiliate_commissions/com_a'); mock.documents.delete('affiliate_commissions/com_b');
    mock.documents.set(`affiliates/${account.id}`, { ...durableAccount(), balanceAvailableKes: 400, totalCommissionEarnedKes: 400 });
    mock.documents.set('site_configs/affiliate_settings', { minPayoutThresholdKes: 1 });
    for (let index = 0; index < MAX_WALLET_PAYOUT_COMMISSIONS; index++) {
      const id = `com_max_${index}`;
      mock.documents.set(`affiliate_commissions/${id}`, commission(id, { commissionAmountKes: 1, saleAmountKes: 5, grossCreatorRevenueKes: 4 }));
    }
    const payout = await affiliateStore.requestPayout(account.id, 400);
    expect(payout.allocations).toHaveLength(400);
    expect(mock.commits).toEqual([403]);
    await affiliateStore.processPayout(payout.id, 'approve');
    await affiliateStore.processPayout(payout.id, 'mark_paid', 'MAX-RECEIPT');
    expect(mock.commits).toEqual([403, 2, 403]);
    expect(durableAccount()).toMatchObject({ balanceAvailableKes: 0, balanceReservedKes: 0, totalCommissionPaidKes: 400 });
  });

  it('refuses legacy commission payout links or failed status audits without repairing records', async () => {
    mock.documents.set('affiliate_commissions/com_a', { ...durableCommission('com_a'), payoutId: 'legacy_ambiguous' });
    const legacy = snapshot();
    await expect(affiliateStore.requestPayout(account.id, 750)).rejects.toThrow(/need writer review/i);
    expect(snapshot()).toEqual(legacy);
    mock.documents.set('affiliate_commissions/com_a', commission('com_a'));
    const before = snapshot();
    mock.failAudit();
    await expect(affiliateStore.updateCommissionStatus('com_a', 'REVERSED')).rejects.toThrow(/could not be committed/i);
    expect(snapshot()).toEqual(before);
  });

  it('reverses a uniquely identified unpaid transaction and refuses duplicate commission identities', async () => {
    expect(await affiliateStore.reverseCommissionForTransaction('tx_com_a')).toBe(true);
    expect(durableCommission('com_a').status).toBe('REVERSED');
    mock.documents.set('affiliate_commissions/com_duplicate', commission('com_duplicate', { transactionId: 'tx_com_b' }));
    const before = snapshot();
    await expect(affiliateStore.reverseCommissionForTransaction('tx_com_b')).rejects.toThrow(/Duplicate transaction commissions/i);
    expect(snapshot()).toEqual(before);
  });
});
