import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MANUAL_ACCESS_ENTITLEMENT_COLLECTION,
  MANUAL_ACCESS_PHONE_RESERVATION_COLLECTION,
  getManualAccessEntitlementId,
  getManualAccessPhoneReservationId
} from './manualAccessSecurity.js';

type FakeRef = {
  collectionName: string;
  id: string;
  key: string;
};

type FakeQuery = {
  kind: 'query';
  collectionName: string;
  filters: Array<{ field: string; operator: string; value: unknown }>;
  maximum: number | null;
  where: (field: string, operator: string, value: unknown) => FakeQuery;
  limit: (maximum: number) => FakeQuery;
  get: () => Promise<FakeQuerySnapshot>;
};

type FakeQuerySnapshot = {
  docs: Array<ReturnType<typeof makeDocumentSnapshot>>;
  size: number;
  empty: boolean;
};

const TEST_SECRET = 'ab'.repeat(32);
const FIRST_PHONE = '254712345678';

const users = [
  {
    id: 'reader_one',
    email: 'reader-one@example.test',
    passwordHash: 'unused',
    role: 'client',
    name: 'Reader One',
    createdAt: '2026-09-15T00:00:00.000Z',
    updatedAt: '2026-09-15T00:00:00.000Z'
  },
  {
    id: 'reader_two',
    email: 'reader-two@example.test',
    passwordHash: 'unused',
    role: 'client',
    name: 'Reader Two',
    createdAt: '2026-09-15T00:00:00.000Z',
    updatedAt: '2026-09-15T00:00:00.000Z'
  }
];

const articles = [
  {
    id: 'article-one',
    slug: 'article-one-slug',
    title: 'Article One',
    subtitle: '',
    excerpt: 'First article',
    synopsis: '',
    content: 'Protected article one',
    category: 'Essays',
    categories: ['Essays'],
    topics: [],
    tags: [],
    previewParagraphs: [],
    status: 'published',
    isPaid: true,
    priceKes: 100,
    readTimeMinutes: 3,
    createdAt: '2026-09-15T00:00:00.000Z',
    updatedAt: '2026-09-15T00:00:00.000Z',
    publishedAt: '2026-09-15T00:00:00.000Z'
  },
  {
    id: 'article-two',
    slug: 'article-two-slug',
    title: 'Article Two',
    subtitle: '',
    excerpt: 'Second article',
    synopsis: '',
    content: 'Protected article two',
    category: 'Essays',
    categories: ['Essays'],
    topics: [],
    tags: [],
    previewParagraphs: [],
    status: 'published',
    isPaid: true,
    priceKes: 100,
    readTimeMinutes: 3,
    createdAt: '2026-09-15T00:00:00.000Z',
    updatedAt: '2026-09-15T00:00:00.000Z',
    publishedAt: '2026-09-15T00:00:00.000Z'
  }
];

const firestoreMock = vi.hoisted(() => {
  const documents = new Map<string, any>();
  let failNextTransactionCommit = false;
  const transactionRuns = vi.fn();
  const transactionWrites = vi.fn();
  const getAllFirestoreDocs = vi.fn(async (collectionName: string) => {
    if (collectionName === 'users') return structuredClone(users);
    if (collectionName === 'articles') return structuredClone(articles);
    return [];
  });

  return {
    documents,
    transactionRuns,
    transactionWrites,
    getAllFirestoreDocs,
    shouldFailTransaction() {
      const shouldFail = failNextTransactionCommit;
      failNextTransactionCommit = false;
      return shouldFail;
    },
    failNextTransaction() {
      failNextTransactionCommit = true;
    },
    resetObservations() {
      transactionRuns.mockClear();
      transactionWrites.mockClear();
      failNextTransactionCommit = false;
    }
  };
});

function clone<T>(value: T): T {
  return value === undefined ? value : structuredClone(value);
}

function snapshotManualAccessDocuments(): Array<[string, unknown]> {
  return Array.from(firestoreMock.documents.entries())
    .filter(([key]) => (
      key.startsWith('manual_access/')
      || key.startsWith(`${MANUAL_ACCESS_PHONE_RESERVATION_COLLECTION}/`)
      || key.startsWith(`${MANUAL_ACCESS_ENTITLEMENT_COLLECTION}/`)
      || key.startsWith('reader_licenses/')
    ))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => [key, clone(value)]);
}

function makeRef(collectionName: string, id: string): FakeRef {
  return { collectionName, id, key: `${collectionName}/${id}` };
}

