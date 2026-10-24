import crypto from 'crypto';
import { describe, expect, it } from 'vitest';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import type { AffiliateAccount, AffiliateSaleCommission, PaymentTransaction } from '../types.js';
import {
  AFFILIATE_TIER_PERIOD_COLLECTION, MAX_TIER_PERIOD_BOOTSTRAP_COMMISSIONS, MAX_TIER_PERIOD_SALES,
  AffiliateTierPeriodReviewError, affiliateTierPeriodBounds, affiliateTierPeriodDocumentId,
  appendAffiliateTierPeriodSale, countAffiliateTierPeriodSales, readAffiliateTierPeriodForSale,
  readAffiliateTierPeriodReversal, validateAffiliateTierPeriodPayment,
  type AffiliateTierPeriod,
} from './affiliateTierPeriods.js';

const affiliate = { id: 'affiliate_1', affiliateCode: 'PARTNER1' } as AffiliateAccount;
const createdAt = '2026-10-12T08:00:00.000Z';
function sale(index: number, at = createdAt): AffiliateSaleCommission {
  const checkout = `checkout_${index}`;
  return { id: `com_tx_${crypto.createHash('sha256').update(checkout).digest('hex').slice(0, 40)}`,
    checkoutRequestId: checkout, transactionId: `tx_${index}`, affiliateId: affiliate.id, affiliateCode: affiliate.affiliateCode,
    affiliateName: 'Existing Partner', articleId: 'piece_1', articleTitle: 'Existing piece',
    receiptNumber: `RECEIPT_${index}`, saleAmountKes: 500, commissionRate: 15, commissionAmountKes: 75,
    grossCreatorRevenueKes: 425, paymentMethod: 'mpesa', status: 'APPROVED', createdAt: at };
}
function payment(commission: AffiliateSaleCommission, type: 'PURCHASE' | 'TIP' = 'PURCHASE'): PaymentTransaction {
  return { id: commission.transactionId, checkoutRequestId: commission.checkoutRequestId!, merchantRequestId: 'merchant_1',
    articleId: commission.articleId, amount: commission.saleAmountKes, type, status: 'CONFIRMED', paymentMethod: 'mpesa',
    phoneNumber: '254712345678', mpesaReceiptNumber: commission.receiptNumber, affiliateCode: commission.affiliateCode,
    createdAt: commission.createdAt } as PaymentTransaction;
}
function period(members: AffiliateSaleCommission[] = []): AffiliateTierPeriod {
  return { schemaVersion: 1, affiliateId: affiliate.id, periodKey: '2026-10', revision: 1, evidenceComplete: true,
    members: members.map(row => ({ id: row.id, checkoutRequestId: row.checkoutRequestId!, createdAt: row.createdAt })),
    awardedMilestones: [] };
}
function fakeDb() {
  const records = new Map<string, any>();
  const reads: string[] = [];
  const queries: any[] = [];
  const ref = (collection: string, id: string) => ({ id, collection, path: `${collection}/${id}` });
  const query = (collection: string, filters: Array<[string, string, any]> = [], cap = Infinity): any => ({
    collection, filters, cap,
    doc: (id: string) => ref(collection, id),
    where: (field: string, operator: string, value: any) => query(collection, [...filters, [field, operator, value]], cap),
    limit: (count: number) => query(collection, filters, count),
  });
  const db = { collection: query } as unknown as Firestore;
  const transaction = { get: async (target: any) => {
    if (target.path) {
      reads.push(target.path);
      return { id: target.id, exists: records.has(target.path), data: () => structuredClone(records.get(target.path)) };
    }
    queries.push(target);
    return { docs: [...records].filter(([key, value]) => key.startsWith(`${target.collection}/`)
      && target.filters.every(([field, operator, expected]: [string, string, any]) => operator === '==' ? value[field] === expected
        : operator === '>=' ? value[field] >= expected : value[field] < expected))
      .slice(0, target.cap).map(([key, value]) => ({ id: key.slice(target.collection.length + 1), data: () => structuredClone(value) })) };
  } } as unknown as Transaction;
  return { records, reads, queries, db, transaction,
    seed(commission: AffiliateSaleCommission, type: 'PURCHASE' | 'TIP' = 'PURCHASE') {
      records.set(`affiliate_commissions/${commission.id}`, commission);
      records.set(`transactions/${commission.checkoutRequestId}`, payment(commission, type));
    },
    savePeriod(value: AffiliateTierPeriod) {
      records.set(`${AFFILIATE_TIER_PERIOD_COLLECTION}/${affiliateTierPeriodDocumentId(affiliate.id, value.periodKey)}`, value);
    },
  };
}
const request = (mock: ReturnType<typeof fakeDb>, initialize = true) => ({
  db: mock.db, transaction: mock.transaction, affiliate, transactionAt: createdAt, initialize,
});

