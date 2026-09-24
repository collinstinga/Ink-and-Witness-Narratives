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
