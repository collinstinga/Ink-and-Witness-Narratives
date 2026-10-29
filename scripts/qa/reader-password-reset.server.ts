import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import type { RequestHandler } from 'express';
import { isAllowedPublicWriteOrigin } from '../../src/server/publicWriteOrigin.js';
import { READER_PASSWORD_RESET_PATH, registerReaderPasswordResetRoutes } from '../../src/server/readerPasswordResetRoutes.js';

const token = `pr1_${'a'.repeat(43)}`;
const password = 'SyntheticReaderPassword1!';

/** Actual reader reset routes and strict origin composition. All credential,
 * persistence and session operations below are synthetic and memory-only. */
export function createReaderPasswordResetQaApp() {
  const app = express();
  let active = true, uncertain = false;
  let counts = { consumes: 0, hashes: 0, capabilityReads: 0, cookieClears: 0, localCleanup: 0, posts: 0 };
  let postMetadata = { origin: '', referer: '', contentType: '', accept: '', keys: [] as string[] };
  let blockedOrigin = '';
  app.use(helmet({ contentSecurityPolicy: { directives: { scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
    connectSrc: ["'self'"], formAction: ["'self'"], upgradeInsecureRequests: null } } }));
  app.use(cookieParser());
  const sameOrigin: RequestHandler = (req, res, next) => {
    if (!isAllowedPublicWriteOrigin({ origin: req.get('origin'), requestOrigin: `${req.protocol}://${req.get('host')}`,
      fetchSite: req.get('sec-fetch-site'), production: false })) {
      blockedOrigin = req.get('origin') || '';
      res.status(403).json({ success: false, error: 'This request was blocked because it did not originate from this site.', code: 'ORIGIN_CHECK_FAILED' }); return;
    }
    next();
  };
  // Match the production cookie guard BEFORE body parsing. Do not exempt the
  // reset route or accept Origin:null to make a synthetic test pass.
  app.use((req, res, next) => req.method === 'POST' && (req.cookies.reader_qa || req.cookies.writer_qa)
    ? sameOrigin(req, res, next) : next());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use((req, _res, next) => {
    if (req.method === 'POST' && req.path === READER_PASSWORD_RESET_PATH) {
      counts.posts++;
      postMetadata = { origin: req.get('origin') || '', referer: req.get('referer') || '', contentType: req.get('content-type') || '',
        accept: req.get('accept') || '', keys: Object.keys(req.body || {}).sort() };
    }
    if (req.path === '/password-reset') req.url = `${READER_PASSWORD_RESET_PATH}${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`;
    next();
  });
  registerReaderPasswordResetRoutes(app, {
    sameOrigin, capabilityLimiter: (_req, _res, next) => next(),
    service: {
      async isActive(value) { counts.capabilityReads++; return active && value === token; },
      async consume(value, hash) {
        if (!active || value !== token || hash !== '$argon2id$synthetic-only') return null;
        active = false; counts.consumes++;
        if (uncertain) throw new Error('Synthetic acknowledgment lost after commit.');
        return { user: { id: 'user_synthetic_reader', email: 'reader@example.invalid', role: 'client', name: 'Synthetic reader',
          passwordHash: hash, createdAt: '2026-10-29T00:00:00.000Z' }, resetAt: '2026-10-29T08:00:00.000Z' };
      },
    },
    hashPassword: async value => { if (value !== password) throw new Error('Unexpected synthetic password.'); counts.hashes++; return '$argon2id$synthetic-only'; },
    applyPasswordResetUser: async () => { counts.localCleanup++; },
    clearSessionCookie: res => { counts.cookieClears++; res.clearCookie('reader_qa'); res.clearCookie('writer_qa'); },
  });
  app.get('/legacy-reader-password-reset', (_req, res) => {
    res.setHeader('Referrer-Policy', 'no-referrer');
    // Deliberately reproduce the pre-fix native-form behavior on a synthetic,
    // separate route. No production handler uses this old form.
    res.type('html').send(`<!doctype html><html><head><meta name="referrer" content="no-referrer"></head><body><form method="post" action="${READER_PASSWORD_RESET_PATH}"><input name="token" type="hidden" value="${token}"><label>New password<input name="password" type="password"></label><label>Confirm new password<input name="confirmPassword" type="password"></label><button type="submit">Legacy submit</button></form></body></html>`);
  });
  app.get('/favicon.ico', (_req, res) => res.sendStatus(204));
  app.use((_req, res) => res.status(404).json({ success: false, error: 'Unknown synthetic route.' }));
  return { app,
    reset(options: { uncertain?: boolean } = {}) { active = true; uncertain = Boolean(options.uncertain);
      counts = { consumes: 0, hashes: 0, capabilityReads: 0, cookieClears: 0, localCleanup: 0, posts: 0 };
      postMetadata = { origin: '', referer: '', contentType: '', accept: '', keys: [] }; blockedOrigin = ''; },
    snapshot() { return { ...counts, postMetadata, blockedOrigin }; },
  };
}
