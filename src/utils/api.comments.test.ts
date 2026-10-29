import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => vi.stubGlobal('localStorage', { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe('private comment API contract', () => {
  it('loads private account comments without browser or shared caching', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('[]', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { api } = await import('./api.js');
    await expect(api.getMyPieceComments('piece:one')).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith('/api/articles/piece%3Aone/comments/mine', {
      credentials: 'include', cache: 'no-store'
    });
  });

  it('submits content and its retry identifier without client-controlled identity or approval', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ comment: { id: 'one', status: 'pending' } }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const { api } = await import('./api.js');
    await expect(api.submitPieceComment('piece-one', 'A thoughtful response', 'submission-one-12345')).resolves.toMatchObject({ status: 'pending' });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ content: 'A thoughtful response', submissionId: 'submission-one-12345' });
  });
});
