import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('firebase-admin/firestore', () => ({ FieldPath: { documentId: () => '__name__' } }));
import { ReaderAccountAdminError, readerAccountSecurityId } from './readerAccountAdmin.js';
import { grantReaderAccountPieceAccess, hasReaderAccountPieceAccess, listReaderAccountPieceAccess,
  MAX_READER_PIECE_ACCESS_GRANTS, readerAccountPieceAccessId, READER_PIECE_ACCESS_AUDIT_COLLECTION,
  READER_PIECE_ACCESS_COLLECTION, registerReaderAccountPieceAccessRoutes } from './readerAccountPieceAccess.js';

const WRITER = { id: 'user_writer0001', role: 'admin', email: 'writer@example.com' };
const READER = { id: 'user_reader0001', role: 'client', email: 'reader@example.com', name: 'Reader', passwordHash: 'private-reader-credential' };
const OTHER = { ...READER, id: 'user_reader0002', email: 'other@example.com' };
const ARTICLE = { id: 'art_piece-one', status: 'published', title: 'Published piece', content: 'Private full text', priceKes: 100 };
const copy = <T>(value: T): T => value === undefined ? value : JSON.parse(JSON.stringify(value));
function fixture() {
  const documents = new Map<string, any>(); const versions = new Map<string, number>();
  const reads: any[] = [], writes: any[] = [];
  const state = { failCommit: false, beforeCommit: null as (() => void) | null };
  const seed = (path: string, value: any) => { documents.set(path, copy(value)); versions.set(path, (versions.get(path) || 0) + 1); };
  for (const [path, value] of [['users/' + WRITER.id, WRITER], ['users/' + READER.id, READER], ['users/' + OTHER.id, OTHER], ['articles/' + ARTICLE.id, ARTICLE]] as const) seed(path, value);
  const snapshot = (path: string) => ({ id: path.split('/').pop()!, exists: documents.has(path), data: () => copy(documents.get(path)) });
  const collection = (name: string) => {
    const query = (filters: any[] = [], maximum = Infinity): any => ({
      doc: (id: string) => ({ path: `${name}/${id}`, get: async () => { reads.push({ doc: `${name}/${id}` }); return snapshot(`${name}/${id}`); } }),
      where: (key: string, op: string, value: any) => query([...filters, [key, op, value]], maximum),
      limit: (value: number) => query(filters, value),
      get: async () => { reads.push({ query: name, filters, maximum }); return { docs: [...documents.entries()]
        .filter(([path, value]) => path.startsWith(name + '/') && filters.every(([field, op, match]) => op === '==' && value[field] === match))
        .slice(0, maximum).map(([path]) => snapshot(path)) }; },
    });
    return query();
  };
  const db: any = { collection, runTransaction: async (callback: any) => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const observed = new Map<string, number>(), pending: Array<[string, any]> = [];
      let writing = false;
      const result = await callback({ get: async (reference: any) => {
        if (writing) throw new Error('Transaction read after write'); reads.push({ transactionGet: reference.path });
        observed.set(reference.path, versions.get(reference.path) || 0); return snapshot(reference.path);
      }, create: (reference: any, value: any) => { writing = true; pending.push([reference.path, copy(value)]); } });
      if (state.beforeCommit) { const hook = state.beforeCommit; state.beforeCommit = null; hook(); }
      if ([...observed].some(([path, version]) => (versions.get(path) || 0) !== version)) continue;
      if (state.failCommit) throw new Error('SDK failure containing private backend details');
      for (const [path] of pending) if (documents.has(path)) throw new Error('Create conflict');
      for (const [path, value] of pending) { seed(path, value); writes.push([path, value]); }
      return result;
    }
    throw new Error('Synthetic transaction exhausted retries');
  } };
  return { db, documents, reads, writes, seed, state };
}
const grantPath = (user = READER.id, article = ARTICLE.id) => `${READER_PIECE_ACCESS_COLLECTION}/${readerAccountPieceAccessId(user, article)}`;
const validGrant = () => ({ schemaVersion: 1, userId: READER.id, articleId: ARTICLE.id, accessSource: 'MANUAL_GRANT',
  createdAt: '2026-10-29T00:00:00.000Z', createdBy: WRITER.id });

