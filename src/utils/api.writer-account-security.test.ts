import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './api.js';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
}
describe('writer account security API client', () => {
  beforeEach(() => {
    const local = new MemoryStorage(); local.setItem('ink_writer_session_active', '1');
    vi.stubGlobal('localStorage', local);
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  it('reads readiness with signed cookie authentication, no cache and an abortable read only', async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({ success: true, security: { status: 'review_required', memberCount: 4, canIssue: false } }) }));
    vi.stubGlobal('fetch', fetch); const controller = new AbortController();
    await api.getWriterAccountSecurity({ signal: controller.signal });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('/api/admin/account-security'); expect(init.cache).toBe('no-store'); expect(init.credentials).toBe('include');
    expect(init.signal).toBe(controller.signal); expect(init.headers).toMatchObject({ 'x-admin-token': 'cookie-session' }); expect(init.body).toBeUndefined();
  });
  it('sends an exact empty request with no client-selected identity, recipient, URL or password', async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({ success: true, recovery: { status: 'pending', expiresAt: 100000, delivery: 'accepted' } }) }));
    vi.stubGlobal('fetch', fetch);
    await (api.requestWriterAccountRecovery as any)({ actor: 'spoof', email: 'spoof@example.test', token: 'PRIVATE', password: 'PRIVATE' });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('/api/admin/account-security/password-recovery'); expect(init.method).toBe('POST'); expect(init.cache).toBe('no-store');
    expect(init.credentials).toBe('include'); expect(init.body).toBe('{}'); expect(init.headers).toMatchObject({ 'x-admin-token': 'cookie-session', 'Content-Type': 'application/json' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
