import crypto from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import type { UserRecord } from '../types.js';
const binding = vi.hoisted(() => ({ target: { projectId: 'ink-and-witness-narratives', firestoreDatabaseId: '(default)' } as { projectId: string; firestoreDatabaseId: string } | null }));
const passwords = vi.hoisted(() => ({ verify: vi.fn() }));
vi.mock('./db.js', () => ({ getDb: () => { throw new Error('Default DB not permitted in tests'); }, getFirestoreClientTarget: () => binding.target }));
vi.mock('./auth.js', () => ({ verifyPassword: passwords.verify }));
import {
  WriterIdentityConsolidationStore, WRITER_CONSOLIDATION_OWNER as OWNER, WRITER_CONSOLIDATION_TOKEN_PATTERN,
  WRITER_CONSOLIDATION_TOKEN_TTL_MS as TTL, writerIdentityConsolidationId, writerIdentityCohortSha256,
  hashWriterConsolidationToken, resolveWriterIdentityByEmail, writerConsolidationSessionAllowed,
  resolveWriterIdentityForSessionCreation, WRITER_CONSOLIDATION_MAX_MEMBERS,
} from './writerIdentityConsolidation.js';

const NOW = Date.parse('2026-10-27T15:00:00.000Z');
const ID1 = 'user_writer0001', ID2 = 'user_writer0002';
const sha = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const PLAN = `user_identity_consolidations/${writerIdentityConsolidationId(OWNER)}`;
const REVIEW = `user_identity_repair_reviews/${writerIdentityConsolidationId(OWNER)}`;
const RESERVATION = `user_email_reservations/uer1_${sha(OWNER)}`;
const ENV: NodeJS.ProcessEnv = { VERCEL_ENV: 'production', FIREBASE_PROJECT_ID: 'ink-and-witness-narratives', FIRESTORE_DATABASE_ID: '(default)' };
const actor = { id: ID2, email: OWNER, role: 'admin' };
const NEW_PASSWORD = 'new-writer-password-123!';
const user = (id: string): UserRecord => ({ id, email: OWNER, role: 'admin', name: 'Original writer',
  passwordHash: `$argon2id$original-${id}`, createdAt: '2026-09-01T00:00:00.000Z' });

