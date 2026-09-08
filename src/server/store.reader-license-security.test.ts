import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type FakeRef = {
  collectionName: string;
  id: string;
  key: string;
};

const firestoreMock = vi.hoisted(() => {
  const documents = new Map<string, any>();
  let failNextBatchCommit = false;

  const users = [
    {
      id: 'reader_query',
      email: 'query@example.test',
      passwordHash: 'unused',
      role: 'client',
      name: 'Query Reader',
      createdAt: '2026-09-08T00:00:00.000Z',
      updatedAt: '2026-09-08T00:00:00.000Z'
    },
    {
      id: 'reader_link',
      email: 'link@example.test',
      passwordHash: 'unused',
      role: 'client',
      name: 'Link Reader',
      createdAt: '2026-09-08T00:00:00.000Z',
      updatedAt: '2026-09-08T00:00:00.000Z'
    },
    {
      id: 'reader_remote_revoke',
      email: 'remote-revoke@example.test',
      passwordHash: 'unused',
      role: 'client',
      name: 'Remote Revoke Reader',
      createdAt: '2026-09-08T00:00:00.000Z',
      updatedAt: '2026-09-08T00:00:00.000Z'
    }
  ];

  const clone = <T>(value: T): T => value === undefined ? value : structuredClone(value);
  const snapshot = (ref: FakeRef) => ({
    id: ref.id,
    exists: documents.has(ref.key),
    data: () => clone(documents.get(ref.key))
  });
  const ref = (collectionName: string, id: string): FakeRef => ({
    collectionName,
    id,
    key: `${collectionName}/${id}`
  });

  const queryCalls = vi.fn();
  const limitCalls = vi.fn();
  const directReads = vi.fn();
  const transactionRuns = vi.fn();
  const transactionSets = vi.fn();
  const batchCommits = vi.fn();
  const getAllFirestoreDocs = vi.fn(async (collectionName: string) =>
    collectionName === 'users' ? clone(users) : []
  );

  const collection = (collectionName: string) => ({
    doc: (id: string) => ({
      ...ref(collectionName, id),
      get: async () => {
        directReads(collectionName, id);
        return snapshot(ref(collectionName, id));
      }
    }),
    where: (field: string, operator: string, value: unknown) => {
      queryCalls(collectionName, field, operator, value);
      return {
        limit: (limit: number) => {
          limitCalls(collectionName, limit);
          return {
            get: async () => ({
              docs: Array.from(documents.entries())
                .filter(([key, data]) =>
                  key.startsWith(`${collectionName}/`) && data?.[field] === value
                )
                .slice(0, limit)
                .map(([key]) => snapshot(ref(collectionName, key.slice(collectionName.length + 1))))
            })
          };
        }
      };
    }
  });

  const runTransaction = async (callback: (transaction: any) => Promise<any>) => {
    transactionRuns();
    const writes: Array<{ ref: FakeRef; data: any; merge: boolean }> = [];
    const result = await callback({
      get: async (documentRef: FakeRef) => snapshot(documentRef),
      set: (documentRef: FakeRef, data: any, options?: { merge?: boolean }) => {
        transactionSets(documentRef, clone(data), options);
        writes.push({ ref: documentRef, data: clone(data), merge: Boolean(options?.merge) });
      }
    });
    for (const write of writes) {
      const previous = write.merge ? (documents.get(write.ref.key) || {}) : {};
      documents.set(write.ref.key, { ...previous, ...write.data });
    }
    return result;
  };

  const batch = () => {
    const operations: Array<() => void> = [];
    return {
      delete: (documentRef: FakeRef) => {
        operations.push(() => documents.delete(documentRef.key));
      },
      set: (documentRef: FakeRef, data: any, options?: { merge?: boolean }) => {
        operations.push(() => {
          const previous = options?.merge ? (documents.get(documentRef.key) || {}) : {};
          documents.set(documentRef.key, { ...previous, ...clone(data) });
        });
      },
      commit: async () => {
        batchCommits();
        if (failNextBatchCommit) {
          failNextBatchCommit = false;
          throw new Error('injected batch commit failure');
        }
        for (const operation of operations) operation();
      }
    };
  };

  return {
    documents,
    users,
    db: { collection, runTransaction, batch },
    queryCalls,
    limitCalls,
    directReads,
    transactionRuns,
    transactionSets,
    batchCommits,
    getAllFirestoreDocs,
    failNextBatch() {
      failNextBatchCommit = true;
    },
    resetObservations() {
      queryCalls.mockClear();
      limitCalls.mockClear();
      directReads.mockClear();
      transactionRuns.mockClear();
      transactionSets.mockClear();
      batchCommits.mockClear();
      getAllFirestoreDocs.mockClear();
      failNextBatchCommit = false;
    }
  };
});

