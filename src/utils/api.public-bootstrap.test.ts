import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const payload = {
  generatedAt: '2026-09-24T16:00:00.000Z',
  session: { authenticated: false, user: null },
  author: { name: 'Jake' },
  articles: [{ id: 'piece-1', title: 'Piece One' }],
  categories: [{ id: 'category-1', name: 'Essays', order: 1 }],
  topics: [{ id: 'topic-1', name: 'Memory', slug: 'memory' }],
  homepage: {
    config: { heroHeadline: 'INK & WITNESS' },
    mostSellingPieces: [{ id: 'piece-1', title: 'Piece One' }]
  },
  newsletter: {
    enabled: true,
    consentVersion: '2026-09-23',
    doubleOptIn: true
  }
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

beforeEach(() => {
  vi.stubGlobal('localStorage', {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn()
  });
});

describe('public bootstrap API client', () => {
  it.each([
    ['/api/public/bootstrap', { cache: 'no-store', method: 'POST' }],
    ['/api/public/bootstrap', { cache: 'no-store', credentials: 'omit' }],
    ['/api/public/bootstrap', { cache: 'no-store', headers: { 'X-Requested-With': 'custom' } }],
    ['/api/auth/me', { cache: 'no-store' }],
  ] as Array<[string, RequestInit]>)('does not adopt a credentialed head response for custom request %s %j', async (url, options) => {
    const take = vi.fn();
    vi.stubGlobal('window', { __IW_INITIAL_BOOTSTRAP__: { startedAt: Date.now(), take, cancel: vi.fn() } });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ fresh: true }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { safeFetchJson } = await import('./api.js');
    await expect(safeFetchJson(url, options)).resolves.toEqual({ fresh: true });
    expect(take).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(url, expect.objectContaining(options));
  }, 30_000);

  it('adopts one head response for the initial fan-out, then fetches later changes afresh', async () => {
    const response = () => new Response(JSON.stringify(payload), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
    const fetchMock = vi.fn().mockResolvedValue(response());
    vi.stubGlobal('fetch', fetchMock);
    const target: any = {};
    const take = vi.fn(() => {
      delete target.__IW_INITIAL_BOOTSTRAP__;
      return Promise.resolve({ response: response() });
    });
    target.__IW_INITIAL_BOOTSTRAP__ = { startedAt: Date.now(), take, cancel: vi.fn() };
    vi.stubGlobal('window', target);
    const { api } = await import('./api.js');
    const results = await Promise.all([api.authGetMe(), api.getAuthor(), api.getHomepageData(), api.getNewsletterConfig()]);
    expect(results).toEqual([payload.session, payload.author, payload.homepage, payload.newsletter]);
    expect(take).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    await new Promise(resolve => setTimeout(resolve, 0));
    await expect(api.getAuthor()).resolves.toEqual(payload.author);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  }, 30_000);

  it.each(['authLogin', 'authRegister', 'authLogout'] as const)('discards an unused pre-authentication handoff after %s', async (method) => {
    const cancel = vi.fn();
    const take = vi.fn();
    const target: any = { __IW_INITIAL_BOOTSTRAP__: { startedAt: Date.now(), take, cancel } };
    vi.stubGlobal('window', target);
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { 'content-type': 'application/json' },
    })));
    const { api } = await import('./api.js');
    await api[method]('reader@example.test', 'not-a-real-password');
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(take).not.toHaveBeenCalled();
    expect(target.__IW_INITIAL_BOOTSTRAP__).toBeUndefined();
  }, 30_000);

  it('keeps normal HTTP/JSON handling and independent session fallback for a failed early response', async () => {
    const session = { authenticated: true, user: { id: 'reader-1', role: 'reader' } };
    const target: any = {};
    target.__IW_INITIAL_BOOTSTRAP__ = { startedAt: Date.now(), cancel: vi.fn(), take: () => {
      delete target.__IW_INITIAL_BOOTSTRAP__;
      return Promise.resolve({ response: new Response('<html>Unavailable</html>', { status: 503 }) });
    } };
    vi.stubGlobal('window', target);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(session), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { api } = await import('./api.js');
    await expect(api.authGetMe()).resolves.toEqual(session);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/me', { credentials: 'include', cache: 'no-store' });
  }, 30_000);

  it('coalesces the initial public data fan-out into one uncached request', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { api } = await import('./api.js');

    const [session, author, articles, categories, topics, homepage, newsletter] = await Promise.all([
      api.authGetMe(),
      api.getAuthor(),
      api.getArticles(),
      api.getCategories(),
      api.getTopics(false),
      api.getHomepageData(),
      api.getNewsletterConfig()
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/public/bootstrap', expect.objectContaining({
      cache: 'no-store',
      credentials: 'include'
    }));
    expect(session).toEqual(payload.session);
    expect(author).toEqual(payload.author);
    expect(articles).toEqual(payload.articles);
    expect(categories).toEqual(payload.categories);
    expect(topics).toEqual(payload.topics);
    expect(homepage).toEqual(payload.homepage);
    expect(newsletter).toEqual(payload.newsletter);
  }, 30_000);

  it('keeps authentication independent from public content availability', async () => {
    const session = { authenticated: true, user: { id: 'reader-1', role: 'reader' } };
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/public/bootstrap') {
        return new Response(JSON.stringify({ error: 'content unavailable' }), {
          status: 503,
          headers: { 'content-type': 'application/json' }
        });
      }
      expect(url).toBe('/api/auth/me');
      return new Response(JSON.stringify(session), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { api } = await import('./api.js');

    await expect(api.authGetMe()).resolves.toEqual(session);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 30_000);

  it('does not retain a completed snapshot across later refreshes', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { api } = await import('./api.js');

    await api.getAuthor();
    await new Promise(resolve => setTimeout(resolve, 0));
    await api.getAuthor();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 30_000);
});