function fakeFirestore() {
  const docs = new Map<string, Record<string, any>>();
  let failCommit = false;
  const clone = <T>(value: T): T => structuredClone(value);
  const snap = (path: string) => ({ id: path.split('/').pop()!, exists: docs.has(path), data: () => docs.has(path) ? clone(docs.get(path)!) : undefined });
  const field = (value: any, key: string) => key.split('.').reduce((current, part) => current?.[part], value);
  function collection(name: string) {
    const query = (filters: Array<[string, unknown]> = [], max = Infinity): any => ({ name, filters, max,
      doc: (id: string) => ({ path: `${name}/${id}`, get: async () => snap(`${name}/${id}`) }),
      where: (key: string, op: string, value: unknown) => { if (op !== '==') throw new Error('Unexpected operator'); return query([...filters, [key, value]], max); },
      limit: (limit: number) => query(filters, limit), get: async () => result(query(filters, max)),
    });
    return query();
  }
  function result(ref: any): any {
    if (ref.path) return snap(ref.path);
    return { docs: [...docs.entries()].filter(([key, value]) => key.startsWith(`${ref.name}/`)
      && ref.filters.every(([key, expected]: [string, unknown]) => field(value, key) === expected))
      .slice(0, ref.max).map(([key]) => snap(key)) };
  }
  const db = { collection, runTransaction: async (callback: (tx: any) => Promise<any>) => {
    const operations: Array<() => void> = []; let writing = false;
    const tx = { get: async (ref: any) => { if (writing) throw new Error('Read after write'); return result(ref); },
      create: (ref: any, value: any) => { writing = true; operations.push(() => { if (docs.has(ref.path)) throw new Error('Exists'); docs.set(ref.path, clone(value)); }); },
      set: (ref: any, value: any) => { writing = true; operations.push(() => { docs.set(ref.path, clone(value)); }); },
      update: (ref: any, value: any) => { writing = true; operations.push(() => { if (!docs.has(ref.path)) throw new Error('Missing'); docs.set(ref.path, { ...docs.get(ref.path), ...clone(value) }); }); },
      delete: (ref: any) => { writing = true; operations.push(() => { docs.delete(ref.path); }); },
    };
    const value = await callback(tx);
    if (failCommit) throw new Error('Private database failure');
    for (const operation of operations) operation();
    return value;
  } } as unknown as Firestore;
  return { db, docs, setFailCommit: (value: boolean) => { failCommit = value; } };
}
function seed(fake: ReturnType<typeof fakeFirestore>) {
  fake.docs.set(`users/${ID1}`, user(ID1)); fake.docs.set(`users/${ID2}`, user(ID2));
  const rows = [ID1, ID2].map(id => ({ id, data: fake.docs.get(`users/${id}`)! }));
  fake.docs.set(REVIEW, { schemaVersion: 1, kind: 'writer-identity-consolidation-review', projectId: ENV.FIREBASE_PROJECT_ID,
    databaseId: '(default)', emailSha256: sha(OWNER), memberUserIds: [ID1, ID2], cohortSha256: writerIdentityCohortSha256(rows),
    backupManifestSha256: 'a'.repeat(64), dependencyProof: { schemaVersion: 1, result: 'no-owned-records',
      checkedAt: new Date(NOW - 60_000).toISOString(), datasetsSha256: 'b'.repeat(64) },
    createdAt: new Date(NOW - 30_000).toISOString(), expiresAt: new Date(NOW + 12 * 3_600_000).toISOString() });
}
let fake: ReturnType<typeof fakeFirestore>, store: WriterIdentityConsolidationStore;
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(NOW); binding.target = { projectId: ENV.FIREBASE_PROJECT_ID!, firestoreDatabaseId: '(default)' };
  passwords.verify.mockReset(); passwords.verify.mockImplementation(async (hash: string) => !hash.includes('original-'));
  fake = fakeFirestore(); seed(fake); store = new WriterIdentityConsolidationStore(() => fake.db, () => ENV);
});
afterEach(() => vi.useRealTimers());

