import crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import type { Express, Request, RequestHandler, Response } from 'express';
import type { Firestore } from 'firebase-admin/firestore';
import { normalizeNewsletterEmail } from './newsletterSecurity.js';
import { resolveWriterIdentityByEmail } from './writerIdentityConsolidation.js';
import {
  AFFILIATE_NOTIFICATION_PRODUCTION_ORIGIN, AffiliateNotificationRolloutError,
  getProductionAffiliateNotificationRolloutStatus, productionAffiliateNotificationGate,
  saveProductionAffiliateNotificationReview, sendProductionAffiliateNotificationTest,
} from './affiliateNotificationRollout.js';

export const AFFILIATE_NOTIFICATION_OWNER_OPERATOR_PATH = '/api/internal/affiliate-notifications/owner-test';
// Public client identifier from the existing, officially distributed Firebase
// CLI. No OAuth client secret, user refresh token or access token is deployed.
export const AFFILIATE_NOTIFICATION_OWNER_GOOGLE_AUDIENCE = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
export const AFFILIATE_NOTIFICATION_APPROVED_OWNER = 'collinstinga@gmail.com';
const HOUR = 3_600_000;
const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const services = { status: getProductionAffiliateNotificationRolloutStatus,
  review: saveProductionAffiliateNotificationReview, test: sendProductionAffiliateNotificationTest };

/** Temporary operation capability, independent of the normal writer portal.
 * It grants only one reviewed owner delivery probe, never affiliate dispatch. */
export function affiliateNotificationOwnerOperatorEnabled(env: NodeJS.ProcessEnv, now = Date.now()): boolean {
  const secret = env.AFFILIATE_NOTIFICATION_OWNER_TEST_OPERATOR_SECRET;
  const expiry = env.AFFILIATE_NOTIFICATION_OWNER_TEST_OPERATOR_EXPIRES_AT;
  const expiresAt = typeof expiry === 'string' ? Date.parse(expiry) : NaN;
  return env.AFFILIATE_NOTIFICATION_OWNER_TEST_OPERATOR_ENABLED === 'true'
    && env.VERCEL_ENV === 'production' && env.AFFILIATE_NOTIFICATION_EVENT_MODE === 'production_held'
    && env.AFFILIATE_NOTIFICATION_DELIVERY_MODE === 'production_test'
    && env.AFFILIATE_NOTIFICATION_PRODUCTION_BASE_URL === AFFILIATE_NOTIFICATION_PRODUCTION_ORIGIN
    && env.AFFILIATE_NOTIFICATION_TEST_RECIPIENT_EMAIL === AFFILIATE_NOTIFICATION_APPROVED_OWNER
    && env.AFFILIATE_NOTIFICATION_TEST_RECIPIENT_SHA256 === hash(AFFILIATE_NOTIFICATION_APPROVED_OWNER)
    && typeof secret === 'string' && secret.length >= 32 && secret.length <= 512 && secret.trim() === secret
    && !/[\u0000-\u0020\u007f]/.test(secret)
    && !['AFFILIATE_NOTIFICATION_SIGNING_SECRET', 'SESSION_SIGNING_SECRET', 'SESSION_SECRET',
      'AFFILIATE_SESSION_SIGNING_SECRET', 'NEWSLETTER_SIGNING_SECRET', 'CRON_SECRET', 'RESEND_API_KEY', 'RESEND_WEBHOOK_SECRET']
      .some(key => Boolean(env[key]) && env[key] === secret)
    && Number.isFinite(expiresAt) && new Date(expiresAt).toISOString() === expiry
    && expiresAt > now && expiresAt - now <= HOUR;
}

/** Google's maintained verifier checks the signature, certificate, audience,
 * issuer and expiry. Additional strict claims pin this temporary owner flow.
 * A userinfo response or decoded, unsigned JWT is never identity proof. */
export async function verifyAffiliateNotificationOwnerIdToken(idToken: string, now = Date.now()): Promise<string | null> {
  try {
    const client = new OAuth2Client();
    const ticket = await client.verifyIdToken({ idToken, audience: AFFILIATE_NOTIFICATION_OWNER_GOOGLE_AUDIENCE, maxExpiry: 3600 });
    const value = ticket.getPayload(); const seconds = Math.floor(now / 1000);
    if (!value || !['accounts.google.com', 'https://accounts.google.com'].includes(value.iss)
      || value.aud !== AFFILIATE_NOTIFICATION_OWNER_GOOGLE_AUDIENCE
      || value.azp !== undefined && value.azp !== AFFILIATE_NOTIFICATION_OWNER_GOOGLE_AUDIENCE
      || !Number.isSafeInteger(value.exp) || value.exp <= seconds || value.exp > seconds + 3630
      || !Number.isSafeInteger(value.iat) || value.iat > seconds + 30 || value.iat < seconds - 3600
      || value.exp - value.iat > 3630 || typeof value.sub !== 'string' || !value.sub || value.sub.length > 255
      || value.email_verified !== true || normalizeNewsletterEmail(value.email) !== AFFILIATE_NOTIFICATION_APPROVED_OWNER) return null;
    return AFFILIATE_NOTIFICATION_APPROVED_OWNER;
  } catch { return null; }
}

/** Separate, disabled-by-default endpoints. They neither create a session nor
 * modify req.user, and cannot approve live delivery, choose a recipient, alter
 * consent/settings/accounts, or run the general notification runtime. */
