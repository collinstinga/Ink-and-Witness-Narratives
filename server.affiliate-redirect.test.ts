import http, { Server } from 'http';
import { AddressInfo } from 'net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.VERCEL = '1';
  process.env.NODE_ENV = 'test';
  process.env.SESSION_SIGNING_SECRET = 'affiliate-click-dedup-test-secret-with-32-plus-characters';
});

const affiliateMocks = vi.hoisted(() => ({
  getAffiliateByCode: vi.fn(),
  registerClick: vi.fn()
}));

const storeMocks = vi.hoisted(() => {
  const known = {
    init: vi.fn(async () => undefined),
    affiliates: affiliateMocks
  };
  const fallback = new Map<PropertyKey, ReturnType<typeof vi.fn>>();
  return new Proxy(known as Record<PropertyKey, any>, {
    get(target, property) {
      if (property in target) return target[property];
      if (!fallback.has(property)) fallback.set(property, vi.fn());
      return fallback.get(property);
    }
  });
});

vi.mock('./src/server/store.js', () => ({ store: storeMocks }));
vi.mock('./src/server/affiliateStore.js', () => ({
  affiliateStore: affiliateMocks,
  sanitizeAffiliateForResponse: (value: unknown) => value
}));
vi.mock('./src/server/affiliateCredentials.js', () => ({
  generateAffiliateTemporaryPassword: vi.fn(),
  hashAffiliatePassword: vi.fn(),
  rehashVerifiedAffiliatePassword: vi.fn(),
  validateAffiliatePasswordStrength: vi.fn(() => ({ valid: true })),
  verifyAffiliatePassword: vi.fn()
}));
vi.mock('./src/server/publicWriteSecurity.js', () => ({
  publicWriteValidators: new Proxy({}, {
    get: () => (_req: unknown, _res: unknown, next: () => void) => next()
  })
}));
vi.mock('./src/server/mpesa.js', () => ({
  initiateStkPush: vi.fn(),
  handleDarajaCallback: vi.fn(),
  queryPaymentStatus: vi.fn(),
  verifyManualReceipt: vi.fn(),
  getDarajaAccessToken: vi.fn(),
  formatKenyanPhone: vi.fn((value: unknown) => String(value || '')),
  maskPhone: vi.fn(() => '254700***001')
}));

import { createApp } from './server.js';

