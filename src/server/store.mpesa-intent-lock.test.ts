import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type FakeRef = { collectionName: string; id: string; key: string };

const firestoreMock = vi.hoisted(() => {
  const documents = new Map<string, any>();
  let failNextCommit = false;

  const clone = (value: any) => value === undefined ? undefined : structuredClone(value);
  const snapshot = (ref: FakeRef) => ({
    exists: documents.has(ref.key),
    data: () => clone(documents.get(ref.key))
  });
  const collection = (collectionName: string) => ({
    doc: (id: string) => {
      const ref: FakeRef & { get: () => Promise<ReturnType<typeof snapshot>> } = {
        collectionName,
        id,
        key: `${collectionName}/${id}`,
        get: async () => snapshot(ref)
      };
      return ref;
    }
  });
  const runTransaction = async (callback: (transaction: any) => Promise<any>) => {
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
      throw new Error('injected atomic commit failure');
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
  };

  return {
    documents,
    db: { collection, runTransaction },
    reset() {
      documents.clear();
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

vi.mock('./affiliateStore.js', () => ({
  affiliateStore: {
    init: vi.fn(async () => undefined),
    recordAffiliateSale: vi.fn(async () => null)
  }
}));

describe('M-Pesa request locks and intent attachment', () => {
  let store: typeof import('./store.js').store;
  let getMpesaRequestLockId: typeof import('./store.js').getMpesaRequestLockId;

  beforeAll(async () => {
    process.env.VERCEL = '1';
    ({ store, getMpesaRequestLockId } = await import('./store.js'));
  }, 60_000);

  beforeEach(() => {
    firestoreMock.reset();
  });

  function intent(
    callbackCharacter: string,
    paymentCharacter: string,
    overrides: Record<string, unknown> = {}
  ): import('./store.js').MpesaCallbackIntent {
    const createdAt = new Date();
    const articleId = String(overrides.articleId || 'article_1');
    const phoneNumber = String(overrides.phoneNumber || '254712345678');
    return {
      version: 1,
      callbackCapabilityHash: callbackCharacter.repeat(64),
      paymentCapabilityHash: paymentCharacter.repeat(64),
      requestLockId: getMpesaRequestLockId(articleId, phoneNumber),
      articleId,
      articleTitle: 'Intent recovery test',
      phoneNumber,
      amount: 300,
      currency: 'KES',
      originalAmount: 300,
      exchangeRate: 1,
      exchangeRateTimestamp: createdAt.toISOString(),
      type: 'PURCHASE',
      shortcodeUsed: '600111',
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + 60 * 60 * 1000).toISOString(),
      status: 'PREPARED',
      ...overrides
    } as import('./store.js').MpesaCallbackIntent;
  }

  it('blocks a duplicate request while the phone-and-piece lock is active', async () => {
    const first = intent('a', 'b');
    const duplicate = intent('c', 'd');

    await store.saveMpesaCallbackIntent(first);

    await expect(store.saveMpesaCallbackIntent(duplicate)).rejects.toMatchObject({
      code: 'ACTIVE_MPESA_INTENT'
    });
    expect(firestoreMock.documents.has(
      `mpesa_callback_intents/${duplicate.callbackCapabilityHash}`
    )).toBe(false);
    expect(firestoreMock.documents.has(
      `mpesa_payment_intents/${duplicate.paymentCapabilityHash}`
    )).toBe(false);
  });

  it('replaces an expired request lock with the new durable intent correlation', async () => {
    const replacement = intent('c', 'd');
    firestoreMock.documents.set(`mpesa_request_locks/${replacement.requestLockId}`, {
      version: 1,
      requestLockId: replacement.requestLockId,
      callbackCapabilityHash: 'a'.repeat(64),
      paymentCapabilityHash: 'b'.repeat(64),
      articleId: replacement.articleId,
      phoneNumber: replacement.phoneNumber,
      createdAt: '2026-09-01T00:00:00.000Z',
      expiresAt: '2026-09-01T00:02:00.000Z'
    });

    await expect(store.saveMpesaCallbackIntent(replacement)).resolves.toEqual(replacement);

    expect(firestoreMock.documents.get(
      `mpesa_request_locks/${replacement.requestLockId}`
    )).toMatchObject({
      callbackCapabilityHash: replacement.callbackCapabilityHash,
      paymentCapabilityHash: replacement.paymentCapabilityHash,
      articleId: replacement.articleId,
      phoneNumber: replacement.phoneNumber
    });
    expect(firestoreMock.documents.get(
      `mpesa_callback_intents/${replacement.callbackCapabilityHash}`
    )).toEqual(replacement);
    expect(firestoreMock.documents.get(
      `mpesa_payment_intents/${replacement.paymentCapabilityHash}`
    )).toEqual(replacement);
  });

  it('refuses attachment when callback and payment intent mirrors do not match', async () => {
    const prepared = intent('a', 'b');
    await store.saveMpesaCallbackIntent(prepared);
    const paymentKey = `mpesa_payment_intents/${prepared.paymentCapabilityHash}`;
    firestoreMock.documents.set(paymentKey, {
      ...firestoreMock.documents.get(paymentKey),
      amount: prepared.amount + 1
    });

    const result = await store.attachMpesaCallbackIntent(
      prepared.callbackCapabilityHash,
      'ws_CO_123456789',
      'merchant_123456789'
    );

    expect(result).toBeUndefined();
    expect(firestoreMock.documents.has('transactions/ws_CO_123456789')).toBe(false);
    expect(firestoreMock.documents.get(
      `mpesa_callback_intents/${prepared.callbackCapabilityHash}`
    )).toMatchObject({ status: 'PREPARED' });
    expect(firestoreMock.documents.get(paymentKey)).toMatchObject({ status: 'PREPARED' });
  });

  it('atomically creates the transaction and marks both matching mirrors attached', async () => {
    const prepared = intent('a', 'b');
    await store.saveMpesaCallbackIntent(prepared);

    const result = await store.attachMpesaCallbackIntent(
      prepared.callbackCapabilityHash,
      'ws_CO_123456789',
      'merchant_123456789'
    );

    expect(result).toMatchObject({
      checkoutRequestId: 'ws_CO_123456789',
      merchantRequestId: 'merchant_123456789',
      articleId: prepared.articleId,
      phoneNumber: prepared.phoneNumber,
      status: 'PENDING'
    });
    expect(firestoreMock.documents.get('transactions/ws_CO_123456789')).toEqual(result);
    for (const key of [
      `mpesa_callback_intents/${prepared.callbackCapabilityHash}`,
      `mpesa_payment_intents/${prepared.paymentCapabilityHash}`
    ]) {
      expect(firestoreMock.documents.get(key)).toMatchObject({
        status: 'ATTACHED',
        checkoutRequestId: 'ws_CO_123456789',
        merchantRequestId: 'merchant_123456789',
        attachedAt: expect.any(String)
      });
    }
  });

  it('publishes none of the attachment writes if the Firestore commit fails', async () => {
    const prepared = intent('a', 'b');
    await store.saveMpesaCallbackIntent(prepared);
    firestoreMock.failCommit();

    await expect(store.attachMpesaCallbackIntent(
      prepared.callbackCapabilityHash,
      'ws_CO_123456789',
      'merchant_123456789'
    )).rejects.toThrow('injected atomic commit failure');

    expect(firestoreMock.documents.has('transactions/ws_CO_123456789')).toBe(false);
    expect(firestoreMock.documents.get(
      `mpesa_callback_intents/${prepared.callbackCapabilityHash}`
    )).toMatchObject({ status: 'PREPARED' });
    expect(firestoreMock.documents.get(
      `mpesa_payment_intents/${prepared.paymentCapabilityHash}`
    )).toMatchObject({ status: 'PREPARED' });
  });
});
