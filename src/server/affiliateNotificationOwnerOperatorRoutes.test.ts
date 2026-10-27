import crypto from 'crypto';
import type { Express, Request, RequestHandler, Response } from 'express';
import type { Firestore } from 'firebase-admin/firestore';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ verify: vi.fn(), gate: vi.fn() }));
vi.mock('google-auth-library', () => ({ OAuth2Client: class { verifyIdToken = mocks.verify; } }));
vi.mock('./affiliateNotificationRollout.js', () => ({
  AFFILIATE_NOTIFICATION_PRODUCTION_ORIGIN: 'https://www.inkandwitness-narratives.co.ke',
  AffiliateNotificationRolloutError: class extends Error { statusCode = 409; },
  getProductionAffiliateNotificationRolloutStatus: vi.fn(), productionAffiliateNotificationGate: mocks.gate,
  saveProductionAffiliateNotificationReview: vi.fn(), sendProductionAffiliateNotificationTest: vi.fn(),
}));
import {
  AFFILIATE_NOTIFICATION_APPROVED_OWNER as OWNER, AFFILIATE_NOTIFICATION_OWNER_GOOGLE_AUDIENCE as AUDIENCE,
  AFFILIATE_NOTIFICATION_OWNER_OPERATOR_PATH as ROOT, affiliateNotificationOwnerOperatorEnabled,
  registerAffiliateNotificationOwnerOperatorRoutes, verifyAffiliateNotificationOwnerIdToken,
} from './affiliateNotificationOwnerOperatorRoutes.js';
import type { ProductionAffiliateNotificationRolloutStatus } from '../types.js';

const NOW = Date.parse('2026-10-27T06:00:00.000Z');
const ORIGIN = 'https://www.inkandwitness-narratives.co.ke';
const SECRET = 'independent-owner-test-operator-only-123456789';
const ENV = { VERCEL_ENV: 'production', AFFILIATE_NOTIFICATION_EVENT_MODE: 'production_held',
  AFFILIATE_NOTIFICATION_DELIVERY_MODE: 'production_test', AFFILIATE_NOTIFICATION_PRODUCTION_BASE_URL: ORIGIN,
  AFFILIATE_NOTIFICATION_TEST_RECIPIENT_EMAIL: OWNER,
  AFFILIATE_NOTIFICATION_TEST_RECIPIENT_SHA256: crypto.createHash('sha256').update(OWNER).digest('hex'),
  AFFILIATE_NOTIFICATION_OWNER_TEST_OPERATOR_ENABLED: 'true', AFFILIATE_NOTIFICATION_OWNER_TEST_OPERATOR_SECRET: SECRET,
  AFFILIATE_NOTIFICATION_OWNER_TEST_OPERATOR_EXPIRES_AT: new Date(NOW + 30 * 60_000).toISOString(),
};
const CLAIMS = { iss: 'https://accounts.google.com', aud: AUDIENCE, azp: AUDIENCE, sub: 'verified-google-subject',
  email: OWNER, email_verified: true, iat: NOW / 1000 - 30, exp: NOW / 1000 + 3500 };
const STATUS: ProductionAffiliateNotificationRolloutStatus = { status: 'unreviewed', revision: 0, environmentMode: 'production_test',
  foundingWelcomeCount: 0, maximumReviewDays: 30, testRecipientConfigured: true, reviewAvailable: true };
const USER = { id: 'user_realwriter123', role: 'admin', email: OWNER, passwordHash: '$argon2id$real-record-format-for-test-only' };

