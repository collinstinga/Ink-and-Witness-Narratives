import type { Express, Request, RequestHandler, Response } from 'express';
import type { Firestore } from 'firebase-admin/firestore';
import {
  AffiliateNotificationRolloutError,
  getProductionAffiliateNotificationRolloutStatus,
  parseProductionAffiliateNotificationReviewRequest,
  pauseProductionAffiliateNotifications,
  saveProductionAffiliateNotificationReview,
  sendProductionAffiliateNotificationTest,
} from './affiliateNotificationRollout.js';
import {
  isProductionAffiliateNotificationTestRequest,
  parseProductionAffiliateNotificationPauseRequest,
} from './affiliateNotificationRuntimeRequest.js';
import { normalizeNewsletterEmail } from './newsletterSecurity.js';

const ROOT = '/api/admin/affiliates/notifications/rollout';
const services = {
  status: getProductionAffiliateNotificationRolloutStatus,
  review: saveProductionAffiliateNotificationReview,
  pause: pauseProductionAffiliateNotifications,
  test: sendProductionAffiliateNotificationTest,
};

/** Routing merely opts into reconciliation; the existing raw signature check,
 * actual SDK/environment gate and exact delivery/recipient checks still apply. */
export function affiliateNotificationWebhookModeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return ['staging_test', 'production_test', 'production_live'].includes(env.AFFILIATE_NOTIFICATION_DELIVERY_MODE || '');
}

function actualWriterEmail(req: Request): string | null {
  const user = (req as Request & { user?: { role?: unknown; email?: unknown } }).user;
  return user?.role === 'admin' ? normalizeNewsletterEmail(user.email) : null;
}

/** The real application supplies its existing session resolver/strict admin
 * middleware, no-store middleware, limiter and bound SDK. Dependencies are
 * server-owned and never taken from HTTP input. No scheduled or automatic send
 * is introduced by registering these routes. */
export function registerAffiliateNotificationRolloutRoutes(app: Pick<Express, 'get' | 'put' | 'post'>, input: {
  requireAdminAuth: RequestHandler;
  noStore: RequestHandler;
  rateLimiter: RequestHandler;
  getDb: () => Firestore;
  services?: typeof services;
}): void {
  const service = input.services || services;
  const guards = [input.noStore, input.requireAdminAuth, input.rateLimiter];
  const failure = (res: Response, error: unknown) => {
    const status = error instanceof AffiliateNotificationRolloutError ? error.statusCode : 503;
    const message = status === 409
      ? 'The notification review changed. Refresh its status before reviewing again.'
      : status === 400 ? 'The notification review request is invalid.'
        : 'The notification operation could not be confirmed safely. Refresh its status before retrying.';
    return res.status(status).json({ success: false, error: message });
  };
  const authorize = (req: Request, res: Response): string | null => {
    const email = actualWriterEmail(req);
    if (!email) res.status(403).json({ success: false, error: 'An authenticated writer account is required.' });
    return email;
  };
  const rejectQuery = (req: Request, res: Response): boolean => {
    if (!Object.keys(req.query).length) return false;
    res.status(400).json({ success: false, error: 'Notification review parameters must not be supplied in the URL.' });
    return true;
  };

  app.get(ROOT, ...guards, async (req: Request, res: Response) => {
    if (!authorize(req, res) || rejectQuery(req, res)) return;
    try {
      return res.json({ success: true, rollout: await service.status({ db: input.getDb() }) });
    } catch (error) { return failure(res, error); }
  });

  app.put(ROOT, ...guards, async (req: Request, res: Response) => {
    const authenticatedWriterEmail = authorize(req, res);
    if (!authenticatedWriterEmail || rejectQuery(req, res)) return;
    const request = parseProductionAffiliateNotificationReviewRequest(req.body);
    if (!request) return res.status(400).json({ success: false, error: 'Choose an expected revision, mode, review duration and founding-welcome option only.' });
    try {
      const rollout = await service.review({ db: input.getDb(), request, authenticatedWriterEmail });
      return res.json({ success: true, rollout });
    } catch (error) { return failure(res, error); }
  });

  app.post(`${ROOT}/pause`, ...guards, async (req: Request, res: Response) => {
    const authenticatedWriterEmail = authorize(req, res);
    if (!authenticatedWriterEmail || rejectQuery(req, res)) return;
    const request = parseProductionAffiliateNotificationPauseRequest(req.body);
    if (!request) return res.status(400).json({ success: false, error: 'Supply the current notification review revision only.' });
    try {
      const rollout = await service.pause({ db: input.getDb(), expectedRevision: request.expectedRevision, authenticatedWriterEmail });
      return res.json({ success: true, rollout });
    } catch (error) { return failure(res, error); }
  });

  app.post(`${ROOT}/test`, ...guards, async (req: Request, res: Response) => {
    const authenticatedWriterEmail = authorize(req, res);
    if (!authenticatedWriterEmail || rejectQuery(req, res)) return;
    if (!isProductionAffiliateNotificationTestRequest(req.body)) {
      return res.status(400).json({ success: false, error: 'The controlled test accepts an empty request only. Its recipient is configured on the server.' });
    }
    try {
      const db = input.getDb();
      const result = await service.test({ db, authenticatedWriterEmail });
      // Do not expose the private delivery ID or treat provider acceptance as
      // delivered. The separate status read supplies the signed receipt state.
      const rollout = await service.status({ db });
      return res.status(result.status === 'failed' ? 503 : 200).json({
        success: result.status === 'accepted' || result.status === 'already_processed',
        result: { status: result.status }, rollout,
      });
    } catch (error) { return failure(res, error); }
  });
}
