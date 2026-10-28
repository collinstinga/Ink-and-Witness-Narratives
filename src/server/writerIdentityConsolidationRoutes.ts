import crypto from 'crypto';
import type { Express, Request, RequestHandler, Response } from 'express';
import type { Firestore } from 'firebase-admin/firestore';
import { hashPassword, validatePasswordStrength } from './auth.js';
import { sendNewsletterEmail } from './newsletterEmail.js';
import {
  WriterIdentityConsolidationStore, WriterIdentityConsolidationError,
  WRITER_CONSOLIDATION_OWNER, WRITER_CONSOLIDATION_ORIGIN,
  WRITER_CONSOLIDATION_TOKEN_PATTERN, WRITER_CONSOLIDATION_TOKEN_TTL_MS,
} from './writerIdentityConsolidation.js';

export const WRITER_ACCOUNT_SECURITY_PATH = '/api/admin/account-security';
export const WRITER_RECOVERY_CAPABILITY_PATH = '/api/auth/writer-password-reset';
type Actor = { id: string; email: string; role: 'admin' };
type Service = Pick<WriterIdentityConsolidationStore, 'status' | 'issue' | 'isActive' | 'consume'>;
const USER_ID = /^user_[A-Za-z0-9_-]{8,120}$/;
const plainObject = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');

function noStore(_req: Request, res: Response, next: () => void) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  next();
}
function actorFromSession(req: Request): Actor | null {
  const user = (req as Request & { user?: { id?: unknown; role?: unknown; email?: unknown } }).user;
  if (user?.role !== 'admin' || typeof user.id !== 'string' || !USER_ID.test(user.id)
    || typeof user.email !== 'string' || user.email.trim().toLowerCase() !== WRITER_CONSOLIDATION_OWNER) return null;
  // The core revalidates this exact authenticated ID and reviewed cohort. An
  // email lookup, request body or arbitrary duplicate never selects canonical ID.
  return { id: user.id, email: WRITER_CONSOLIDATION_OWNER, role: 'admin' };
}
function safeStatus(value: Awaited<ReturnType<Service['status']>>) {
  const status = ['unavailable', 'review_required', 'ready', 'pending', 'active'].includes(value.status) ? value.status : 'unavailable';
  return { status, memberCount: Number.isSafeInteger(value.memberCount) && value.memberCount >= 0 && value.memberCount <= 32 ? value.memberCount : 0,
    canIssue: status === 'ready' && value.canIssue === true,
    ...(typeof value.expiresAt === 'number' && Number.isSafeInteger(value.expiresAt) ? { expiresAt: value.expiresAt } : {}) };
}
function page(token = '', error = '', complete = false): string {
  const safeToken = WRITER_CONSOLIDATION_TOKEN_PATTERN.test(token) ? token : '';
  const content = complete
    ? `<p>Your Writer Studio password has been updated. Previous writer sessions have been invalidated. Sign in normally with your new password.</p><p><a href="/" style="color:#38bdf8">Return to Ink &amp; Witness</a></p>`
    : `<p style="line-height:1.7;color:#cbd5e1">Choose at least eight characters, including a letter and a number or special character. Your current login stays unchanged until you submit this form.</p>
${error ? `<p role="alert" style="color:#fecdd3">${escapeHtml(error)}</p>` : ''}
<form method="post" action="${WRITER_RECOVERY_CAPABILITY_PATH}" style="margin-top:24px;display:grid;gap:16px">
<input type="hidden" name="token" value="${safeToken}">
<label style="display:grid;gap:7px">New password<input type="password" name="password" autocomplete="new-password" minlength="8" maxlength="256" required style="box-sizing:border-box;width:100%;padding:12px;border:1px solid #475569;border-radius:10px;background:#080d17;color:white;font-size:16px"></label>
<label style="display:grid;gap:7px">Confirm new password<input type="password" name="confirmPassword" autocomplete="new-password" minlength="8" maxlength="256" required style="box-sizing:border-box;width:100%;padding:12px;border:1px solid #475569;border-radius:10px;background:#080d17;color:white;font-size:16px"></label>
<button type="submit" style="border:0;border-radius:10px;background:#0284c7;color:white;padding:13px;font-weight:700">Update Writer Studio password</button></form>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Writer Studio password recovery</title></head><body style="margin:0;background:#080d17;color:#e2e8f0;font-family:Georgia,serif;min-height:100vh;display:grid;place-items:center;padding:24px;box-sizing:border-box"><main style="width:min(560px,100%);background:#0f172a;border:1px solid #334155;border-radius:20px;padding:32px;box-sizing:border-box;overflow-wrap:anywhere"><p style="color:#38bdf8">Ink &amp; Witness Narratives</p><h1>${complete ? 'Password updated' : 'Choose your Writer Studio password'}</h1>${content}</main></body></html>`;
}
export function buildWriterIdentityRecoveryEmail(token: string) {
  if (!WRITER_CONSOLIDATION_TOKEN_PATTERN.test(token)) throw new Error('A valid writer recovery capability is required.');
  const url = new URL(WRITER_RECOVERY_CAPABILITY_PATH, WRITER_CONSOLIDATION_ORIGIN);
  url.searchParams.set('token', token);
  const text = `A secure Writer Studio recovery link was requested from your signed-in account. Open this link within ${WRITER_CONSOLIDATION_TOKEN_TTL_MS / 60_000} minutes and choose a new password:\n\n${url}\n\nYour current login remains unchanged until you submit the new password. The link works once. If you did not request this, ignore the email. Original account IDs, purchases and payment records are preserved.`;
  return { subject: 'Secure Writer Studio password recovery', text,
    html: `<div style="background:#080d17;color:#e2e8f0;padding:28px;font-family:Arial,sans-serif"><h1 style="color:white">Writer Studio password recovery</h1><p>Your current login remains unchanged until you choose and submit a new password.</p><p>This secure link works once and expires in ${WRITER_CONSOLIDATION_TOKEN_TTL_MS / 60_000} minutes.</p><p><a style="color:#38bdf8" href="${escapeHtml(url.toString())}">Choose your new password</a></p><p>If you did not request this email, ignore it. Original account IDs, purchases and payment records are preserved.</p></div>` };
}