describe('bounded durable Nairobi monthly tier qualification', () => {
  it('uses exact Nairobi UTC calendar boundaries, including year transitions', () => {
    expect(affiliateTierPeriodBounds('2026-10')).toEqual({ start: '2026-09-30T21:00:00.000Z', end: '2026-10-31T21:00:00.000Z' });
    expect(affiliateTierPeriodBounds('2026-12')).toEqual({ start: '2026-11-30T21:00:00.000Z', end: '2026-12-31T21:00:00.000Z' });
    expect(() => affiliateTierPeriodBounds('2026-13')).toThrow(AffiliateTierPeriodReviewError);
  });

  it('bootstraps only one capped month query and joins exact confirmed canonical purchases', async () => {
    const mock = fakeDb();
    mock.seed(sale(1)); mock.seed(sale(2, '2026-09-30T21:00:00.000Z'));
    mock.seed(sale(3, '2026-09-30T20:59:59.999Z')); mock.seed(sale(4, '2026-10-31T21:00:00.000Z'));
    const result = await readAffiliateTierPeriodForSale(request(mock));
    expect(result?.period.members.map(row => row.id).sort()).toEqual([sale(1).id, sale(2).id].sort());
    expect(mock.queries).toHaveLength(1);
    expect(mock.queries[0]).toMatchObject({ collection: 'affiliate_commissions', cap: MAX_TIER_PERIOD_BOOTSTRAP_COMMISSIONS + 1,
      filters: [['affiliateId', '==', affiliate.id], ['createdAt', '>=', '2026-09-30T21:00:00.000Z'], ['createdAt', '<', '2026-10-31T21:00:00.000Z']] });
    expect(mock.reads.filter(key => key.startsWith('transactions/'))).toHaveLength(2);
  });

  it('uses only one period read on later sales regardless of lifetime history', async () => {
    const mock = fakeDb(); mock.savePeriod(period([sale(1)]));
    for (let index = 10; index < 10_020; index++) mock.seed(sale(index, '2026-09-10T08:00:00.000Z'));
    const result = await readAffiliateTierPeriodForSale(request(mock));
    expect(countAffiliateTierPeriodSales(result!.period)).toBe(1);
    expect(mock.queries).toHaveLength(0); expect(mock.reads).toHaveLength(1);
  });

  it('does not bootstrap or invent evidence for preserved legacy/manual arrangements', async () => {
    const mock = fakeDb();
    expect(await readAffiliateTierPeriodForSale(request(mock, false))).toBeUndefined();
    expect(mock.queries).toHaveLength(0); expect(mock.records.size).toBe(0);
  });

  it('refuses overflow before reading payments rather than pricing an incomplete history', async () => {
    const mock = fakeDb();
    for (let index = 0; index <= MAX_TIER_PERIOD_BOOTSTRAP_COMMISSIONS; index++) mock.seed(sale(index));
    await expect(readAffiliateTierPeriodForSale(request(mock))).rejects.toThrow(AffiliateTierPeriodReviewError);
    expect(mock.reads.filter(key => key.startsWith('transactions/'))).toHaveLength(0);
  });

  it.each(['missing', 'unconfirmed', 'wrong_amount', 'wrong_receipt', 'wrong_owner', 'wrong_settlement', 'wrong_kind'])('fails closed for %s backing evidence', async kind => {
    const mock = fakeDb(); const row = sale(1); mock.seed(row);
    const key = `transactions/${row.checkoutRequestId}`;
    if (kind === 'missing') mock.records.delete(key);
    else Object.assign(mock.records.get(key), kind === 'unconfirmed' ? { status: 'PENDING' }
      : kind === 'wrong_amount' ? { amount: 501 } : kind === 'wrong_receipt' ? { mpesaReceiptNumber: 'OTHER' }
        : kind === 'wrong_owner' ? { affiliateCode: 'OTHER' } : kind === 'wrong_settlement' ? { confirmedAt: '2026-10-13T08:00:00.000Z' }
          : { purchaseKind: 'bundle' });
    await expect(readAffiliateTierPeriodForSale(request(mock))).rejects.toThrow(AffiliateTierPeriodReviewError);
  });

  it('never promotes legacy noncanonical IDs or duplicate checkout rows into verified sales', async () => {
    const mock = fakeDb(); const row = sale(1); mock.seed(row);
    mock.records.set('affiliate_commissions/legacy_duplicate', { ...row, id: 'legacy_duplicate' });
    await expect(readAffiliateTierPeriodForSale(request(mock))).rejects.toThrow(AffiliateTierPeriodReviewError);
  });

  it('excludes tips, rejected/reversed and flagged commissions without changing their financial values', async () => {
    const mock = fakeDb(); mock.seed(sale(1)); mock.seed(sale(2), 'TIP');
    mock.seed({ ...sale(3), status: 'REVERSED' }); mock.seed({ ...sale(4), status: 'REJECTED' });
    mock.seed({ ...sale(5), fraudFlag: { flagged: true, reason: 'review', severity: 'high', reviewed: true } });
    const before = structuredClone([...mock.records]);
    const result = await readAffiliateTierPeriodForSale(request(mock));
    expect(result?.period.members.map(row => row.id)).toEqual([sale(1).id]);
    expect([...mock.records]).toEqual(before);
  });

  it('validates new settlement evidence and does not count a tip as a purchase', async () => {
    const mock = fakeDb(); const row = sale(1); mock.seed(row, 'TIP');
    await expect(validateAffiliateTierPeriodPayment({ ...request(mock), commission: row, paymentType: 'PURCHASE' })).rejects.toThrow(AffiliateTierPeriodReviewError);
    expect(await validateAffiliateTierPeriodPayment({ ...request(mock), commission: row, paymentType: 'TIP' })).toBe(false);
  });

  it('counts by effective date and settlement as-of, not by callback arrival time', () => {
    const value = period([sale(1, '2026-10-01T08:00:00.000Z'), sale(2), sale(3, '2026-10-20T08:00:00.000Z')]);
    expect(countAffiliateTierPeriodSales(value, '2026-10-10T08:00:00.000Z', createdAt)).toBe(1);
    expect(countAffiliateTierPeriodSales(value, undefined, createdAt)).toBe(2);
    expect(countAffiliateTierPeriodSales(value)).toBe(3);
  });

  it('appends one member and rejects duplicate commission or checkout membership', () => {
    const mock = fakeDb(); const mutation = { ref: mock.db.collection(AFFILIATE_TIER_PERIOD_COLLECTION).doc('example'), period: period([sale(1)]) };
    const next = appendAffiliateTierPeriodSale(mutation, sale(2));
    expect(next.revision).toBe(2); expect(next.members).toHaveLength(2); expect(mutation.period.members).toHaveLength(1);
    expect(() => appendAffiliateTierPeriodSale({ ...mutation, period: next }, sale(2))).toThrow(AffiliateTierPeriodReviewError);
  });

  it('removes only the recorded member once, retains recognition and never bootstraps a missing reversal summary', async () => {
    const mock = fakeDb(); const row = sale(1); const value = period([row, sale(2)]); value.awardedMilestones = ['3:literary-ambassador']; mock.savePeriod(value);
    const result = await readAffiliateTierPeriodReversal({ db: mock.db, transaction: mock.transaction, commission: row });
    expect(result?.period.members.map(member => member.id)).toEqual([sale(2).id]);
    expect(result?.period.awardedMilestones).toEqual(['3:literary-ambassador']);
    mock.savePeriod(result!.period);
    expect(await readAffiliateTierPeriodReversal({ db: mock.db, transaction: mock.transaction, commission: row })).toBeUndefined();
    const empty = fakeDb();
    expect(await readAffiliateTierPeriodReversal({ db: empty.db, transaction: empty.transaction, commission: row })).toBeUndefined();
    expect(empty.queries).toHaveLength(0);
  });

  it('refuses malformed, duplicate and oversized period documents before using their counts', async () => {
    for (const value of [
      { ...period(), evidenceComplete: false },
      period([sale(1), sale(1)]),
      period(Array.from({ length: MAX_TIER_PERIOD_SALES + 1 }, (_, index) => sale(index))),
      { ...period(), ignoredBlob: 'x'.repeat(1_048_576) },
    ]) {
      const mock = fakeDb(); mock.savePeriod(value as AffiliateTierPeriod);
      await expect(readAffiliateTierPeriodForSale(request(mock))).rejects.toThrow(AffiliateTierPeriodReviewError);
    }
  });

  it('enforces the document/member bounds before a sale append can be committed', () => {
    const mock = fakeDb(); const value = period(Array.from({ length: MAX_TIER_PERIOD_SALES }, (_, index) => sale(index)));
    expect(() => appendAffiliateTierPeriodSale({ ref: mock.db.collection(AFFILIATE_TIER_PERIOD_COLLECTION).doc('example'), period: value }, sale(MAX_TIER_PERIOD_SALES))).toThrow(AffiliateTierPeriodReviewError);
  });
});
