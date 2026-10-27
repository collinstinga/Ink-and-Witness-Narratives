import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestHandler } from 'express';
import { AffiliateFinancialAdjustmentError, createAffiliateRefundAdjustment } from './affiliateFinancialAdjustments.js';
import { registerAffiliateFinancialAdjustmentRoutes } from './affiliateFinancialAdjustmentRoutes.js';

vi.mock('./db.js', () => ({
  resolveFirestoreTargetConfig: () => ({ projectId: 'ink-witness-staging-20261024', firestoreDatabaseId: '(default)' }),
  getFirestoreClientTarget: () => ({ projectId: 'ink-witness-staging-20261024', firestoreDatabaseId: '(default)' }),
}));
const ROOT = '/api/admin/affiliates/financial-adjustments';
const valid = { expectedRevision: 0, idempotencyKey: 'route_idempotency_1', confirmationReference: 'CONFIRMED-EXTERNAL-PROOF', currency: 'KES',
  confirmedByWriter: true, commissionId: 'original_commission', refundedAmountKes: 500, reason: 'refund' };

function fixture(options: { allowAuth?: boolean; user?: any; realValidation?: boolean } = {}) {
  const routes = new Map<string, RequestHandler[]>();
  const app: any = {
    get: (path: string, ...handlers: RequestHandler[]) => routes.set(`GET ${path}`, handlers),
    post: (path: string, ...handlers: RequestHandler[]) => routes.set(`POST ${path}`, handlers),
  };
  const db = { collection: vi.fn(), runTransaction: vi.fn() };
  const getDb = vi.fn(() => db as any);
  const operations = Object.fromEntries(['overview', 'wallet', 'costs', 'refund', 'refundCorrection', 'cost', 'costCorrection']
    .map(name => [name, vi.fn(async () => ({ safe: true, providerOperationPerformed: false, accessPermissionsChanged: false }))])) as Record<string, any>;
  if (options.realValidation) operations.refund = vi.fn(createAffiliateRefundAdjustment);
  const guardOrder: string[] = [];
  registerAffiliateFinancialAdjustmentRoutes(app, {
    noStore: (_req, res, next) => { guardOrder.push('noStore'); res.setHeader('Cache-Control', 'no-store'); next(); },
    requireAdminAuth: (_req, res, next) => { guardOrder.push('auth'); if (options.allowAuth === false) res.status(401).json({ success: false }); else next(); },
    rateLimiter: (_req, _res, next) => { guardOrder.push('rate'); next(); },
    getDb, services: operations as any,
  });
  async function invoke(method: string, suffix = '', input: { body?: any; query?: any; params?: any; user?: any } = {}) {
    const handlers = routes.get(`${method} ${ROOT}${suffix}`);
    if (!handlers) throw new Error('Unregistered route');
    const req: any = { body: input.body, query: input.query || {}, params: input.params || {},
      user: Object.hasOwn(input, 'user') ? input.user : options.user ?? { role: 'admin', email: 'Writer@Example.test' } };
    const res: any = { statusCode: 200, headers: {}, body: undefined,
      setHeader(name: string, value: string) { this.headers[name] = value; },
      status(code: number) { this.statusCode = code; return this; },
      json(body: any) { this.body = body; return this; } };
    for (const handler of handlers) {
      let next = false;
      await handler(req, res, () => { next = true; });
      if (!next) break;
    }
    return res;
  }
  return { routes, db, getDb, operations, guardOrder, invoke };
}
beforeEach(() => vi.unstubAllEnvs());

