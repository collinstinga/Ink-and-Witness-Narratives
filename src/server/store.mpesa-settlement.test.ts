import crypto from 'crypto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type FakeRef = { collectionName: string; id: string; key: string };

const firestoreMock = vi.hoisted(() => {
  const documents = new Map<string, any>();
  let queue: Promise<void> = Promise.resolve();
  let failNextCommit = false;

  const clone = (value: any) => value === undefined ? undefined : structuredClone(value);
  const snapshot = (ref: FakeRef) => ({
    exists: documents.has(ref.key),
    data: () => clone(documents.get(ref.key))
  });
  const collection = (collectionName: string) => ({
    doc: (id: string): FakeRef => ({ collectionName, id, key: `${collectionName}/${id}` })
  });
  const runTransaction = async (callback: (transaction: any) => Promise<any>) => {
    let release!: () => void;
    const previous = queue;
    queue = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      const writes: Array<
        | { operation: 'set' | 'create'; ref: FakeRef; data: any; merge: boolean }
        | { operation: 'delete'; ref: FakeRef }
      > = [];
      const result = await callback({
        get: async (ref: FakeRef) => snapshot(ref),
        set: (ref: FakeRef, data: any, options?: { merge?: boolean }) => {
          writes.push({ operation: 'set', ref, data: clone(data), merge: Boolean(options?.merge) });
        },
        create: (ref: FakeRef, data: any) => {
          if (documents.has(ref.key)) throw new Error('document already exists');
          writes.push({ operation: 'create', ref, data: clone(data), merge: false });
        },
        delete: (ref: FakeRef) => writes.push({ operation: 'delete', ref })
      });
      if (failNextCommit) {
        failNextCommit = false;
        throw new Error('injected commit failure');
      }
      for (const write of writes) {
        if (write.operation === 'delete') {
          documents.delete(write.ref.key);
          continue;
        }
        const current = write.merge ? (documents.get(write.ref.key) || {}) : {};
        documents.set(write.ref.key, { ...current, ...write.data });
      }
      return result;
    } finally {
      release();
    }
  };

  return {
    documents,
    db: { collection, runTransaction },
    reset() {
      documents.clear();
      queue = Promise.resolve();
      failNextCommit = false;
    },
    failCommit() {
      failNextCommit = true;
    }
  };
});

vi.mock('./db.js', () => ({
  getDb: vi.fn(() => firestoreMock.db),
  getFirestoreDoc: vi.fn(async (collectionName: string, id: string) =>
    firestoreMock.documents.get(`${collectionName}/${id}`) || null
  ),
  setFirestoreDoc: vi.fn(async (collectionName: string, id: string, data: any) => {
    const key = `${collectionName}/${id}`;
    firestoreMock.documents.set(key, { ...(firestoreMock.documents.get(key) || {}), ...data });
  }),
  deleteFirestoreDoc: vi.fn(async () => undefined),
  getAllFirestoreDocs: vi.fn(async () => []),
  sanitizeForFirestore: (value: unknown) => value
}));

const affiliateMocks = vi.hoisted(() => ({ recordAffiliateSale: vi.fn() }));
vi.mock('./affiliateStore.js', () => ({
  affiliateStore: {
    init: vi.fn(async () => undefined),
    recordAffiliateSale: affiliateMocks.recordAffiliateSale
  }
}));

import { setFirestoreDoc } from './db.js';

function pendingTransaction(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `tx_${id}`,
    checkoutRequestId: id,
    merchantRequestId: `merchant_${id}`,
    articleId: 'article_1',
    articleTitle: 'Atomic test',
    phoneNumber: '254712345678',
    amount: 300,
    paymentMethod: 'mpesa',
    type: 'PURCHASE',
    status: 'PENDING',
    callbackCapabilityHash: 'b'.repeat(64),
    paymentCapabilityHash: 'a'.repeat(64),
    createdAt: '2026-09-05T10:00:00.000Z',
    ...overrides
  };
}

