import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => vi.stubGlobal('localStorage', { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe('manual partner email client contract', () => {
  it('sends only explicit message/audience data and credentials to the writer endpoints', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ campaign: { id: 'synthetic' }, complete: true }),
      { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const { api } = await import('./api.js');
    const input = { subject: 'Synthetic subject', body: 'Synthetic message', audience: 'selected' as const, affiliateIds: ['synthetic-partner'] };
    await api.getAdminAffiliateEmailOverview(); await api.previewAdminAffiliateEmail(input);
    await api.createAdminAffiliateEmail({ ...input, requestId: 'synthetic-intent-123456' });
    await api.sendAdminAffiliateEmail('campaign:one');
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual(['/api/admin/affiliates/email', '/api/admin/affiliates/email/preview',
      '/api/admin/affiliates/email/campaigns', '/api/admin/affiliates/email/campaigns/campaign%3Aone/send']);
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual(input);
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toEqual({ ...input, requestId: 'synthetic-intent-123456' });
    expect(JSON.parse(String(fetchMock.mock.calls[3][1]?.body))).toEqual({});
    for (const [, options] of fetchMock.mock.calls) expect(options).toMatchObject({ credentials: 'include', cache: 'no-store' });
  });

  it('does not retry failed send commands automatically', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ error: 'Synthetic uncertain send' }), { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    const { api } = await import('./api.js');
    await expect(api.sendAdminAffiliateEmail('synthetic-campaign')).rejects.toThrow('uncertain');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
