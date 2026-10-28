import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() });
});
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe('book quote and payment client contract', () => {
  it('loads personalized prices without a browser or shared cache', async () => {
    const payload = { bookId: 'book:one', bookUpdatedAt: '2026-10-28T12:00:00.000Z', amountKes: 200 };
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(payload), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { api } = await import('./api.js');
    await expect(api.getBookQuote('book:one')).resolves.toEqual(payload);
    expect(fetchMock).toHaveBeenCalledWith('/api/books/book%3Aone/quote', expect.objectContaining({ cache: 'no-store' }));
  });
  it('sends the reviewed edition alongside the amount, without changing normal piece checkout', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ success: true, checkoutRequestId: 'synthetic-checkout' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { api } = await import('./api.js');
    await api.initiateStkPush('bundle:book-one', '0700000000', 200, false, undefined, undefined, '2026-10-28T12:00:00.000Z');
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body).toMatchObject({ articleId: 'bundle:book-one', amount: 200, bookUpdatedAt: '2026-10-28T12:00:00.000Z' });
    await api.initiateStkPush('piece-one', '0700000000', 100);
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).not.toHaveProperty('bookUpdatedAt');
  });
});
