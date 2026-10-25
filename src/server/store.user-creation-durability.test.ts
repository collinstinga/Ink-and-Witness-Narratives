import crypto from 'crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Ref = { collection: string; id: string; path: string };
type Query = { collection: string; field: string; operator: string; value: unknown; maximum: number };
const firestore = vi.hoisted(() => {
  const documents = new Map<string, any>();
  const state: {
    readError: Error | null; commitError: Error | null; commitGate: Promise<void> | null;
    prepared: (() => void) | null; transactionTail: Promise<void>; staged: Array<{ ref: Ref; value: any }>;
  } = { readError: null, commitError: null, commitGate: null, prepared: null, transactionTail: Promise.resolve(), staged: [] };
  const queries = vi.fn(); const reads = vi.fn(); const creates = vi.fn();
  const db = {
    collection: (collection: string) => ({
      doc: (id: string): Ref => ({ collection, id, path: `${collection}/${id}` }),
      where: (field: string, operator: string, value: unknown) => ({
        limit: (maximum: number): Query => ({ collection, field, operator, value, maximum }),
      }),
    }),
    runTransaction: vi.fn(async (operation: (transaction: any) => Promise<unknown>) => {
      const previous = state.transactionTail;
      let release!: () => void; state.transactionTail = new Promise<void>(resolve => { release = resolve; });
      await previous;
      const staged: Array<{ ref: Ref; value: any }> = [];
      try {
        const result = await operation({
          get: async (target: Query | Ref) => {
            if (state.readError) throw state.readError;
            if ('path' in target) {
              if (target.collection !== 'user_email_reservations') throw new Error('unexpected identity document read');
              reads(target.path);
              return { exists: documents.has(target.path), data: () => structuredClone(documents.get(target.path)) };
            }
            const query = target;
            queries(query);
            if (query.collection !== 'users' || query.field !== 'email' || query.operator !== '==' || query.maximum !== 2) {
              throw new Error('unexpected unbounded identity query');
            }
            return { docs: [...documents].filter(([path, value]) => path.startsWith('users/') && value.email === query.value)
              .slice(0, query.maximum).map(([path, value]) => ({ id: path.slice(6), data: () => structuredClone(value) })) };
          },
          create: (ref: Ref, value: unknown) => {
            creates(ref, value);
            if (!['users', 'user_email_reservations'].includes(ref.collection)) throw new Error('unexpected non-identity write');
            staged.push({ ref, value: structuredClone(value) });
          },
          set: () => { throw new Error('existing user overwrite forbidden'); },
          update: () => { throw new Error('existing user mutation forbidden'); },
          delete: () => { throw new Error('existing user deletion forbidden'); },
        });
        state.staged = staged; state.prepared?.();
        if (state.commitGate) await state.commitGate;
        if (state.commitError) throw state.commitError;
        if (staged.some(item => documents.has(item.ref.path))) throw new Error('already exists');
        for (const item of staged) documents.set(item.ref.path, item.value);
        return result;
      } finally { release(); }
    }),
  };
  return { documents, state, queries, reads, creates, db,
    getDb: vi.fn(() => db),
    setFirestoreDoc: vi.fn(async (collection: string, id: string, data: unknown) => {
      documents.set(`${collection}/${id}`, structuredClone(data));
    }),
  };
});
const disk = vi.hoisted(() => ({
  existsSync: vi.fn(() => false), mkdirSync: vi.fn(), writeFileSync: vi.fn(), renameSync: vi.fn(),
  readFileSync: vi.fn(() => { throw new Error('unexpected disk read'); }),
}));
vi.mock('fs', () => ({ default: disk, ...disk }));
vi.mock('./db.js', () => ({
  getDb: firestore.getDb, setFirestoreDoc: firestore.setFirestoreDoc,
  getAllFirestoreDocs: vi.fn(async () => []), getFirestoreDoc: vi.fn(async () => null),
  deleteFirestoreDoc: vi.fn(), sanitizeForFirestore: (value: unknown) => value,
}));
vi.mock('./affiliateStore.js', () => ({ affiliateStore: { init: vi.fn(async () => undefined) } }));

