import type { Express, Request, RequestHandler, Response } from 'express';
import type { Firestore } from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';
import { AFFILIATE_NOTIFICATION_SCHEDULED_PATH, registerAffiliateNotificationScheduledRoutes } from './affiliateNotificationScheduledRoutes.js';
import type { runAffiliateNotificationJob } from './affiliateNotificationRuntime.js';
import type { AffiliateNotificationRuntimeResult } from '../types.js';

const SECRET = 'cron-only-test-secret-not-a-real-key-123456789';
const ENV = { CRON_SECRET: SECRET, VERCEL_ENV: 'production', AFFILIATE_NOTIFICATION_EVENT_MODE: 'production_held',
  AFFILIATE_NOTIFICATION_DELIVERY_MODE: 'production_live' };
function outcome(mode: 'prepare' | 'dispatch', status: AffiliateNotificationRuntimeResult['status'] = 'completed'): AffiliateNotificationRuntimeResult {
  return { mode, status, scanned: 0, attempted: 0, intentCount: 0, counts: {} };
}
function harness(env: NodeJS.ProcessEnv = ENV) {
  const routes = new Map<string, RequestHandler[]>();
  const db = { only: 'mock-no-network' } as unknown as Firestore;
  const getDb = vi.fn(() => db);
  const runJob = vi.fn<typeof runAffiliateNotificationJob>(async input => outcome(input.mode));
  const rateLimiter = vi.fn<RequestHandler>((_req, _res, next) => next());
  const app = { get: (path: string, ...handlers: RequestHandler[]) => routes.set(path, handlers) } as unknown as Pick<Express, 'get'>;
  registerAffiliateNotificationScheduledRoutes(app, {
    noStore: (_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store, max-age=0');
      res.setHeader('CDN-Cache-Control', 'no-store'); res.setHeader('Vercel-CDN-Cache-Control', 'no-store'); next(); },
    rateLimiter, getDb, runJob, env,
  });
  const invoke = async (input: { authorization?: unknown; method?: string; query?: unknown; body?: unknown } = {}) => {
    const { authorization = `Bearer ${SECRET}`, method = 'GET', query = {}, body } = input;
    const req = { method, query, body, get: () => authorization } as unknown as Request;
    const headers: Record<string, string> = {}; let status = 200; let payload: any; let finished = false;
    const res = { setHeader: (key: string, value: string) => { headers[key] = value; },
      status: (value: number) => { status = value; return res; },
      json: (value: unknown) => { payload = value; finished = true; return res; } } as unknown as Response;
    for (const handler of routes.get(AFFILIATE_NOTIFICATION_SCHEDULED_PATH)!) {
      let next = false; await handler(req, res, () => { next = true; }); if (finished || !next) break;
    }
    return { status, payload, headers };
  };
  return { routes, invoke, runJob, getDb, db, rateLimiter };
}