function harness(env: NodeJS.ProcessEnv = ENV) {
  const routes = new Map<string, RequestHandler[]>();
  const documents: Array<{ id: string; data: () => Record<string, unknown> }> = [{ id: USER.id, data: () => USER }];
  const get = vi.fn(async () => ({ docs: documents })); const limit = vi.fn(() => ({ get }));
  const where = vi.fn(() => ({ limit })); const collection = vi.fn(() => ({ where }));
  const db = { collection } as unknown as Firestore; const getDb = vi.fn(() => db);
  const service = { status: vi.fn(async () => STATUS), review: vi.fn(async () => ({ ...STATUS, status: 'ready' as const, revision: 1 })),
    test: vi.fn(async () => ({ status: 'accepted' as const, deliveryId: 'private-provider-delivery-id' })) };
  const app = Object.fromEntries(['get', 'put', 'post'].map(method => [method,
    (path: string, ...handlers: RequestHandler[]) => routes.set(`${method.toUpperCase()} ${path}`, handlers)])) as unknown as Pick<Express, 'get' | 'put' | 'post'>;
  const rateLimiter = vi.fn<RequestHandler>((_req, _res, next) => next());
  registerAffiliateNotificationOwnerOperatorRoutes(app, { env, getDb, services: service, rateLimiter,
    noStore: (_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store, max-age=0');
      res.setHeader('CDN-Cache-Control', 'no-store'); res.setHeader('Vercel-CDN-Cache-Control', 'no-store'); next(); } });
  const invoke = async (method = 'GET', input: { headers?: Record<string, unknown>; body?: unknown; query?: unknown; user?: unknown } = {}) => {
    const headers: Record<string, unknown> = { authorization: 'Bearer signed.google.jwt',
      'x-affiliate-owner-test-authorization': SECRET, origin: ORIGIN, ...input.headers };
    const req = { method, body: method === 'PUT' ? { expectedRevision: 0 } : {}, query: {}, user: undefined,
      ...input, get: (key: string) => headers[key.toLowerCase()] } as unknown as Request;
    const responseHeaders: Record<string, string> = {}; let status = 200; let payload: any; let finished = false;
    const res = { setHeader: (key: string, value: string) => { responseHeaders[key] = value; },
      status: (value: number) => { status = value; return res; },
      json: (value: unknown) => { payload = value; finished = true; return res; } } as unknown as Response;
    for (const handler of routes.get(`${method === 'HEAD' ? 'GET' : method} ${ROOT}`)!) {
      let next = false; await handler(req, res, () => { next = true; }); if (finished || !next) break;
    }
    return { status, payload, headers: responseHeaders, req };
  };
  return { routes, invoke, service, db, getDb, get, collection, where, limit, documents, rateLimiter };
}

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(NOW); mocks.verify.mockReset(); mocks.gate.mockReset(); mocks.gate.mockReturnValue('allowed');
  mocks.verify.mockResolvedValue({ getPayload: () => CLAIMS });
});
afterEach(() => { vi.useRealTimers(); });

describe('Google-signed identity for the temporary owner probe', () => {
  it('uses the official signature verifier with the exact CLI audience and maximum expiry', async () => {
    expect(await verifyAffiliateNotificationOwnerIdToken('signed.google.jwt')).toBe(OWNER);
    expect(mocks.verify).toHaveBeenCalledExactlyOnceWith({ idToken: 'signed.google.jwt', audience: AUDIENCE, maxExpiry: 3600 });
  });
  it.each([
    { iss: 'https://attacker.invalid' }, { aud: 'another-client' }, { aud: [AUDIENCE, 'another-client'] }, { azp: 'another-client' },
    { email: 'other@example.invalid' }, { email_verified: false }, { email_verified: 'true' },
    { exp: NOW / 1000 }, { exp: NOW / 1000 + 5000 }, { iat: NOW / 1000 + 60 }, { iat: NOW / 1000 - 4000 },
    { sub: '' }, { sub: 123 }, { sub: 'x'.repeat(256) },
  ])('rejects signed but unsuitable claims %#', async override => {
    mocks.verify.mockResolvedValueOnce({ getPayload: () => ({ ...CLAIMS, ...override }) });
    expect(await verifyAffiliateNotificationOwnerIdToken('signed.google.jwt')).toBeNull();
  });
  it('never treats userinfo, an unsigned token, absent payload or SDK failure as proof', async () => {
    for (const result of [null, undefined]) {
      mocks.verify.mockResolvedValueOnce({ getPayload: () => result });
      expect(await verifyAffiliateNotificationOwnerIdToken('signed.google.jwt')).toBeNull();
    }
    mocks.verify.mockRejectedValueOnce(new Error('private-token/certificate-body'));
    expect(await verifyAffiliateNotificationOwnerIdToken('signed.google.jwt')).toBeNull();
  });
});

