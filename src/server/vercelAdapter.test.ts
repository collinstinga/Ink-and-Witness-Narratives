import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
const mocks = vi.hoisted(() => ({ app: vi.fn(), createApp: vi.fn() }));
vi.mock('../../server.js', () => ({ createApp: mocks.createApp }));

describe('Vercel Express rewrite adapter', () => {
  beforeEach(() => { vi.resetModules(); mocks.app.mockReset(); mocks.createApp.mockReset().mockResolvedValue(mocks.app); });
  it('removes only internal routing path from a prepopulated query, so strict guards work', async () => {
    const { default: handler } = await import('../../api/index.js');
    const req = { url: '/api/index?path=internal/affiliate-notifications/owner-test', query: { path: 'internal/affiliate-notifications/owner-test' } } as unknown as Request;
    await handler(req, {} as Response);
    expect(req.url).toBe('/api/internal/affiliate-notifications/owner-test');
    expect(req.query).toEqual({}); expect(mocks.app).toHaveBeenCalledWith(req, {});
  });
  it('preserves all actual client query fields, including forbidden overrides, arrays and empty values', async () => {
    const { default: handler } = await import('../../api/index.js');
    const req = { query: { path: 'admin/affiliates/financial-adjustments', actor: 'forged', tag: ['one', 'two'], empty: '' } } as unknown as Request;
    await handler(req, {} as Response);
    expect(req.query).toEqual({ actor: 'forged', tag: ['one', 'two'], empty: '' });
    expect(req.url).toBe('/api/admin/affiliates/financial-adjustments?actor=forged&tag=one&tag=two&empty=');
  });
  it('does not remove a user path query on a non-rewritten request or build a route from an array', async () => {
    const { default: handler } = await import('../../api/index.js');
    const req = { url: '/api/index', query: { path: ['one', 'two'], other: 'keep' } } as unknown as Request;
    await handler(req, {} as Response);
    expect(req.query).toEqual({ path: ['one', 'two'], other: 'keep' }); expect(req.url).toBe('/api/index');
  });
});
