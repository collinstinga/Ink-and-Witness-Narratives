import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthSession, UserRecord } from '../types.js';
vi.mock('firebase-admin/firestore', () => ({ FieldPath: { documentId: () => '__name__' } }));
import { getReaderAccountSessionGeneration, listReaderAccounts, readerAccountSecurityId, readerAccountSessionAllowed,
  READER_ACCOUNT_AUDIT_COLLECTION, READER_ACCOUNT_SECURITY_COLLECTION, registerReaderAccountAdminRoutes, setReaderAccountStatus } from './readerAccountAdmin.js';
import { normalizeAuthSessionRecord } from './sessionSecurity.js';

const WRITER = { id: 'user_writer0001', role: 'admin', email: 'writer@example.com' };
const READER: UserRecord = { id: 'user_reader0001', role: 'client', name: 'Reader One', email: 'reader@example.com',
  passwordHash: '$argon2id$private', createdAt: '2026-10-01T00:00:00.000Z' };
const SESSION: AuthSession = { storageVersion: 2, userId: READER.id, role: 'client', email: READER.email,
  name: READER.name, createdAt: Date.now(), expiresAt: Date.now() + 60_000 };
const copy = <T>(value: T): T => value === undefined ? value : JSON.parse(JSON.stringify(value));
function fixture() {
  const docs = new Map<string, any>([['users/' + WRITER.id, { ...WRITER }], ['users/' + READER.id, copy(READER)]]);
  const reads: any[] = []; const writes: any[] = [];
  let failCommit = false;
  const snapshot = (path: string) => ({ id: path.split('/').pop()!, exists: docs.has(path), data: () => copy(docs.get(path)) });
  const collection = (name: string) => {
    function query(filters: any[] = [], limit = Infinity, after = ''): any {
      const rows = () => [...docs.entries()].filter(([path, value]) => path.startsWith(name + '/')
        && filters.every(([field, op, match]) => op === '==' && value[field] === match))
        .sort(([left], [right]) => left.localeCompare(right));
      return {
        where: (field: string, op: string, value: any) => query([...filters, [field, op, value]], limit, after),
        orderBy: (field: string) => { expect(field).toBe('__name__'); return query(filters, limit, after); },
        limit: (value: number) => query(filters, value, after),
        startAfter: (value: string) => query(filters, limit, value),
        count: () => ({ get: async () => { reads.push({ aggregate: name, filters }); return { data: () => ({ count: rows().length }) }; } }),
        get: async () => { reads.push({ query: name, limit, filters, after }); return { docs: rows().filter(([path]) => path.split('/').pop()! > after).slice(0, limit).map(([path]) => snapshot(path)) }; },
        doc: (id: string) => ({ path: `${name}/${id}`, get: async () => { reads.push({ doc: `${name}/${id}` }); return snapshot(`${name}/${id}`); } }),
      };
    }
    return query();
  };
  const db: any = { collection, getAll: async (...refs: any[]) => { reads.push({ getAll: refs.map(ref => ref.path) }); return refs.map(ref => snapshot(ref.path)); },
    runTransaction: async (callback: any) => {
      const pending: any[] = []; let writing = false;
      const result = await callback({ get: async (ref: any) => { if (writing) throw new Error('read after write'); reads.push({ transactionGet: ref.path }); return snapshot(ref.path); },
        set: (ref: any, value: any) => { writing = true; pending.push([ref.path, copy(value), false]); },
        create: (ref: any, value: any) => { writing = true; pending.push([ref.path, copy(value), true]); } });
      if (failCommit) throw new Error('simulated commit failure');
      for (const [path, value, create] of pending) { if (create && docs.has(path)) throw new Error('exists'); docs.set(path, value); writes.push([path, value]); }
      return result;
    } };
  return { db, docs, reads, writes, fail: () => { failCommit = true; }, snapshot };
}