const originalEnvironment = {
  VERCEL: process.env.VERCEL, FIREBASE_SERVICE_ACCOUNT_JSON: process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
  GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS,
};
describe('reader account create durability', () => {
  let store: typeof import('./store.js').store;
  let sequence = 0;
  const user = () => ({ email: `creation-fixture-${++sequence}@example.invalid`, name: 'STAGING TEST Reader', passwordHash: '$argon2id$unchanged-fixture' });
  const reservationPath = (email: string) => `user_email_reservations/uer1_${crypto.createHash('sha256').update(email.trim().toLowerCase()).digest('hex')}`;
  beforeAll(async () => {
    process.env.VERCEL = '1';
    ({ store } = await import('./store.js'));
  }, 60_000);
  beforeEach(() => {
    vi.clearAllMocks(); process.env.VERCEL = '1';
    delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON; delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    firestore.documents.clear(); Object.assign(firestore.state, {
      readError: null, commitError: null, commitGate: null, prepared: null, transactionTail: Promise.resolve(), staged: [],
    });
  });
  afterAll(() => {
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });

  it('does not publish the cache or resolve until the create-only cloud transaction commits', async () => {
    const input = user(); let release!: () => void; let prepared!: () => void; let acknowledged = false;
    firestore.state.commitGate = new Promise<void>(resolve => { release = resolve; });
    const reached = new Promise<void>(resolve => { prepared = resolve; }); firestore.state.prepared = prepared;
    const pending = store.createUser(input).then(value => { acknowledged = true; return value; });
    await reached;
    expect(acknowledged).toBe(false); expect(store.getUserByEmail(input.email)).toBeNull();
    expect(firestore.documents.size).toBe(0); expect(disk.writeFileSync).not.toHaveBeenCalled();
    release(); const created = await pending;
    expect(created).toMatchObject({ ...input, role: 'client' });
    expect(firestore.documents.get(`users/${created.id}`)).toEqual(created);
    expect(firestore.documents.get(reservationPath(input.email))).toEqual({ userId: created.id, createdAt: created.createdAt });
    expect(firestore.documents.size).toBe(2);
    expect(firestore.reads).toHaveBeenCalledWith(reservationPath(input.email));
    expect(firestore.reads.mock.invocationCallOrder[0]).toBeLessThan(firestore.queries.mock.invocationCallOrder[0]);
    expect(store.getUserById(created.id)).toEqual(created);
    expect(firestore.queries).toHaveBeenCalledWith(expect.objectContaining({ field: 'email', value: input.email, maximum: 2 }));
    expect(firestore.setFirestoreDoc).not.toHaveBeenCalled();
  });

  it.each(['read', 'commit'])('returns a safe %s failure without a phantom cached or durable identity', async failure => {
    const input = user();
    firestore.state[failure === 'read' ? 'readError' : 'commitError'] = new Error('private-sdk-password@example.test');
    await expect(store.createUser(input)).rejects.toThrow('Your account could not be created right now. Please retry.');
    expect(store.getUserByEmail(input.email)).toBeNull(); expect(firestore.documents.size).toBe(0);
    for (const item of firestore.state.staged) expect(store.getUserById(item.ref.id)).toBeNull();
    expect(disk.writeFileSync).not.toHaveBeenCalled();
  });

  it('allows a real retry after a failed commit instead of reserving a phantom cached email', async () => {
    const input = user(); firestore.state.commitError = new Error('unavailable');
    await expect(store.createUser(input)).rejects.toThrow(/could not be created/);
    firestore.state.commitError = null;
    const created = await store.createUser(input);
    expect(store.getUserByEmail(input.email)?.id).toBe(created.id);
    expect([...firestore.documents.values()].filter(value => value.email === input.email)).toHaveLength(1);
  });

  it('rejects a duplicate in shared storage even when it is absent from the local startup cache, without overwriting it', async () => {
    const input = user(); const existing = { ...input, id: 'user_preserved_123', role: 'client', immutable: 'preserve-me' };
    firestore.documents.set(`users/${existing.id}`, existing);
    expect(store.getUserByEmail(input.email)).toBeNull();
    await expect(store.createUser(input)).rejects.toThrow('A user with this email address already exists.');
    expect(firestore.creates).not.toHaveBeenCalled(); expect([...firestore.documents]).toEqual([[`users/${existing.id}`, existing]]);
    expect(store.getUserByEmail(input.email)).toBeNull();
  });

  it('preserves cached duplicate rejection, normalization and existing credentials', async () => {
    const input = user(); const created = await store.createUser({ ...input, email: ` ${input.email.toUpperCase()} `, role: 'admin' });
    expect(created).toMatchObject({ email: input.email, role: 'admin', passwordHash: input.passwordHash });
    const before = structuredClone([...firestore.documents]); firestore.db.runTransaction.mockClear();
    await expect(store.createUser(input)).rejects.toThrow(/already exists/);
    expect(firestore.db.runTransaction).not.toHaveBeenCalled(); expect([...firestore.documents]).toEqual(before);
    expect(store.getUserById(created.id)).toEqual(created);
  });

  it('creates only one same-email account when concurrent transactions serialize', async () => {
    const input = user(); const results = await Promise.allSettled([store.createUser(input), store.createUser(input)]);
    expect(results.map(value => value.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect([...firestore.documents.values()].filter(value => value.email === input.email)).toHaveLength(1);
    const [created] = [...firestore.documents].filter(([path]) => path.startsWith('users/'));
    expect(firestore.documents.get(reservationPath(input.email))).toEqual({ userId: created[1].id, createdAt: created[1].createdAt });
    expect(firestore.documents.size).toBe(2);
  });

  it('preserves an existing email reservation and rejects before querying legacy users or publishing any user', async () => {
    const input = user(); const original = { userId: 'user_existing_123', createdAt: '2026-10-01T00:00:00.000Z' };
    firestore.documents.set(reservationPath(input.email), original);
    await expect(store.createUser(input)).rejects.toThrow('A user with this email address already exists.');
    expect(firestore.queries).not.toHaveBeenCalled(); expect(firestore.creates).not.toHaveBeenCalled();
    expect([...firestore.documents]).toEqual([[reservationPath(input.email), original]]);
    expect(store.getUserByEmail(input.email)).toBeNull();
  });

  it('commits neither the user nor a replacement when a competing email reservation wins after the reads', async () => {
    const input = user(); let release!: () => void; let prepared!: () => void;
    firestore.state.commitGate = new Promise<void>(resolve => { release = resolve; });
    const reached = new Promise<void>(resolve => { prepared = resolve; }); firestore.state.prepared = prepared;
    const pending = store.createUser(input); const assertion = expect(pending).rejects.toThrow(/could not be created/);
    await reached;
    const original = { userId: 'user_other_runtime_123', createdAt: '2026-10-01T00:00:00.000Z' };
    firestore.documents.set(reservationPath(input.email), original); release(); await assertion;
    expect([...firestore.documents]).toEqual([[reservationPath(input.email), original]]);
    expect(store.getUserByEmail(input.email)).toBeNull();
    const createdUser = firestore.state.staged.find(item => item.ref.collection === 'users')!;
    expect(store.getUserById(createdUser.ref.id)).toBeNull();
  });

  it('refuses a create-only document collision without overwriting the existing record or caching success', async () => {
    const input = user(); let release!: () => void; let prepared!: () => void;
    firestore.state.commitGate = new Promise<void>(resolve => { release = resolve; });
    const reached = new Promise<void>(resolve => { prepared = resolve; }); firestore.state.prepared = prepared;
    const pending = store.createUser(input); const assertion = expect(pending).rejects.toThrow(/could not be created/);
    await reached; const path = firestore.state.staged[0].ref.path;
    const original = { id: path.slice(6), email: 'preserved@example.invalid', passwordHash: 'unchanged' };
    firestore.documents.set(path, original); release(); await assertion;
    expect(firestore.documents.get(path)).toEqual(original); expect(store.getUserByEmail(input.email)).toBeNull();
  });

  it.each(['FIREBASE_SERVICE_ACCOUNT_JSON', 'GOOGLE_APPLICATION_CREDENTIALS'])('requires cloud durability outside Vercel when %s is explicitly configured', async key => {
    delete process.env.VERCEL; process.env[key] = 'configured-test-marker-not-a-credential';
    const input = user(); firestore.state.commitError = new Error('unavailable');
    await expect(store.createUser(input)).rejects.toThrow(/could not be created/);
    expect(store.getUserByEmail(input.email)).toBeNull(); expect(disk.writeFileSync).not.toHaveBeenCalled();
  });

  it('preserves credential-free local JSON development when optional cloud persistence is unavailable', async () => {
    delete process.env.VERCEL; const input = user();
    firestore.setFirestoreDoc.mockRejectedValueOnce(new Error('no local cloud credential'));
    const created = await store.createUser(input);
    expect(store.getUserById(created.id)).toEqual(created); expect(firestore.db.runTransaction).not.toHaveBeenCalled();
    expect(disk.writeFileSync).toHaveBeenCalled(); expect(disk.renameSync).toHaveBeenCalled();
    expect(firestore.setFirestoreDoc).toHaveBeenCalledWith('users', created.id, created);
  });
});