describe('writer-only financial adjustment HTTP boundary', () => {
  it.each(['GET', 'POST'])('runs no-store and auth before database work for anonymous %s', async method => {
    const test = fixture({ allowAuth: false });
    const response = await test.invoke(method, method === 'POST' ? '/refunds' : '', { body: valid });
    expect(response.statusCode).toBe(401);
    expect(response.headers['Cache-Control']).toBe('no-store');
    expect(test.guardOrder).toEqual(['noStore', 'auth']);
    expect(test.getDb).not.toHaveBeenCalled();
    expect(Object.values(test.operations).every(operation => operation.mock.calls.length === 0)).toBe(true);
  });

  it.each([null, { role: 'reader', email: 'reader@example.test' }, { role: 'affiliate', email: 'partner@example.test' },
    { role: 'admin', email: 'invalid' }])('requires a server-resolved writer identity even after middleware (%j)', async user => {
    const test = fixture();
    const response = await test.invoke('POST', '/refunds', { body: { ...valid, role: 'admin', email: 'spoof@example.test' }, user });
    expect(response.statusCode).toBe(403); expect(test.getDb).not.toHaveBeenCalled();
    expect(test.operations.refund).not.toHaveBeenCalled();
  });

  it('takes actor, SDK and target pins from the authenticated server context', async () => {
    const test = fixture();
    const response = await test.invoke('POST', '/refunds', { body: valid });
    expect(response.body).toMatchObject({ success: true, result: { providerOperationPerformed: false, accessPermissionsChanged: false } });
    expect(test.operations.refund).toHaveBeenCalledWith({ db: test.db, actor: 'writer@example.test',
      expectedProjectId: 'ink-witness-staging-20261024', expectedDatabaseId: '(default)' }, valid);
    expect(test.guardOrder).toEqual(['noStore', 'auth', 'rate']);
  });

  it.each(['actor', 'clock', 'db', 'expectedProjectId', 'expectedDatabaseId', 'walletDeltaKes', 'affiliateId', 'providerVerified'])
    ('rejects body-selected %s through exact service validation before ledger access', async key => {
      const test = fixture({ realValidation: true });
      const response = await test.invoke('POST', '/refunds', { body: { ...valid, [key]: 'spoofed' } });
      expect(response.statusCode).toBe(400); expect(response.body.code).toBe('AFFILIATE_ADJUSTMENT_INVALID');
      expect(test.db.collection).not.toHaveBeenCalled(); expect(test.db.runTransaction).not.toHaveBeenCalled();
    });

  it.each(['/refunds', '/refund-corrections', '/costs', '/cost-corrections'])('rejects URL mutation fields for %s', async suffix => {
    const test = fixture();
    const response = await test.invoke('POST', suffix, { body: valid, query: { actor: 'spoofed', expectedRevision: '0' } });
    expect(response.statusCode).toBe(400); expect(test.getDb).not.toHaveBeenCalled();
    expect(test.routes.has(`GET ${ROOT}${suffix}`)).toBe(false);
  });

  it('accepts only the documented read filters and identifiers', async () => {
    const test = fixture();
    expect((await test.invoke('GET', '', { query: { affiliateId: 'original_partner' } })).statusCode).toBe(200);
    expect(test.operations.overview).toHaveBeenLastCalledWith(expect.objectContaining({ actor: 'writer@example.test' }), { affiliateId: 'original_partner' });
    expect((await test.invoke('GET', '', { query: { affiliateId: ['partner_a', 'partner_b'] } })).statusCode).toBe(400);
    expect((await test.invoke('GET', '/wallet/:id', { params: { id: '../private' } })).statusCode).toBe(400);
    expect((await test.invoke('GET', '/costs/:id', { params: { id: 'safe_tx' }, query: { actor: 'spoof' } })).statusCode).toBe(400);
    expect(test.operations.wallet).not.toHaveBeenCalled(); expect(test.operations.costs).not.toHaveBeenCalled();
  });

  it('redacts infrastructure errors and preserves deliberate review conflicts', async () => {
    const test = fixture();
    test.operations.refund.mockRejectedValueOnce(new Error('PRIVATE_PROVIDER_KEY PRIVATE_BUYER'));
    const unavailable = await test.invoke('POST', '/refunds', { body: valid });
    expect(unavailable.statusCode).toBe(503); expect(JSON.stringify(unavailable.body)).not.toMatch(/PRIVATE/);
    test.operations.refund.mockRejectedValueOnce(new AffiliateFinancialAdjustmentError('Refresh reviewed revision.', 409, 'AFFILIATE_ADJUSTMENT_CONFLICT'));
    expect((await test.invoke('POST', '/refunds', { body: valid })).body).toMatchObject({ code: 'AFFILIATE_ADJUSTMENT_CONFLICT', error: 'Refresh reviewed revision.' });
    test.operations.refund.mockRejectedValueOnce(new AffiliateFinancialAdjustmentError('PRIVATE_PROVIDER_KEY', 503, 'AFFILIATE_ADJUSTMENT_UNAVAILABLE'));
    expect(JSON.stringify((await test.invoke('POST', '/refunds', { body: valid })).body)).not.toMatch(/PRIVATE/);
  });
});