describe('writer reader directory and suspension', () => {
  let h: ReturnType<typeof fixture>;
  beforeEach(() => { h = fixture(); });
  it('returns an exact role-scoped aggregate and bounded pages without passwords, tokens or writer accounts', async () => {
    h.docs.set('users/user_reader0002', { ...READER, id: 'user_reader0002', email: 'second@example.com', name: 'Second', privateField: 'private' });
    const first = await listReaderAccounts(h.db, WRITER, { pageSize: 1 });
    expect(first.totalReaderAccounts).toBe(2); expect(first.readers).toHaveLength(1); expect(first.nextCursor).toBeTruthy();
    const second = await listReaderAccounts(h.db, WRITER, { pageSize: 1, cursor: first.nextCursor });
    expect(second.readers[0].id).not.toBe(first.readers[0].id); expect(second.nextCursor).toBeUndefined();
    expect(JSON.stringify([first, second])).not.toMatch(/passwordHash|argon2|privateField|sessionGeneration|writer@example/);
    expect(h.reads.filter(read => read.query).every(read => read.limit === 2 && read.filters[0][2] === 'client')).toBe(true);
    expect(h.reads.some(read => read.aggregate === 'users')).toBe(true); expect(h.writes).toHaveLength(0);
  });
  it('supports exact normalized email without a full-collection client filter', async () => {
    h.docs.set('users/user_reader0002', { ...READER, id: 'user_reader0002', email: 'second@example.com' });
    const result = await listReaderAccounts(h.db, WRITER, { email: ' READER@example.com ' });
    expect(result).toMatchObject({ totalReaderAccounts: 2, matchingReaderAccounts: 1 }); expect(result.readers.map(row => row.email)).toEqual([READER.email]);
    expect(h.reads.filter(read => read.query)[0].filters).toContainEqual(['email', '==', READER.email]);
  });
  it('preserves legacy missing IDs and isolates malformed historical records instead of hiding the directory', async () => {
    delete h.docs.get('users/' + READER.id).id;
    h.docs.set('users/user_reader0002', { ...READER, id: 'wrong-account' });
    h.docs.set('users/legacy-account', { ...READER, id: 'legacy-account' });
    const result = await listReaderAccounts(h.db, WRITER);
    expect(result.totalReaderAccounts).toBe(3);
    expect(result.readers.find(row => row.id === READER.id)?.status).toBe('active');
    expect(result.readers.filter(row => row.status === 'unavailable')).toHaveLength(2);
    expect(await readerAccountSessionAllowed(h.db, SESSION)).toBe(true);
  });
  it('preserves mixed-case and outer-space historical reader and writer emails using existing login normalization', async () => {
    h.docs.get('users/' + WRITER.id).email = '  WRITER@Example.com  ';
    h.docs.get('users/' + READER.id).email = '  READER@Example.com  ';
    const transaction = { get: async (ref: any) => h.snapshot(ref.path) } as any;
    expect(await getReaderAccountSessionGeneration(h.db, READER, transaction)).toBeUndefined();
    expect(await readerAccountSessionAllowed(h.db, SESSION)).toBe(true);
    expect(await readerAccountSessionAllowed(h.db, { ...SESSION, email: ' READER@EXAMPLE.COM ' })).toBe(true);
    expect((await listReaderAccounts(h.db, { ...WRITER, email: ' WRITER@EXAMPLE.COM ' })).totalReaderAccounts).toBe(1);
    const changed = await setReaderAccountStatus(h.db, WRITER, READER.id, { status: 'suspended', expectedRevision: 0 });
    expect(changed.reader.status).toBe('suspended');
    expect(h.docs.get('users/' + READER.id).email).toBe('  READER@Example.com  ');
    expect(h.docs.get('users/' + WRITER.id).email).toBe('  WRITER@Example.com  ');
  });
  it('does not normalize different identities together or accept malformed and overlong identity fields', async () => {
    const transaction = { get: async (ref: any) => h.snapshot(ref.path) } as any;
    h.docs.get('users/' + READER.id).email = 'another@example.com';
    expect(await readerAccountSessionAllowed(h.db, SESSION)).toBe(false);
    await expect(getReaderAccountSessionGeneration(h.db, READER, transaction)).rejects.toMatchObject({ statusCode: 401 });
    h.docs.get('users/' + READER.id).email = ' '.repeat(1025) + READER.email;
    expect(await readerAccountSessionAllowed(h.db, SESSION)).toBe(false);
    await expect(listReaderAccounts(h.db, { ...WRITER, email: '' })).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each([{ pageSize: 0 }, { pageSize: 51 }, { pageSize: '2.5' }, { cursor: Buffer.from('../users').toString('base64url') }, { email: 'not-email' }])('rejects invalid query input before reads: %j', async input => {
    await expect(listReaderAccounts(h.db, WRITER, input)).rejects.toMatchObject({ statusCode: 400 }); expect(h.reads).toHaveLength(0);
  });
  it('uses a fresh writer role and never lets a reader list identities or suspend the writer', async () => {
    await expect(listReaderAccounts(h.db, { ...WRITER, role: 'client' })).rejects.toMatchObject({ statusCode: 403 });
    h.docs.get('users/' + WRITER.id).role = 'client';
    await expect(listReaderAccounts(h.db, WRITER)).rejects.toMatchObject({ statusCode: 403 });
    h.docs.get('users/' + WRITER.id).role = 'admin';
    await expect(setReaderAccountStatus(h.db, WRITER, WRITER.id, { status: 'suspended', expectedRevision: 0 })).rejects.toMatchObject({ statusCode: 404 });
    expect(h.writes).toHaveLength(0);
  });
  it('suspends atomically with an audit and no changes to credentials, purchases, grants or financial history', async () => {
    const original = copy([...h.docs.entries()]);
    h.docs.set('reader_licenses/paid', { userId: READER.id, receipt: 'original' });
    const result = await setReaderAccountStatus(h.db, WRITER, READER.id, { status: 'suspended', expectedRevision: 0, reason: 'Writer review' });
    expect(result).toMatchObject({ changed: true, reader: { status: 'suspended', revision: 1, suspensionReason: 'Writer review' } });
    for (const [path, value] of original) expect(h.docs.get(path)).toEqual(value);
    expect(h.docs.get('reader_licenses/paid')).toEqual({ userId: READER.id, receipt: 'original' });
    expect(h.writes).toHaveLength(2); expect(h.writes.every(([path]) => path.startsWith(READER_ACCOUNT_SECURITY_COLLECTION) || path.startsWith(READER_ACCOUNT_AUDIT_COLLECTION))).toBe(true);
    const audit = h.writes.find(([path]) => path.startsWith(READER_ACCOUNT_AUDIT_COLLECTION))[1];
    expect(audit).toMatchObject({ actorUserId: WRITER.id, readerUserId: READER.id, previousStatus: 'active', status: 'suspended', revision: 1 });
    expect(JSON.stringify(result)).not.toContain('sessionGeneration'); expect(JSON.stringify(audit)).not.toMatch(/passwordHash|sessionGeneration|reader@example/);
  });
  it('does not acknowledge partial persistence, stale edits or forged extra fields', async () => {
    h.fail();
    await expect(setReaderAccountStatus(h.db, WRITER, READER.id, { status: 'suspended', expectedRevision: 0 })).rejects.toThrow('simulated');
    expect(h.writes).toHaveLength(0); expect(h.docs.has(`${READER_ACCOUNT_SECURITY_COLLECTION}/${readerAccountSecurityId(READER.id)}`)).toBe(false);
    await expect(setReaderAccountStatus(h.db, WRITER, READER.id, { status: 'suspended', expectedRevision: 9 })).rejects.toMatchObject({ statusCode: 409 });
    await expect(setReaderAccountStatus(h.db, WRITER, READER.id, { status: 'suspended', expectedRevision: 0, role: 'admin' })).rejects.toMatchObject({ statusCode: 400 });
  });
  it('immediately denies old sessions and sign-in; reactivation cannot resurrect previous sessions', async () => {
    expect(await readerAccountSessionAllowed(h.db, SESSION)).toBe(true);
    await setReaderAccountStatus(h.db, WRITER, READER.id, { status: 'suspended', expectedRevision: 0 });
    expect(await readerAccountSessionAllowed(h.db, SESSION)).toBe(false);
    const transaction = { get: async (ref: any) => h.snapshot(ref.path) } as any;
    await expect(getReaderAccountSessionGeneration(h.db, READER, transaction)).rejects.toMatchObject({ statusCode: 403 });
    await setReaderAccountStatus(h.db, WRITER, READER.id, { status: 'active', expectedRevision: 1 });
    expect(await readerAccountSessionAllowed(h.db, SESSION)).toBe(false);
    const generation = await getReaderAccountSessionGeneration(h.db, READER, transaction);
    expect(generation).toMatch(/^[a-f0-9]{64}$/);
    expect(await readerAccountSessionAllowed(h.db, { ...SESSION, readerAccountGeneration: generation })).toBe(true);
    expect(normalizeAuthSessionRecord({ ...SESSION, readerAccountGeneration: generation })).toMatchObject({ readerAccountGeneration: generation });
    expect(normalizeAuthSessionRecord({ ...SESSION, readerAccountGeneration: 'invalid' })).toBeNull();
    expect(normalizeAuthSessionRecord({ ...SESSION, role: 'admin', readerAccountGeneration: generation })).toBeNull();
  });
  it('rechecks identity and verified credentials inside session creation and fails closed on malformed security', async () => {
    const transaction = { get: async (ref: any) => h.snapshot(ref.path) } as any;
    h.docs.get('users/' + READER.id).passwordHash = '$argon2id$newer';
    await expect(getReaderAccountSessionGeneration(h.db, READER, transaction)).rejects.toMatchObject({ statusCode: 401 });
    h.docs.set(`${READER_ACCOUNT_SECURITY_COLLECTION}/${readerAccountSecurityId(READER.id)}`, { status: 'active' });
    await expect(readerAccountSessionAllowed(h.db, SESSION)).rejects.toMatchObject({ statusCode: 503 });
    const page = await listReaderAccounts(h.db, WRITER); expect(page.readers[0].status).toBe('unavailable');
    await expect(setReaderAccountStatus(h.db, WRITER, READER.id, { status: 'suspended', expectedRevision: 0 })).rejects.toMatchObject({ statusCode: 503 });
  });
  it('does not rotate or audit a no-op and rejects stale retries after a confirmed change', async () => {
    expect((await setReaderAccountStatus(h.db, WRITER, READER.id, { status: 'active', expectedRevision: 0 })).changed).toBe(false);
    expect(h.writes).toHaveLength(0);
    await setReaderAccountStatus(h.db, WRITER, READER.id, { status: 'suspended', expectedRevision: 0 });
    const count = h.writes.length;
    await expect(setReaderAccountStatus(h.db, WRITER, READER.id, { status: 'suspended', expectedRevision: 0 })).rejects.toMatchObject({ statusCode: 409 });
    expect(h.writes).toHaveLength(count);
  });
  it('registers role and write guards ahead of private routes, keeping status writes off public endpoints', () => {
    const routes: any[] = []; const admin = vi.fn(); const writeGuard = vi.fn();
    registerReaderAccountAdminRoutes({ get: (path: string, ...handlers: any[]) => routes.push(['get', path, handlers]), patch: (path: string, ...handlers: any[]) => routes.push(['patch', path, handlers]) } as any,
      { getDb: () => h.db, requireAdminAuth: admin, writeGuard });
    expect(routes[0].slice(0, 2)).toEqual(['get', '/api/admin/readers']); expect(routes[0][2][1]).toBe(admin);
    expect(routes[1].slice(0, 2)).toEqual(['patch', '/api/admin/readers/:id/status']); expect(routes[1][2].slice(1, 3)).toEqual([admin, writeGuard]);
    const headers = new Map(); const next = vi.fn();
    routes[0][2][0]({}, { setHeader: (key: string, value: string) => headers.set(key, value) }, next);
    expect(headers.get('Cache-Control')).toBe('private, no-store'); expect(headers.get('Vercel-CDN-Cache-Control')).toBe('no-store'); expect(next).toHaveBeenCalledOnce();
  });
});
