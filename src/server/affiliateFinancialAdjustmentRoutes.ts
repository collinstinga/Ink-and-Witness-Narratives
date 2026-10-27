import type { Express, Request, RequestHandler, Response } from 'express';
import type { Firestore } from 'firebase-admin/firestore';
import { resolveFirestoreTargetConfig } from './db.js';
import {
  AffiliateFinancialAdjustmentError, createAffiliateRefundAdjustment, reverseAffiliateRefundAdjustment,
  recordAffiliateDirectCost, reverseAffiliateDirectCost, getAffiliateFinancialAdjustmentOverview,
  readAffiliateAdjustmentWallet, readAffiliateDirectCostSummary,
} from './affiliateFinancialAdjustments.js';
import { normalizeNewsletterEmail } from './newsletterSecurity.js';

const ROOT = '/api/admin/affiliates/financial-adjustments';
const services = {
  overview: getAffiliateFinancialAdjustmentOverview, wallet: readAffiliateAdjustmentWallet,
  costs: readAffiliateDirectCostSummary, refund: createAffiliateRefundAdjustment,
  refundCorrection: reverseAffiliateRefundAdjustment, cost: recordAffiliateDirectCost,
  costCorrection: reverseAffiliateDirectCost,
};
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

/** Only the resolved writer session and server-created SDK choose the actor and
 * database. These additive accounting routes never call a payment provider. */
export function registerAffiliateFinancialAdjustmentRoutes(app: Pick<Express, 'get' | 'post'>, input: {
  requireAdminAuth: RequestHandler; noStore: RequestHandler; rateLimiter: RequestHandler;
  getDb: () => Firestore; services?: typeof services;
}): void {
  const service = input.services || services;
  const guards = [input.noStore, input.requireAdminAuth, input.rateLimiter];
  const context = (req: Request, res: Response) => {
    const user = (req as Request & { user?: { role?: unknown; email?: unknown } }).user;
    const actor = user?.role === 'admin' ? normalizeNewsletterEmail(user.email) : null;
    if (!actor) { res.status(403).json({ success: false, error: 'An authenticated writer account is required.' }); return null; }
    const target = resolveFirestoreTargetConfig();
    return { db: input.getDb(), expectedProjectId: target.projectId, expectedDatabaseId: target.firestoreDatabaseId, actor };
  };
  const fail = (res: Response, error: unknown) => {
    const known = error instanceof AffiliateFinancialAdjustmentError;
    const status = known ? error.statusCode : 503;
    return res.status(status).json({ success: false,
      error: known && status < 500 ? error.message : 'The financial operation could not be confirmed. Refresh the ledger before retrying.',
      code: known ? error.code : 'AFFILIATE_ADJUSTMENT_UNAVAILABLE' });
  };
  const rejectQuery = (req: Request, res: Response) => {
    if (!Object.keys(req.query).length) return false;
    res.status(400).json({ success: false, error: 'Financial adjustment parameters are not accepted in this URL.' }); return true;
  };
  app.get(ROOT, ...guards, async (req, res) => {
    if (Object.keys(req.query).some(key => key !== 'affiliateId')
      || (req.query.affiliateId !== undefined && (typeof req.query.affiliateId !== 'string' || !ID.test(req.query.affiliateId)))) {
      res.status(400).json({ success: false, error: 'Choose a valid affiliate filter only.' }); return;
    }
    try {
      const ctx = context(req, res); if (!ctx) return;
      res.json({ success: true, overview: await service.overview(ctx,
        req.query.affiliateId ? { affiliateId: req.query.affiliateId as string } : {}) });
    } catch (error) { fail(res, error); }
  });
  for (const [suffix, operation] of [['wallet/:id', 'wallet'], ['costs/:id', 'costs']] as const) {
    app.get(`${ROOT}/${suffix}`, ...guards, async (req, res) => {
      if (rejectQuery(req, res)) return;
      if (typeof req.params.id !== 'string' || !ID.test(req.params.id)) {
        res.status(400).json({ success: false, error: 'Choose a valid ledger identifier.' }); return;
      }
      try {
        const ctx = context(req, res); if (!ctx) return;
        res.json({ success: true, summary: await service[operation](ctx, req.params.id) });
      } catch (error) { fail(res, error); }
    });
  }
  for (const [suffix, operation] of [['refunds', 'refund'], ['refund-corrections', 'refundCorrection'],
    ['costs', 'cost'], ['cost-corrections', 'costCorrection']] as const) {
    app.post(`${ROOT}/${suffix}`, ...guards, async (req, res) => {
      if (rejectQuery(req, res)) return;
      try {
        const ctx = context(req, res); if (!ctx) return;
        // The service validates exact keys, cents, revision, evidence and a
        // stable idempotency key inside the atomic ledger transaction.
        res.json({ success: true, result: await service[operation](ctx, req.body) });
      } catch (error) { fail(res, error); }
    });
  }
}
