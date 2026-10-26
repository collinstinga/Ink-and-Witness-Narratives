import type { Express, Request, RequestHandler, Response } from 'express';
import type { Firestore } from 'firebase-admin/firestore';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import {
  affiliateNotificationWebhookModeEnabled, registerAffiliateNotificationRolloutRoutes,
} from './affiliateNotificationRolloutRoutes.js';
import { AffiliateNotificationRolloutError } from './affiliateNotificationRollout.js';

const ROOT = '/api/admin/affiliates/notifications/rollout';
const REVIEW = { expectedRevision: 0, mode: 'production_test' as const, durationDays: 7, includeFoundingWelcome: false };
const STATUS = { status: 'disabled' as const, revision: 0, environmentMode: null,
  foundingWelcomeCount: 0, maximumReviewDays: 30, testRecipientConfigured: false, reviewAvailable: false };

function harness() {
  const routes = new Map<string, RequestHandler[]>();
  const headers: Record<string, string> = {};
  const db = { only: 'mock-no-network' } as unknown as Firestore;
  const service = {
    status: vi.fn(async () => STATUS), review: vi.fn(async () => STATUS), pause: vi.fn(async () => STATUS),
    test: vi.fn(async () => ({ status: 'accepted' as const, deliveryId: 'private-delivery-id-not-for-browser' })),
  };
  const getDb = vi.fn(() => db);
  const noStore: RequestHandler = (_req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('CDN-Cache-Control', 'no-store');
    res.setHeader('Vercel-CDN-Cache-Control', 'no-store'); next();
  };
  const requireAdminAuth: RequestHandler = (req, res, next) => {
    const user = (req as any).user;
    if (!user) { res.status(401).json({ success: false }); return; }
    if (user.role !== 'admin') { res.status(403).json({ success: false }); return; }
    next();
  };
  const limiter = vi.fn<RequestHandler>((_req, _res, next) => next());
  const app = Object.fromEntries(['get', 'put', 'post'].map(method => [method,
    (path: string, ...handlers: RequestHandler[]) => routes.set(`${method.toUpperCase()} ${path}`, handlers),
  ])) as unknown as Pick<Express, 'get' | 'put' | 'post'>;
  registerAffiliateNotificationRolloutRoutes(app, { requireAdminAuth, noStore, rateLimiter: limiter, getDb, services: service });
  const invoke = async (method: string, suffix = '', input: { user?: unknown; body?: unknown; query?: unknown } = {}) => {
    const req = { user: { role: 'admin', email: ' Actual.Writer@Example.Invalid ' }, body: {}, query: {}, ...input } as unknown as Request;
    let status = 200; let payload: any; let finished = false;
    const res = {
      setHeader: (key: string, value: string) => { headers[key] = value; },
      status: (value: number) => { status = value; return res; },
      json: (value: unknown) => { payload = value; finished = true; return res; },
    } as unknown as Response;
    for (const handler of routes.get(`${method} ${ROOT}${suffix}`)!) {
      let next = false;
      await handler(req, res, () => { next = true; });
      if (finished || !next) break;
    }
    return { status, payload, headers };
  };
  return { routes, invoke, getDb, db, service, limiter };
}