export function registerAffiliateNotificationOwnerOperatorRoutes(app: Pick<Express, 'get' | 'put' | 'post'>, input: {
  noStore: RequestHandler;
  rateLimiter: RequestHandler;
  getDb: () => Firestore;
  services?: typeof services;
  verifyIdToken?: typeof verifyAffiliateNotificationOwnerIdToken;
  env?: NodeJS.ProcessEnv;
}): void {
  const service = input.services || services;
  const verifyIdToken = input.verifyIdToken || verifyAffiliateNotificationOwnerIdToken;
  const capability: RequestHandler = (req, res, next) => {
    const env = input.env || process.env;
    if (!affiliateNotificationOwnerOperatorEnabled(env)) return res.status(404).json({ success: false });
    const actual = req.get('x-affiliate-owner-test-authorization');
    const expected = env.AFFILIATE_NOTIFICATION_OWNER_TEST_OPERATOR_SECRET!;
    if (typeof actual !== 'string' || actual.length > 512 || Buffer.byteLength(actual) !== Buffer.byteLength(expected)
      || !crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) return res.status(401).json({ success: false });
    // A command-line bearer probe carries no browser cookies and pins its
    // intended application origin. Existing cookie authentication is separate.
    if (req.get('cookie') || req.get('origin') !== AFFILIATE_NOTIFICATION_PRODUCTION_ORIGIN
      || Object.keys(req.query).length) return res.status(400).json({ success: false });
    if (req.method === 'HEAD') return res.status(405).json({ success: false });
    next();
  };
  const guards = [input.noStore, capability, input.rateLimiter];
  const authorize = async (req: Request, res: Response) => {
    const authorization = req.get('authorization');
    if (typeof authorization !== 'string' || authorization.length > 12_008 || !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(authorization)) {
      res.status(401).json({ success: false }); return null;
    }
    const email = await verifyIdToken(authorization.slice(7));
    // The override is server-owned test injection; even its result is pinned.
    if (email !== AFFILIATE_NOTIFICATION_APPROVED_OWNER) { res.status(401).json({ success: false }); return null; }
    const env = { ...(input.env || process.env) };
    if (!affiliateNotificationOwnerOperatorEnabled(env)) { res.status(404).json({ success: false }); return null; }
    const db = input.getDb();
    if (productionAffiliateNotificationGate(db, env, true) !== 'allowed') { res.status(403).json({ success: false }); return null; }
    // Authoritative bounded query, including duplicate detection. An OAuth
    // email cannot grant a role from a warm cache or self-register as a writer.
    const identity = await resolveWriterIdentityByEmail(db, email);
    if (identity.kind === 'invalid') { res.status(403).json({ success: false }); return null; }
    const users = identity.kind === 'none' ? await db.collection('users').where('email', '==', email).limit(2).get() : null;
    const document = users?.docs.length === 1 ? users.docs[0] : null;
    const user = identity.kind === 'active' ? identity.user : document?.data();
    const documentId = identity.kind === 'active' ? identity.user.id : document?.id;
    if (!documentId || user?.id !== documentId || !/^user_[A-Za-z0-9_-]{8,120}$/.test(documentId)
      || user.role !== 'admin' || normalizeNewsletterEmail(user.email) !== email || !/^\$argon2id\$/.test(user.passwordHash || '')) {
      res.status(403).json({ success: false }); return null;
    }
    return { db, env, email };
  };
  const failure = (res: Response, error: unknown) => res.status(error instanceof AffiliateNotificationRolloutError ? error.statusCode : 503)
    .json({ success: false, error: 'The controlled owner operation could not be confirmed. Read its status before retrying.' });
  const empty = (value: unknown) => value !== null && typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length;

  app.get(AFFILIATE_NOTIFICATION_OWNER_OPERATOR_PATH, ...guards, async (req, res) => {
    if (req.body !== undefined && !empty(req.body)) return res.status(400).json({ success: false });
    try {
      const owner = await authorize(req, res); if (!owner) return;
      return res.json({ success: true, rollout: await service.status({ db: owner.db }, owner.env) });
    } catch (error) { return failure(res, error); }
  });
  app.put(AFFILIATE_NOTIFICATION_OWNER_OPERATOR_PATH, ...guards, async (req, res) => {
    const body = req.body as unknown;
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1
      || !Object.hasOwn(body, 'expectedRevision') || !Number.isSafeInteger((body as any).expectedRevision)
      || (body as any).expectedRevision < 0) return res.status(400).json({ success: false });
    try {
      const owner = await authorize(req, res); if (!owner) return;
      const previous = await service.status({ db: owner.db }, owner.env);
      if (previous.revision !== (body as any).expectedRevision || previous.testDeliveryStatus) return res.status(409).json({ success: false });
      if (!affiliateNotificationOwnerOperatorEnabled(owner.env)) return res.status(404).json({ success: false });
      const rollout = await service.review({ db: owner.db, authenticatedWriterEmail: owner.email,
        request: { expectedRevision: (body as any).expectedRevision, mode: 'production_test', durationDays: 1, includeFoundingWelcome: false } }, owner.env);
      return res.json({ success: true, rollout });
    } catch (error) { return failure(res, error); }
  });
  app.post(AFFILIATE_NOTIFICATION_OWNER_OPERATOR_PATH, ...guards, async (req, res) => {
    if (!empty(req.body)) return res.status(400).json({ success: false });
    try {
      const owner = await authorize(req, res); if (!owner) return;
      if (!affiliateNotificationOwnerOperatorEnabled(owner.env)) return res.status(404).json({ success: false });
      const result = await service.test({ db: owner.db, authenticatedWriterEmail: owner.email }, owner.env);
      const rollout = await service.status({ db: owner.db }, owner.env);
      return res.status(result.status === 'failed' ? 503 : 200).json({
        success: result.status === 'accepted' || result.status === 'already_processed', result: { status: result.status }, rollout,
      });
    } catch (error) { return failure(res, error); }
  });
}
