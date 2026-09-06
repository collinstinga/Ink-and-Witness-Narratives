import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type MockDocumentRef = {
  collectionName: string;
  id: string;
  get: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

const dbMocks = vi.hoisted(() => {
  const documents = new Map<string, any>();
  const keyFor = (collectionName: string, id: string) => `${collectionName}/${id}`;
  const directDocumentReads = vi.fn();
  const userSessionQueries = vi.fn();
  const batchCommits = vi.fn(async () => undefined);
  const getAllFirestoreDocs = vi.fn(async (_collectionName: string) => []);
  const getFirestoreDoc = vi.fn(async (collectionName: string, id: string) =>
    documents.get(keyFor(collectionName, id)) ?? null
  );
  const setFirestoreDoc = vi.fn(async (collectionName: string, id: string, data: unknown) => {
    documents.set(keyFor(collectionName, id), structuredClone(data));
  });
  const deleteFirestoreDoc = vi.fn(async (collectionName: string, id: string) => {
    documents.delete(keyFor(collectionName, id));
  });

  const documentRef = (collectionName: string, id: string): MockDocumentRef => ({
    collectionName,
    id,
    get: vi.fn(async () => {
      directDocumentReads(collectionName, id);
      const value = documents.get(keyFor(collectionName, id));
      return {
        exists: value !== undefined,
        data: () => value
      };
    }),
    delete: vi.fn(async () => {
      documents.delete(keyFor(collectionName, id));
    })
  });

  const db = {
    collection: vi.fn((collectionName: string) => ({
      doc: vi.fn((id: string) => documentRef(collectionName, id)),
      where: vi.fn((_field: string, _operator: string, userId: string) => ({
        get: vi.fn(async () => {
          userSessionQueries(collectionName, userId);
          const docs = Array.from(documents.entries())
            .filter(([key, value]) => key.startsWith(`${collectionName}/`) && value?.userId === userId)
            .map(([key]) => ({
              ref: documentRef(collectionName, key.slice(collectionName.length + 1))
            }));
          return { docs };
        })
      }))
    })),
    batch: vi.fn(() => {
      const operations: Array<() => void> = [];
      return {
        set: vi.fn((ref: MockDocumentRef, data: unknown) => {
          operations.push(() => documents.set(keyFor(ref.collectionName, ref.id), structuredClone(data)));
        }),
        delete: vi.fn((ref: MockDocumentRef) => {
          operations.push(() => documents.delete(keyFor(ref.collectionName, ref.id)));
        }),
        commit: vi.fn(async () => {
          for (const operation of operations) operation();
          await batchCommits();
        })
      };
    })
  };

  return {
    documents,
    keyFor,
    db,
    directDocumentReads,
    userSessionQueries,
    batchCommits,
    getAllFirestoreDocs,
    getFirestoreDoc,
    setFirestoreDoc,
    deleteFirestoreDoc
  };
});

vi.mock('./db.js', () => ({
  getDb: vi.fn(() => dbMocks.db),
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

import { createSignedAuthSessionToken, getAuthSessionDocumentId } from './sessionSecurity.js';

describe('lazy hashed primary sessions', () => {
  let store: typeof import('./store.js').store;
  let startupSessionScanCount = -1;

  const activeRecord = (userId: string) => ({
    storageVersion: 2,
    userId,
    role: 'admin' as const,
    email: `${userId}@example.test`,
    name: 'Test Admin',
    createdAt: Date.now() - 1_000,
    expiresAt: Date.now() + 60_000
  });

  beforeAll(async () => {
    process.env.VERCEL = '1';
    process.env.NODE_ENV = 'test';
    process.env.INITIAL_ADMIN_EMAIL = '';
    process.env.INITIAL_ADMIN_PASSWORD = '';
    process.env.ADMIN_EMAIL = '';
    process.env.ADMIN_PASSWORD = '';
    process.env.SESSION_SIGNING_SECRET = 'integration-test-session-signing-secret-which-is-long-enough';
    delete process.env.MPESA_CONSUMER_KEY;
    delete process.env.MPESA_CONSUMER_SECRET;
    delete process.env.MPESA_PASSKEY;

    ({ store } = await import('./store.js'));
    await store.init();
    startupSessionScanCount = dbMocks.getAllFirestoreDocs.mock.calls
      .filter(([collectionName]) => collectionName === 'sessions').length;
  }, 60_000);

  beforeEach(() => {
    for (const key of Array.from(dbMocks.documents.keys())) {
      if (key.startsWith('sessions/')) dbMocks.documents.delete(key);
    }
    dbMocks.getFirestoreDoc.mockClear();
    dbMocks.setFirestoreDoc.mockClear();
    dbMocks.deleteFirestoreDoc.mockClear();
    dbMocks.directDocumentReads.mockClear();
    dbMocks.userSessionQueries.mockClear();
    dbMocks.batchCommits.mockClear();
  });

  it('does not scan the sessions collection during a cold start', () => {
    expect(startupSessionScanCount).toBe(0);
  });

  it('rejects malformed cookie tokens without any Firestore read', async () => {
    const signed = createSignedAuthSessionToken(process.env.SESSION_SIGNING_SECRET);
    const tampered = `${signed.slice(0, -1)}${signed.endsWith('0') ? '1' : '0'}`;

    expect(await store.getAuthSession('../users/admin')).toBeNull();
    expect(await store.getAuthSession(tampered)).toBeNull();
    expect(dbMocks.getFirestoreDoc).not.toHaveBeenCalled();
    expect(dbMocks.directDocumentReads).not.toHaveBeenCalled();
  });

  it('loads a v2 session with one hashed document lookup', async () => {
    const token = createSignedAuthSessionToken(process.env.SESSION_SIGNING_SECRET);
    const documentId = getAuthSessionDocumentId(token)!;
    dbMocks.documents.set(dbMocks.keyFor('sessions', documentId), activeRecord('direct_user'));

    const session = await store.getAuthSession(token);

    expect(session).toMatchObject({ userId: 'direct_user', storageVersion: 2 });
    expect(session).not.toHaveProperty('sessionId');
    expect(dbMocks.getFirestoreDoc).toHaveBeenCalledWith('sessions', documentId);
    expect(dbMocks.directDocumentReads).not.toHaveBeenCalled();
  });

  it('deduplicates concurrent lookups and rechecks revocation after the short cache window', async () => {
    let now = Date.parse('2026-09-06T09:00:00.000Z');
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const token = createSignedAuthSessionToken(process.env.SESSION_SIGNING_SECRET);
    const documentId = getAuthSessionDocumentId(token)!;
    dbMocks.documents.set(dbMocks.keyFor('sessions', documentId), {
      ...activeRecord('cache_user'),
      expiresAt: now + 10 * 60 * 1000
    });

    try {
      const concurrent = await Promise.all(Array.from({ length: 8 }, () => store.getAuthSession(token)));
      expect(concurrent.every(session => session?.userId === 'cache_user')).toBe(true);
      expect(dbMocks.getFirestoreDoc.mock.calls
        .filter(([collectionName, id]) => collectionName === 'sessions' && id === documentId)).toHaveLength(1);

      dbMocks.documents.delete(dbMocks.keyFor('sessions', documentId));
      now += 61_000;

      expect(await store.getAuthSession(token)).toBeNull();
      expect(dbMocks.getFirestoreDoc.mock.calls
        .filter(([collectionName, id]) => collectionName === 'sessions' && id === documentId)).toHaveLength(2);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('persists a new session only under its hash and never stores the bearer token', async () => {
    const token = await store.createAuthSession({
      id: 'created_user',
      role: 'client',
      email: 'created@example.test',
      name: 'Created User',
      passwordHash: 'not-used',
      createdAt: new Date().toISOString()
    });
    const documentId = getAuthSessionDocumentId(token)!;

    expect(dbMocks.setFirestoreDoc).toHaveBeenCalledTimes(1);
    expect(dbMocks.setFirestoreDoc).toHaveBeenCalledWith('sessions', documentId, expect.any(Object));
    const saved = dbMocks.documents.get(dbMocks.keyFor('sessions', documentId));
    expect(saved).not.toHaveProperty('sessionId');
    expect(JSON.stringify(saved)).not.toContain(token);
    expect(dbMocks.documents.has(dbMocks.keyFor('sessions', token))).toBe(false);
  });

  it('atomically migrates a matching legacy session when it is next used', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-06T09:00:00.000Z'));
    const token = `sess_${'d'.repeat(64)}`;
    const documentId = getAuthSessionDocumentId(token)!;
    dbMocks.documents.set(dbMocks.keyFor('sessions', token), {
      ...activeRecord('legacy_user'),
      storageVersion: 1,
      sessionId: token
    });

    try {
      const session = await store.getAuthSession(token);
      const migrated = dbMocks.documents.get(dbMocks.keyFor('sessions', documentId));

      expect(session).toMatchObject({ userId: 'legacy_user', storageVersion: 2 });
      expect(dbMocks.directDocumentReads).toHaveBeenCalledWith('sessions', token);
      expect(dbMocks.batchCommits).toHaveBeenCalledTimes(1);
      expect(dbMocks.documents.has(dbMocks.keyFor('sessions', token))).toBe(false);
      expect(migrated).not.toHaveProperty('sessionId');
      expect(JSON.stringify(migrated)).not.toContain(token);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('does not attempt a raw-token lookup after the migration deadline', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-16T00:00:00.000Z'));
    const token = `sess_${'f'.repeat(64)}`;
    dbMocks.documents.set(dbMocks.keyFor('sessions', token), {
      ...activeRecord('expired_compat_user'),
      sessionId: token
    });

    try {
      expect(await store.getAuthSession(token)).toBeNull();
      expect(dbMocks.directDocumentReads).not.toHaveBeenCalled();
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('revokes both v2 and legacy formats without reading either document', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-06T09:00:00.000Z'));
    const token = `sess_${'e'.repeat(64)}`;
    const documentId = getAuthSessionDocumentId(token)!;
    dbMocks.documents.set(dbMocks.keyFor('sessions', documentId), activeRecord('logout_user'));
    dbMocks.documents.set(dbMocks.keyFor('sessions', token), { ...activeRecord('logout_user'), sessionId: token });

    try {
      await store.invalidateAuthSession(token);

      expect(dbMocks.documents.has(dbMocks.keyFor('sessions', documentId))).toBe(false);
      expect(dbMocks.documents.has(dbMocks.keyFor('sessions', token))).toBe(false);
      expect(dbMocks.getFirestoreDoc).not.toHaveBeenCalled();
      expect(dbMocks.directDocumentReads).not.toHaveBeenCalled();
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('revokes one user through a targeted query rather than a collection scan', async () => {
    const keepId = `v2_${'1'.repeat(64)}`;
    const removeId = `v2_${'2'.repeat(64)}`;
    dbMocks.documents.set(dbMocks.keyFor('sessions', keepId), activeRecord('other_user'));
    dbMocks.documents.set(dbMocks.keyFor('sessions', removeId), activeRecord('target_user'));

    await store.invalidateAllUserSessions('target_user');

    expect(dbMocks.userSessionQueries).toHaveBeenCalledWith('sessions', 'target_user');
    expect(dbMocks.documents.has(dbMocks.keyFor('sessions', keepId))).toBe(true);
    expect(dbMocks.documents.has(dbMocks.keyFor('sessions', removeId))).toBe(false);
    expect(dbMocks.getAllFirestoreDocs.mock.calls
      .filter(([collectionName]) => collectionName === 'sessions')).toHaveLength(0);
  });
});