describe('review-bound writer consolidation capability', () => {
  it('requires a private repair review and never selects the first query result', async () => {
    expect(await store.status(actor)).toEqual({ status: 'ready', memberCount: 2, canIssue: true });
    fake.docs.delete(REVIEW);
    expect(await store.status(actor)).toEqual({ status: 'review_required', memberCount: 2, canIssue: false });
    await expect(store.issue(actor)).rejects.toMatchObject({ code: 'blocked' });
    expect(fake.docs.has(PLAN)).toBe(false);
  });
  it('issues inert hash-only metadata for the actual authenticated actor, not the oldest/first user', async () => {
    const before = structuredClone([...fake.docs.entries()]); const issued = await store.issue(actor);
    expect(issued.token).toMatch(WRITER_CONSOLIDATION_TOKEN_PATTERN); expect(issued.expiresAt).toBe(NOW + TTL);
    expect(fake.docs.get(PLAN)).toMatchObject({ state: 'pending', canonicalUserId: ID2 });
    expect(JSON.stringify([...fake.docs.entries()])).not.toContain(issued.token);
    expect(fake.docs.get(`writer_identity_reset_tokens/${hashWriterConsolidationToken(issued.token)}`)).toMatchObject({ purpose: 'writer-identity-consolidation' });
    for (const [key, value] of before) expect(fake.docs.get(key)).toEqual(value);
    expect(fake.docs.has(RESERVATION)).toBe(false);
    expect(await store.isActive(issued.token)).toBe(true);
    expect(await store.status(actor)).toMatchObject({ status: 'pending', canIssue: false });
    await expect(store.issue(actor)).rejects.toMatchObject({ code: 'conflict' });
    const dto = JSON.stringify(await store.status(actor)); expect(dto).not.toContain(ID1); expect(dto).not.toContain('Sha256');
  });
  it.each([{ id: 'user_notmember0' }, { role: 'client' }, { email: 'other@example.test' }])('rejects a non-authoritative actor %#', async override => {
    await expect(store.issue({ ...actor, ...override })).rejects.toMatchObject({ code: 'blocked' });
    expect(fake.docs.has(PLAN)).toBe(false);
  });
  it.each([
    { expiresAt: new Date(NOW).toISOString() }, { expiresAt: new Date(NOW + 2 * 86_400_000).toISOString() },
    { cohortSha256: 'f'.repeat(64) }, { backupManifestSha256: 'invalid' }, { memberUserIds: [ID2, ID1] },
    { projectId: 'another-project' }, { extraAuthority: true },
  ])('rejects stale, changed or malformed review %#', async override => {
    fake.docs.set(REVIEW, { ...fake.docs.get(REVIEW), ...override });
    await expect(store.issue(actor)).rejects.toMatchObject({ code: 'blocked' });
  });
  it.each([{ role: 'client' }, { id: 'user_wrong_identity' }, { passwordHash: 'not-argon' }, { email: OWNER.toUpperCase() }])('rejects invalid cohort member %#', async override => {
    fake.docs.set(`users/${ID1}`, { ...fake.docs.get(`users/${ID1}`), ...override });
    await expect(store.issue(actor)).rejects.toMatchObject({ code: 'blocked' });
  });
  it('rejects cohort overflow and existing reservations without overwriting either', async () => {
    for (let n = 3; n <= WRITER_CONSOLIDATION_MAX_MEMBERS + 1; n++) fake.docs.set(`users/user_writer${String(n).padStart(4, '0')}`, user(`user_writer${String(n).padStart(4, '0')}`));
    await expect(store.issue(actor)).rejects.toMatchObject({ code: 'blocked' });
    fake = fakeFirestore(); seed(fake); store = new WriterIdentityConsolidationStore(() => fake.db, () => ENV);
    fake.docs.set(RESERVATION, { userId: ID1, createdAt: '2026-01-01T00:00:00.000Z' });
    await expect(store.issue(actor)).rejects.toMatchObject({ code: 'blocked' });
    expect(fake.docs.get(RESERVATION)?.userId).toBe(ID1);
  });
  it('accepts the complete observed 21-member cohort without truncating it', async () => {
    for (let n = 3; n <= 21; n++) {
      const id = `user_writer${String(n).padStart(4, '0')}`; fake.docs.set(`users/${id}`, user(id));
    }
    const rows = [...fake.docs.entries()].filter(([key]) => key.startsWith('users/'))
      .map(([key, data]) => ({ id: key.slice(6), data })).sort((a, b) => a.id.localeCompare(b.id));
    fake.docs.set(REVIEW, { ...fake.docs.get(REVIEW), memberUserIds: rows.map(row => row.id), cohortSha256: writerIdentityCohortSha256(rows) });
    expect(await store.status(actor)).toMatchObject({ status: 'ready', memberCount: 21, canIssue: true });
    const issued = await store.issue(actor);
    expect(fake.docs.get(PLAN)?.memberUserIds).toHaveLength(21);
    expect(issued.token).toMatch(WRITER_CONSOLIDATION_TOKEN_PATTERN);
  });
  it('permits isolated staging only with all four provider-off switches and actual SDK binding', async () => {
    const env = { ...ENV, VERCEL_ENV: 'preview', FIREBASE_PROJECT_ID: 'ink-witness-staging-20261024',
      MPESA_NETWORK_MODE: 'disabled', NEWSLETTER_ENABLED: 'false', AFFILIATE_NOTIFICATION_EVENT_MODE: 'off', AFFILIATE_NOTIFICATION_DELIVERY_MODE: 'off' };
    binding.target = { projectId: env.FIREBASE_PROJECT_ID, firestoreDatabaseId: '(default)' };
    fake.docs.set(REVIEW, { ...fake.docs.get(REVIEW), projectId: env.FIREBASE_PROJECT_ID });
    store = new WriterIdentityConsolidationStore(() => fake.db, () => env);
    expect((await store.status(actor)).canIssue).toBe(true);
    env.MPESA_NETWORK_MODE = 'live'; expect((await store.status(actor)).status).toBe('unavailable');
    binding.target = null; expect((await store.status(actor)).status).toBe('unavailable');
  });
});

