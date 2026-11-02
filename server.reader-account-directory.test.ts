import http, { type Server } from 'http';
import type { AddressInfo } from 'net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.NODE_ENV = 'test';
  process.env.VERCEL = '1';
  process.env.SESSION_SIGNING_SECRET = 'reader-directory-route-test-secret-with-32-plus-characters';
});

const fixture = vi.hoisted(() => {
  const writer = { id: 'user_writer0001', role: 'admin', name: 'Writer', email: 'writer@example.test' };
  const reader = { id: 'user_reader0001', role: 'client', name: 'Reader One', email: 'reader@example.test',
    passwordHash: 'private-reader-password-hash', createdAt: '2026-10-01T00:00:00.000Z' };
  const accounts = new Map<string, any>([
    [`users/${writer.id}`, writer], [`users/${reader.id}`, reader],
    ['users/legacy-reader', { role: 'client', name: 'Legacy Reader', email: 'legacy@example.test' }],
  ]);
  const snapshot = (path: string) => ({ id: path.split('/').pop()!, exists: accounts.has(path),
    data: () => accounts.has(path) ? { ...accounts.get(path) } : undefined });
  const collection = vi.fn((name: string) => {
    function query(filters: [string, unknown][]=[], maximum = Infinity, after = ''): any {
      const rows = () => [...accounts.entries()].filter(([path, value]) => path.startsWith(`${name}/`)
        && filters.every(([field, expected]) => value[field] === expected)).sort(([a], [b]) => a.localeCompare(b));
      return {
        doc: (id: string) => ({ path: `${name}/${id}`, get: async () => snapshot(`${name}/${id}`) }),
        where: (field: string, operator: string, value: unknown) => {
          if (operator !== '==') throw new Error('Unexpected fixture query');
          return query([...filters, [field, value]], maximum, after);
        },
        orderBy: () => query(filters, maximum, after),
        limit: (value: number) => query(filters, value, after),
        startAfter: (id: string) => query(filters, maximum, id),
        count: () => ({ get: async () => ({ data: () => ({ count: rows().length }) }) }),
        get: async () => ({ docs: rows().filter(([path]) => path.split('/').pop()! > after)
          .slice(0, maximum).map(([path]) => snapshot(path)) }),
      };
    }
    return query();
  });
  const forbiddenWrite = vi.fn(() => { throw new Error('Directory requests must never write data'); });
  const db = { collection, getAll: async (...refs: { path: string }[]) => refs.map(ref => snapshot(ref.path)),
    runTransaction: forbiddenWrite };
  const session = (user: typeof writer | typeof reader) => ({ storageVersion: 2, userId: user.id,
    role: user.role, email: user.email, name: user.name, createdAt: Date.now() - 1000, expiresAt: Date.now() + 60_000 });
  const writerCookie = `iw_session=sess_${'b'.repeat(64)}`;
  const readerCookie = `iw_session=sess_${'c'.repeat(64)}`;
  const licenses = [{ articleId: 'piece_old', phone: '254700000001' }];
  return { writer, reader, db, collection, forbiddenWrite, session, writerCookie, readerCookie, licenses };
});

const storeMocks = vi.hoisted(() => {
  const known = {
    init: vi.fn(async () => undefined),
    getAuthSession: vi.fn(),
    ensureReaderLicensesHydrated: vi.fn(async () => undefined),
    getReaderLicenses: vi.fn(() => fixture.licenses),
  };
  const fallback = new Map<PropertyKey, ReturnType<typeof vi.fn>>();
  return new Proxy(known as Record<PropertyKey, any>, {
    get(target, property) {
      if (property in target) return target[property];
      if (!fallback.has(property)) fallback.set(property, vi.fn());
      return fallback.get(property);
    },
  });
});

vi.mock('./src/server/store.js', () => ({
  HomepageSaveConflictError: class HomepageSaveConflictError extends Error {}, store: storeMocks,
}));
vi.mock('./src/server/db.js', () => ({
  getDb: () => fixture.db,
  getAllFirestoreDocs: vi.fn(async () => []),
  getFirestoreDoc: vi.fn(async () => null),
  setFirestoreDoc: fixture.forbiddenWrite,
  replaceFirestoreDoc: fixture.forbiddenWrite,
  updateFirestoreDoc: fixture.forbiddenWrite,
  deleteFirestoreDoc: fixture.forbiddenWrite,
  sanitizeForFirestore: (value: unknown) => value,
  getFirestoreClientTarget: vi.fn(() => null),
  resolveFirestoreTargetConfig: vi.fn(),
}));

import { createApp } from './server.js';

describe('full server reader account directory routing', () => {
  let server: Server;
  let baseUrl: string;
  beforeAll(async () => {
    storeMocks.getAuthSession.mockImplementation(async (token: string) => token === fixture.writerCookie.split('=')[1]
      ? fixture.session(fixture.writer) : token === fixture.readerCookie.split('=')[1] ? fixture.session(fixture.reader) : null);
    server = http.createServer(await createApp());
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 60_000);
  beforeEach(() => { vi.clearAllMocks(); });
  afterAll(async () => {
    if (server?.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });

  it('reaches the registered account handler and preserves the separate legacy licence API', async () => {
    const headers = { cookie: fixture.writerCookie };
    const response = await fetch(`${baseUrl}/api/admin/reader-accounts`, { headers });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vercel-cdn-cache-control')).toBe('no-store');
    const body = await response.json();
    expect(body).toMatchObject({ success: true, directory: { totalReaderAccounts: 2, matchingReaderAccounts: 2 } });
    expect(body.directory.readers.map((account: any) => account.email).sort()).toEqual(['legacy@example.test', fixture.reader.email]);
    expect(body.directory.readers.find((account: any) => account.id === fixture.reader.id)?.status).toBe('active');
    expect(body.directory.readers.find((account: any) => account.id === 'legacy-reader')?.status).toBe('unavailable');
    expect(JSON.stringify(body)).not.toMatch(/passwordHash|private-reader-password|writer@example|licenses/);
    expect(storeMocks.getReaderLicenses).not.toHaveBeenCalled();

    const legacy = await fetch(`${baseUrl}/api/admin/readers`, { headers });
    expect(legacy.status).toBe(200);
    expect(await legacy.json()).toEqual({ count: 1, licenses: fixture.licenses });
    expect(storeMocks.ensureReaderLicensesHydrated).toHaveBeenCalledOnce();
    expect(storeMocks.getReaderLicenses).toHaveBeenCalledOnce();
    expect(fixture.forbiddenWrite).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated and reader sessions before reading the directory', async () => {
    for (const [cookie, status] of [[undefined, 401], [fixture.readerCookie, 403]] as const) {
      const response = await fetch(`${baseUrl}/api/admin/reader-accounts`, { headers: cookie ? { cookie } : {} });
      expect(response.status).toBe(status);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(await response.json()).toMatchObject({ success: false });
    }
    expect(fixture.collection).not.toHaveBeenCalled();
    expect(storeMocks.getReaderLicenses).not.toHaveBeenCalled();
    expect(fixture.forbiddenWrite).not.toHaveBeenCalled();
  });
});