describe('writer notification rollout routing', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('registers only four explicit admin endpoints, no recipient/queue or automatic route', () => {
    expect([...harness().routes.keys()]).toEqual([
      `GET ${ROOT}`, `PUT ${ROOT}`, `POST ${ROOT}/pause`, `POST ${ROOT}/test`,
    ]);
  });

  it.each([['GET', ''], ['PUT', ''], ['POST', '/pause'], ['POST', '/test']])(
    'denies anonymous and non-writers before any DB/service access: %s %s', async (method, suffix) => {
      for (const user of [undefined, { role: 'client', email: 'reader@example.invalid' },
        { role: 'affiliate', email: 'partner@example.invalid' }, { role: 'admin', email: '' }]) {
        const h = harness();
        const response = await h.invoke(method, suffix, { user, body: REVIEW });
        expect([401, 403]).toContain(response.status);
        expect(h.getDb).not.toHaveBeenCalled();
        for (const call of Object.values(h.service)) expect(call).not.toHaveBeenCalled();
        expect(response.headers['Cache-Control']).toContain('no-store');
        expect(response.headers['CDN-Cache-Control']).toBe('no-store');
        expect(response.headers['Vercel-CDN-Cache-Control']).toBe('no-store');
      }
    });

  it.each([['GET', ''], ['PUT', ''], ['POST', '/pause'], ['POST', '/test']])(
    'rejects URL overrides on %s %s before DB/service access', async (method, suffix) => {
      const h = harness();
      expect((await h.invoke(method, suffix, { query: { recipient: 'other@example.invalid' }, body: REVIEW })).status).toBe(400);
      expect(h.getDb).not.toHaveBeenCalled();
    });

  it('reads status without creating a review, sending a test or preparing an audience', async () => {
    const h = harness(); const response = await h.invoke('GET');
    expect(response).toMatchObject({ status: 200, payload: { success: true, rollout: STATUS } });
    expect(h.service.status).toHaveBeenCalledExactlyOnceWith({ db: h.db });
    expect(h.service.review).not.toHaveBeenCalled(); expect(h.service.test).not.toHaveBeenCalled();
    expect(h.limiter).toHaveBeenCalledTimes(1);
  });

  it('reviews only exact choices using the real resolved writer email', async () => {
    const h = harness(); const response = await h.invoke('PUT', '', { body: REVIEW });
    expect(response.status).toBe(200);
    expect(h.service.review).toHaveBeenCalledExactlyOnceWith({ db: h.db, request: REVIEW,
      authenticatedWriterEmail: 'actual.writer@example.invalid' });
    expect(h.service.test).not.toHaveBeenCalled();
    expect(h.service.pause).not.toHaveBeenCalled();
  });

  it.each(['recipient', 'authenticatedWriterEmail', 'approvedTestRecipient', 'now', 'clock', 'env', 'sendEmail', 'source'])
    ('rejects injected %s for both review and test before DB access', async key => {
      for (const [method, suffix, body] of [['PUT', '', { ...REVIEW, [key]: 'injected' }],
        ['POST', '/test', { [key]: 'injected' }]] as const) {
        const h = harness(); expect((await h.invoke(method, suffix, { body })).status).toBe(400);
        expect(h.getDb).not.toHaveBeenCalled();
      }
    });

  it('pauses using the expected revision, never a client-selected actor', async () => {
    const h = harness(); expect((await h.invoke('POST', '/pause', { body: { expectedRevision: 3 } })).status).toBe(200);
    expect(h.service.pause).toHaveBeenCalledExactlyOnceWith({ db: h.db, expectedRevision: 3,
      authenticatedWriterEmail: 'actual.writer@example.invalid' });
    expect((await h.invoke('POST', '/pause', { body: { expectedRevision: 3, now: 'injected' } })).status).toBe(400);
    expect(h.service.test).not.toHaveBeenCalled();
  });

  it('the controlled test supplies no recipient/transport and returns no delivery identifier', async () => {
    const h = harness(); const response = await h.invoke('POST', '/test', { body: {} });
    expect(h.service.test).toHaveBeenCalledExactlyOnceWith({ db: h.db, authenticatedWriterEmail: 'actual.writer@example.invalid' });
    expect(response.payload).toEqual({ success: true, result: { status: 'accepted' }, rollout: STATUS });
    expect(JSON.stringify(response.payload)).not.toMatch(/private-delivery|recipientEmail|signature|providerMessage/);
  });

  it('a revision conflict is explicit and never automatically retried', async () => {
    const h = harness(); h.service.review.mockRejectedValueOnce(new AffiliateNotificationRolloutError('conflict'));
    const response = await h.invoke('PUT', '', { body: REVIEW });
    expect(response.status).toBe(409); expect(response.payload.error).toMatch(/Refresh/);
    expect(h.service.review).toHaveBeenCalledTimes(1); expect(h.service.test).not.toHaveBeenCalled();
  });

  it('does not leak provider or credential errors or blindly retry a possible send', async () => {
    const h = harness(); h.service.test.mockRejectedValueOnce(new Error('private-secret/provider/recipient'));
    const response = await h.invoke('POST', '/test');
    expect(response.status).toBe(503); expect(response.payload.error).toMatch(/Refresh/);
    expect(JSON.stringify(response.payload)).not.toMatch(/private-secret|provider\/recipient/);
    expect(h.service.test).toHaveBeenCalledTimes(1);
  });

  it('keeps global session-origin guards and raw signature verification ahead of production reconciliation', () => {
    const source = fs.readFileSync(new URL('../../server.ts', import.meta.url), 'utf8');
    expect(source.indexOf('app.use(requireSameOriginForCookieAuth)')).toBeGreaterThan(0);
    expect(source.indexOf('app.use(requireSameOriginForCookieAuth)')).toBeLessThan(source.indexOf('registerAffiliateNotificationRolloutRoutes(app'));
    const start = source.indexOf("app.post('/api/newsletter/webhooks/resend'");
    const hook = source.slice(start, source.indexOf('let delivery = await newsletterStore', start));
    expect(hook.indexOf('verifyResendWebhook({ payload, headers, webhookSecret })')).toBeLessThan(hook.indexOf('reconcileAffiliateNotificationWebhook({'));
    expect(hook).toContain('affiliateNotificationWebhookModeEnabled()');
  });
});

describe('signed partner webhook route activation', () => {
  it.each(['staging_test', 'production_test', 'production_live'])('permits gated reconciliation routing for %s', mode => {
    expect(affiliateNotificationWebhookModeEnabled({ AFFILIATE_NOTIFICATION_DELIVERY_MODE: mode })).toBe(true);
  });
  it.each([undefined, '', 'off', ' production_test ', 'PRODUCTION_LIVE', 'live'])('keeps unsupported mode %# disabled', mode => {
    expect(affiliateNotificationWebhookModeEnabled({ AFFILIATE_NOTIFICATION_DELIVERY_MODE: mode })).toBe(false);
  });
});
