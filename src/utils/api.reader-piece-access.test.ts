import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) || null,
    setItem: vi.fn((key: string, value: string) => storage.set(key, value)), removeItem: vi.fn((key: string) => storage.delete(key)) });
});
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe('writer grants a selected reader account one piece', () => {
  it('uses the dedicated account-scoped route with cookie authentication and a strict, credential-free body', async () => {
    const payload = { success: true, grant: { articleId: 'piece:chapter-one', createdAt: '2026-10-29T08:00:00.000Z' }, changed: true };
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(payload), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { api, setWriterToken } = await import('./api.js'); setWriterToken('cookie-session');
    const writesBefore = vi.mocked(localStorage.setItem).mock.calls.length;
    expect(await api.grantReaderAccountPieceAccess('user_reader0001', {
      articleId: 'piece:chapter-one', email: 'never-forward@example.invalid', userId: 'user_other0001',
      role: 'admin', phone: '254700000001', password: 'never-forward',
    } as any)).toEqual(payload);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/admin/readers/user_reader0001/piece-access', expect.objectContaining({
      method: 'POST', credentials: 'include', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'x-admin-token': 'cookie-session' },
      body: JSON.stringify({ articleId: 'piece:chapter-one' }),
    }));
    expect(vi.mocked(localStorage.setItem).mock.calls).toHaveLength(writesBefore);
    expect(String(fetchMock.mock.calls[0][1]?.body)).not.toMatch(/email|phone|password|role|userId/);
  });

  it.each(['', '../users', 'user_short', 'user_reader0001/private', ' user_reader0001', 'user_' + 'x'.repeat(121)])('rejects unsafe or unsupported reader IDs before requesting: %j', async userId => {
    const fetchMock = vi.fn<typeof fetch>(); vi.stubGlobal('fetch', fetchMock);
    const { api } = await import('./api.js');
    await expect(api.grantReaderAccountPieceAccess(userId, { articleId: 'piece-one' })).rejects.toThrow(/valid registered reader/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['', 'all', '../private', 'piece/one', 'piece one', ' piece-one ', 'x'.repeat(129), null, undefined])('rejects invalid piece IDs before requesting: %j', async articleId => {
    const fetchMock = vi.fn<typeof fetch>(); vi.stubGlobal('fetch', fetchMock);
    const { api } = await import('./api.js');
    await expect(api.grantReaderAccountPieceAccess('user_reader0001', { articleId } as any)).rejects.toThrow(/valid piece/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts the existing public identifier bounds, including one-character and 128-character IDs', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ success: true, changed: false, grant: {} }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { api } = await import('./api.js');
    for (const articleId of ['a', 'x'.repeat(128), 'piece.2026:chapter-1_2']) {
      await api.grantReaderAccountPieceAccess('user_reader0001', { articleId });
      expect(JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body))).toEqual({ articleId });
    }
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not automatically retry an uncertain grant write or persist reader details', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => { throw new Error('Synthetic uncertain connection'); });
    vi.stubGlobal('fetch', fetchMock);
    const { api } = await import('./api.js');
    await expect(api.grantReaderAccountPieceAccess('user_reader0001', { articleId: 'piece-one' })).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledOnce(); expect(localStorage.setItem).not.toHaveBeenCalled();
  });

  it('surfaces a protected-route denial without a fallback or second request', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ success: false, error: 'Writer authentication required.' }), { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);
    const { api } = await import('./api.js');
    await expect(api.grantReaderAccountPieceAccess('user_reader0001', { articleId: 'piece-one' })).rejects.toThrow(/Writer authentication required/);
    expect(fetchMock).toHaveBeenCalledOnce(); expect(localStorage.setItem).not.toHaveBeenCalled();
  });
});