describe('one-time activation and authoritative session fences', () => {
  it('atomically changes only canonical credentials and activates reservation/generation; replay cannot mutate anything', async () => {
    const alias = structuredClone(fake.docs.get(`users/${ID1}`)); const issued = await store.issue(actor);
    const consumed = await store.consume(issued.token, '$argon2id$new-owner-password', NEW_PASSWORD);
    expect(consumed?.user.id).toBe(ID2); expect(consumed?.identityGeneration).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(fake.docs.get(`users/${ID1}`)).toEqual(alias);
    expect(fake.docs.get(`users/${ID2}`)).toEqual({ ...user(ID2), passwordHash: '$argon2id$new-owner-password', updatedAt: new Date(NOW).toISOString() });
    expect(fake.docs.get(RESERVATION)).toEqual({ userId: ID2, createdAt: new Date(NOW).toISOString() });
    expect(fake.docs.get(PLAN)?.state).toBe('active'); expect(await store.isActive(issued.token)).toBe(false);
    expect(await store.consume(issued.token, '$argon2id$replayed', NEW_PASSWORD)).toBeNull();
    expect(await store.status(actor)).toMatchObject({ status: 'active', canIssue: false });
    const resolved = await resolveWriterIdentityByEmail(fake.db, OWNER, { env: ENV }); expect(resolved.kind).toBe('active');
    expect(await writerConsolidationSessionAllowed(fake.db, { userId: ID2, email: OWNER }, { env: ENV })).toBe(false);
    expect(await writerConsolidationSessionAllowed(fake.db, { userId: ID1, email: OWNER, writerIdentityGeneration: consumed!.identityGeneration }, { env: ENV })).toBe(false);
    expect(await writerConsolidationSessionAllowed(fake.db, { userId: ID1, email: 'historical@example.test' }, { env: ENV })).toBe(false);
    expect(await writerConsolidationSessionAllowed(fake.db, { userId: ID2, email: 'historical@example.test', writerIdentityGeneration: consumed!.identityGeneration }, { env: ENV })).toBe(false);
    expect(await writerConsolidationSessionAllowed(fake.db, { userId: ID2, email: OWNER, writerIdentityGeneration: consumed!.identityGeneration }, { env: ENV })).toBe(true);
  });
  it('blocks old-password login racing activation and forbids alias rebinding', async () => {
    const old = user(ID2); const issued = await store.issue(actor); const consumed = await store.consume(issued.token, '$argon2id$new', NEW_PASSWORD);
    const create = (verified: UserRecord) => fake.db.runTransaction(tx => resolveWriterIdentityForSessionCreation(fake.db, verified, tx, ENV));
    expect(await create(old)).toBeNull(); expect(await create(user(ID1))).toBeNull();
    expect(await create(consumed!.user)).toMatchObject({ writerIdentityGeneration: consumed!.identityGeneration });
  });
  it('preserves verified actor credential CAS before activation without choosing among duplicate rows', async () => {
    await store.issue(actor);
    const create = (verified: UserRecord) => fake.db.runTransaction(tx => resolveWriterIdentityForSessionCreation(fake.db, verified, tx, ENV));
    expect(await create(user(ID1))).toEqual({ user: user(ID1) });
    expect(await create(user(ID2))).toEqual({ user: user(ID2) });
    expect(await create({ ...user(ID2), passwordHash: '$argon2id$stale' })).toBeNull();
  });
  it('does not apply production target restrictions to unrelated identities in development', async () => {
    binding.target = null;
    expect(await resolveWriterIdentityByEmail(fake.db, 'reader@example.test', { env: {} })).toEqual({ kind: 'none' });
    expect(await writerConsolidationSessionAllowed(fake.db, { userId: 'user_reader0000', email: 'reader@example.test' }, { env: {} })).toBe(true);
  });
  it('requires the new hash to verify the submitted plaintext and forbids reuse of any historical password', async () => {
    const issued = await store.issue(actor); const before = structuredClone([...fake.docs.entries()]);
    passwords.verify.mockResolvedValueOnce(false);
    expect(await store.consume(issued.token, '$argon2id$new', NEW_PASSWORD)).toBeNull();
    passwords.verify.mockImplementation(async (hash: string) => hash === '$argon2id$new' || hash === user(ID1).passwordHash);
    expect(await store.consume(issued.token, '$argon2id$new', NEW_PASSWORD)).toBeNull();
    expect([...fake.docs.entries()]).toEqual(before); expect(JSON.stringify([...fake.docs.entries()])).not.toContain(NEW_PASSWORD);
  });
  it('rejects substituted pending member IDs before any account change', async () => {
    const issued = await store.issue(actor);
    fake.docs.get(PLAN)!.memberUserIds = [ID2, 'user_writer9999'];
    expect(await store.consume(issued.token, '$argon2id$new', NEW_PASSWORD)).toBeNull();
    expect(fake.docs.get(`users/${ID2}`)?.passwordHash).toBe(user(ID2).passwordHash);
  });
  it.each(['cohort', 'review', 'reservation'])('fails closed when %s changes after issuance', async changed => {
    const issued = await store.issue(actor);
    if (changed === 'cohort') fake.docs.set(`users/${ID1}`, { ...fake.docs.get(`users/${ID1}`), name: 'Concurrent change' });
    if (changed === 'review') fake.docs.set(REVIEW, { ...fake.docs.get(REVIEW), backupManifestSha256: 'c'.repeat(64) });
    if (changed === 'reservation') fake.docs.set(RESERVATION, { userId: ID1 });
    expect(await store.isActive(issued.token)).toBe(false); expect(await store.consume(issued.token, '$argon2id$new', NEW_PASSWORD)).toBeNull();
    expect(fake.docs.get(`users/${ID2}`)?.passwordHash).toBe(user(ID2).passwordHash);
  });
  it('does not activate on expired, reader-purpose, unsigned or malformed capabilities', async () => {
    const issued = await store.issue(actor); vi.setSystemTime(NOW + TTL);
    expect(await store.consume(issued.token, '$argon2id$new', NEW_PASSWORD)).toBeNull();
    for (const token of ['pr1_' + 'a'.repeat(43), 'wcr1_short', '', null]) expect(await store.isActive(token)).toBe(false);
    vi.setSystemTime(NOW);
    fake.docs.get(`writer_identity_reset_tokens/${hashWriterConsolidationToken(issued.token)}`)!.purpose = 'reader-password-reset';
    expect(await store.consume(issued.token, '$argon2id$new', NEW_PASSWORD)).toBeNull();
  });
  it('does not mutate accounts or activate when the commit fails', async () => {
    const issued = await store.issue(actor); const before = structuredClone([...fake.docs.entries()]); fake.setFailCommit(true);
    expect(await store.consume(issued.token, '$argon2id$new', NEW_PASSWORD)).toBeNull(); expect([...fake.docs.entries()]).toEqual(before);
  });
  it('rejects incoherent active marker/reservation and changed canonical credentials', async () => {
    const issued = await store.issue(actor); const result = await store.consume(issued.token, '$argon2id$new', NEW_PASSWORD);
    fake.docs.set(RESERVATION, { userId: ID1 });
    expect((await resolveWriterIdentityByEmail(fake.db, OWNER, { env: ENV })).kind).toBe('invalid');
    fake.docs.set(RESERVATION, { userId: ID2 }); fake.docs.get(`users/${ID2}`)!.passwordHash = '$argon2id$unreviewed';
    expect(await writerConsolidationSessionAllowed(fake.db, { userId: ID2, email: OWNER, writerIdentityGeneration: result!.identityGeneration }, { env: ENV })).toBe(false);
  });
  it('does not let historical-email cohort sessions bypass broken target or malformed membership', async () => {
    const issued = await store.issue(actor); await store.consume(issued.token, '$argon2id$new', NEW_PASSWORD);
    const old = { userId: ID1, email: 'historical@example.test' };
    binding.target = null;
    expect(await writerConsolidationSessionAllowed(fake.db, old, { env: ENV })).toBe(false);
    binding.target = { projectId: ENV.FIREBASE_PROJECT_ID!, firestoreDatabaseId: '(default)' };
    fake.docs.get(PLAN)!.memberUserIds = [ID2];
    expect(await writerConsolidationSessionAllowed(fake.db, old, { env: ENV })).toBe(false);
  });
});

