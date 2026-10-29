import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => { vi.stubGlobal('localStorage', { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() }); });
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
describe('private reader account administration client', () => {
  it('loads bounded pages and exact-email filters with credentialed no-store requests', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ success: true, directory: {} }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { api } = await import('./api.js');
    await api.getAdminReaderAccounts({ email: 'reader@example.com', cursor: 'cursor-value', pageSize: 25 });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/readers?cursor=cursor-value&pageSize=25&email=reader%40example.com');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: 'no-store', credentials: 'include' });
    expect(localStorage.setItem).not.toHaveBeenCalled();
  });
  it('sends only the explicit status and reviewed revision to the dedicated route', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ success: true, changed: true, reader: {} }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { api } = await import('./api.js');
    await api.setAdminReaderAccountStatus('user_reader0001', { status: 'suspended', expectedRevision: 2, reason: 'Writer review' });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/readers/user_reader0001/status');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'PATCH', credentials: 'include', cache: 'no-store' });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ status: 'suspended', expectedRevision: 2, reason: 'Writer review' });
  });
  it('does not retry an uncertain write or store reader identities in browser persistence', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => { throw new Error('synthetic network failure'); });
    vi.stubGlobal('fetch', fetchMock);
    const { api } = await import('./api.js');
    await expect(api.setAdminReaderAccountStatus('user_reader0001', { status: 'active', expectedRevision: 3 })).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledOnce(); expect(localStorage.setItem).not.toHaveBeenCalled();
  });
});
