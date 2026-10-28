import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import type { RequestHandler } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import { isAllowedPublicWriteOrigin } from '../../src/server/publicWriteOrigin.js';
import { registerWriterIdentityConsolidationRoutes, WRITER_RECOVERY_CAPABILITY_PATH } from '../../src/server/writerIdentityConsolidationRoutes.js';
import { WriterIdentityConsolidationError, WRITER_CONSOLIDATION_OWNER } from '../../src/server/writerIdentityConsolidation.js';

const fixtureToken = `wcr1_${'a'.repeat(43)}`;
const fixturePassword = 'SyntheticNewPassword1!';
type Mode = 'review_required' | 'ready' | 'pending';

/** Test-only composition: actual HTTP routes/parser/headers, isolated services. */
export function createWriterSecurityQaApp(assets: { script: string; css: string; fonts: string }) {
  const app = express();
  let mode: Mode = 'review_required', active = true;
  let counts = { issues: 0, emails: 0, consumes: 0, hashes: 0, capabilityReads: 0, statusReads: 0, databaseAccesses: 0, cookieClears: 0 };
  let postMetadata = { origin: '', referer: '', contentType: '', keys: [] as string[] };
  app.use(helmet({ contentSecurityPolicy: { directives: {
    scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"], styleSrc: ["'self'", "'unsafe-inline'"],
    connectSrc: ["'self'"], formAction: ["'self'"],
    // The lab binds HTTP loopback only. Production HTTPS policy is unchanged.
    upgradeInsecureRequests: null,
  } } }));
  app.use(cookieParser());
  const sameOrigin: RequestHandler = (req, res, next) => {
    if (!isAllowedPublicWriteOrigin({ origin: req.get('origin'), requestOrigin: `${req.protocol}://${req.get('host')}`,
      fetchSite: req.get('sec-fetch-site'), production: false })) {
      res.status(403).json({ success: false, error: 'Synthetic strict origin check rejected the request.' }); return;
    }
    next();
  };
  // Exercise the same strict cookie-origin boundary before body parsing.
  app.use((req, res, next) => req.method === 'POST' && req.cookies.writer_qa ? sameOrigin(req, res, next) : next());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use((req, _res, next) => {
    if (req.method === 'POST' && req.path === WRITER_RECOVERY_CAPABILITY_PATH) postMetadata = {
      origin: req.get('origin') || '', referer: req.get('referer') || '', contentType: req.get('content-type') || '', keys: Object.keys(req.body || {}).sort(),
    };
    next();
  });
  const service = {
    async status() { counts.statusReads++; return { status: mode, memberCount: 4, canIssue: mode === 'ready' }; },
    async issue(actor: { id: string; role: string }) {
      if (actor.id !== 'user_synthetic_writer' || actor.role !== 'admin') throw new Error('Unexpected synthetic actor.');
      if (mode !== 'ready') throw new WriterIdentityConsolidationError('conflict');
      counts.issues++; mode = 'pending'; return { token: fixtureToken, expiresAt: Date.now() + 3_600_000 };
    },
    async isActive(token: unknown) { counts.capabilityReads++; return active && token === fixtureToken; },
    async consume(token: unknown, hash: string, password: string) {
      if (!active || token !== fixtureToken || hash !== 'synthetic-server-hash' || password !== fixturePassword) return null;
      active = false; counts.consumes++; return { user: {}, resetAt: '2026-10-28T00:00:00.000Z', identityGeneration: 'synthetic-only' };
    },
  };
  registerWriterIdentityConsolidationRoutes(app, {
    requireAdminAuth: (req, _res, next) => { (req as any).user = { id: 'user_synthetic_writer', email: WRITER_CONSOLIDATION_OWNER, role: 'admin' }; next(); },
    sameOrigin,
    issueLimiter: rateLimit({ windowMs: 900_000, max: 5, standardHeaders: true, legacyHeaders: false }),
    capabilityLimiter: rateLimit({ windowMs: 900_000, max: 20, standardHeaders: true, legacyHeaders: false }),
    getDb: () => { counts.databaseAccesses++; throw new Error('Database access is forbidden in this lab.'); },
    service: service as any,
    sendEmail: async options => {
      if (options.to !== WRITER_CONSOLIDATION_OWNER) throw new Error('Unexpected synthetic recipient.');
      counts.emails++; throw new Error('Synthetic ambiguous provider result; no provider was called.');
    },
    hashPassword: async password => { if (password !== fixturePassword) throw new Error('Unexpected synthetic password.'); counts.hashes++; return 'synthetic-server-hash'; },
    clearSessionCookie: res => { counts.cookieClears++; res.clearCookie('writer_qa'); },
  });
  app.get('/', (_req, res) => res.type('html').send('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body style="background:#080f20"><div id="root"></div><script type="module" src="/lab.js"></script></body></html>'));
  app.get('/lab.js', (_req, res) => res.type('application/javascript').sendFile(assets.script));
  app.get('/style.css', (_req, res) => res.type('text/css').sendFile(assets.css));
  app.get('/fonts/:name', (req, res) => {
    if (!/^[a-z0-9-]+\.woff2$/.test(req.params.name)) { res.sendStatus(404); return; }
    const file = path.join(assets.fonts, req.params.name);
    if (!fs.existsSync(file)) { res.sendStatus(404); return; }
    res.type('font/woff2').sendFile(file);
  });
  app.get('/favicon.ico', (_req, res) => res.sendStatus(204));
  app.use((_req, res) => res.status(404).json({ success: false, error: 'Unknown synthetic route.' }));
  return { app,
    reset(next: Mode) { mode = next; active = true; counts = { issues: 0, emails: 0, consumes: 0, hashes: 0, capabilityReads: 0, statusReads: 0, databaseAccesses: 0, cookieClears: 0 }; postMetadata = { origin: '', referer: '', contentType: '', keys: [] }; },
    ready() { mode = 'ready'; },
    snapshot() { return { ...counts, postMetadata }; },
  };
}
