import { beforeAll, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => {
  const remoteTransaction = {
    id: 'tx_remote',
    checkoutRequestId: 'checkout_remote',
    articleId: 'article_remote',
    articleTitle: 'Remote purchase',
    amount: 300,
    type: 'PURCHASE',
    status: 'CONFIRMED',
    createdAt: '2026-01-01T00:00:00.000Z'
  };

  return {
    remoteTransaction,
    getAllFirestoreDocs: vi.fn(async (collectionName: string) =>
      collectionName === 'transactions' ? [remoteTransaction] : []
    ),
    getFirestoreDoc: vi.fn(async () => null),
    setFirestoreDoc: vi.fn(async () => undefined),
    deleteFirestoreDoc: vi.fn(async () => undefined)
  };
});

vi.mock('./db.js', () => ({
  getDb: vi.fn(() => ({})),
  getAllFirestoreDocs: dbMocks.getAllFirestoreDocs,
  getFirestoreDoc: dbMocks.getFirestoreDoc,
  setFirestoreDoc: dbMocks.setFirestoreDoc,
  deleteFirestoreDoc: dbMocks.deleteFirestoreDoc,
  sanitizeForFirestore: (value: unknown) => value
}));

vi.mock('./affiliateStore.js', () => ({
  affiliateStore: {
    init: vi.fn(async () => undefined),
    recordAffiliateSale: vi.fn()
  }
}));

describe('lazy transaction hydration', () => {
  let store: typeof import('./store.js').store;

  beforeAll(async () => {
    process.env.VERCEL = '1';
    delete process.env.EAGER_TRANSACTION_BOOTSTRAP;
    process.env.INITIAL_ADMIN_EMAIL = '';
    process.env.INITIAL_ADMIN_PASSWORD = '';
    process.env.ADMIN_EMAIL = '';
    process.env.ADMIN_PASSWORD = '';

    ({ store } = await import('./store.js'));
    await store.init();
  });

  it('does not scan transactions during a Vercel cold start', () => {
    const startupTransactionReads = dbMocks.getAllFirestoreDocs.mock.calls
      .filter(([collectionName]) => collectionName === 'transactions');

    expect(startupTransactionReads).toHaveLength(0);
    expect(() => store.getTransactions()).toThrow(/must be hydrated/i);
  });

  it('uses one Firestore scan and preserves writes made before hydration', async () => {
    const localTransaction = {
      id: 'tx_local',
      checkoutRequestId: 'checkout_local',
      articleId: 'article_local',
      articleTitle: 'Local in-flight purchase',
      amount: 300,
      type: 'PURCHASE',
      status: 'PENDING',
      createdAt: '2026-01-02T00:00:00.000Z'
    } as any;

    await store.saveTransaction(localTransaction);
    await Promise.all([
      store.ensureTransactionsHydrated(),
      store.ensureTransactionsHydrated(),
      store.ensureTransactionsHydrated()
    ]);

    const transactionReads = dbMocks.getAllFirestoreDocs.mock.calls
      .filter(([collectionName]) => collectionName === 'transactions');

    expect(transactionReads).toHaveLength(1);
    expect(store.getTransaction('checkout_remote')).toMatchObject(dbMocks.remoteTransaction);
    expect(store.getTransaction('checkout_local')).toMatchObject(localTransaction);
  });
});
