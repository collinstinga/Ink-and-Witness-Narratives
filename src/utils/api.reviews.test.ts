import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => vi.stubGlobal('localStorage', { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
describe('independent review intent client contract', () => {
  it('sends the intended response ID without client identity or publication authority', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ success: true, review: { id: 'synthetic', status: 'pending' }, message: 'Awaiting approval.' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const { api } = await import('./api.js');
    await api.savePieceReview('piece:one', 5, 'An independent response.', 'submission-first-12345');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/pieces/piece%3Aone/reviews');
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ rating: 5, review: 'An independent response.', submissionId: 'submission-first-12345' });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'include', cache: 'no-store' });
  });
  it('does not automatically retry an ambiguous review write', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ error: 'Synthetic uncertain response' }), { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    const { api } = await import('./api.js');
    await expect(api.savePieceReview('piece-one', 5, 'An independent response.', 'submission-first-12345')).rejects.toThrow('Synthetic uncertain response');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
