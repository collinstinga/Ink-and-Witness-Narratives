import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) || null,
    setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
});
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe('compact affiliate payout status API', () => {
  it('requests only bounded explicit IDs with the secure cookie and no browser/shared cache', async () => {
    const payload = { success: true, payouts: [{ id: 'payout:one', status: 'APPROVED' }] };
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(payload), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { api, setAffiliateToken } = await import('./api.js'); setAffiliateToken('cookie-session');
    expect(await api.getAffiliatePayoutStatuses(['payout:one'])).toEqual(payload);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/affiliate/payouts/status?ids=payout%3Aone', expect.objectContaining({
      credentials: 'include', cache: 'no-store', headers: { 'x-affiliate-token': 'cookie-session' },
    }));
  });

  it('rejects missing authentication, unsafe IDs or oversized batches without requests', async () => {
    const fetchMock = vi.fn<typeof fetch>(); vi.stubGlobal('fetch', fetchMock);
    const { api, setAffiliateToken } = await import('./api.js');
    await expect(api.getAffiliatePayoutStatuses(['payout_one'])).rejects.toThrow(/log in/);
    setAffiliateToken('cookie-session');
    for (const ids of [[], ['../private'], ['same', 'same'], Array.from({ length: 11 }, (_, i) => `payout_${i}`)]) {
      await expect(api.getAffiliatePayoutStatuses(ids)).rejects.toThrow(/10 distinct/);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