vi.mock('./db.js', () => ({
  getDb: vi.fn(() => firestoreMock.db),
  getAllFirestoreDocs: firestoreMock.getAllFirestoreDocs,
  getFirestoreDoc: vi.fn(async (collectionName: string, id: string) =>
    firestoreMock.documents.get(`${collectionName}/${id}`) ?? null
  ),
  setFirestoreDoc: vi.fn(async (collectionName: string, id: string, data: any) => {
    const key = `${collectionName}/${id}`;
    firestoreMock.documents.set(key, {
      ...(firestoreMock.documents.get(key) || {}),
      ...structuredClone(data)
    });
  }),
  deleteFirestoreDoc: vi.fn(async (collectionName: string, id: string) => {
    firestoreMock.documents.delete(`${collectionName}/${id}`);
  }),
  sanitizeForFirestore: (value: unknown) => value
}));

vi.mock('./affiliateStore.js', () => ({
  affiliateStore: {
    init: vi.fn(async () => undefined),
    recordAffiliateSale: vi.fn()
  }
}));

describe('reader-license query and ownership security', () => {
  let store: typeof import('./store.js').store;

  const license = (articleId: string, overrides: Record<string, unknown> = {}) => ({
    articleId,
    phone: '254712345678',
    expiresAt: Date.now() + 60 * 60 * 1000,
    receipt: 'SIA1234567',
    createdAt: '2026-09-08T00:00:00.000Z',
    accessSource: 'MPESA_PURCHASE',
    ...overrides
  });

  beforeAll(async () => {
    process.env.VERCEL = '1';
    process.env.NODE_ENV = 'test';
    process.env.INITIAL_ADMIN_EMAIL = '';
    process.env.INITIAL_ADMIN_PASSWORD = '';
    process.env.ADMIN_EMAIL = '';
    process.env.ADMIN_PASSWORD = '';
    delete process.env.EAGER_READER_LICENSE_BOOTSTRAP;
    delete process.env.MPESA_CONSUMER_KEY;
    delete process.env.MPESA_CONSUMER_SECRET;
    delete process.env.MPESA_PASSKEY;
    delete process.env.MPESA_SECRET_MIGRATION_APPROVED;

    ({ store } = await import('./store.js'));
    await store.init();
  }, 60_000);

  beforeEach(() => {
    for (const key of Array.from(firestoreMock.documents.keys())) {
      if (key.startsWith('reader_licenses/')) firestoreMock.documents.delete(key);
    }
    firestoreMock.resetObservations();
  });

  it('uses one bounded account query and never scans all reader licenses', async () => {
    const token = `ink_1788782400000_${'a'.repeat(64)}`;
    firestoreMock.documents.set(`reader_licenses/${token}`, license('article_bounded', {
      token,
      userId: 'reader_query',
      email: 'query@example.test'
    }));

    const first = await store.getUserPurchases('reader_query');
    const second = await store.isArticlePurchasedByUser('article_bounded', {
      id: 'reader_query',
      email: 'query@example.test'
    });

    expect(first).toEqual([
      expect.objectContaining({ articleId: 'article_bounded', token })
    ]);
    expect(second).toBe(true);
    expect(firestoreMock.queryCalls).toHaveBeenCalledTimes(1);
    expect(firestoreMock.queryCalls).toHaveBeenCalledWith(
      'reader_licenses',
      'userId',
      '==',
      'reader_query'
    );
    expect(firestoreMock.limitCalls).toHaveBeenCalledExactlyOnceWith('reader_licenses', 200);
    expect(firestoreMock.getAllFirestoreDocs.mock.calls
      .filter(([collectionName]) => collectionName === 'reader_licenses')).toHaveLength(0);
  });

  it('rejects phone-only purchase claims before opening a Firestore transaction', async () => {
    const result = await store.linkUserPurchase('reader_link', '0712 345 678');

    expect(result).toEqual({
      success: false,
      message: expect.stringMatching(/complete unlock token/i),
      linkedCount: 0
    });
    expect(firestoreMock.transactionRuns).not.toHaveBeenCalled();
    expect(firestoreMock.transactionSets).not.toHaveBeenCalled();
  });

  it('drops a remotely revoked account license after the scoped cache TTL', async () => {
    const actualNow = Date.now();
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(actualNow);
    const token = `ink_1788782400004_${'e'.repeat(64)}`;
    firestoreMock.documents.set(`reader_licenses/${token}`, license('article_remote_revoke', {
      token,
      userId: 'reader_remote_revoke',
      email: 'remote-revoke@example.test',
      expiresAt: actualNow + 10 * 60 * 1000
    }));

    try {
      expect(await store.isArticlePurchasedByUser('article_remote_revoke', {
        id: 'reader_remote_revoke',
        email: 'remote-revoke@example.test'
      })).toBe(true);

      firestoreMock.documents.delete(`reader_licenses/${token}`);
      nowSpy.mockReturnValue(actualNow + 61 * 1000);

      expect(await store.isArticlePurchasedByUser('article_remote_revoke', {
        id: 'reader_remote_revoke',
        email: 'remote-revoke@example.test'
      })).toBe(false);
      expect(firestoreMock.queryCalls.mock.calls.filter(
        ([collectionName, field]) => collectionName === 'reader_licenses' && field === 'userId'
      )).toHaveLength(2);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('persists an account binding when a complete valid token is claimed', async () => {
    const token = `ink_1788782400001_${'b'.repeat(64)}`;
    firestoreMock.documents.set(`reader_licenses/${token}`, license('article_linked', { token }));

    const result = await store.linkUserPurchase('reader_link', token);

    expect(result).toEqual({
      success: true,
      message: expect.any(String),
      linkedCount: 1
    });
    expect(firestoreMock.transactionRuns).toHaveBeenCalledTimes(1);
    expect(firestoreMock.transactionSets).toHaveBeenCalledTimes(1);
    expect(firestoreMock.documents.get(`reader_licenses/${token}`)).toMatchObject({
      token,
      userId: 'reader_link',
      email: 'link@example.test'
    });
    expect(store.getPurchasedToken(token)).toMatchObject({
      userId: 'reader_link',
      email: 'link@example.test'
    });
  });

  it('refuses to rebind a license owned by another account', async () => {
    const token = `ink_1788782400002_${'c'.repeat(64)}`;
    const original = license('article_foreign', {
      token,
      userId: 'different_reader',
      email: 'different@example.test'
    });
    firestoreMock.documents.set(`reader_licenses/${token}`, original);

    const result = await store.linkUserPurchase('reader_link', token);

    expect(result).toEqual({
      success: false,
      message: expect.stringMatching(/already belongs to another account/i),
      linkedCount: 0
    });
    expect(firestoreMock.transactionRuns).toHaveBeenCalledTimes(1);
    expect(firestoreMock.transactionSets).not.toHaveBeenCalled();
    expect(firestoreMock.documents.get(`reader_licenses/${token}`)).toEqual(original);
  });

  it('keeps the reader license cached and durable when revocation commit fails', async () => {
    const token = `ink_1788782400003_${'d'.repeat(64)}`;
    const original = license('article_revoke', { token });
    firestoreMock.documents.set(`reader_licenses/${token}`, original);
    expect(await store.loadPurchasedToken(token)).toMatchObject(original);

    firestoreMock.failNextBatch();
    await expect(store.revokeReaderLicense(token)).rejects.toThrow(/injected batch commit failure/i);

    expect(firestoreMock.batchCommits).toHaveBeenCalledTimes(1);
    expect(firestoreMock.documents.get(`reader_licenses/${token}`)).toEqual(original);
    expect(store.getPurchasedToken(token)).toMatchObject(original);

    await expect(store.revokeReaderLicense(token)).resolves.toBe(true);
    expect(firestoreMock.documents.has(`reader_licenses/${token}`)).toBe(false);
    expect(store.getPurchasedToken(token)).toBeUndefined();
  });
});