describe('affiliate redirect route', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = await createApp();
    server = http.createServer(app);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  }, 60_000);

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    affiliateMocks.getAffiliateByCode.mockReturnValue({
      affiliateCode: 'PARTNER_7',
      status: 'active',
      linksDisabled: false
    });
    affiliateMocks.registerClick.mockReturnValue({
      valid: true,
      affiliate: { name: 'Test Partner' }
    });
  });

  async function requestRedirect(path: string): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      redirect: 'manual',
      headers: {
        'user-agent': 'affiliate-redirect-regression-test',
        referer: 'https://share.example.test/'
      }
    });
  }

  function getRelativeRedirect(response: Response): URL {
    const location = response.headers.get('location');
    expect(location).toBeTruthy();
    expect(location).toMatch(/^\//);
    return new URL(location!, baseUrl);
  }

  it('lands a homepage link on the homepage and records exactly one click', async () => {
    const response = await requestRedirect('/api/affiliate/redirect/PARTNER_7');
    const target = getRelativeRedirect(response);

    expect(response.status).toBe(302);
    expect(target.pathname).toBe('/');
    expect(Object.fromEntries(target.searchParams)).toEqual({
      ref: 'PARTNER_7'
    });
    expect(response.headers.get('set-cookie')).toContain('iw_affiliate_click_dedup=');
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(response.headers.get('set-cookie')).toContain('SameSite=Lax');
    expect(response.headers.get('set-cookie')).toContain('Path=/api/affiliate/click');
    expect(affiliateMocks.registerClick).toHaveBeenCalledTimes(1);
    expect(affiliateMocks.registerClick).toHaveBeenCalledWith(
      'PARTNER_7',
      undefined,
      undefined,
      expect.stringMatching(/^[a-f0-9]{16}$/),
      'affiliate-redirect-regression-test',
      'https://share.example.test/'
    );
  });

  it('lands a piece link on the selected article and records it once', async () => {
    const response = await requestRedirect('/api/affiliate/redirect/PARTNER_7?article=piece_42');
    const target = getRelativeRedirect(response);

    expect(response.status).toBe(302);
    expect(target.pathname).toBe('/');
    expect(Object.fromEntries(target.searchParams)).toEqual({
      ref: 'PARTNER_7',
      article: 'piece_42'
    });
    expect(affiliateMocks.registerClick).toHaveBeenCalledTimes(1);
    expect(affiliateMocks.registerClick.mock.calls[0]?.slice(0, 3)).toEqual([
      'PARTNER_7',
      'piece_42',
      undefined
    ]);
  });

  it('preserves a campaign link while landing on the homepage and records it once', async () => {
    const response = await requestRedirect('/api/affiliate/redirect/PARTNER_7?c=launch_2026');
    const target = getRelativeRedirect(response);

    expect(response.status).toBe(302);
    expect(target.pathname).toBe('/');
    expect(Object.fromEntries(target.searchParams)).toEqual({
      ref: 'PARTNER_7',
      c: 'launch_2026'
    });
    expect(affiliateMocks.registerClick).toHaveBeenCalledTimes(1);
    expect(affiliateMocks.registerClick.mock.calls[0]?.slice(0, 3)).toEqual([
      'PARTNER_7',
      undefined,
      'launch_2026'
    ]);
  });

  it('drops unsafe article and campaign targets instead of reflecting them', async () => {
    const unsafeArticle = encodeURIComponent('https://evil.example.test/read');
    const unsafeCampaign = encodeURIComponent('launch%0d%0aLocation:https://evil.example.test');
    const response = await requestRedirect(
      `/api/affiliate/redirect/PARTNER_7?article=${unsafeArticle}&c=${unsafeCampaign}`
    );
    const target = getRelativeRedirect(response);

    expect(response.status).toBe(302);
    expect(Object.fromEntries(target.searchParams)).toEqual({
      ref: 'PARTNER_7'
    });
    expect(response.headers.get('location')).not.toContain('evil.example.test');
    expect(affiliateMocks.registerClick).toHaveBeenCalledTimes(1);
    expect(affiliateMocks.registerClick.mock.calls[0]?.slice(0, 3)).toEqual([
      'PARTNER_7',
      undefined,
      undefined
    ]);
  });

  it('rejects an unsafe affiliate code without recording a click', async () => {
    const response = await requestRedirect('/api/affiliate/redirect/PARTNER.7');

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/');
    expect(affiliateMocks.getAffiliateByCode).not.toHaveBeenCalled();
    expect(affiliateMocks.registerClick).not.toHaveBeenCalled();
  });

  it('consumes a matching signed cookie without recording the redirect click twice', async () => {
    const redirect = await requestRedirect(
      '/api/affiliate/redirect/PARTNER_7?article=piece_42&c=launch_2026'
    );
    const cookiePair = redirect.headers.get('set-cookie')?.split(';')[0];

    expect(cookiePair).toMatch(/^iw_affiliate_click_dedup=/);
    expect(affiliateMocks.registerClick).toHaveBeenCalledTimes(1);

    const response = await fetch(`${baseUrl}/api/affiliate/click`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: cookiePair!
      },
      body: JSON.stringify({
        ref: 'partner_7',
        articleId: 'piece_42',
        campaign: 'launch_2026'
      })
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, deduplicated: true });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('set-cookie')).toContain('iw_affiliate_click_dedup=;');
    expect(response.headers.get('set-cookie')).toContain('Path=/api/affiliate/click');
    expect(affiliateMocks.registerClick).toHaveBeenCalledTimes(1);
  });

  it('does not deduplicate a cookie whose article does not match the submitted click', async () => {
    const redirect = await requestRedirect('/api/affiliate/redirect/PARTNER_7?article=piece_42');
    const cookiePair = redirect.headers.get('set-cookie')?.split(';')[0];
    affiliateMocks.registerClick.mockClear();

    const response = await fetch(`${baseUrl}/api/affiliate/click`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: cookiePair!
      },
      body: JSON.stringify({ ref: 'partner_7', articleId: 'piece_43' })
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, deduplicated: false });
    expect(response.headers.get('set-cookie')).toContain('iw_affiliate_click_dedup=;');
    expect(affiliateMocks.registerClick).toHaveBeenCalledTimes(1);
    expect(affiliateMocks.registerClick.mock.calls[0]?.slice(0, 3)).toEqual([
      'partner_7',
      'piece_43',
      undefined
    ]);
  });
});