function makeDocumentSnapshot(ref: FakeRef) {
  return {
    id: ref.id,
    exists: firestoreMock.documents.has(ref.key),
    ref,
    data: () => clone(firestoreMock.documents.get(ref.key))
  };
}

function runQuery(query: FakeQuery): FakeQuerySnapshot {
  const docs = Array.from(firestoreMock.documents.entries())
    .filter(([key, data]) => {
      if (!key.startsWith(`${query.collectionName}/`)) return false;
      return query.filters.every(({ field, operator, value }) => {
        if (operator === '==') return data?.[field] === value;
        if (operator === 'in') return Array.isArray(value) && value.includes(data?.[field]);
        throw new Error(`Unsupported fake query operator ${operator}`);
      });
    })
    .slice(0, query.maximum ?? undefined)
    .map(([key]) => makeDocumentSnapshot(
      makeRef(query.collectionName, key.slice(query.collectionName.length + 1))
    ));
  return { docs, size: docs.length, empty: docs.length === 0 };
}

function makeQuery(
  collectionName: string,
  filters: FakeQuery['filters'] = [],
  maximum: number | null = null
): FakeQuery {
  const query: FakeQuery = {
    kind: 'query',
    collectionName,
    filters,
    maximum,
    where: (field, operator, value) => makeQuery(
      collectionName,
      [...filters, { field, operator, value }],
      maximum
    ),
    limit: nextMaximum => makeQuery(collectionName, filters, nextMaximum),
    get: async () => runQuery(query)
  };
  return query;
}

const db = {
  collection(collectionName: string) {
    const query = makeQuery(collectionName);
    return {
      doc(id: string) {
        const ref = makeRef(collectionName, id);
        return {
          ...ref,
          get: async () => makeDocumentSnapshot(ref)
        };
      },
      where: query.where,
      limit: query.limit
    };
  },
  async runTransaction(callback: (transaction: any) => Promise<any>) {
    firestoreMock.transactionRuns();
    const operations: Array<() => void> = [];
    let hasWritten = false;
    const result = await callback({
      get: async (target: FakeRef | FakeQuery) => {
        if (hasWritten) throw new Error('Firestore transaction attempted a read after a write');
        return 'kind' in target && target.kind === 'query'
          ? runQuery(target)
          : makeDocumentSnapshot(target as FakeRef);
      },
      create: (ref: FakeRef, data: unknown) => {
        hasWritten = true;
        firestoreMock.transactionWrites('create', ref.key);
        if (firestoreMock.documents.has(ref.key)) throw new Error('ALREADY_EXISTS');
        operations.push(() => firestoreMock.documents.set(ref.key, clone(data)));
      },
      set: (ref: FakeRef, data: unknown, options?: { merge?: boolean }) => {
        hasWritten = true;
        firestoreMock.transactionWrites('set', ref.key);
        operations.push(() => {
          const previous = options?.merge ? (firestoreMock.documents.get(ref.key) || {}) : {};
          firestoreMock.documents.set(ref.key, {
            ...previous,
            ...(clone(data) as Record<string, unknown>)
          });
        });
      },
      delete: (ref: FakeRef) => {
        hasWritten = true;
        firestoreMock.transactionWrites('delete', ref.key);
        operations.push(() => firestoreMock.documents.delete(ref.key));
      }
    });
    if (firestoreMock.shouldFailTransaction()) {
      throw new Error('injected transaction commit failure');
    }
    for (const operation of operations) operation();
    return result;
  },
  batch() {
    const operations: Array<() => void> = [];
    return {
      set(ref: FakeRef, data: unknown, options?: { merge?: boolean }) {
        operations.push(() => {
          const previous = options?.merge ? (firestoreMock.documents.get(ref.key) || {}) : {};
          firestoreMock.documents.set(ref.key, {
            ...previous,
            ...(clone(data) as Record<string, unknown>)
          });
        });
      },
      delete(ref: FakeRef) {
        operations.push(() => firestoreMock.documents.delete(ref.key));
      },
      async commit() {
        for (const operation of operations) operation();
      }
    };
  }
};