describe('selected-reader complimentary piece access', () => {
  let h: ReturnType<typeof fixture>;
  beforeEach(() => { h = fixture(); });
  it('creates account-and-piece-specific access atomically with a private audit, not a purchase or phone grant', async () => {
    h.seed('reader_licenses/paid-original', { userId: READER.id, receipt: 'Original paid receipt' });
    h.seed('transactions/paid-original', { amountKes: 100, status: 'CONFIRMED' });
    const original = copy([...h.documents.entries()]);
    const result = await grantReaderAccountPieceAccess(h.db, WRITER, READER.id, { articleId: ARTICLE.id });
    expect(result).toMatchObject({ changed: true, grant: { articleId: ARTICLE.id, createdAt: expect.any(String) } });
    expect(h.documents.get(grantPath())).toMatchObject({ ...validGrant(), createdAt: result.grant.createdAt });
    for (const [path, value] of original) expect(h.documents.get(path)).toEqual(value);
    expect(h.writes).toHaveLength(2);
    expect(h.writes.every(([path]) => path.startsWith(READER_PIECE_ACCESS_COLLECTION + '/') || path.startsWith(READER_PIECE_ACCESS_AUDIT_COLLECTION + '/'))).toBe(true);
    const audit = h.writes.find(([path]) => path.startsWith(READER_PIECE_ACCESS_AUDIT_COLLECTION + '/'))[1];
    expect(audit).toMatchObject({ action: 'reader_account_piece_granted', actorUserId: WRITER.id, readerUserId: READER.id, articleId: ARTICLE.id });
    expect(JSON.stringify(result)).not.toMatch(/reader@example|writer@example|password|content|createdBy|MANUAL_GRANT|receipt/);
    expect(JSON.stringify(audit)).not.toMatch(/password|content|receipt|@example/);
  });
  it('makes repeat and concurrent grants idempotent without changing creation time or adding audits', async () => {
    const results = await Promise.all([1, 2].map(() => grantReaderAccountPieceAccess(h.db, WRITER, READER.id, { articleId: ARTICLE.id })));
    expect(results.filter(result => result.changed)).toHaveLength(1); expect(h.writes).toHaveLength(2);
    const createdAt = results[0].grant.createdAt;
    expect(results[1].grant.createdAt).toBe(createdAt);
    expect(await grantReaderAccountPieceAccess(h.db, WRITER, READER.id, { articleId: ARTICLE.id })).toEqual({ changed: false, grant: { articleId: ARTICLE.id, createdAt } });
    expect(h.writes).toHaveLength(2);
  });
  it('does not acknowledge a failed commit or expose SDK/credential details', async () => {
    h.state.failCommit = true;
    await expect(grantReaderAccountPieceAccess(h.db, WRITER, READER.id, { articleId: ARTICLE.id })).rejects.toMatchObject({ statusCode: 503 });
    try { await grantReaderAccountPieceAccess(h.db, WRITER, READER.id, { articleId: ARTICLE.id }); }
    catch (error) { expect((error as Error).message).not.toContain('private backend'); }
    expect(h.writes).toHaveLength(0); expect(h.documents.has(grantPath())).toBe(false);
  });
  it.each([null, [], {}, { articleId: 'all' }, { articleId: '*' }, { articleId: '../article' }, { articleId: 'a'.repeat(129) },
    { articleId: ARTICLE.id, userId: OTHER.id }, { articleId: ARTICLE.id, phone: '0700000000' }, { articleId: ARTICLE.id, token: 'copyable' }])('rejects invalid or expanded input before any SDK reads: %j', async input => {
    await expect(grantReaderAccountPieceAccess(h.db, WRITER, READER.id, input)).rejects.toMatchObject({ statusCode: 400 });
    expect(h.reads).toHaveLength(0); expect(h.writes).toHaveLength(0);
  });
  it('checks the fresh writer and reader roles without promoting or altering legacy users', async () => {
    await expect(grantReaderAccountPieceAccess(h.db, { ...READER, role: 'admin' }, OTHER.id, { articleId: ARTICLE.id })).rejects.toMatchObject({ statusCode: 403 });
    await expect(grantReaderAccountPieceAccess(h.db, WRITER, WRITER.id, { articleId: ARTICLE.id })).rejects.toMatchObject({ statusCode: 404 });
    const legacy = { ...READER }; delete (legacy as any).id; h.seed('users/' + READER.id, legacy);
    h.seed('users/' + WRITER.id, { ...WRITER, email: ' WRITER@EXAMPLE.COM ' });
    expect((await grantReaderAccountPieceAccess(h.db, WRITER, READER.id, { articleId: ARTICLE.id })).changed).toBe(true);
    expect(h.documents.get('users/' + READER.id)).toEqual(legacy);
  });
  it('fails closed for suspended or malformed account security without changing it', async () => {
    const path = `reader_account_security/${readerAccountSecurityId(READER.id)}`;
    h.seed(path, { schemaVersion: 1, userId: READER.id, status: 'suspended', revision: 1,
      sessionGeneration: 'a'.repeat(64), updatedAt: '2026-10-29T00:00:00.000Z', updatedBy: WRITER.id, reason: 'Writer review' });
    await expect(grantReaderAccountPieceAccess(h.db, WRITER, READER.id, { articleId: ARTICLE.id })).rejects.toMatchObject({ statusCode: 409 });
    h.seed(path, { status: 'active' });
    await expect(grantReaderAccountPieceAccess(h.db, WRITER, READER.id, { articleId: ARTICLE.id })).rejects.toMatchObject({ statusCode: 503 });
    expect(h.writes).toHaveLength(0);
  });
  it.each(['draft', 'scheduled', 'deleted'])('never grants %s pieces or a fabricated catalogue-wide identifier', async status => {
    h.seed('articles/' + ARTICLE.id, { ...ARTICLE, status });
    await expect(grantReaderAccountPieceAccess(h.db, WRITER, READER.id, { articleId: ARTICLE.id })).rejects.toMatchObject({ statusCode: 404 });
    expect(h.writes).toHaveLength(0);
  });
  it('rechecks publish state when it changes during the transaction', async () => {
    h.state.beforeCommit = () => h.seed('articles/' + ARTICLE.id, { ...ARTICLE, status: 'draft' });
    await expect(grantReaderAccountPieceAccess(h.db, WRITER, READER.id, { articleId: ARTICLE.id })).rejects.toMatchObject({ statusCode: 404 });
    expect(h.writes).toHaveLength(0);
  });
  it('does not overwrite a conflicting/malformed existing access record', async () => {
    h.seed(grantPath(), { ...validGrant(), userId: OTHER.id });
    await expect(grantReaderAccountPieceAccess(h.db, WRITER, READER.id, { articleId: ARTICLE.id })).rejects.toBeInstanceOf(ReaderAccountAdminError);
    expect(h.documents.get(grantPath()).userId).toBe(OTHER.id); expect(h.writes).toHaveLength(0);
  });
  it('uses fresh exact grants, without email/phone fallback, shared wildcard or positive caching', async () => {
    expect(await hasReaderAccountPieceAccess(h.db, READER.id, ARTICLE.id)).toBe(false);
    h.seed(grantPath(), validGrant());
    expect(await hasReaderAccountPieceAccess(h.db, READER.id, ARTICLE.id)).toBe(true);
    expect(await hasReaderAccountPieceAccess(h.db, OTHER.id, ARTICLE.id)).toBe(false);
    expect(await hasReaderAccountPieceAccess(h.db, READER.id, 'another-piece')).toBe(false);
    h.seed(grantPath(), { ...validGrant(), accessSource: 'MPESA_PURCHASE' });
    await expect(hasReaderAccountPieceAccess(h.db, READER.id, ARTICLE.id)).rejects.toMatchObject({ statusCode: 503 });
  });
  it('keeps unsupported legacy IDs eligible for existing fallback paths without reading Firestore', async () => {
    expect(await hasReaderAccountPieceAccess(h.db, 'reader_one', ARTICLE.id)).toBe(false);
    expect(await hasReaderAccountPieceAccess(h.db, READER.id, 'all')).toBe(false);
    expect(await listReaderAccountPieceAccess(h.db, 'reader_one')).toEqual([]);
    expect(h.reads).toHaveLength(0);
  });
  it('queries only the exact account with a strict overflow sentinel and returns minimal library metadata', async () => {
    h.seed(grantPath(), validGrant());
    const result = await listReaderAccountPieceAccess(h.db, READER.id);
    expect(result).toEqual([{ articleId: ARTICLE.id, createdAt: validGrant().createdAt }]);
    expect(h.reads[0]).toEqual({ query: READER_PIECE_ACCESS_COLLECTION, filters: [['userId', '==', READER.id]], maximum: MAX_READER_PIECE_ACCESS_GRANTS + 1 });
    for (let index = 0; index <= MAX_READER_PIECE_ACCESS_GRANTS; index++) {
      const articleId = `overflow-${index}`;
      h.seed(`${READER_PIECE_ACCESS_COLLECTION}/${readerAccountPieceAccessId(READER.id, articleId)}`, { ...validGrant(), articleId });
    }
    await expect(listReaderAccountPieceAccess(h.db, READER.id)).rejects.toMatchObject({ statusCode: 503 });
  });
  it('registers private response, writer authentication and write guards before the action', async () => {
    let route: any[] = []; const requireAdminAuth = vi.fn(), writeGuard = vi.fn();
    registerReaderAccountPieceAccessRoutes({ post: (...args: any[]) => { route = args; } } as any, { getDb: () => h.db, requireAdminAuth, writeGuard });
    expect(route[0]).toBe('/api/admin/readers/:id/piece-access'); expect(route[2]).toBe(requireAdminAuth); expect(route[3]).toBe(writeGuard);
    const headers = new Map(); const next = vi.fn();
    route[1]({}, { setHeader: (key: string, value: string) => headers.set(key, value) }, next);
    expect(headers.get('Cache-Control')).toBe('private, no-store'); expect(headers.get('CDN-Cache-Control')).toBe('no-store'); expect(headers.get('Vercel-CDN-Cache-Control')).toBe('no-store');
    expect(next).toHaveBeenCalledOnce();
    const res: any = { status: vi.fn(function (code: number) { this.code = code; return this; }), json: vi.fn(function (body: any) { this.body = body; return this; }) };
    await route[4]({ params: { id: READER.id }, query: { email: 'spoof@example.com' }, body: { articleId: ARTICLE.id }, user: WRITER }, res);
    expect(res.code).toBe(400); expect(h.writes).toHaveLength(0);
  });
});