describe('temporary owner-test operation boundary', () => {
  it('registers three narrow operations only and does not create an app session', async () => {
    const h = harness(); expect([...h.routes.keys()]).toEqual([`GET ${ROOT}`, `PUT ${ROOT}`, `POST ${ROOT}`]);
    const response = await h.invoke(); expect(response.status).toBe(200); expect((response.req as any).user).toBeUndefined();
    expect(response.headers['Set-Cookie']).toBeUndefined(); expect(h.service.test).not.toHaveBeenCalled();
  });
  it.each([
    { AFFILIATE_NOTIFICATION_OWNER_TEST_OPERATOR_ENABLED: undefined }, { AFFILIATE_NOTIFICATION_OWNER_TEST_OPERATOR_ENABLED: 'TRUE' },
    { VERCEL_ENV: 'preview' }, { AFFILIATE_NOTIFICATION_DELIVERY_MODE: 'production_live' },
    { AFFILIATE_NOTIFICATION_EVENT_MODE: 'off' }, { AFFILIATE_NOTIFICATION_TEST_RECIPIENT_EMAIL: 'other@example.invalid' },
    { AFFILIATE_NOTIFICATION_TEST_RECIPIENT_SHA256: 'a'.repeat(64) },
    { AFFILIATE_NOTIFICATION_OWNER_TEST_OPERATOR_SECRET: 'short' }, { AFFILIATE_NOTIFICATION_SIGNING_SECRET: SECRET },
    { SESSION_SIGNING_SECRET: SECRET }, { CRON_SECRET: SECRET }, { RESEND_API_KEY: SECRET },
    { AFFILIATE_NOTIFICATION_OWNER_TEST_OPERATOR_EXPIRES_AT: new Date(NOW).toISOString() },
    { AFFILIATE_NOTIFICATION_OWNER_TEST_OPERATOR_EXPIRES_AT: new Date(NOW + 2 * 3_600_000).toISOString() },
    { AFFILIATE_NOTIFICATION_OWNER_TEST_OPERATOR_EXPIRES_AT: '2026-10-27T06:30:00Z' },
  ])('defaults closed before certificate/DB/service access for unsafe capability %#', async override => {
    const h = harness({ ...ENV, ...override }); expect((await h.invoke('POST')).status).toBe(404);
    expect(mocks.verify).not.toHaveBeenCalled(); expect(h.getDb).not.toHaveBeenCalled(); expect(h.rateLimiter).not.toHaveBeenCalled();
  });
  it.each([undefined, '', 'wrong-secret', ['nested-value']])('requires an independent exact operator secret %#', async secret => {
    const h = harness(); const response = await h.invoke('POST', { headers: { 'x-affiliate-owner-test-authorization': secret } });
    expect(response.status).toBe(401); expect(mocks.verify).not.toHaveBeenCalled(); expect(h.getDb).not.toHaveBeenCalled();
    expect(response.headers['Cache-Control']).toContain('no-store'); expect(response.headers['CDN-Cache-Control']).toBe('no-store');
    expect(response.headers['Vercel-CDN-Cache-Control']).toBe('no-store');
  });
  it.each([undefined, '', 'Bearer access-token', 'Bearer unsigned.jwt', 'Bearer signed.google.jwt extra'])('refuses missing or malformed ID tokens %#', async authorization => {
    const h = harness(); expect((await h.invoke('POST', { headers: { authorization } })).status).toBe(401);
    expect(mocks.verify).not.toHaveBeenCalled(); expect(h.getDb).not.toHaveBeenCalled();
  });
  it('requires a Google-verified identity even if a browser admin object is present', async () => {
    const h = harness(); mocks.verify.mockRejectedValueOnce(new Error('bad signature'));
    expect((await h.invoke('POST', { user: { role: 'admin', email: OWNER } })).status).toBe(401);
    expect(h.getDb).not.toHaveBeenCalled(); expect(h.service.test).not.toHaveBeenCalled();
  });
  it('rejects cookies, foreign origins, URL overrides and implicit HEAD before verifying identity', async () => {
    for (const input of [{ headers: { cookie: 'iw_session=existing' } }, { headers: { origin: 'https://other.invalid' } },
      { headers: { origin: undefined } }, { query: { recipient: OWNER } }, { query: { token: SECRET } }]) {
      expect((await harness().invoke('POST', input)).status).toBe(400);
    }
    expect((await harness().invoke('HEAD')).status).toBe(405); expect(mocks.verify).not.toHaveBeenCalled();
  });
  it.each(['disabled', 'blocked'])('requires the real SDK production delivery gate: %s', async gate => {
    const h = harness(); mocks.gate.mockReturnValueOnce(gate);
    expect((await h.invoke('POST')).status).toBe(403); expect(h.collection).not.toHaveBeenCalled(); expect(h.service.test).not.toHaveBeenCalled();
  });
  it('uses a fresh unique authoritative admin record with a bounded query', async () => {
    const h = harness(); expect((await h.invoke()).status).toBe(200);
    expect(h.collection).toHaveBeenCalledExactlyOnceWith('users'); expect(h.where).toHaveBeenCalledExactlyOnceWith('email', '==', OWNER);
    expect(h.limit).toHaveBeenCalledExactlyOnceWith(2); expect(h.service.status).toHaveBeenCalledWith({ db: h.db }, ENV);
  });
  it('denies missing, duplicate, downgraded or mismatched writer records', async () => {
    const candidates = [[], [{ ...USER, role: 'client' }], [{ ...USER, id: 'injected-id' }],
      [{ ...USER, email: 'other@example.invalid' }], [{ ...USER, passwordHash: '' }], [USER, USER]];
    for (const records of candidates) {
      const h = harness(); h.documents.splice(0, h.documents.length, ...records.map(value => ({ id: USER.id, data: () => value })));
      expect((await h.invoke('POST')).status).toBe(403); expect(h.service.test).not.toHaveBeenCalled();
    }
  });
  it('cannot inject recipient, live mode, clocks, environments, transports or actor via a body', async () => {
    for (const key of ['recipient', 'mode', 'durationDays', 'includeFoundingWelcome', 'authenticatedWriterEmail', 'now', 'env', 'sendEmail']) {
      for (const method of ['PUT', 'POST']) {
        const h = harness(); expect((await h.invoke(method, { body: { expectedRevision: 0, [key]: 'injected' } })).status).toBe(400);
        expect(h.getDb).not.toHaveBeenCalled(); expect(h.service.review).not.toHaveBeenCalled(); expect(h.service.test).not.toHaveBeenCalled();
      }
    }
  });
  it('reviews a fixed owner test only, with a server-verified actor and no founding welcome', async () => {
    const h = harness(); expect((await h.invoke('PUT')).status).toBe(200);
    expect(h.service.review).toHaveBeenCalledExactlyOnceWith({ db: h.db, authenticatedWriterEmail: OWNER,
      request: { expectedRevision: 0, mode: 'production_test', durationDays: 1, includeFoundingWelcome: false } }, ENV);
    expect(h.service.test).not.toHaveBeenCalled();
  });
  it.each(['accepted', 'delivered', 'needs_investigation', 'leased', 'dispatching'])('does not re-review an attempted %s test', async testDeliveryStatus => {
    const h = harness(); h.service.status.mockResolvedValueOnce({ ...STATUS, testDeliveryStatus });
    expect((await h.invoke('PUT')).status).toBe(409); expect(h.service.review).not.toHaveBeenCalled();
  });
  it('uses revision conflicts without automatically retrying a review', async () => {
    const h = harness(); h.service.status.mockResolvedValueOnce({ ...STATUS, revision: 2 });
    expect((await h.invoke('PUT')).status).toBe(409); expect(h.service.review).not.toHaveBeenCalled();
  });
  it('sends only through the existing one-test ledger and exposes acceptance separately from delivery', async () => {
    const h = harness(); const response = await h.invoke('POST');
    expect(h.service.test).toHaveBeenCalledExactlyOnceWith({ db: h.db, authenticatedWriterEmail: OWNER }, ENV);
    expect(response.payload).toEqual({ success: true, result: { status: 'accepted' }, rollout: STATUS });
    expect(JSON.stringify(response.payload)).not.toMatch(/private-provider|deliveryId|signed.google.jwt|operator-only/);
    expect(h.service.review).not.toHaveBeenCalled();
  });
  it('rechecks capability after identity verification and before DB access', async () => {
    const env = { ...ENV }; const h = harness(env);
    mocks.verify.mockImplementationOnce(async () => { env.AFFILIATE_NOTIFICATION_OWNER_TEST_OPERATOR_ENABLED = 'false'; return { getPayload: () => CLAIMS }; });
    expect((await h.invoke('POST')).status).toBe(404); expect(h.getDb).not.toHaveBeenCalled();
  });
  it('suppresses SDK/provider failures and never retries a possible send', async () => {
    const h = harness(); h.service.test.mockRejectedValueOnce(new Error('private-token/provider-body'));
    const response = await h.invoke('POST'); expect(response.status).toBe(503);
    expect(JSON.stringify(response.payload)).not.toMatch(/private-token|provider-body/); expect(h.service.test).toHaveBeenCalledTimes(1);
  });
  it('expires automatically within an hour independently of deployment cleanup', () => {
    expect(affiliateNotificationOwnerOperatorEnabled(ENV)).toBe(true);
    vi.setSystemTime(NOW + 30 * 60_000); expect(affiliateNotificationOwnerOperatorEnabled(ENV)).toBe(false);
  });
});
