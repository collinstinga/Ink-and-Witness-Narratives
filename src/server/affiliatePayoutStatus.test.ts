import { describe, expect, it, vi } from 'vitest';
import { getAffiliatePayoutStatuses, parseAffiliatePayoutStatusIds, registerAffiliatePayoutStatusRoutes } from './affiliatePayoutStatus.js';

const partner = { id: 'affiliate_one', status: 'active' };
function fixture() {
  const data = new Map<string, any>([
    ['payout_one', { id: 'payout_one', affiliateId: partner.id, status: 'APPROVED', notes: 'PRIVATE',
      amountKes: 750, commissionIds: ['private-commission'], payoutDetails: { mpesaPhone: '254700000001' } }],
    ['payout_two', { id: 'payout_two', affiliateId: partner.id, status: 'PAID', paidAt: '2026-10-29T08:00:00.000Z',
      paymentReference: 'QK82910482', confirmationMethod: 'writer_confirmed', privateCredential: 'PRIVATE' }],
    ['another_partner', { id: 'another_partner', affiliateId: 'affiliate_elsewhere', status: 'PAID', paymentReference: 'PRIVATE' }],
  ]);
  const getAll = vi.fn(async (...refs: Array<{ id: string }>) => refs.map(ref => ({ id: ref.id,
    exists: data.has(ref.id), data: () => data.get(ref.id) })).reverse());
  const collection = vi.fn((name: string) => {
    expect(name).toBe('affiliate_payouts');
    // No query, get, transaction or write interface exists in this fixture.
    return { doc: (id: string) => ({ id }) };
  });
  return { data, getAll, collection, db: { getAll, collection } as any };
}

describe('bounded private affiliate payout status probe', () => {
  it('loads exact IDs once and returns only the permitted compact fields, in requested order', async () => {
    const h = fixture();
    const result = await getAffiliatePayoutStatuses(h.db, partner, ['payout_one', 'payout_two']);
    expect(result).toEqual([{ id: 'payout_one', status: 'APPROVED' }, {
      id: 'payout_two', status: 'PAID', paidAt: '2026-10-29T08:00:00.000Z', paymentReference: 'QK82910482',
    }]);
    expect(h.getAll).toHaveBeenCalledExactlyOnceWith({ id: 'payout_one' }, { id: 'payout_two' });
    expect(h.collection).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|amountKes|commissionIds|payoutDetails|affiliateId|confirmationMethod/);
  });

  it('retains historical missing embedded IDs without rewriting any payout', async () => {
    const h = fixture(); delete h.data.get('payout_one').id;
    const before = structuredClone([...h.data]);
    expect(await getAffiliatePayoutStatuses(h.db, partner, ['payout_one'])).toEqual([{ id: 'payout_one', status: 'APPROVED' }]);
    expect([...h.data]).toEqual(before);
  });

  it.each([undefined, '', [], {}, 'private/path', 'payout_one,payout_one', Array.from({ length: 11 }, (_, i) => `payout_${i}`).join(','), 'X'.repeat(257)])('rejects invalid query IDs before Firestore reads: %j', value => {
    expect(() => parseAffiliatePayoutStatusIds(value)).toThrow(/10 distinct/);
  });

  it('bounds valid batches to ten exact reads', async () => {
    const h = fixture();
    const ids = Array.from({ length: 10 }, (_, index) => `payout_${index}`);
    for (const id of ids) h.data.set(id, { affiliateId: partner.id, status: 'PENDING' });
    expect(parseAffiliatePayoutStatusIds(ids.join(','))).toEqual(ids);
    expect(await getAffiliatePayoutStatuses(h.db, partner, ids)).toHaveLength(10);
    expect(h.getAll).toHaveBeenCalledTimes(1);
    expect(h.getAll.mock.calls[0]).toHaveLength(10);
    await expect(getAffiliatePayoutStatuses(h.db, partner, [...ids, 'payout_extra'])).rejects.toMatchObject({ statusCode: 400 });
    expect(h.getAll).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, {}, { id: partner.id, status: 'suspended' }, { id: partner.id, status: 'pending' },
    { ...partner, role: 'client' }, { ...partner, role: 'admin' }])('rejects absent, inactive or wrong-role actors before reads: %j', actor => {
    const h = fixture();
    return expect(getAffiliatePayoutStatuses(h.db, actor, ['payout_one'])).rejects.toMatchObject({ statusCode: 403 })
      .then(() => { expect(h.getAll).not.toHaveBeenCalled(); });
  });

  it('returns the same generic unavailable error for cross-partner and missing records, without partial data', async () => {
    const h = fixture();
    for (const id of ['another_partner', 'missing']) {
      await expect(getAffiliatePayoutStatuses(h.db, partner, ['payout_one', id])).rejects.toMatchObject({
        statusCode: 404, message: 'The requested payout status is unavailable for this account.',
      });
    }
    h.data.get('payout_one').id = 'mismatched';
    await expect(getAffiliatePayoutStatuses(h.db, partner, ['payout_one'])).rejects.toMatchObject({ statusCode: 404 });
  });

  it.each([{ status: 'invented' }, { paidAt: 'not a timestamp' }, { paymentReference: { secret: 'PRIVATE' } },
    { paymentReference: 'BAD\u0000REF' }, { paymentReference: 'X'.repeat(129) }])('fails closed on malformed evidence: %j', patch => {
    const h = fixture(); Object.assign(h.data.get('payout_one'), patch);
    return expect(getAffiliatePayoutStatuses(h.db, partner, ['payout_one'])).rejects.toMatchObject({ statusCode: 503 });
  });

  it('registers fresh affiliate authorization and optional rate limiting before the handler, with private cache headers', async () => {
    const h = fixture(), routes: any[] = [], auth = vi.fn(), limiter = vi.fn();
    registerAffiliatePayoutStatusRoutes({ get: (path: string, ...handlers: any[]) => routes.push({ path, handlers }) } as any,
      { getDb: () => h.db, requireFreshAffiliateAuth: auth, rateLimiter: limiter });
    expect(routes).toHaveLength(1);
    expect(routes[0].path).toBe('/api/affiliate/payouts/status');
    expect(routes[0].handlers.slice(1, 3)).toEqual([auth, limiter]);
    const headers = new Map(), next = vi.fn(), response: any = {
      setHeader: (key: string, value: string) => headers.set(key, value),
      status: vi.fn().mockReturnThis(), json: vi.fn(),
    };
    routes[0].handlers[0]({}, response, next);
    expect(headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(headers.get('Vercel-CDN-Cache-Control')).toBe('no-store');
    await routes[0].handlers.at(-1)({ query: { ids: 'payout_two', affiliateId: 'another_partner' }, affiliate: partner }, response);
    expect(response.status).toHaveBeenLastCalledWith(400); expect(h.getAll).not.toHaveBeenCalled();
    await routes[0].handlers.at(-1)({ query: { ids: 'payout_two' }, user: { role: 'admin' } }, response);
    expect(response.status).toHaveBeenLastCalledWith(403); expect(h.getAll).not.toHaveBeenCalled();
    h.getAll.mockRejectedValueOnce(new Error('PRIVATE database error'));
    await routes[0].handlers.at(-1)({ query: { ids: 'payout_two' }, affiliate: partner }, response);
    expect(response.status).toHaveBeenLastCalledWith(503);
    expect(JSON.stringify(response.json.mock.calls.at(-1))).not.toContain('PRIVATE');
  });
});