describe('noncanonical ownership is never silently stranded', () => {
  it.each([
    ['reader_licenses', 'userId'], ['reader_subscriptions', 'userId'], ['subscription_activations', 'userId'],
    ['manual_access', 'boundUserId'], ['manual_access', 'claimedUserId'], ['manual_access_phone_reservations', 'boundUserId'],
    ['manual_access_entitlements', 'userId'], ['reader_profiles', 'userId'], ['piece_reviews', 'userId'],
    ['transactions', 'userId'], ['mpesa_callback_intents', 'userId'],
  ])('blocks %s.%s ownership at issuance and at consumption', async (collection, field) => {
    fake.docs.set(`${collection}/owned`, { [field]: ID1 });
    await expect(store.issue(actor)).rejects.toMatchObject({ code: 'blocked' });
    fake.docs.delete(`${collection}/owned`); const issued = await store.issue(actor);
    fake.docs.set(`${collection}/owned`, { [field]: ID1 });
    expect(await store.consume(issued.token, '$argon2id$new', NEW_PASSWORD)).toBeNull();
  });
  it('detects buyer.userId, hashed comments, derived profile/subscription documents and hash-only reactions', async () => {
    const specimens: Array<[string, Record<string, unknown>]> = [
      ['transactions/owned', { buyer: { userId: ID1 } }], ['comments/owned', { readerHash: `account_${sha(ID1).slice(0, 40)}` }],
      [`reader_profiles/${sha(ID1)}`, {}], [`reader_subscriptions/sub_${sha(ID1)}`, {}],
      [`reader_piece_reactions/${sha([ID1, 'piece1'].join('\u001f'))}`, { articleId: 'piece1' }],
    ];
    for (const [key, value] of specimens) {
      fake.docs.set(key, value); await expect(store.issue(actor)).rejects.toMatchObject({ code: 'blocked' }); fake.docs.delete(key);
    }
  });
  it('fails closed on reaction scan overflow and malformed records', async () => {
    fake.docs.set('reader_piece_reactions/bad', {}); await expect(store.issue(actor)).rejects.toMatchObject({ code: 'blocked' });
    fake.docs.delete('reader_piece_reactions/bad');
    for (let n = 0; n < 1001; n++) fake.docs.set(`reader_piece_reactions/${sha(String(n))}`, { articleId: 'piece' });
    await expect(store.issue(actor)).rejects.toMatchObject({ code: 'blocked' });
  });
  it.each(['', ' ', 'piece\ncontrol', 'x'.repeat(129)])('fails closed on noncanonical reaction article IDs %#', async articleId => {
    fake.docs.set(`reader_piece_reactions/${sha('bad-reaction')}`, { articleId });
    await expect(store.issue(actor)).rejects.toMatchObject({ code: 'blocked' });
  });
});
