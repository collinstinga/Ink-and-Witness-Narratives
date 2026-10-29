import { describe, expect, it, vi } from 'vitest';
import type { RequestHandler } from 'express';
import { registerAffiliatePartnerEmailRoutes } from './affiliatePartnerEmailRoutes.js';
import { AffiliatePartnerEmailError } from './affiliatePartnerEmailStore.js';

function fixture(options: { authenticated?: boolean; origin?: boolean; user?: any } = {}) {
  const routes = new Map<string, RequestHandler[]>(), guards: string[] = [];
  const service = { overview: vi.fn(async () => ({ campaigns: [], recipients: [], providerConfigured: false })),
    preview: vi.fn(async (_body: any) => ({ eligible: 1, excluded: 0, total: 1 })),
    create: vi.fn(async (_body: any, _actor: string) => ({ id: 'campaign' } as any)),
    send: vi.fn(async (_id: string, _actor: string) => ({ campaign: { id: 'campaign' }, complete: true } as any)) };
  const getDb = vi.fn();
  registerAffiliatePartnerEmailRoutes({ get: (path: string, ...handlers: RequestHandler[]) => routes.set(`GET ${path}`, handlers),
    post: (path: string, ...handlers: RequestHandler[]) => routes.set(`POST ${path}`, handlers) } as any, {
    service, getDb,
    noStore: (_req, res, next) => { guards.push('noStore'); res.setHeader('Cache-Control', 'no-store'); next(); },
    requireAdminAuth: (_req, res, next) => { guards.push('auth'); if (options.authenticated === false) res.status(401).json({ success: false }); else next(); },
    rateLimiter: (_req, _res, next) => { guards.push('rate'); next(); },
    sameOrigin: (_req, res, next) => { guards.push('origin'); if (options.origin === false) res.status(403).json({ success: false }); else next(); },
  });
  async function invoke(method = 'GET', suffix = '', input: { body?: any; query?: any } = {}) {
    const req: any = { ...input, query: input.query || {}, params: { id: 'saved-campaign' },
      user: 'user' in options ? options.user : { role: 'admin', email: 'Writer@Example.test' } };
    const res: any = { statusCode: 200, body: undefined, headers: {},
      status(code: number) { this.statusCode = code; return this; }, json(body: unknown) { this.body = body; return this; },
      setHeader(key: string, value: string) { this.headers[key] = value; } };
    for (const handler of routes.get(`${method} /api/admin/affiliates/email${suffix}`) || []) {
      let next = false; await handler(req, res, () => { next = true; }); if (!next) break;
    }
    return res;
  }
  return { service, guards, getDb, invoke };
}
describe('manual partner email writer HTTP boundary', () => {
  it.each([['GET', ''], ['POST', '/preview'], ['POST', '/campaigns'], ['POST', '/campaigns/:id/send']])
    ('protects %s %s before reading any recipient or sending', async (method, suffix) => {
      const h = fixture({ authenticated: false }), result = await h.invoke(method, suffix);
      expect(result.statusCode).toBe(401); expect(result.headers['Cache-Control']).toBe('no-store');
      expect(h.guards).toEqual(['noStore', 'auth']); expect(Object.values(h.service).every(fn => !fn.mock.calls.length)).toBe(true);
    });
  it.each([null, { role: 'client', email: 'reader@example.test' }, { role: 'affiliate', email: 'partner@example.test' }, { role: 'admin', email: 'invalid' }])
    ('requires server-resolved writer identity %j', async user => {
      const h = fixture({ user }); expect((await h.invoke('POST', '/campaigns', { body: { actor: 'admin@example.test' } })).statusCode).toBe(403);
      expect(h.service.create).not.toHaveBeenCalled();
    });
  it('keeps strict same-origin writes and never lets a body change saved campaign recipients', async () => {
    const blocked = fixture({ origin: false }); expect((await blocked.invoke('POST', '/campaigns')).statusCode).toBe(403);
    expect(blocked.service.create).not.toHaveBeenCalled();
    const h = fixture(); expect((await h.invoke('POST', '/campaigns/:id/send', { body: { affiliateIds: ['other'] } })).statusCode).toBe(400);
    expect(h.service.send).not.toHaveBeenCalled();
  });
  it('uses only authenticated actor and saved campaign identifier for explicit Send', async () => {
    const h = fixture(); expect((await h.invoke('POST', '/campaigns/:id/send', { body: {} })).body.complete).toBe(true);
    expect(h.service.send).toHaveBeenCalledExactlyOnceWith('saved-campaign', 'writer@example.test');
    expect(h.guards).toEqual(['noStore', 'auth', 'rate', 'origin']);
  });
  it('rejects URL parameters and hides private SDK errors without retrying possible sends', async () => {
    const h = fixture(); expect((await h.invoke('GET', '', { query: { email: 'arbitrary@example.test' } })).statusCode).toBe(400);
    expect(h.service.overview).not.toHaveBeenCalled();
    h.service.send.mockRejectedValueOnce(new Error('PRIVATE SDK CREDENTIAL'));
    const failed = await h.invoke('POST', '/campaigns/:id/send'); expect(failed.statusCode).toBe(503);
    expect(failed.body.error).toContain('Refresh'); expect(JSON.stringify(failed.body)).not.toContain('PRIVATE'); expect(h.service.send).toHaveBeenCalledOnce();
  });
  it('returns known conflict errors so the writer can refresh instead of duplicate', async () => {
    const h = fixture(); h.service.create.mockRejectedValueOnce(new AffiliatePartnerEmailError(409, 'Content changed. Refresh.'));
    const result = await h.invoke('POST', '/campaigns'); expect(result.statusCode).toBe(409); expect(result.body.error).toBe('Content changed. Refresh.');
  });
});
