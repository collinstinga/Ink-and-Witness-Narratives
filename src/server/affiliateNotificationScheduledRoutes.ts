import type { Express, Request, RequestHandler, Response } from 'express';
import type { Firestore } from 'firebase-admin/firestore';
import { runAffiliateNotificationJob } from './affiliateNotificationRuntime.js';
import { isAffiliateNotificationCronAuthorized } from './affiliateNotificationRuntimeRequest.js';

export const AFFILIATE_NOTIFICATION_SCHEDULED_PATH = '/api/internal/affiliate-notifications/run';

/** One bounded reconciliation pass. Existing transaction leases, signed review
 * checks, fresh consent checks and provider idempotency remain authoritative.
 * No request parameter can choose a recipient, transport, clock or queue. */
export function registerAffiliateNotificationScheduledRoutes(app: Pick<Express, 'get'>, input: {
  noStore: RequestHandler;
  rateLimiter: RequestHandler;
  getDb: () => Firestore;
  /** Server/test dependencies only; never populated from an HTTP request. */
  runJob?: typeof runAffiliateNotificationJob;
  env?: NodeJS.ProcessEnv;
}): void {
  const runJob = input.runJob || runAffiliateNotificationJob;
  app.get(AFFILIATE_NOTIFICATION_SCHEDULED_PATH, input.noStore,
    (req: Request, res: Response, next) => {
      if (!isAffiliateNotificationCronAuthorized(req.get('authorization'), input.env || process.env)) {
        return res.status(401).json({ success: false });
      }
      // Express implicitly routes HEAD through GET. A HEAD probe must never
      // execute a notification pass, even with an otherwise valid credential.
      if (req.method !== 'GET') return res.status(405).json({ success: false });
      next();
    }, input.rateLimiter, async (req: Request, res: Response) => {
      const body = req.body as unknown;
      if (Object.keys(req.query).length || body !== undefined && (body === null || typeof body !== 'object'
        || Array.isArray(body) || Object.keys(body).length)) return res.status(400).json({ success: false });
      // A scheduled test must not create reviews or drain affiliate messages.
      // Environment capabilities are pinned for this pass; the runtime still
      // rereads the signed review before each operation and delivery attempt.
      const env = { ...(input.env || process.env) };
      if (env.VERCEL_ENV !== 'production' || env.AFFILIATE_NOTIFICATION_EVENT_MODE !== 'production_held'
        || env.AFFILIATE_NOTIFICATION_DELIVERY_MODE !== 'production_live') {
        return res.json({ success: false, status: 'disabled' });
      }
      try {
        const db = input.getDb();
        const prepare = await runJob({ db, mode: 'prepare' }, env);
        // A failed/overflow/busy preparation is not authorization to continue
        // with a stale queue. Another scheduled pass can reconcile it safely.
        if (prepare.status !== 'completed' || prepare.counts.failed) {
          return res.status(prepare.status === 'failed' || prepare.counts.failed ? 503 : 200)
            .json({ success: false, prepare });
        }
        const dispatch = await runJob({ db, mode: 'dispatch' }, env);
        return res.status(dispatch.status === 'failed' ? 503 : 200).json({
          success: dispatch.status === 'completed', prepare, dispatch,
        });
      } catch {
        // Provider/SDK errors may contain addresses, credentials or payloads.
        return res.status(503).json({ success: false, error: 'Partner notification schedule could not complete safely.' });
      }
    });
}
