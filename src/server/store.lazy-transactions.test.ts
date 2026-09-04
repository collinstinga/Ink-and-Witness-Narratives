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

  const directTransaction = {
    id: 'tx_direct',
    checkoutRequestId: 'checkout_direct',
    articleId: 'article_direct',
    articleTitle: 'Direct lookup purchase',
    phoneNumber: '254700000001',
    amount: 400,
    type: 'PURCHASE',
    status: 'PENDING',
    createdAt: '2026-01-03T00:00:00.000Z'
  };

  const recentTransaction = {
    id: 'tx_recent',
    checkoutRequestId: 'checkout_recent',
    articleId: 'article_recent',
    articleTitle: 'Recent purchase',
    phoneNumber: '254700000002',
    amount: 500,
    type: 'PURCHASE',
    status: 'PENDING',
    createdAt: new Date().toISOString()
  };

  const recentQueryGet = vi.fn(async () => ({
    docs: [{ data: () => recentTransaction }]
  }));

  return {
    remoteTransaction,
    directTransaction,
    recentTransaction,
    recentQueryGet,
    getAllFirestoreDocs: vi.fn(async (collectionName: string) =>
      collectionName === 'transactions' ? [remoteTransaction] : []
    ),
    getFirestoreDoc: vi.fn(async (collectionName: string, docId: string) =>
      collectionName === 'transactions' && docId === directTransaction.checkoutRequestId
        ? directTransaction
        : null
    ),
    setFirestoreDoc: vi.fn(async () => undefined),
    deleteFirestoreDoc: vi.fn(async () => undefined)
  };
});

vi.mock('./db.js', () => ({
  getDb: vi.fn(() => ({
    collection: vi.fn(() => ({
      where: vi.fn(() => ({
        orderBy: vi.fn(() => ({
          limit: vi.fn(() => ({ get: dbMocks.recentQueryGet }))
        }))
      }))
    }))
  })),
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

  it('loads a checkout directly without scanning the transaction ledger', async () => {
    const transaction = await store.loadTransaction('checkout_direct');

    expect(transaction).toMatchObject(dbMocks.directTransaction);
    expect(dbMocks.getFirestoreDoc).toHaveBeenCalledWith('transactions', 'checkout_direct');
    expect(dbMocks.getAllFirestoreDocs.mock.calls
      .filter(([collectionName]) => collectionName === 'transactions')).toHaveLength(0);
  });

  it('checks only recent transaction documents for duplicate STK requests', async () => {
    const transaction = await store.findRecentPendingTransaction(
      dbMocks.recentTransaction.articleId,
      dbMocks.recentTransaction.phoneNumber,
      45000
    );

    expect(transaction).toMatchObject(dbMocks.recentTransaction);
    expect(dbMocks.recentQueryGet).toHaveBeenCalledTimes(1);
    expect(dbMocks.getAllFirestoreDocs.mock.calls
      .filter(([collectionName]) => collectionName === 'transactions')).toHaveLength(0);
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
