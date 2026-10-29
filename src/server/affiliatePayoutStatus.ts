import type { Firestore } from 'firebase-admin/firestore';
import type { Express, Request, RequestHandler } from 'express';
import type { PayoutStatus } from '../types.js';
import { validAffiliatePayoutStatusIds, type AffiliatePayoutStatusItem } from '../utils/affiliateDashboardRefresh.js';

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const STATUS: readonly PayoutStatus[] = ['PENDING', 'APPROVED', 'PROCESSING', 'PAID', 'FAILED', 'REJECTED'];
const unsafeText = /[\u0000-\u001f\u007f]/;
export class AffiliatePayoutStatusError extends Error {
  constructor(readonly statusCode: number, message: string) { super(message); this.name = 'AffiliatePayoutStatusError'; }
}

export function parseAffiliatePayoutStatusIds(input: unknown): string[] {
  if (typeof input !== 'string' || input.length > 2569) throw new AffiliatePayoutStatusError(400, 'Choose up to 10 distinct payout identifiers.');
  const ids = input.split(',');
  if (!validAffiliatePayoutStatusIds(ids)) throw new AffiliatePayoutStatusError(400, 'Choose up to 10 distinct payout identifiers.');
  return ids;
}

/** The fresh affiliate-auth middleware supplies actor; never accept a browser affiliateId.
 * At most ten exact document reads; no ledger scan, aggregation or financial writes. */
export async function getAffiliatePayoutStatuses(db: Firestore, actor: unknown, ids: unknown): Promise<AffiliatePayoutStatusItem[]> {
  const affiliate = actor as { id?: unknown; status?: unknown; role?: unknown } | null;
  if (!affiliate || typeof affiliate.id !== 'string' || !ID.test(affiliate.id) || affiliate.status !== 'active'
    || (affiliate.role !== undefined && affiliate.role !== 'affiliate')) {
    throw new AffiliatePayoutStatusError(403, 'An authenticated active partner account is required.');
  }
  if (!validAffiliatePayoutStatusIds(ids)) throw new AffiliatePayoutStatusError(400, 'Choose up to 10 distinct payout identifiers.');
  const snapshots = await db.getAll(...ids.map(id => db.collection('affiliate_payouts').doc(id)));
  const byId = new Map(snapshots.map(snapshot => [snapshot.id, snapshot]));
  return ids.map(id => {
    const snapshot = byId.get(id);
    const payout = snapshot?.exists ? snapshot.data() : null;
    // Same generic response for absent and another partner's records. Never
    // return a partial batch that reveals which requested account owns a row.
    if (!payout || payout.affiliateId !== affiliate.id || (payout.id !== undefined && payout.id !== id)) {
      throw new AffiliatePayoutStatusError(404, 'The requested payout status is unavailable for this account.');
    }
    if (!STATUS.includes(payout.status) || (payout.paidAt !== undefined
      && (typeof payout.paidAt !== 'string' || payout.paidAt.length > 80 || !Number.isFinite(Date.parse(payout.paidAt))))
      || (payout.paymentReference !== undefined && (typeof payout.paymentReference !== 'string'
        || payout.paymentReference.length > 128 || unsafeText.test(payout.paymentReference)))) {
      throw new AffiliatePayoutStatusError(503, 'Payout status could not be confirmed. Refresh the saved payout history.');
    }
    return { id, status: payout.status as PayoutStatus,
      ...(payout.paidAt ? { paidAt: payout.paidAt as string } : {}),
      ...(payout.paymentReference ? { paymentReference: payout.paymentReference as string } : {}) };
  });
}

export function registerAffiliatePayoutStatusRoutes(app: Pick<Express, 'get'>, options: {
  getDb: () => Firestore;
  requireFreshAffiliateAuth: RequestHandler;
  rateLimiter?: RequestHandler;
}): void {
  const privateResponse: RequestHandler = (_req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('CDN-Cache-Control', 'no-store');
    res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
    next();
  };
  app.get('/api/affiliate/payouts/status', privateResponse, options.requireFreshAffiliateAuth,
    ...(options.rateLimiter ? [options.rateLimiter] : []), async (req: Request, res) => {
      try {
        if (Object.keys(req.query).some(key => key !== 'ids')) throw new AffiliatePayoutStatusError(400, 'Only payout identifiers are accepted.');
        const ids = parseAffiliatePayoutStatusIds(req.query.ids);
        const payouts = await getAffiliatePayoutStatuses(options.getDb(), (req as Request & { affiliate?: unknown }).affiliate, ids);
        return res.json({ success: true, payouts });
      } catch (error) {
        const known = error instanceof AffiliatePayoutStatusError;
        return res.status(known ? error.statusCode : 503).json({ success: false,
          error: known ? error.message : 'Payout status could not be confirmed. Refresh the saved payout history.' });
      }
    });
}
