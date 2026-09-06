import { beforeAll, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => {
  const settingsState = {
    canonical: {
      paymentType: 'till',
      transactionType: 'CustomerBuyGoodsOnline',
      storeNumber: '600111',
      tillNumber: '600222',
      consumerKey: 'legacy-database-key',
      consumerSecret: 'legacy-database-secret',
      passkey: 'legacy-database-passkey'
    } as Record<string, unknown> | null,
    legacy: {
      paymentType: 'paybill',
      transactionType: 'CustomerPayBillOnline',
      paybillNumber: '600333'
    } as Record<string, unknown> | null
  };

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
  const batchSet = vi.fn();
  const batchCommit = vi.fn(async () => undefined);

  return {
    remoteTransaction,
    directTransaction,
    recentTransaction,
    recentQueryGet,
    settingsState,
    batchSet,
    batchCommit,
    getAllFirestoreDocs: vi.fn(async (collectionName: string) =>
      collectionName === 'transactions' ? [remoteTransaction] : []
    ),
    getFirestoreDoc: vi.fn(async (collectionName: string, docId: string) => {
      if (collectionName === 'transactions' && docId === directTransaction.checkoutRequestId) {
        return directTransaction;
      }
      if (collectionName === 'site_configs' && docId === 'mpesa_settings') {
        return settingsState.canonical;
      }
      if (collectionName === 'site_configs' && docId === 'settings') {
        return settingsState.legacy;
      }
      return null;
    }),
    setFirestoreDoc: vi.fn(async (_collectionName: string, _docId: string, _data: unknown) => undefined),
    deleteFirestoreDoc: vi.fn(async () => undefined)
  };
});

vi.mock('./db.js', () => ({
  getDb: vi.fn(() => ({
    batch: vi.fn(() => ({
      set: dbMocks.batchSet,
      commit: dbMocks.batchCommit
    })),
    collection: vi.fn(() => ({
      doc: vi.fn((id: string) => ({ id })),
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
    delete process.env.MPESA_PAYMENT_TYPE;
    delete process.env.MPESA_TRANSACTION_TYPE;
    process.env.MPESA_CONSUMER_KEY = 'runtime-key';
    process.env.MPESA_CONSUMER_SECRET = 'runtime-secret';
    process.env.MPESA_PASSKEY = 'runtime-passkey';
    delete process.env.MPESA_SECRET_MIGRATION_APPROVED;

    ({ store } = await import('./store.js'));
    await store.init();
  }, 60_000);

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

  it('loads the canonical M-Pesa settings without touching the legacy copy before approval', () => {
    expect(store.getMpesaSettings()).toMatchObject({
      paymentType: 'till',
      transactionType: 'CustomerBuyGoodsOnline',
      storeNumber: '600111',
      tillNumber: '600222'
    });
    expect(dbMocks.getFirestoreDoc).toHaveBeenCalledWith('site_configs', 'mpesa_settings');
    const settingsCalls = dbMocks.getFirestoreDoc.mock.calls
      .filter(([collectionName]) => collectionName === 'site_configs')
      .map(([, documentId]) => documentId);
    expect(settingsCalls).toContain('mpesa_settings');
    expect(settingsCalls).not.toContain('settings');
  });

  it('removes legacy database credentials only after runtime credentials are complete and explicitly approved', async () => {
    expect(dbMocks.batchCommit).not.toHaveBeenCalled();
    expect(store.getMpesaSettings()).toMatchObject({
      consumerKey: 'runtime-key',
      consumerSecret: 'runtime-secret',
      passkey: 'runtime-passkey'
    });

    process.env.MPESA_SECRET_MIGRATION_APPROVED = 'true';
    await store.init();

    expect(dbMocks.batchCommit).toHaveBeenCalledTimes(1);
    expect(dbMocks.batchSet).toHaveBeenCalledTimes(2);

    for (const [, patch] of dbMocks.batchSet.mock.calls) {
      expect(patch).toMatchObject({ secretStorageVersion: 2 });
      expect(patch).not.toMatchObject({
        consumerKey: 'legacy-database-key',
        consumerSecret: 'legacy-database-secret',
        passkey: 'legacy-database-passkey'
      });
    }

    delete process.env.MPESA_SECRET_MIGRATION_APPROVED;
  });

  it('checks and cleans legacy settings after approval even when canonical settings are already clean', async () => {
    dbMocks.batchSet.mockClear();
    dbMocks.batchCommit.mockClear();
    dbMocks.getFirestoreDoc.mockClear();
    dbMocks.settingsState.canonical = {
      paymentType: 'till',
      transactionType: 'CustomerBuyGoodsOnline',
      storeNumber: '600111',
      tillNumber: '600222',
      secretStorageVersion: 2
    };
    dbMocks.settingsState.legacy = {
      paymentType: 'paybill',
      consumerKey: 'older-legacy-key',
      consumerSecret: 'older-legacy-secret',
      passkey: 'older-legacy-passkey'
    };

    process.env.MPESA_SECRET_MIGRATION_APPROVED = 'true';
    await store.init();

    expect(dbMocks.getFirestoreDoc).toHaveBeenCalledWith('site_configs', 'settings');
    expect(dbMocks.batchCommit).toHaveBeenCalledTimes(1);
    expect(dbMocks.batchSet).toHaveBeenCalledTimes(1);
    expect(dbMocks.batchSet.mock.calls[0][0]).toMatchObject({ id: 'settings' });
    expect(dbMocks.batchSet.mock.calls[0][1]).toMatchObject({ secretStorageVersion: 2 });
    expect(dbMocks.batchSet.mock.calls[0][1]).not.toMatchObject({
      consumerKey: 'older-legacy-key',
      consumerSecret: 'older-legacy-secret',
      passkey: 'older-legacy-passkey'
    });

    delete process.env.MPESA_SECRET_MIGRATION_APPROVED;
  });

  it('keeps the saved payment selector and transaction type consistent', async () => {
    dbMocks.setFirestoreDoc.mockClear();
    await store.saveMpesaSettings({ paymentType: 'paybill', paybillNumber: '600333' });

    expect(store.getMpesaSettings()).toMatchObject({
      paymentType: 'paybill',
      transactionType: 'CustomerPayBillOnline',
      paybillNumber: '600333'
    });
  });

  it('defensively strips provider credentials from every settings write', async () => {
    dbMocks.setFirestoreDoc.mockClear();
    await store.saveMpesaSettings({
      consumerKey: 'attempted-database-key',
      consumerSecret: 'attempted-database-secret',
      passkey: 'attempted-database-passkey',
      tillName: 'Safe public setting'
    });

    expect(dbMocks.setFirestoreDoc).toHaveBeenCalledTimes(1);
    const [collectionName, documentId, saved] = dbMocks.setFirestoreDoc.mock.calls[0];
    expect([collectionName, documentId]).toEqual(['site_configs', 'mpesa_settings']);
    expect(saved).toMatchObject({
      tillName: 'Safe public setting',
      secretStorageVersion: 2
    });
    expect(saved).not.toHaveProperty('consumerKey');
    expect(saved).not.toHaveProperty('consumerSecret');
    expect(saved).not.toHaveProperty('passkey');
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