vi.mock('./db.js', () => ({
  getDb: vi.fn(() => db),
  getAllFirestoreDocs: firestoreMock.getAllFirestoreDocs,
  getFirestoreDoc: vi.fn(async (collectionName: string, id: string) =>
    clone(firestoreMock.documents.get(`${collectionName}/${id}`)) ?? null
  ),
  setFirestoreDoc: vi.fn(async (collectionName: string, id: string, data: unknown) => {
    const key = `${collectionName}/${id}`;
    firestoreMock.documents.set(key, {
      ...(firestoreMock.documents.get(key) || {}),
      ...(clone(data) as Record<string, unknown>)
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

describe('single-use manual access transactions', () => {
  let store: typeof import('./store.js').store;
  let startupManualScans = 0;

  beforeAll(async () => {
    process.env.VERCEL = '1';
    process.env.NODE_ENV = 'test';
    process.env.MANUAL_ACCESS_PHONE_RESERVATION_SECRET = TEST_SECRET;
    process.env.INITIAL_ADMIN_EMAIL = '';
    process.env.INITIAL_ADMIN_PASSWORD = '';
    process.env.ADMIN_EMAIL = '';
    process.env.ADMIN_PASSWORD = '';
    delete process.env.EAGER_READER_LICENSE_BOOTSTRAP;
    delete process.env.MPESA_CONSUMER_KEY;
    delete process.env.MPESA_CONSUMER_SECRET;
    delete process.env.MPESA_PASSKEY;

    ({ store } = await import('./store.js'));
    await store.init();
    startupManualScans = firestoreMock.getAllFirestoreDocs.mock.calls
      .filter(([collectionName]) => collectionName === 'manual_access')
      .length;
  }, 60_000);

  beforeEach(() => {
    for (const key of Array.from(firestoreMock.documents.keys())) {
      if (
        key.startsWith('manual_access/')
        || key.startsWith(`${MANUAL_ACCESS_PHONE_RESERVATION_COLLECTION}/`)
        || key.startsWith(`${MANUAL_ACCESS_ENTITLEMENT_COLLECTION}/`)
        || key.startsWith('reader_licenses/')
      ) {
        firestoreMock.documents.delete(key);
      }
    }
    for (const user of users) {
      firestoreMock.documents.set(`users/${user.id}`, clone(user));
    }
    firestoreMock.resetObservations();
  });

  it('does not enumerate grants or touch Firestore for an unauthenticated claim', async () => {
    expect(startupManualScans).toBe(0);

    await expect(store.verifyManualAccess('article-one', FIRST_PHONE, null)).resolves.toMatchObject({
      success: false,
      verified: false,
      requiresAuth: true,
      code: 'MANUAL_ACCESS_AUTH_REQUIRED'
    });
    expect(firestoreMock.transactionRuns).not.toHaveBeenCalled();
  });

  it('binds one normalized phone to one account, remains idempotent, and keeps its tombstone', async () => {
    const created = await store.grantManualAccess(
      'article-one',
      '0712 345 678',
      'Writer',
      'Complimentary review'
    );
    const grantId = created.grant.id;
    const reservationId = getManualAccessPhoneReservationId(FIRST_PHONE, TEST_SECRET);
    expect(created.grant).not.toHaveProperty('token');
    expect(created.grant).not.toHaveProperty('phoneReservationId');
    expect(firestoreMock.documents.get(`manual_access/${grantId}`)).not.toHaveProperty('token');
    expect(firestoreMock.documents.get(
      `${MANUAL_ACCESS_PHONE_RESERVATION_COLLECTION}/${reservationId}`
    )).toMatchObject({ grantId, articleId: 'article-one', state: 'unclaimed' });

    const firstClaim = await store.verifyManualAccess(
      'article-one',
      '+254 712 345 678',
      users[0]
    );
    const entitlementId = getManualAccessEntitlementId('reader_one', 'article-one', TEST_SECRET);
    expect(firstClaim).toMatchObject({
      success: true,
      verified: true,
      activated: true,
      alreadyActivated: false,
      articleId: 'article-one',
      boundUser: { id: 'reader_one' }
    });
    expect(JSON.stringify(firstClaim)).not.toMatch(/token|phone/i);
    expect(firestoreMock.documents.get(`manual_access/${grantId}`)).toMatchObject({
      status: 'claimed',
      activated: true,
      boundUserId: 'reader_one',
      claimedUserId: 'reader_one',
      entitlementId
    });
    expect(firestoreMock.documents.get(
      `${MANUAL_ACCESS_ENTITLEMENT_COLLECTION}/${entitlementId}`
    )).toMatchObject({
      grantId,
      userId: 'reader_one',
      articleId: 'article-one',
      state: 'active'
    });
    await expect(store.isArticlePurchasedByUser('article-one', users[0])).resolves.toBe(true);

    firestoreMock.transactionWrites.mockClear();
    await expect(store.verifyManualAccess('article-one', '712345678', users[0])).resolves.toMatchObject({
      success: true,
      verified: true,
      alreadyActivated: true
    });
    expect(firestoreMock.transactionWrites).not.toHaveBeenCalled();

    await expect(store.verifyManualAccess('article-one', '00254712345678', users[1])).resolves.toMatchObject({
      success: false,
      verified: false,
      alreadyActivated: true,
      code: 'MANUAL_ACCESS_ALREADY_CLAIMED',
      message: expect.stringMatching(/already been used/i)
    });

    await expect(store.grantManualAccess('article-two', FIRST_PHONE, 'Writer')).rejects.toMatchObject({
      code: 'MANUAL_ACCESS_PHONE_ALREADY_USED',
      statusCode: 409,
      message: expect.stringMatching(/already been used/i)
    });

    const paidToken = `ink_1788782400000_${'d'.repeat(64)}`;
    firestoreMock.documents.set(`reader_licenses/${paidToken}`, {
      token: paidToken,
      articleId: 'article-two',
      phone: FIRST_PHONE,
      expiresAt: Date.now() + 60_000,
      receipt: 'SIA1234567',
      accessSource: 'MPESA_PURCHASE'
    });

    await expect(store.revokeManualAccess(grantId)).resolves.toBe(true);
    expect(firestoreMock.documents.get(`reader_licenses/${paidToken}`)).toBeDefined();
    expect(firestoreMock.documents.get(
      `${MANUAL_ACCESS_ENTITLEMENT_COLLECTION}/${entitlementId}`
    )).toMatchObject({ state: 'revoked' });
    await expect(store.isArticlePurchasedByUser('article-one', users[0])).resolves.toBe(false);

    await expect(store.deleteManualAccess(grantId)).resolves.toBe(true);
    expect(firestoreMock.documents.get(`manual_access/${grantId}`)).toMatchObject({ status: 'deleted' });
    expect(firestoreMock.documents.get(
      `${MANUAL_ACCESS_PHONE_RESERVATION_COLLECTION}/${reservationId}`
    )).toMatchObject({ state: 'deleted' });
    expect(firestoreMock.documents.get(
      `${MANUAL_ACCESS_ENTITLEMENT_COLLECTION}/${entitlementId}`
    )).toMatchObject({ state: 'deleted' });
    await expect(store.grantManualAccess('article-two', FIRST_PHONE, 'Writer')).rejects.toMatchObject({
      code: 'MANUAL_ACCESS_PHONE_ALREADY_USED'
    });
  });

  it('canonicalizes a legacy slug grant before creating its account entitlement', async () => {
    const grantId = 'legacy_slug_grant';
    const phone = '254733333333';
    firestoreMock.documents.set(`manual_access/${grantId}`, {
      id: grantId,
      articleId: 'article-one-slug',
      articleTitle: 'Article One',
      phone,
      status: 'active',
      activated: false,
      grantedAt: '2026-09-15T01:00:00.000Z',
      grantedBy: 'Writer',
      accessType: 'manual',
      accessSource: 'MANUAL_GRANT'
    });

    await expect(store.verifyManualAccess('article-one', phone, users[0])).resolves.toMatchObject({
      success: true,
      verified: true,
      articleId: 'article-one'
    });
    const entitlementId = getManualAccessEntitlementId('reader_one', 'article-one', TEST_SECRET);
    expect(firestoreMock.documents.get(`manual_access/${grantId}`)).toMatchObject({
      articleId: 'article-one',
      entitlementId
    });
    expect(firestoreMock.documents.get(
      `${MANUAL_ACCESS_ENTITLEMENT_COLLECTION}/${entitlementId}`
    )).toMatchObject({ articleId: 'article-one', state: 'active' });
    await expect(store.isArticlePurchasedByUser('article-one', users[0])).resolves.toBe(true);
  });

  it('fails closed for a claimed legacy grant with no account binding and for corrupt expiry data', async () => {
    const claimedGrantId = 'legacy_claimed_without_owner';
    firestoreMock.documents.set(`manual_access/${claimedGrantId}`, {
      id: claimedGrantId,
      articleId: 'article-one',
      phone: '254744444444',
      status: 'claimed',
      activated: true,
      claimedAt: '2026-09-15T02:00:00.000Z',
      grantedAt: '2026-09-15T01:00:00.000Z',
      grantedBy: 'Writer',
      accessType: 'manual'
    });
    await expect(store.verifyManualAccess('article-one', '0744444444', users[0])).rejects.toMatchObject({
      code: 'MANUAL_ACCESS_LEGACY_RECONCILIATION_REQUIRED',
      statusCode: 409
    });

    const corruptGrantId = 'legacy_corrupt_expiry';
    firestoreMock.documents.set(`manual_access/${corruptGrantId}`, {
      id: corruptGrantId,
      articleId: 'article-one',
      phone: '254755555555',
      status: 'active',
      activated: false,
      grantedAt: '2026-09-15T01:00:00.000Z',
      grantedBy: 'Writer',
      accessType: 'manual',
      expiresAt: 'never'
    });
    await expect(store.verifyManualAccess('article-one', '0755555555', users[0])).rejects.toMatchObject({
      code: 'MANUAL_ACCESS_EXPIRY_CORRUPT',
      statusCode: 503
    });
  });

  it('does not reserve a phone or report success when the transaction commit fails', async () => {
    const phone = '254766666666';
    const reservationId = getManualAccessPhoneReservationId(phone, TEST_SECRET);
    const beforeFailure = snapshotManualAccessDocuments();
    firestoreMock.failNextTransaction();

    await expect(store.grantManualAccess('article-one', phone, 'Writer')).rejects.toThrow(
      /injected transaction commit failure/i
    );
    expect(snapshotManualAccessDocuments()).toEqual(beforeFailure);
    expect(firestoreMock.documents.has(`${MANUAL_ACCESS_PHONE_RESERVATION_COLLECTION}/${reservationId}`)).toBe(false);
    expect(Array.from(firestoreMock.documents.keys()).filter(key => key.startsWith('manual_access/'))).toHaveLength(0);

    await expect(store.grantManualAccess('article-one', '0766 666 666', 'Writer')).resolves.toMatchObject({
      success: true,
      grant: { articleId: 'article-one', phone }
    });
    expect(firestoreMock.documents.get(
      `${MANUAL_ACCESS_PHONE_RESERVATION_COLLECTION}/${reservationId}`
    )).toMatchObject({ articleId: 'article-one', state: 'unclaimed' });
    expect(Array.from(firestoreMock.documents.keys()).filter(key => key.startsWith('manual_access/'))).toHaveLength(1);
  });

  it('rejects a corrupt entitlement without rewriting the durable binding', async () => {
    const phone = '254777777777';
    const created = await store.grantManualAccess('article-one', phone, 'Writer');
    await store.verifyManualAccess('article-one', phone, users[0]);
    const entitlementId = getManualAccessEntitlementId('reader_one', 'article-one', TEST_SECRET);
    const key = `${MANUAL_ACCESS_ENTITLEMENT_COLLECTION}/${entitlementId}`;
    firestoreMock.documents.set(key, {
      ...firestoreMock.documents.get(key),
      token: 'must-never-exist'
    });
    const durableGrant = clone(firestoreMock.documents.get(`manual_access/${created.grant.id}`));
    firestoreMock.transactionWrites.mockClear();

    await expect(store.verifyManualAccess('article-one', phone, users[0])).rejects.toMatchObject({
      code: 'MANUAL_ACCESS_ENTITLEMENT_MISMATCH',
      statusCode: 503
    });
    expect(firestoreMock.transactionWrites).not.toHaveBeenCalled();
    expect(firestoreMock.documents.get(`manual_access/${created.grant.id}`)).toEqual(durableGrant);
  });

  it('copies a finite grant expiry into the entitlement and denies access at expiry', async () => {
    const phone = '254788888881';
    const created = await store.grantManualAccess('article-one', phone, 'Writer');
    const grantKey = `manual_access/${created.grant.id}`;
    const expiresAt = Date.now() + 60_000;
    firestoreMock.documents.set(grantKey, {
      ...firestoreMock.documents.get(grantKey),
      expiresAt
    });

    await expect(store.verifyManualAccess('article-one', phone, users[0])).resolves.toMatchObject({
      success: true,
      verified: true
    });
    const entitlementId = getManualAccessEntitlementId('reader_one', 'article-one', TEST_SECRET);
    expect(firestoreMock.documents.get(
      `${MANUAL_ACCESS_ENTITLEMENT_COLLECTION}/${entitlementId}`
    )).toMatchObject({ expiresAt, state: 'active' });
    await expect(store.isArticlePurchasedByUser('article-one', users[0])).resolves.toBe(true);

    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(expiresAt);
    try {
      await expect(store.isArticlePurchasedByUser('article-one', users[0])).resolves.toBe(false);
      const library = await store.getUserPurchases(users[0].id);
      expect(library.some(item => item.articleId === 'article-one')).toBe(false);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('repairs a dangling pointer and revokes the one real entitlement', async () => {
    const phone = '254788888882';
    const created = await store.grantManualAccess('article-one', phone, 'Writer');
    await store.verifyManualAccess('article-one', phone, users[0]);
    const realEntitlementId = getManualAccessEntitlementId('reader_one', 'article-one', TEST_SECRET);
    const danglingEntitlementId = getManualAccessEntitlementId('reader_two', 'article-two', TEST_SECRET);
    const grantKey = `manual_access/${created.grant.id}`;
    firestoreMock.documents.set(grantKey, {
      ...firestoreMock.documents.get(grantKey),
      entitlementId: danglingEntitlementId
    });

    await expect(store.revokeManualAccess(created.grant.id)).resolves.toBe(true);
    expect(firestoreMock.documents.get(grantKey)).toMatchObject({
      status: 'revoked',
      entitlementId: realEntitlementId
    });
    expect(firestoreMock.documents.get(
      `${MANUAL_ACCESS_ENTITLEMENT_COLLECTION}/${realEntitlementId}`
    )).toMatchObject({ state: 'revoked' });
    expect(firestoreMock.documents.has(
      `${MANUAL_ACCESS_ENTITLEMENT_COLLECTION}/${danglingEntitlementId}`
    )).toBe(false);
    await expect(store.isArticlePurchasedByUser('article-one', users[0])).resolves.toBe(false);
  });

  it('rejects duplicate entitlements for one grant without changing durable state', async () => {
    const phone = '254788888883';
    const created = await store.grantManualAccess('article-one', phone, 'Writer');
    await store.verifyManualAccess('article-one', phone, users[0]);
    const duplicateEntitlementId = getManualAccessEntitlementId('reader_two', 'article-two', TEST_SECRET);
    const createdAt = new Date().toISOString();
    firestoreMock.documents.set(
      `${MANUAL_ACCESS_ENTITLEMENT_COLLECTION}/${duplicateEntitlementId}`,
      {
        storageVersion: 1,
        grantId: created.grant.id,
        userId: 'reader_two',
        articleId: 'article-two',
        state: 'active',
        createdAt,
        updatedAt: createdAt
      }
    );
    const beforeRevoke = snapshotManualAccessDocuments();
    firestoreMock.transactionWrites.mockClear();

    await expect(store.revokeManualAccess(created.grant.id)).rejects.toMatchObject({
      code: 'MANUAL_ACCESS_ENTITLEMENT_CONFLICT',
      statusCode: 503
    });
    expect(firestoreMock.transactionWrites).not.toHaveBeenCalled();
    expect(snapshotManualAccessDocuments()).toEqual(beforeRevoke);
  });

  it('recovers an entitlement by grantId when all grant and reservation pointers are missing', async () => {
    const phone = '254788888884';
    const created = await store.grantManualAccess('article-one', phone, 'Writer');
    await store.verifyManualAccess('article-one', phone, users[0]);
    const entitlementId = getManualAccessEntitlementId('reader_one', 'article-one', TEST_SECRET);
    const reservationId = getManualAccessPhoneReservationId(phone, TEST_SECRET);
    const grantKey = `manual_access/${created.grant.id}`;
    const {
      entitlementId: _entitlementPointer,
      boundUserId: _boundUserId,
      boundUserEmail: _boundUserEmail,
      boundUserName: _boundUserName,
      claimedUserId: _claimedUserId,
      claimedUserEmail: _claimedUserEmail,
      claimedUserName: _claimedUserName,
      ...legacyGrantWithoutPointers
    } = firestoreMock.documents.get(grantKey);
    firestoreMock.documents.set(grantKey, legacyGrantWithoutPointers);
    firestoreMock.documents.delete(
      `${MANUAL_ACCESS_PHONE_RESERVATION_COLLECTION}/${reservationId}`
    );

    await expect(store.revokeManualAccess(created.grant.id)).resolves.toBe(true);
    expect(firestoreMock.documents.get(grantKey)).toMatchObject({
      status: 'revoked',
      entitlementId,
      boundUserId: 'reader_one',
      claimedUserId: 'reader_one'
    });
    expect(firestoreMock.documents.get(
      `${MANUAL_ACCESS_PHONE_RESERVATION_COLLECTION}/${reservationId}`
    )).toMatchObject({
      state: 'revoked',
      boundUserId: 'reader_one'
    });
    expect(firestoreMock.documents.get(
      `${MANUAL_ACCESS_ENTITLEMENT_COLLECTION}/${entitlementId}`
    )).toMatchObject({ state: 'revoked' });
  });

  it('monotonically repairs an active entitlement when grant and reservation are already deleted', async () => {
    const phone = '254788888885';
    const created = await store.grantManualAccess('article-one', phone, 'Writer');
    await store.verifyManualAccess('article-one', phone, users[0]);
    const entitlementId = getManualAccessEntitlementId('reader_one', 'article-one', TEST_SECRET);
    const reservationId = getManualAccessPhoneReservationId(phone, TEST_SECRET);
    const grantKey = `manual_access/${created.grant.id}`;
    const reservationKey = `${MANUAL_ACCESS_PHONE_RESERVATION_COLLECTION}/${reservationId}`;
    const deletedAt = new Date().toISOString();
    firestoreMock.documents.set(grantKey, {
      ...firestoreMock.documents.get(grantKey),
      status: 'deleted',
      deletedAt
    });
    firestoreMock.documents.set(reservationKey, {
      ...firestoreMock.documents.get(reservationKey),
      state: 'deleted',
      updatedAt: deletedAt,
      deletedAt
    });

    await expect(store.deleteManualAccess(created.grant.id)).resolves.toBe(true);
    expect(firestoreMock.documents.get(grantKey)).toMatchObject({ status: 'deleted' });
    expect(firestoreMock.documents.get(reservationKey)).toMatchObject({ state: 'deleted' });
    expect(firestoreMock.documents.get(
      `${MANUAL_ACCESS_ENTITLEMENT_COLLECTION}/${entitlementId}`
    )).toMatchObject({ state: 'deleted' });
    await expect(store.isArticlePurchasedByUser('article-one', users[0])).resolves.toBe(false);
  });

  it('migrates a legacy slug grant whose manual license already uses the canonical article ID', async () => {
    const grantId = 'legacy_slug_with_canonical_license';
    const phone = '254788888886';
    const token = 'ink_grant_legacy_slug_license_1234';
    firestoreMock.documents.set(`manual_access/${grantId}`, {
      id: grantId,
      articleId: 'article-one-slug',
      articleTitle: 'Article One',
      phone,
      token,
      status: 'active',
      activated: false,
      grantedAt: '2026-09-15T01:00:00.000Z',
      grantedBy: 'Writer',
      accessType: 'manual',
      accessSource: 'MANUAL_GRANT'
    });
    firestoreMock.documents.set(`reader_licenses/${token}`, {
      token,
      articleId: 'article-one',
      phone,
      expiresAt: Date.now() + 60_000,
      receipt: 'MANUAL-LEGACY',
      createdAt: '2026-09-15T01:30:00.000Z',
      accessSource: 'MANUAL_GRANT'
    });

    await expect(store.verifyManualAccess('article-one', phone, users[0])).resolves.toMatchObject({
      success: true,
      verified: true,
      articleId: 'article-one'
    });
    const entitlementId = getManualAccessEntitlementId('reader_one', 'article-one', TEST_SECRET);
    expect(firestoreMock.documents.get(`manual_access/${grantId}`)).toMatchObject({
      articleId: 'article-one',
      entitlementId
    });
    expect(firestoreMock.documents.get(
      `${MANUAL_ACCESS_ENTITLEMENT_COLLECTION}/${entitlementId}`
    )).toMatchObject({ articleId: 'article-one', state: 'active' });
    expect(firestoreMock.documents.has(`reader_licenses/${token}`)).toBe(false);
  });

  it('preserves a same-phone, same-article M-Pesa license exactly across manual revoke and delete', async () => {
    const phone = '254788888887';
    const created = await store.grantManualAccess('article-one', phone, 'Writer');
    await store.verifyManualAccess('article-one', phone, users[1]);
    const paidToken = `ink_1788782400010_${'e'.repeat(64)}`;
    const paidLicense = {
      token: paidToken,
      articleId: 'article-one',
      phone,
      expiresAt: Date.now() + 600_000,
      receipt: 'SIA7654321',
      createdAt: '2026-09-15T02:00:00.000Z',
      userId: 'reader_two',
      email: 'reader-two@example.test',
      accessSource: 'MPESA_PURCHASE'
    };
    firestoreMock.documents.set(`reader_licenses/${paidToken}`, clone(paidLicense));
    await expect(store.loadPurchasedToken(paidToken)).resolves.toEqual(paidLicense);

    await expect(store.revokeManualAccess(created.grant.id)).resolves.toBe(true);
    expect(firestoreMock.documents.get(`reader_licenses/${paidToken}`)).toEqual(paidLicense);
    await expect(store.isArticlePurchasedByUser('article-one', users[1])).resolves.toBe(true);

    await expect(store.deleteManualAccess(created.grant.id)).resolves.toBe(true);
    expect(firestoreMock.documents.get(`reader_licenses/${paidToken}`)).toEqual(paidLicense);
    await expect(store.isArticlePurchasedByUser('article-one', users[1])).resolves.toBe(true);
  });

  it.each([
    {
      name: 'MANUAL_GRANT source',
      token: 'ink_grant_legacy_source_20260916',
      receipt: 'LEGACY-GRANT',
      accessSource: 'MANUAL_GRANT'
    },
    {
      name: 'MANUAL receipt on an old license',
      token: `ink_1788782400011_${'a'.repeat(64)}`,
      receipt: 'MANUAL-LEGACY-20260916',
      accessSource: 'MPESA_PURCHASE'
    }
  ])('does not permit $name to unlock through account linking or warm cache', async ({ token, receipt, accessSource }) => {
    const manualLicense = {
      token,
      articleId: 'article-two',
      phone: '254799999991',
      expiresAt: Date.now() + 600_000,
      receipt,
      createdAt: '2026-09-15T02:00:00.000Z',
      userId: users[0].id,
      email: users[0].email,
      accessSource
    };
    firestoreMock.documents.set(`reader_licenses/${token}`, clone(manualLicense));
    await expect(store.loadPurchasedToken(token)).resolves.toEqual(manualLicense);

    await expect(store.isArticlePurchasedByUser('article-two', users[0])).resolves.toBe(false);
    const library = await store.getUserPurchases(users[0].id);
    expect(library.some(entry => entry.token === token)).toBe(false);
    const linkResult = await store.linkUserPurchase(users[0].id, token);
    expect(linkResult).toMatchObject({ success: false, linkedCount: 0 });
    expect(firestoreMock.documents.get(`reader_licenses/${token}`)).toEqual(manualLicense);
    expect(firestoreMock.transactionWrites).not.toHaveBeenCalled();
  });

  it('still permits an account-bound M-Pesa purchase after legacy manual bearer filtering', async () => {
    const token = `ink_1788782400012_${'b'.repeat(64)}`;
    const paidLicense = {
      token,
      articleId: 'article-two',
      phone: '254799999992',
      expiresAt: Date.now() + 600_000,
      receipt: 'SIA1234569',
      createdAt: '2026-09-15T02:10:00.000Z',
      userId: users[0].id,
      email: users[0].email,
      accessSource: 'MPESA_PURCHASE'
    };
    firestoreMock.documents.set(`reader_licenses/${token}`, clone(paidLicense));
    await expect(store.loadPurchasedToken(token)).resolves.toEqual(paidLicense);

    await expect(store.isArticlePurchasedByUser('article-two', users[0])).resolves.toBe(true);
    const library = await store.getUserPurchases(users[0].id);
    expect(library).toContainEqual(expect.objectContaining({ token, articleId: 'article-two' }));
    await expect(store.linkUserPurchase(users[0].id, token)).resolves.toMatchObject({
      success: true,
      linkedCount: 1
    });
  });

  it('keeps claim and terminal state atomic when their transaction commits fail', async () => {
    const phone = '254788888888';
    const created = await store.grantManualAccess('article-one', phone, 'Writer');
    const beforeClaim = snapshotManualAccessDocuments();
    firestoreMock.failNextTransaction();

    await expect(store.verifyManualAccess('article-one', phone, users[0])).rejects.toThrow(
      /injected transaction commit failure/i
    );
    expect(snapshotManualAccessDocuments()).toEqual(beforeClaim);
    expect(Array.from(firestoreMock.documents.keys()).some(
      key => key.startsWith(`${MANUAL_ACCESS_ENTITLEMENT_COLLECTION}/`)
    )).toBe(false);

    await expect(store.verifyManualAccess('article-one', phone, users[0])).resolves.toMatchObject({
      success: true,
      verified: true
    });
    const beforeRevoke = snapshotManualAccessDocuments();
    firestoreMock.failNextTransaction();
    await expect(store.revokeManualAccess(created.grant.id)).rejects.toThrow(
      /injected transaction commit failure/i
    );
    expect(snapshotManualAccessDocuments()).toEqual(beforeRevoke);
    await expect(store.isArticlePurchasedByUser('article-one', users[0])).resolves.toBe(true);

    await expect(store.revokeManualAccess(created.grant.id)).resolves.toBe(true);
    await expect(store.isArticlePurchasedByUser('article-one', users[0])).resolves.toBe(false);
  });
});