describe('authenticated scheduled partner notification reconciliation', () => {
  it('registers one explicit combined route', () => {
    expect([...harness().routes.keys()]).toEqual([AFFILIATE_NOTIFICATION_SCHEDULED_PATH]);
  });
  it.each(['', 'Bearer undefined', SECRET, `bearer ${SECRET}`, `Bearer ${SECRET} `, ['Bearer', SECRET]])(
    'denies invalid authentication %# before DB/job/limiter access and never caches it', async authorization => {
      const h = harness(); const response = await h.invoke({ authorization });
      expect(response.status).toBe(401); expect(h.getDb).not.toHaveBeenCalled(); expect(h.runJob).not.toHaveBeenCalled();
      expect(h.rateLimiter).not.toHaveBeenCalled(); expect(response.headers['Cache-Control']).toContain('no-store');
      expect(response.headers['CDN-Cache-Control']).toBe('no-store'); expect(response.headers['Vercel-CDN-Cache-Control']).toBe('no-store');
    });
  it.each([undefined, '', 'short', ' '.repeat(32)])('keeps missing/weak server credentials locked: %#', async secret => {
    const h = harness({ ...ENV, CRON_SECRET: secret });
    expect((await h.invoke()).status).toBe(401); expect(h.getDb).not.toHaveBeenCalled();
  });
  it('rejects implicit HEAD execution and all request-controlled operations', async () => {
    for (const input of [{ method: 'HEAD' }, { query: { mode: 'dispatch' } }, { query: { token: SECRET } },
      { body: { recipient: 'other@example.invalid' } }, { body: { env: ENV } }, { body: [] }, { body: null }]) {
      const h = harness(); expect([400, 405]).toContain((await h.invoke(input)).status);
      expect(h.getDb).not.toHaveBeenCalled(); expect(h.runJob).not.toHaveBeenCalled();
    }
  });
  it.each([
    { VERCEL_ENV: 'preview' }, { AFFILIATE_NOTIFICATION_EVENT_MODE: 'off' },
    { AFFILIATE_NOTIFICATION_DELIVERY_MODE: 'production_test' }, { AFFILIATE_NOTIFICATION_DELIVERY_MODE: 'staging_test' },
    { AFFILIATE_NOTIFICATION_DELIVERY_MODE: undefined },
  ])('does no scheduled DB work before live production capability %#', async override => {
    const h = harness({ ...ENV, ...override });
    expect((await h.invoke()).payload).toEqual({ success: false, status: 'disabled' });
    expect(h.getDb).not.toHaveBeenCalled(); expect(h.runJob).not.toHaveBeenCalled();
  });
  it('prepares once then dispatches once, supplying only server-owned inputs', async () => {
    const h = harness(); const response = await h.invoke({ body: {} });
    expect(response.status).toBe(200); expect(response.payload.success).toBe(true);
    expect(h.getDb).toHaveBeenCalledTimes(1); expect(h.runJob.mock.calls).toEqual([
      [{ db: h.db, mode: 'prepare' }, ENV], [{ db: h.db, mode: 'dispatch' }, ENV],
    ]);
    expect(h.rateLimiter).toHaveBeenCalledTimes(1);
  });
  it.each(['blocked', 'disabled', 'busy', 'conflict', 'overflow', 'failed'] as const)(
    'never dispatches after %s preparation', async status => {
      const h = harness(); h.runJob.mockResolvedValueOnce(outcome('prepare', status));
      const response = await h.invoke(); expect(response.payload.success).toBe(false);
      expect(response.status).toBe(status === 'failed' ? 503 : 200); expect(h.runJob).toHaveBeenCalledTimes(1);
    });
  it('stops a completed preparation that reports failed source work', async () => {
    const h = harness(); h.runJob.mockResolvedValueOnce({ ...outcome('prepare'), counts: { failed: 1 } });
    expect((await h.invoke()).status).toBe(503); expect(h.runJob).toHaveBeenCalledTimes(1);
  });
  it('allows an independently blocked dispatch after a pause without retrying', async () => {
    const h = harness(); h.runJob.mockResolvedValueOnce(outcome('prepare')).mockResolvedValueOnce(outcome('dispatch', 'blocked'));
    const response = await h.invoke(); expect(response.payload.success).toBe(false);
    expect(response.payload.dispatch.status).toBe('blocked'); expect(h.runJob).toHaveBeenCalledTimes(2);
  });
  it('pins the environment during one pass and relies on durable runtime idempotency for repeated calls', async () => {
    const env = { ...ENV }; const h = harness(env);
    h.runJob.mockImplementation(async (input, passedEnv) => {
      expect(passedEnv?.AFFILIATE_NOTIFICATION_DELIVERY_MODE).toBe('production_live');
      env.AFFILIATE_NOTIFICATION_DELIVERY_MODE = 'production_test'; return outcome(input.mode);
    });
    expect((await h.invoke()).payload.success).toBe(true); expect(h.runJob).toHaveBeenCalledTimes(2);
    expect((await h.invoke()).payload.status).toBe('disabled'); expect(h.runJob).toHaveBeenCalledTimes(2);
  });
  it('suppresses SDK/provider details and never retries an ambiguous failure', async () => {
    const h = harness(); h.runJob.mockRejectedValueOnce(new Error('private-address/provider-secret'));
    const response = await h.invoke(); expect(response.status).toBe(503);
    expect(JSON.stringify(response.payload)).not.toMatch(/private-address|provider-secret/); expect(h.runJob).toHaveBeenCalledTimes(1);
  });
});