describe('atomic M-Pesa settlement', () => {
  let store: typeof import('./store.js').store;

  beforeAll(async () => {
    process.env.VERCEL = '1';
    ({ store } = await import('./store.js'));
  }, 60_000);

  beforeEach(() => {
    firestoreMock.reset();
    affiliateMocks.recordAffiliateSale.mockReset();
    vi.mocked(setFirestoreDoc).mockClear();
  });

  const settlement = (id: string, receiptNumber = 'SIA1234567') => ({
    merchantRequestId: `merchant_${id}`,
    receiptNumber,
    amount: 300,
    phoneNumber: '254712345678',
    resultDesc: 'Success',
    transactionTimestamp: '20260905130500',
    expectedCallbackCapabilityHash: 'b'.repeat(64)
  });

  it('commits one transaction, hashed receipt claim, and reader license', async () => {
    firestoreMock.documents.set('transactions/checkout_1', pendingTransaction('checkout_1'));

    const result = await store.settleMpesaTransaction('checkout_1', settlement('checkout_1'));

    expect(result.outcome).toBe('committed');
    expect(result.downloadToken).toMatch(/^ink_/);
    expect(firestoreMock.documents.get('transactions/checkout_1')).toMatchObject({
      status: 'CONFIRMED',
      mpesaReceiptNumber: 'SIA1234567',
      downloadToken: result.downloadToken
    });
    expect(Array.from(firestoreMock.documents.keys()).filter(key => key.startsWith('payment_receipts/'))).toHaveLength(1);
    expect(firestoreMock.documents.has(`reader_licenses/${result.downloadToken}`)).toBe(true);
  });

  it('serializes concurrent retries so only one license is created', async () => {
    firestoreMock.documents.set('transactions/checkout_1', pendingTransaction('checkout_1'));

    const [first, second] = await Promise.all([
      store.settleMpesaTransaction('checkout_1', settlement('checkout_1')),
      store.settleMpesaTransaction('checkout_1', settlement('checkout_1'))
    ]);

    expect([first.outcome, second.outcome].sort()).toEqual(['committed', 'duplicate']);
    expect(first.downloadToken).toBe(second.downloadToken);
    expect(Array.from(firestoreMock.documents.keys()).filter(key => key.startsWith('reader_licenses/'))).toHaveLength(1);
  });

  it('rejects reuse of one receipt by another checkout', async () => {
    firestoreMock.documents.set('transactions/checkout_1', pendingTransaction('checkout_1'));
    firestoreMock.documents.set('transactions/checkout_2', pendingTransaction('checkout_2'));
    await store.settleMpesaTransaction('checkout_1', settlement('checkout_1'));

    const result = await store.settleMpesaTransaction('checkout_2', settlement('checkout_2'));
    expect(result.outcome).toBe('rejected');
    expect(firestoreMock.documents.get('transactions/checkout_2').status).toBe('PENDING');
  });

  it('does not publish cache or license state when the atomic commit fails', async () => {
    firestoreMock.documents.set('transactions/checkout_1', pendingTransaction('checkout_1'));
    firestoreMock.failCommit();

    await expect(store.settleMpesaTransaction('checkout_1', settlement('checkout_1')))
      .rejects.toThrow(/injected commit failure/);
    expect(firestoreMock.documents.get('transactions/checkout_1').status).toBe('PENDING');
    expect(Array.from(firestoreMock.documents.keys()).some(key => key.startsWith('reader_licenses/'))).toBe(false);
    expect(Array.from(firestoreMock.documents.keys()).some(key => key.startsWith('payment_receipts/'))).toBe(false);
  });

  it('writes a pending affiliate outbox checkpoint atomically and completes it after commission persistence', async () => {
    firestoreMock.documents.set('transactions/checkout_affiliate', pendingTransaction('checkout_affiliate', {
      affiliateCode: 'AFFILIATE1',
      campaignCode: 'LAUNCH'
    }));
    affiliateMocks.recordAffiliateSale.mockResolvedValueOnce({ id: 'commission_1' });

    const result = await store.settleMpesaTransaction(
      'checkout_affiliate',
      settlement('checkout_affiliate', 'SIAAFFILIATE1')
    );

    const outboxId = crypto.createHash('sha256').update('checkout_affiliate').digest('hex');
    expect(result.outcome).toBe('committed');
    expect(affiliateMocks.recordAffiliateSale).toHaveBeenCalledWith(
      expect.objectContaining({
        checkoutRequestId: 'checkout_affiliate',
        status: 'CONFIRMED',
        mpesaReceiptNumber: 'SIAAFFILIATE1'
      }),
      'AFFILIATE1',
      'LAUNCH'
    );
    expect(vi.mocked(setFirestoreDoc)).toHaveBeenCalledWith(
      'affiliate_commission_outbox',
      outboxId,
      expect.objectContaining({
        checkoutRequestId: 'checkout_affiliate',
        status: 'COMPLETE',
        commissionId: 'commission_1'
      })
    );
    expect(firestoreMock.documents.get(`affiliate_commission_outbox/${outboxId}`)).toMatchObject({
      checkoutRequestId: 'checkout_affiliate',
      status: 'COMPLETE',
      commissionId: 'commission_1',
      createdAt: expect.any(String),
      completedAt: expect.any(String)
    });
  });

  it('leaves a pending outbox checkpoint when commission persistence fails and completes it on callback retry', async () => {
    firestoreMock.documents.set('transactions/checkout_retry', pendingTransaction('checkout_retry', {
      affiliateCode: 'AFFILIATE1',
      campaignCode: 'LAUNCH'
    }));
    affiliateMocks.recordAffiliateSale
      .mockRejectedValueOnce(new Error('commission persistence unavailable'))
      .mockResolvedValueOnce({ id: 'commission_retry' });

    await expect(store.settleMpesaTransaction(
      'checkout_retry',
      settlement('checkout_retry', 'SIARETRY001')
    )).rejects.toThrow('commission persistence unavailable');

    const outboxId = crypto.createHash('sha256').update('checkout_retry').digest('hex');
    expect(firestoreMock.documents.get('transactions/checkout_retry')).toMatchObject({
      status: 'CONFIRMED',
      mpesaReceiptNumber: 'SIARETRY001'
    });
    expect(firestoreMock.documents.get(`affiliate_commission_outbox/${outboxId}`)).toMatchObject({
      checkoutRequestId: 'checkout_retry',
      status: 'PENDING'
    });
    expect(vi.mocked(setFirestoreDoc)).not.toHaveBeenCalled();

    const retry = await store.settleMpesaTransaction(
      'checkout_retry',
      settlement('checkout_retry', 'SIARETRY001')
    );

    expect(retry.outcome).toBe('duplicate');
    expect(affiliateMocks.recordAffiliateSale).toHaveBeenCalledTimes(2);
    expect(firestoreMock.documents.get(`affiliate_commission_outbox/${outboxId}`)).toMatchObject({
      checkoutRequestId: 'checkout_retry',
      status: 'COMPLETE',
      commissionId: 'commission_retry',
      completedAt: expect.any(String)
    });
    expect(Array.from(firestoreMock.documents.keys()).filter(key =>
      key.startsWith('reader_licenses/')
    )).toHaveLength(1);
  });

  it('retries an outbox completion write without duplicating the settled payment', async () => {
    firestoreMock.documents.set('transactions/checkout_outbox_retry', pendingTransaction('checkout_outbox_retry', {
      affiliateCode: 'AFFILIATE1'
    }));
    affiliateMocks.recordAffiliateSale.mockResolvedValue({ id: 'commission_outbox_retry' });
    vi.mocked(setFirestoreDoc).mockRejectedValueOnce(new Error('outbox completion unavailable'));

    await expect(store.settleMpesaTransaction(
      'checkout_outbox_retry',
      settlement('checkout_outbox_retry', 'SIAOUTBOX01')
    )).rejects.toThrow('outbox completion unavailable');

    const outboxId = crypto.createHash('sha256').update('checkout_outbox_retry').digest('hex');
    expect(firestoreMock.documents.get('transactions/checkout_outbox_retry')).toMatchObject({
      status: 'CONFIRMED',
      mpesaReceiptNumber: 'SIAOUTBOX01'
    });
    expect(firestoreMock.documents.get(`affiliate_commission_outbox/${outboxId}`)).toMatchObject({
      status: 'PENDING'
    });

    const retry = await store.settleMpesaTransaction(
      'checkout_outbox_retry',
      settlement('checkout_outbox_retry', 'SIAOUTBOX01')
    );

    expect(retry.outcome).toBe('duplicate');
    expect(affiliateMocks.recordAffiliateSale).toHaveBeenCalledTimes(2);
    expect(firestoreMock.documents.get(`affiliate_commission_outbox/${outboxId}`)).toMatchObject({
      status: 'COMPLETE',
      commissionId: 'commission_outbox_retry',
      completedAt: expect.any(String)
    });
    expect(Array.from(firestoreMock.documents.keys()).filter(key =>
      key.startsWith('payment_receipts/')
    )).toHaveLength(1);
    expect(Array.from(firestoreMock.documents.keys()).filter(key =>
      key.startsWith('reader_licenses/')
    )).toHaveLength(1);
  });

  it.each(['FAILED', 'CANCELLED', 'TIMEOUT'] as const)(
    'allows one fully correlated success to supersede prior %s state without duplicating settlement',
    async priorStatus => {
      const checkoutRequestId = `checkout_late_${priorStatus.toLowerCase()}`;
      const receiptNumber = `SIALATE${priorStatus.slice(0, 4)}`;
      firestoreMock.documents.set(
        `transactions/${checkoutRequestId}`,
        pendingTransaction(checkoutRequestId, {
          status: priorStatus,
          resultCode: priorStatus === 'CANCELLED' ? 1032 : priorStatus === 'TIMEOUT' ? 1037 : 1,
          resultDesc: `Earlier ${priorStatus.toLowerCase()} result`,
          completedAt: '2026-09-05T10:02:00.000Z'
        })
      );

      const [first, second] = await Promise.all([
        store.settleMpesaTransaction(
          checkoutRequestId,
          settlement(checkoutRequestId, receiptNumber)
        ),
        store.settleMpesaTransaction(
          checkoutRequestId,
          settlement(checkoutRequestId, receiptNumber)
        )
      ]);

      expect([first.outcome, second.outcome].sort()).toEqual(['committed', 'duplicate']);
      expect(first.downloadToken).toBe(second.downloadToken);
      expect(first.downloadToken).toMatch(/^ink_/);
      expect(firestoreMock.documents.get(`transactions/${checkoutRequestId}`)).toMatchObject({
        status: 'CONFIRMED',
        resultCode: 0,
        resultDesc: 'Success',
        mpesaReceiptNumber: receiptNumber,
        receiptNumber,
        downloadToken: first.downloadToken
      });
      expect(Array.from(firestoreMock.documents.keys()).filter(key =>
        key.startsWith('payment_receipts/')
      )).toHaveLength(1);
      expect(Array.from(firestoreMock.documents.keys()).filter(key =>
        key.startsWith('reader_licenses/')
      )).toHaveLength(1);

      const laterFailure = await store.recordMpesaTerminalFailure(checkoutRequestId, {
        merchantRequestId: `merchant_${checkoutRequestId}`,
        callbackCapabilityHash: 'b'.repeat(64),
        resultCode: 1032,
        resultDesc: 'Late cancellation must not win',
        status: 'CANCELLED'
      });

      expect(laterFailure.outcome).toBe('rejected');
      expect(firestoreMock.documents.get(`transactions/${checkoutRequestId}`)).toMatchObject({
        status: 'CONFIRMED',
        resultCode: 0,
        mpesaReceiptNumber: receiptNumber,
        downloadToken: first.downloadToken
      });
      expect(Array.from(firestoreMock.documents.keys()).filter(key =>
        key.startsWith('reader_licenses/')
      )).toHaveLength(1);
    }
  );

  it('prevents a later failure callback from regressing a confirmed payment', async () => {
    firestoreMock.documents.set('transactions/checkout_1', pendingTransaction('checkout_1'));
    await store.settleMpesaTransaction('checkout_1', settlement('checkout_1'));

    const result = await store.recordMpesaTerminalFailure('checkout_1', {
      merchantRequestId: 'merchant_checkout_1',
      callbackCapabilityHash: 'b'.repeat(64),
      resultCode: 1032,
      resultDesc: 'Cancelled',
      status: 'CANCELLED'
    });

    expect(result.outcome).toBe('rejected');
    expect(firestoreMock.documents.get('transactions/checkout_1').status).toBe('CONFIRMED');
  });
});
