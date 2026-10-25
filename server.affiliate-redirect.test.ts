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
  getAffiliateForLoginFresh: vi.fn(),
  getSettingsFresh: vi.fn(),
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
  AffiliateClickLedgerUnavailableError: class AffiliateClickLedgerUnavailableError extends Error {},
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
import { verifyAffiliateAttributionCookie } from './src/server/affiliateAttributionSecurity.js';

const originalClickLedgerEnvironment = {
  AFFILIATE_CLICK_LEDGER_MODE: process.env.AFFILIATE_CLICK_LEDGER_MODE,
  AFFILIATE_CLICK_ANALYTICS_SECRET: process.env.AFFILIATE_CLICK_ANALYTICS_SECRET,
};
const CLICK_LEDGER_SECRET = 'affiliate-click-route-test-secret-with-more-than-32-characters';

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
    for (const [key, value] of Object.entries(originalClickLedgerEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.AFFILIATE_CLICK_LEDGER_MODE;
    delete process.env.AFFILIATE_CLICK_ANALYTICS_SECRET;
    affiliateMocks.getAffiliateByCode.mockReturnValue({
      affiliateCode: 'PARTNER_7',
      status: 'active',
      linksDisabled: false
    });
    affiliateMocks.getAffiliateForLoginFresh.mockResolvedValue({
      affiliateCode: 'PARTNER_7', name: 'Current Partner', status: 'active', linksDisabled: false,
      passwordHash: 'PRIVATE-PASSWORD-HASH', sessionVersion: 'PRIVATE-SESSION-GENERATION',
      email: 'private@example.invalid', balanceAvailableKes: 999, payoutDetails: { bankAccountNumber: 'PRIVATE-PAYOUT' },
    });
    affiliateMocks.getSettingsFresh.mockResolvedValue({ defaultCommissionRate: 17 });
    affiliateMocks.registerClick.mockImplementation((_code, _articleId, campaign) => ({
      valid: true,
      affiliate: { affiliateCode: 'PARTNER_7', name: 'Test Partner' },
      campaign: campaign ? { code: String(campaign).toUpperCase() } : undefined
    }));
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

  function getSetCookieHeaders(response: Response): string[] {
    const headers = response.headers as Headers & { getSetCookie?: () => string[] };
    const individual = headers.getSetCookie?.();
    if (individual && individual.length > 0) return individual;
    const combined = response.headers.get('set-cookie');
    return combined ? [combined] : [];
  }

  function findCookie(response: Response, name: string): string | undefined {
    return getSetCookieHeaders(response).find(value => value.startsWith(`${name}=`));
  }

  it.each(['/api/affiliate/validate/PARTNER_7', '/api/affiliate/validate-ref?code=partner_7'])(
    'validates newly shared partners from current records using %s without a startup-cache prerequisite', async path => {
      affiliateMocks.getAffiliateByCode.mockReturnValue(undefined);
      const response = await fetch(`${baseUrl}${path}`);
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toContain('no-store');
      expect(response.headers.get('cdn-cache-control')).toBe('no-store');
      expect(await response.json()).toEqual({ valid: true, code: 'PARTNER_7', name: 'Current Partner', affiliateName: 'Current Partner', commissionRate: 17 });
      expect(affiliateMocks.getAffiliateForLoginFresh).toHaveBeenCalledWith(expect.stringMatching(/^partner_7$/i));
      expect(affiliateMocks.getAffiliateByCode).not.toHaveBeenCalled();
      expect(affiliateMocks.registerClick).not.toHaveBeenCalled();
      expect(response.headers.get('set-cookie')).toBeNull();
    },
  );

  it.each([{ status: 'suspended' }, { status: 'pending' }, { linksDisabled: true }])(
    'rejects current referral state %j even when the startup cache says active', async current => {
      affiliateMocks.getAffiliateForLoginFresh.mockResolvedValueOnce({ affiliateCode: 'PARTNER_7', status: 'active', linksDisabled: false, ...current });
      const response = await fetch(`${baseUrl}/api/affiliate/validate/PARTNER_7`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ valid: false });
      expect(affiliateMocks.getSettingsFresh).not.toHaveBeenCalled();
      expect(affiliateMocks.getAffiliateByCode).not.toHaveBeenCalled();
      expect(response.headers.get('set-cookie')).toBeNull();
    },
  );

  it('does not substitute a stale account or reveal backend details when shared validation fails', async () => {
    affiliateMocks.getAffiliateForLoginFresh.mockRejectedValueOnce(new Error('PRIVATE-PROVIDER-DETAILS'));
    const response = await fetch(`${baseUrl}/api/affiliate/validate/PARTNER_7`);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ valid: false, error: 'Referral validation is temporarily unavailable. Please retry.' });
    expect(affiliateMocks.getAffiliateByCode).not.toHaveBeenCalled();
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('does not revive an unknown or removed referral from its cached profile', async () => {
    affiliateMocks.getAffiliateForLoginFresh.mockResolvedValueOnce(undefined);
    const response = await fetch(`${baseUrl}/api/affiliate/validate/PARTNER_7`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ valid: false });
    expect(affiliateMocks.getAffiliateByCode).not.toHaveBeenCalled();
    expect(affiliateMocks.getSettingsFresh).not.toHaveBeenCalled();
  });

  it('does not display a cached default rate after the current settings read fails', async () => {
    affiliateMocks.getSettingsFresh.mockRejectedValueOnce(new Error('PRIVATE-SETTINGS-PROVIDER'));
    const response = await fetch(`${baseUrl}/api/affiliate/validate/PARTNER_7`);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ valid: false, error: 'Referral validation is temporarily unavailable. Please retry.' });
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it.each(['', 'code=not%40an-email.test', 'code=PARTNER_7&code=OTHER', 'code=bad%2Fcode', `code=${'A'.repeat(65)}`])(
    'rejects malformed public code query %s before shared database reads', async query => {
      const response = await fetch(`${baseUrl}/api/affiliate/validate-ref?${query}`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ valid: false });
      expect(affiliateMocks.getAffiliateForLoginFresh).not.toHaveBeenCalled();
      expect(affiliateMocks.getSettingsFresh).not.toHaveBeenCalled();
    },
  );

  it('retains an explicit current partner rate without a redundant programme-settings read', async () => {
    affiliateMocks.getAffiliateForLoginFresh.mockResolvedValueOnce({ affiliateCode: 'PARTNER_7', name: 'Current Partner', status: 'active', customCommissionRate: 22 });
    const response = await fetch(`${baseUrl}/api/affiliate/validate/PARTNER_7`);
    expect(await response.json()).toMatchObject({ valid: true, commissionRate: 22 });
    expect(affiliateMocks.getSettingsFresh).not.toHaveBeenCalled();
  });

  it('keeps redirect tracking on its existing fresh transaction without a startup identity preflight', async () => {
    affiliateMocks.getAffiliateByCode.mockReturnValue(undefined);
    affiliateMocks.getAffiliateForLoginFresh.mockResolvedValue(undefined);
    const response = await requestRedirect('/r/PARTNER_7?article=piece_42');
    expect(response.status).toBe(302);
    expect(getRelativeRedirect(response).searchParams.get('article')).toBe('piece_42');
    expect(affiliateMocks.registerClick).toHaveBeenCalledTimes(1);
    expect(affiliateMocks.getAffiliateByCode).not.toHaveBeenCalled();
    expect(affiliateMocks.getAffiliateForLoginFresh).not.toHaveBeenCalled();
  });

  it('lands a homepage link on the homepage and records exactly one click', async () => {
    const response = await requestRedirect('/api/affiliate/redirect/PARTNER_7');
    const target = getRelativeRedirect(response);

    expect(response.status).toBe(302);
    expect(target.pathname).toBe('/');
    expect(Object.fromEntries(target.searchParams)).toEqual({
      ref: 'PARTNER_7'
    });
    const cookies = response.headers.get('set-cookie');
    expect(cookies).toContain('iw_affiliate_click_dedup=');
    expect(cookies).toContain('iw_affiliate_attribution=');
    expect(cookies).toContain('HttpOnly');
    expect(cookies).toContain('SameSite=Lax');
    expect(cookies).toContain('Path=/api/affiliate/click');
    expect(cookies).toContain('Path=/');
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

  it('normalizes the piece alias to the legacy-compatible article landing parameter', async () => {
    const response = await requestRedirect('/api/affiliate/redirect/PARTNER_7?piece=piece_43');
    const target = getRelativeRedirect(response);

    expect(Object.fromEntries(target.searchParams)).toEqual({
      ref: 'PARTNER_7',
      article: 'piece_43'
    });
    expect(affiliateMocks.registerClick.mock.calls[0]?.slice(0, 3)).toEqual([
      'PARTNER_7',
      'piece_43',
      undefined
    ]);
  });

  it.each([
    ['collection', 'collection_healing', 'collection:collection_healing'],
    ['bundle', 'bundle_healing_pair', 'bundle:bundle_healing_pair'],
    ['subscription', 'first-chapter-3-months', 'subscription:first-chapter-3-months']
  ] as const)(
    'lands a %s link on its selected destination and signs its canonical tracking target',
    async (queryKey, destinationId, canonicalTrackingTarget) => {
      const response = await requestRedirect(
        `/api/affiliate/redirect/PARTNER_7?${queryKey}=${destinationId}&c=launch_2026`
      );
      const target = getRelativeRedirect(response);

      expect(Object.fromEntries(target.searchParams)).toEqual({
        ref: 'PARTNER_7',
        [queryKey]: destinationId,
        c: 'LAUNCH_2026'
      });
      expect(affiliateMocks.registerClick.mock.calls[0]?.slice(0, 3)).toEqual([
        'PARTNER_7',
        canonicalTrackingTarget,
        'launch_2026'
      ]);

      const cookieHeader = response.headers.get('set-cookie') || '';
      const signedAttribution = cookieHeader.match(/iw_affiliate_attribution=([^;,]+)/)?.[1];
      expect(signedAttribution).toBeTruthy();
      expect(verifyAffiliateAttributionCookie(
        signedAttribution,
        'a-later-eligible-purchase',
        {
          allowCrossArticle: true,
          signingSecret: process.env.SESSION_SIGNING_SECRET
        }
      )).toMatchObject({
        ref: 'partner_7',
        articleId: canonicalTrackingTarget,
        campaign: 'launch_2026'
      });
    }
  );

  it('fails an ambiguous multi-destination link closed to homepage attribution', async () => {
    const response = await requestRedirect(
      '/api/affiliate/redirect/PARTNER_7?article=piece_42&bundle=bundle_healing_pair'
    );
    const target = getRelativeRedirect(response);

    expect(Object.fromEntries(target.searchParams)).toEqual({ ref: 'PARTNER_7' });
    expect(affiliateMocks.registerClick.mock.calls[0]?.slice(0, 3)).toEqual([
      'PARTNER_7',
      undefined,
      undefined
    ]);
  });

  it('preserves a safe destination without referral data when the affiliate is unavailable', async () => {
    affiliateMocks.registerClick.mockResolvedValueOnce({ valid: false });

    const response = await requestRedirect(
      '/api/affiliate/redirect/PARTNER_7?bundle=bundle_healing_pair'
    );
    const target = getRelativeRedirect(response);

    expect(Object.fromEntries(target.searchParams)).toEqual({
      bundle: 'bundle_healing_pair'
    });
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('preserves a campaign link while landing on the homepage and records it once', async () => {
    const response = await requestRedirect('/api/affiliate/redirect/PARTNER_7?c=launch_2026');
    const target = getRelativeRedirect(response);

    expect(response.status).toBe(302);
    expect(target.pathname).toBe('/');
    expect(Object.fromEntries(target.searchParams)).toEqual({
      ref: 'PARTNER_7',
      c: 'LAUNCH_2026'
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

  it('deduplicates the canonical target submitted after a bundle landing', async () => {
    const redirect = await requestRedirect(
      '/api/affiliate/redirect/PARTNER_7?bundle=starter_bundle&c=launch_2026'
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
        articleId: 'bundle:starter_bundle',
        campaign: 'launch_2026'
      })
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, deduplicated: true });
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

  it('issues a private durable visitor cookie only after a valid shadow-mode referral', async () => {
    process.env.AFFILIATE_CLICK_LEDGER_MODE = 'shadow';
    process.env.AFFILIATE_CLICK_ANALYTICS_SECRET = CLICK_LEDGER_SECRET;

    const response = await requestRedirect('/api/affiliate/redirect/PARTNER_7?article=piece_42');
    const visitorCookie = findCookie(response, 'iw_affiliate_click_visitor');

    expect(response.status).toBe(302);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(visitorCookie).toMatch(/^iw_affiliate_click_visitor=aff_vis_v1\./);
    expect(visitorCookie).toContain('Max-Age=7776000');
    expect(visitorCookie).toContain('Path=/');
    expect(visitorCookie).toContain('HttpOnly');
    expect(visitorCookie).toContain('SameSite=Lax');
    expect(visitorCookie).not.toContain('Domain=');
    expect(affiliateMocks.registerClick).toHaveBeenCalledWith(
      'PARTNER_7',
      'piece_42',
      undefined,
      expect.stringMatching(/^[a-f0-9]{16}$/),
      'affiliate-redirect-regression-test',
      'https://share.example.test/',
      {
        durableMode: 'shadow',
        visitorKey: expect.stringMatching(/^acv1_[A-Za-z0-9_-]{43}$/),
      }
    );
  });

  it('reuses a valid visitor pseudonym without extending its embedded expiry', async () => {
    process.env.AFFILIATE_CLICK_LEDGER_MODE = 'shadow';
    process.env.AFFILIATE_CLICK_ANALYTICS_SECRET = CLICK_LEDGER_SECRET;
    const first = await requestRedirect('/api/affiliate/redirect/PARTNER_7?article=piece_42');
    const visitorCookie = findCookie(first, 'iw_affiliate_click_visitor');
    expect(visitorCookie).toBeTruthy();
    const cookiePair = visitorCookie!.split(';')[0];
    const firstVisitorKey = affiliateMocks.registerClick.mock.calls[0]?.[6]?.visitorKey;
    affiliateMocks.registerClick.mockClear();

    const response = await fetch(`${baseUrl}/api/affiliate/click`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: cookiePair,
        origin: baseUrl,
        'sec-fetch-site': 'same-origin',
      },
      body: JSON.stringify({ ref: 'partner_7', articleId: 'piece_43' })
    });

    expect(response.status).toBe(200);
    expect(findCookie(response, 'iw_affiliate_click_visitor')).toBeUndefined();
    expect(affiliateMocks.registerClick).toHaveBeenCalledTimes(1);
    expect(affiliateMocks.registerClick.mock.calls[0]?.[6]).toEqual({
      durableMode: 'shadow',
      visitorKey: firstVisitorKey,
    });
  });

  it('rejects cross-site referral POSTs without touching the affiliate store', async () => {
    const response = await fetch(`${baseUrl}/api/affiliate/click`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://attacker.example.test',
        'sec-fetch-site': 'cross-site',
      },
      body: JSON.stringify({ ref: 'partner_7', articleId: 'piece_42' })
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ success: false });
    expect(affiliateMocks.registerClick).not.toHaveBeenCalled();
  });

  it('fails required durable mode closed when the dedicated secret is absent', async () => {
    process.env.AFFILIATE_CLICK_LEDGER_MODE = 'required';
    delete process.env.AFFILIATE_CLICK_ANALYTICS_SECRET;

    const response = await fetch(`${baseUrl}/api/affiliate/click`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: baseUrl,
        'sec-fetch-site': 'same-origin',
      },
      body: JSON.stringify({ ref: 'partner_7', articleId: 'piece_42' })
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'Referral tracking is temporarily unavailable. Please retry.'
    });
    expect(affiliateMocks.registerClick).not.toHaveBeenCalled();
    expect(findCookie(response, 'iw_affiliate_click_visitor')).toBeUndefined();
  });

  it('does not persist a visitor cookie for an invalid affiliate', async () => {
    process.env.AFFILIATE_CLICK_LEDGER_MODE = 'shadow';
    process.env.AFFILIATE_CLICK_ANALYTICS_SECRET = CLICK_LEDGER_SECRET;
    affiliateMocks.registerClick.mockResolvedValueOnce({ valid: false });

    const response = await requestRedirect('/api/affiliate/redirect/UNKNOWN_7?article=piece_42');

    expect(response.status).toBe(302);
    expect(findCookie(response, 'iw_affiliate_click_visitor')).toBeUndefined();
    expect(response.headers.get('location')).toBe('/?article=piece_42');
  });

  it('replaces a tampered visitor token without exposing its pseudonym in the response', async () => {
    process.env.AFFILIATE_CLICK_LEDGER_MODE = 'shadow';
    process.env.AFFILIATE_CLICK_ANALYTICS_SECRET = CLICK_LEDGER_SECRET;

    const response = await fetch(`${baseUrl}/api/affiliate/click`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'iw_affiliate_click_visitor=aff_vis_v1.tampered.signature',
        origin: baseUrl,
        'sec-fetch-site': 'same-origin',
      },
      body: JSON.stringify({ ref: 'partner_7', articleId: 'piece_42' })
    });
    const payload = await response.json();
    const replacementCookie = findCookie(response, 'iw_affiliate_click_visitor');
    const storeOptions = affiliateMocks.registerClick.mock.calls[0]?.[6];

    expect(response.status).toBe(200);
    expect(replacementCookie).toMatch(/^iw_affiliate_click_visitor=aff_vis_v1\./);
    expect(storeOptions).toEqual({
      durableMode: 'shadow',
      visitorKey: expect.stringMatching(/^acv1_[A-Za-z0-9_-]{43}$/),
    });
    expect(JSON.stringify(payload)).not.toContain(storeOptions.visitorKey);
    expect(JSON.stringify(payload)).not.toContain('aff_vis_v1');
  });

  it('redirects safely without tracking cookies when required mode is unavailable', async () => {
    process.env.AFFILIATE_CLICK_LEDGER_MODE = 'required';
    delete process.env.AFFILIATE_CLICK_ANALYTICS_SECRET;

    const response = await requestRedirect('/api/affiliate/redirect/PARTNER_7?article=piece_42');

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/?article=piece_42');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(affiliateMocks.registerClick).not.toHaveBeenCalled();
  });

  it('redirects safely without attribution when the atomic click store fails', async () => {
    process.env.AFFILIATE_CLICK_LEDGER_MODE = 'shadow';
    process.env.AFFILIATE_CLICK_ANALYTICS_SECRET = CLICK_LEDGER_SECRET;
    affiliateMocks.registerClick.mockRejectedValueOnce(new Error('simulated durable store failure'));

    const response = await requestRedirect('/api/affiliate/redirect/PARTNER_7?article=piece_42');

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/?article=piece_42');
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('keeps the same durable visitor identity when attribution signing fails after commit', async () => {
    process.env.AFFILIATE_CLICK_LEDGER_MODE = 'shadow';
    process.env.AFFILIATE_CLICK_ANALYTICS_SECRET = CLICK_LEDGER_SECRET;
    const sessionSigningSecret = process.env.SESSION_SIGNING_SECRET;
    const affiliateSigningSecret = process.env.AFFILIATE_SESSION_SIGNING_SECRET;
    delete process.env.SESSION_SIGNING_SECRET;
    delete process.env.AFFILIATE_SESSION_SIGNING_SECRET;

    let first: Response;
    try {
      first = await requestRedirect('/api/affiliate/redirect/PARTNER_7?article=piece_42');
    } finally {
      if (sessionSigningSecret === undefined) delete process.env.SESSION_SIGNING_SECRET;
      else process.env.SESSION_SIGNING_SECRET = sessionSigningSecret;
      if (affiliateSigningSecret === undefined) delete process.env.AFFILIATE_SESSION_SIGNING_SECRET;
      else process.env.AFFILIATE_SESSION_SIGNING_SECRET = affiliateSigningSecret;
    }

    const visitorCookie = findCookie(first!, 'iw_affiliate_click_visitor');
    const firstVisitorKey = affiliateMocks.registerClick.mock.calls[0]?.[6]?.visitorKey;
    expect(first!.status).toBe(302);
    expect(first!.headers.get('location')).toBe('/?article=piece_42');
    expect(visitorCookie).toBeTruthy();
    expect(findCookie(first!, 'iw_affiliate_attribution')).toBeUndefined();
    expect(findCookie(first!, 'iw_affiliate_click_dedup')).toBeUndefined();

    const retry = await fetch(`${baseUrl}/api/affiliate/redirect/PARTNER_7?article=piece_42`, {
      redirect: 'manual',
      headers: {
        cookie: visitorCookie!.split(';')[0],
        'user-agent': 'affiliate-redirect-regression-test',
        referer: 'https://share.example.test/'
      }
    });

    expect(retry.status).toBe(302);
    expect(affiliateMocks.registerClick).toHaveBeenCalledTimes(2);
    expect(affiliateMocks.registerClick.mock.calls[1]?.[6]?.visitorKey).toBe(firstVisitorKey);
    expect(findCookie(retry, 'iw_affiliate_click_visitor')).toBeUndefined();
    expect(findCookie(retry, 'iw_affiliate_attribution')).toBeTruthy();
  });
});