/** Separate writer-purpose capability; the public reader reset remains client-only. */
export function registerWriterIdentityConsolidationRoutes(app: Pick<Express, 'get' | 'post'>, input: {
  requireAdminAuth: RequestHandler; sameOrigin: RequestHandler; issueLimiter: RequestHandler; capabilityLimiter: RequestHandler;
  getDb: () => Firestore; clearSessionCookie: (res: Response) => void;
  service?: Service; sendEmail?: typeof sendNewsletterEmail; hashPassword?: typeof hashPassword;
}) {
  const service = input.service || new WriterIdentityConsolidationStore(input.getDb);
  const send = input.sendEmail || sendNewsletterEmail;
  const hash = input.hashPassword || hashPassword;
  const rejectQuery = (req: Request, res: Response) => {
    if (!Object.keys(req.query).length) return false;
    res.status(400).json({ success: false, error: 'Account security parameters are not accepted in this URL.' }); return true;
  };
  const failure = (res: Response, error: unknown) => {
    const status = error instanceof WriterIdentityConsolidationError && [400, 403, 409].includes(error.statusCode) ? error.statusCode : 503;
    return res.status(status).json({ success: false, error: status === 409
      ? 'Recovery is already pending or the reviewed account state changed. Refresh security status before continuing.'
      : 'Account recovery could not be confirmed. Refresh security status before continuing.' });
  };
  app.get(WRITER_ACCOUNT_SECURITY_PATH, noStore, input.requireAdminAuth, async (req, res) => {
    if (rejectQuery(req, res)) return;
    const actor = actorFromSession(req);
    if (!actor) { res.status(403).json({ success: false, error: 'The approved Writer Studio account is required.' }); return; }
    try { res.json({ success: true, security: safeStatus(await service.status(actor)) }); }
    catch (error) { failure(res, error); }
  });
  app.post(`${WRITER_ACCOUNT_SECURITY_PATH}/password-recovery`, noStore, input.requireAdminAuth, input.sameOrigin, input.issueLimiter, async (req, res) => {
    if (rejectQuery(req, res)) return;
    const actor = actorFromSession(req);
    if (!actor) { res.status(403).json({ success: false, error: 'The approved Writer Studio account is required.' }); return; }
    if (!plainObject(req.body) || Object.keys(req.body).length !== 0) {
      res.status(400).json({ success: false, error: 'Send an empty recovery request. Recipient and account selection come from your authenticated session.' }); return;
    }
    try {
      const issued = await service.issue(actor);
      const content = buildWriterIdentityRecoveryEmail(issued.token);
      const tokenHash = crypto.createHash('sha256').update(issued.token).digest('hex');
      let delivery: 'accepted' | 'unconfirmed' = 'accepted';
      try { await send({ to: WRITER_CONSOLIDATION_OWNER, ...content, idempotencyKey: `writer-identity-recovery-${tokenHash}` }); }
      catch { delivery = 'unconfirmed'; }
      // A provider timeout may follow acceptance. Keep the pending capability;
      // the core cooldown prevents reissue and no automatic second email occurs.
      res.status(202).json({ success: true, recovery: { status: 'pending', expiresAt: issued.expiresAt, delivery } });
    } catch (error) { failure(res, error); }
  });
  app.get(WRITER_RECOVERY_CAPABILITY_PATH, noStore, input.capabilityLimiter, async (req, res) => {
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    if (Object.keys(req.query).some(key => key !== 'token') || !WRITER_CONSOLIDATION_TOKEN_PATTERN.test(token)) {
      res.status(400).type('html').send(page('', 'This writer recovery link is invalid. Request a new link from Writer Studio.')); return;
    }
    try {
      if (!await service.isActive(token)) { res.status(410).type('html').send(page('', 'This writer recovery link expired or was already used.')); return; }
      res.type('html').send(page(token));
    } catch { res.status(503).type('html').send(page('', 'Account recovery is temporarily unavailable. Try the link again shortly.')); }
  });
  app.post(WRITER_RECOVERY_CAPABILITY_PATH, noStore, input.sameOrigin, input.capabilityLimiter, async (req, res) => {
    const html = Boolean(req.is('application/x-www-form-urlencoded'));
    const token = plainObject(req.body) && typeof req.body.token === 'string' ? req.body.token : '';
    const reject = (status: number, message: string) => html
      ? res.status(status).type('html').send(page(token, message)) : res.status(status).json({ success: false, error: message });
    if (Object.keys(req.query).length || !plainObject(req.body)
      || Object.keys(req.body).some(key => !['token', 'password', 'confirmPassword'].includes(key))
      || !WRITER_CONSOLIDATION_TOKEN_PATTERN.test(token)) { reject(400, 'This writer recovery request is invalid.'); return; }
    const { password, confirmPassword } = req.body;
    if (typeof password !== 'string' || password.length > 256 || password !== confirmPassword) { reject(400, 'Enter the same new password in both fields.'); return; }
    const strength = validatePasswordStrength(password);
    if (!strength.valid) { reject(400, strength.error || 'Choose a stronger password.'); return; }
    try {
      if (!await service.isActive(token)) { reject(410, 'This writer recovery link expired or was already used.'); return; }
      const result = await service.consume(token, await hash(password), password);
      if (!result) { reject(410, 'This writer recovery link expired or the reviewed account state changed.'); return; }
      input.clearSessionCookie(res);
      // No session is created and no raw account/receipt/password data is returned.
      if (html) res.type('html').send(page('', '', true));
      else res.json({ success: true, message: 'Writer Studio password updated. Sign in normally with your new password.' });
    } catch { reject(503, 'Recovery could not be confirmed. Try signing in with your new password; otherwise reopen the link.'); }
  });
}
