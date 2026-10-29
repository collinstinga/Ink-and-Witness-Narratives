import type { Express, Request, RequestHandler, Response } from 'express';
import type { Firestore } from 'firebase-admin/firestore';
import { normalizeNewsletterEmail } from './newsletterSecurity.js';
import { AffiliatePartnerEmailError, AffiliatePartnerEmailStore } from './affiliatePartnerEmailStore.js';

const ROOT = '/api/admin/affiliates/email';
type Service = Pick<AffiliatePartnerEmailStore, 'overview' | 'preview' | 'create' | 'send'>;
/** Explicit writer compose/send uses its own immutable campaigns. It cannot
 * activate or drain any of the separately guarded automated notification jobs. */
export function registerAffiliatePartnerEmailRoutes(app: Pick<Express, 'get' | 'post'>, input: {
  requireAdminAuth: RequestHandler; sameOrigin: RequestHandler; noStore: RequestHandler;
  rateLimiter: RequestHandler; getDb: () => Firestore; service?: Service;
}): void {
  const service = input.service || new AffiliatePartnerEmailStore({ db: input.getDb });
  const readGuards = [input.noStore, input.requireAdminAuth, input.rateLimiter];
  const writeGuards = [...readGuards, input.sameOrigin];
  const actor = (req: Request, res: Response): string | null => {
    const user = (req as Request & { user?: { role?: unknown; email?: unknown } }).user;
    const email = user?.role === 'admin' ? normalizeNewsletterEmail(user.email) : null;
    if (!email) res.status(403).json({ success: false, error: 'An authenticated writer account is required.' });
    return email;
  };
  const query = (req: Request, res: Response): boolean => {
    if (!Object.keys(req.query).length) return false;
    res.status(400).json({ success: false, error: 'Email parameters must be submitted in the form, not in the URL.' }); return true;
  };
  const fail = (res: Response, error: unknown) => {
    const known = error instanceof AffiliatePartnerEmailError;
    res.status(known ? error.statusCode : 503).json({ success: false, error: known && error.statusCode < 500 ? error.message
      : 'Email status could not be confirmed. Refresh the email history before continuing; do not create a duplicate email.' });
  };
  app.get(ROOT, ...readGuards, async (req, res) => {
    if (query(req, res) || !actor(req, res)) return;
    try { res.json(await service.overview()); } catch (error) { fail(res, error); }
  });
  app.post(`${ROOT}/preview`, ...writeGuards, async (req, res) => {
    if (query(req, res) || !actor(req, res)) return;
    try { res.json(await service.preview(req.body)); } catch (error) { fail(res, error); }
  });
  app.post(`${ROOT}/campaigns`, ...writeGuards, async (req, res) => {
    if (query(req, res)) return;
    const writer = actor(req, res); if (!writer) return;
    try { res.status(201).json({ campaign: await service.create(req.body, writer) }); } catch (error) { fail(res, error); }
  });
  app.post(`${ROOT}/campaigns/:id/send`, ...writeGuards, async (req, res) => {
    if (query(req, res)) return;
    const writer = actor(req, res); if (!writer) return;
    if (req.body !== undefined && (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length)) {
      res.status(400).json({ success: false, error: 'Saved email content and recipients cannot be changed while sending.' }); return;
    }
    try { res.json(await service.send(req.params.id, writer)); } catch (error) { fail(res, error); }
  });
}
