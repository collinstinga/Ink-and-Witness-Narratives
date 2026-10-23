import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './api.js';

describe('writer campaign API contract', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'ink_writer_session_active' ? '1' : null, setItem: vi.fn(), removeItem: vi.fn() });
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  function mockResponse(body: unknown) {
    const request = vi.fn(async () => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => body }));
    vi.stubGlobal('fetch', request);
    return request;
  }

  it('loads the authoritative campaign list without browser caching and with writer authentication', async () => {
    const fetch = mockResponse([{ id: 'existing', revision: 6 }]);
    expect(await api.getAdminAffiliateCampaigns()).toEqual({ campaigns: [{ id: 'existing', revision: 6 }] });
    const [url, options] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/admin/affiliates/campaigns');
    expect(options).toMatchObject({ cache: 'no-store', headers: { 'x-admin-token': 'cookie-session' } });
  });

  it('sends the exact campaign ID and optimistic revision for an edit', async () => {
    const fetch = mockResponse({ success: true, campaign: { id: 'existing', revision: 7 } });
    const update = { id: 'existing', revision: 6, code: 'CIRCLE', name: 'Updated circle', isActive: false };
    await api.saveAdminAffiliateCampaign(update);
    const [, options] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(options.method).toBe('POST');
    expect(JSON.parse(String(options.body))).toEqual(update);
  });

  it('preserves the legacy endpoint while sending the revision for a preservation-safe pause', async () => {
    const fetch = mockResponse({ success: true });
    await api.deleteAdminAffiliateCampaign('campaign-one', 8);
    const [url, options] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/admin/affiliates/campaigns/campaign-one');
    expect(options.method).toBe('DELETE');
    expect(options.headers).toMatchObject({ 'Content-Type': 'application/json', 'x-admin-token': 'cookie-session' });
    expect(JSON.parse(String(options.body))).toEqual({ revision: 8 });
  });
});
