import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { RequestHandler } from 'express';
import { WriterIdentityConsolidationError, WRITER_CONSOLIDATION_ORIGIN, WRITER_CONSOLIDATION_OWNER } from './writerIdentityConsolidation.js';
import { buildWriterIdentityRecoveryEmail, registerWriterIdentityConsolidationRoutes, WRITER_ACCOUNT_SECURITY_PATH, WRITER_RECOVERY_CAPABILITY_PATH, WRITER_RECOVERY_SCRIPT_PATH, WRITER_RECOVERY_FORM_SCRIPT } from './writerIdentityConsolidationRoutes.js';

const token = `wcr1_${'a'.repeat(43)}`;
const actor = { id: 'user_authenticated_writer', email: WRITER_CONSOLIDATION_OWNER, role: 'admin' };
const password = 'EntirelyNewPassword1!';
function fixture(options: { auth?: boolean; origin?: boolean; limited?: boolean } = {}) {
  const routes = new Map<string, RequestHandler[]>();
  const app: any = {
    get: (path: string, ...handlers: RequestHandler[]) => routes.set(`GET ${path}`, handlers),
    post: (path: string, ...handlers: RequestHandler[]) => routes.set(`POST ${path}`, handlers),
  };
  const service = {
    status: vi.fn(async (_actor: any) => ({ status: 'ready', memberCount: 4, canIssue: true } as any)),
    issue: vi.fn(async (_actor: any) => ({ token, expiresAt: 100000 })),
    isActive: vi.fn(async (_token: unknown) => true),
    consume: vi.fn(async (_token: unknown, _hash: string, _password: string) => ({ user: { id: actor.id, passwordHash: 'PRIVATE_HASH' }, resetAt: 'PRIVATE_RECEIPT', identityGeneration: 'PRIVATE_GENERATION' } as any)),
  };
  const guards: string[] = [];
  const getDb = vi.fn();
  const sendEmail = vi.fn(async (_options: any) => ({ providerMessageId: 'PRIVATE_PROVIDER_RECEIPT' }));
  const hashPassword = vi.fn(async (_password: string) => 'server_argon_hash');
  const clearSessionCookie = vi.fn();
  registerWriterIdentityConsolidationRoutes(app, {
    requireAdminAuth: (_req, res, next) => { guards.push('auth'); if (options.auth === false) res.status(401).json({ success: false }); else next(); },
    sameOrigin: (_req, res, next) => { guards.push('origin'); if (options.origin === false) res.status(403).json({ success: false }); else next(); },
    issueLimiter: (_req, res, next) => { guards.push('issue-limit'); if (options.limited) res.status(429).json({ success: false }); else next(); },
    capabilityLimiter: (_req, res, next) => { guards.push('capability-limit'); if (options.limited) res.status(429).json({ success: false }); else next(); },
    getDb, service: service as any, sendEmail, hashPassword, clearSessionCookie,
  });
  const invoke = async (method: 'GET' | 'POST', path: string, input: { body?: any; query?: any; user?: any; form?: boolean; accept?: string } = {}) => {
    const handlers = routes.get(`${method} ${path}`);
    if (!handlers) throw new Error('Unknown route');
    const req: any = { body: input.body, query: input.query || {}, headers: { accept: input.accept }, user: Object.hasOwn(input, 'user') ? input.user : actor,
      is: (type: string) => input.form && type === 'application/x-www-form-urlencoded', get: () => 'evil.example' };
    const res: any = { statusCode: 200, headers: {}, body: undefined,
      setHeader(name: string, value: string) { this.headers[name] = value; return this; },
      status(code: number) { this.statusCode = code; return this; }, type(type: string) { this.headers['Content-Type'] = type; return this; },
      json(value: unknown) { this.body = value; return this; }, send(value: string) { this.body = value; return this; } };
    for (const handler of handlers) {
      let next = false;
      await handler(req, res, () => { next = true; });
      if (!next) break;
    }
    return res;
  };
  return { routes, service, guards, getDb, sendEmail, hashPassword, clearSessionCookie, invoke };
}
const issuePath = `${WRITER_ACCOUNT_SECURITY_PATH}/password-recovery`;
const validReset = { token, password, confirmPassword: password };

describe('separate Writer Studio recovery HTTP boundary', () => {
  it.each(['GET', 'POST'] as const)('requires authentication before %s account operations and applies privacy headers even on rejection', async method => {
    const test = fixture({ auth: false });
    const response = await test.invoke(method, method === 'GET' ? WRITER_ACCOUNT_SECURITY_PATH : issuePath, { body: {} });
    expect(response.statusCode).toBe(401);
    expect(response.headers).toMatchObject({ 'Cache-Control': 'private, no-store, max-age=0', 'CDN-Cache-Control': 'no-store', 'Vercel-CDN-Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    expect(test.guards).toEqual(['auth']); expect(test.getDb).not.toHaveBeenCalled();
    expect(test.service.status).not.toHaveBeenCalled(); expect(test.service.issue).not.toHaveBeenCalled(); expect(test.sendEmail).not.toHaveBeenCalled();
  });
  it.each([null, { ...actor, role: 'client' }, { ...actor, role: 'affiliate' }, { ...actor, id: '../arbitrary' }, { ...actor, email: 'other@example.test' }])('refuses a non-approved server actor (%j)', async user => {
    const test = fixture();
    expect((await test.invoke('POST', issuePath, { body: {}, user })).statusCode).toBe(403);
    expect(test.service.issue).not.toHaveBeenCalled(); expect(test.sendEmail).not.toHaveBeenCalled();
  });
  it.each([{ origin: false }, { limited: true }])('enforces same-origin and request limits before issuing (%j)', async options => {
    const test = fixture(options);
    expect((await test.invoke('POST', issuePath, { body: {} })).statusCode).toBe(options.origin === false ? 403 : 429);
    expect(test.service.issue).not.toHaveBeenCalled(); expect(test.sendEmail).not.toHaveBeenCalled();
  });
  it.each([null, [], undefined, { canonicalUserId: 'user_arbitrary' }, { email: 'attacker@example.test' }, { token }, { force: true }])('requires an exact empty issuance body (%j)', async body => {
    const test = fixture();
    expect((await test.invoke('POST', issuePath, { body })).statusCode).toBe(400);
    expect(test.service.issue).not.toHaveBeenCalled(); expect(test.sendEmail).not.toHaveBeenCalled();
  });
  it('rejects query-selected issuance/status fields and does not expose a GET mutation', async () => {
    const test = fixture();
    expect((await test.invoke('POST', issuePath, { body: {}, query: { actor: 'spoof' } })).statusCode).toBe(400);
    expect((await test.invoke('GET', WRITER_ACCOUNT_SECURITY_PATH, { query: { user: 'spoof' } })).statusCode).toBe(400);
    expect(test.routes.has(`GET ${issuePath}`)).toBe(false); expect(test.service.issue).not.toHaveBeenCalled(); expect(test.service.status).not.toHaveBeenCalled();
  });
  it('exposes only safe readiness and takes the precise current session actor, not an email-selected duplicate', async () => {
    const test = fixture();
    test.service.status.mockResolvedValueOnce({ status: 'ready', memberCount: 4, canIssue: true, token, memberUserIds: ['PRIVATE_ID'], backupPath: 'PRIVATE_BACKUP', passwordHash: 'PRIVATE_HASH' });
    const response = await test.invoke('GET', WRITER_ACCOUNT_SECURITY_PATH);
    expect(test.service.status).toHaveBeenCalledExactlyOnceWith(actor);
    expect(response.body).toEqual({ success: true, security: { status: 'ready', memberCount: 4, canIssue: true } });
    expect(JSON.stringify(response.body)).not.toMatch(/PRIVATE|wcr1_|gmail/);
  });
  it('sends one fixed HTTPS owner email and never returns a capability, session or private receipt', async () => {
    const test = fixture();
    const response = await test.invoke('POST', issuePath, { body: {} });
    expect(test.service.issue).toHaveBeenCalledExactlyOnceWith(actor);
    expect(test.sendEmail).toHaveBeenCalledTimes(1);
    const sent = test.sendEmail.mock.calls[0][0];
    expect(sent.to).toBe(WRITER_CONSOLIDATION_OWNER);
    expect(sent.text).toContain(`${WRITER_CONSOLIDATION_ORIGIN}${WRITER_RECOVERY_CAPABILITY_PATH}?token=${token}`);
    expect(sent.text).not.toContain('evil.example');
    expect(sent.idempotencyKey).toBe(`writer-identity-recovery-${crypto.createHash('sha256').update(token).digest('hex')}`);
    expect(response.statusCode).toBe(202);
    expect(response.body).toEqual({ success: true, recovery: { status: 'pending', expiresAt: 100000, delivery: 'accepted' } });
    expect(JSON.stringify(response.body)).not.toMatch(/PRIVATE|wcr1_|passwordHash|user_|gmail/);
    expect(test.service.consume).not.toHaveBeenCalled(); expect(test.clearSessionCookie).not.toHaveBeenCalled();
  });
  it('retains pending recovery after an ambiguous provider error and does not automatically retry or reissue', async () => {
    const test = fixture();
    test.sendEmail.mockRejectedValueOnce(new Error(`PRIVATE_PROVIDER_KEY ${token}`));
    const response = await test.invoke('POST', issuePath, { body: {} });
    expect(response.statusCode).toBe(202); expect(response.body.recovery.delivery).toBe('unconfirmed');
    expect(test.sendEmail).toHaveBeenCalledTimes(1); expect(test.service.issue).toHaveBeenCalledTimes(1);
    test.service.issue.mockRejectedValueOnce(new WriterIdentityConsolidationError('conflict'));
    expect((await test.invoke('POST', issuePath, { body: {} })).statusCode).toBe(409);
    expect(test.sendEmail).toHaveBeenCalledTimes(1); expect(JSON.stringify(response.body)).not.toMatch(/PRIVATE|wcr1_/);
  });
  it('sanitizes core infrastructure errors without emailing', async () => {
    const test = fixture();
    test.service.issue.mockRejectedValueOnce(new Error(`PRIVATE_HASH ${token}`));
    const response = await test.invoke('POST', issuePath, { body: {} });
    expect(response.statusCode).toBe(503); expect(JSON.stringify(response.body)).not.toMatch(/PRIVATE|wcr1_/); expect(test.sendEmail).not.toHaveBeenCalled();
  });
  it('renders only an active writer capability and GET does not consume, hash, email or alter the session', async () => {
    const test = fixture();
    const response = await test.invoke('GET', WRITER_RECOVERY_CAPABILITY_PATH, { query: { token } });
    expect(response.statusCode).toBe(200); expect(response.body).toContain(`name="token" value="${token}"`);
    expect(response.body).toContain('autocomplete="new-password"'); expect(response.headers['Referrer-Policy']).toBe('no-referrer');
    expect(test.service.isActive).toHaveBeenCalledExactlyOnceWith(token);
    expect(test.service.consume).not.toHaveBeenCalled(); expect(test.hashPassword).not.toHaveBeenCalled(); expect(test.sendEmail).not.toHaveBeenCalled(); expect(test.clearSessionCookie).not.toHaveBeenCalled();
  });
  it('loads a capability-free same-origin external script and leaves native submission disabled until the strict-origin-safe handler is ready', async () => {
    const test = fixture();
    const response = await test.invoke('GET', WRITER_RECOVERY_SCRIPT_PATH, { user: null });
    expect(response.statusCode).toBe(200); expect(response.headers['Content-Type']).toBe('application/javascript');
    expect(response.headers['Referrer-Policy']).toBe('no-referrer');
    expect(response.body).toBe(WRITER_RECOVERY_FORM_SCRIPT); expect(response.body).not.toContain(token);
    expect(response.body).toContain("mode: 'cors'"); expect(response.body).toContain("referrerPolicy: 'no-referrer'");
    expect(response.body).toContain('event.preventDefault()'); expect(response.body).toContain('if (busy || !form.reportValidity()) return');
    expect(response.body).toContain("response.status === 400"); expect(response.body).not.toMatch(/console\.|localStorage|sessionStorage|setTimeout|setInterval/);
    expect(() => new Function(response.body)).not.toThrow();
    expect(test.service.isActive).not.toHaveBeenCalled(); expect(test.service.consume).not.toHaveBeenCalled(); expect(test.getDb).not.toHaveBeenCalled();
    const form = await test.invoke('GET', WRITER_RECOVERY_CAPABILITY_PATH, { query: { token } });
    expect(form.body).toContain(`src="${WRITER_RECOVERY_SCRIPT_PATH}" defer`);
    expect(form.body).toContain('id="writer-recovery-submit" type="submit" disabled');
    expect((await test.invoke('GET', WRITER_RECOVERY_SCRIPT_PATH, { query: { token } })).statusCode).toBe(400);
  });
  it('returns JSON for the enhanced URL-encoded form only when explicitly requested, without changing native-form or reader behavior', async () => {
    const test = fixture();
    const response = await test.invoke('POST', WRITER_RECOVERY_CAPABILITY_PATH, { body: validReset, form: true, accept: 'application/json' });
    expect(response.body).toEqual({ success: true, message: 'Writer Studio password updated. Sign in normally with your new password.' });
    expect(test.service.consume).toHaveBeenCalledExactlyOnceWith(token, 'server_argon_hash', password);
    expect(test.clearSessionCookie).toHaveBeenCalledTimes(1);
  });
  it.each([{ token: `pr1_${'a'.repeat(43)}` }, { token: [token, token] }, { token, actor: 'spoof' }, {}])('rejects reader-purpose/malformed/query-spoofed GET capabilities (%j)', async query => {
    const test = fixture();
    expect((await test.invoke('GET', WRITER_RECOVERY_CAPABILITY_PATH, { query })).statusCode).toBe(400);
    expect(test.service.isActive).not.toHaveBeenCalled(); expect(test.service.consume).not.toHaveBeenCalled();
  });
  it('does not echo an expired capability into the form', async () => {
    const test = fixture(); test.service.isActive.mockResolvedValueOnce(false);
    const response = await test.invoke('GET', WRITER_RECOVERY_CAPABILITY_PATH, { query: { token } });
    expect(response.statusCode).toBe(410); expect(response.body).not.toContain(token); expect(test.service.consume).not.toHaveBeenCalled();
  });
  it.each([{ ...validReset, token: `pr1_${'a'.repeat(43)}` }, { ...validReset, password: 'weak', confirmPassword: 'weak' },
    { ...validReset, confirmPassword: 'not-matching' }, { ...validReset, password: 'A1'.repeat(129), confirmPassword: 'A1'.repeat(129) },
    { ...validReset, actor: 'spoof' }, { token, password }])('rejects malformed or weak password submission before hashing (%j)', async body => {
    const test = fixture();
    expect((await test.invoke('POST', WRITER_RECOVERY_CAPABILITY_PATH, { body })).statusCode).toBe(400);
    expect(test.hashPassword).not.toHaveBeenCalled(); expect(test.service.consume).not.toHaveBeenCalled();
  });
  it('checks an active capability before expensive Argon work and core still decides one-use atomically', async () => {
    const test = fixture(); test.service.isActive.mockResolvedValueOnce(false);
    expect((await test.invoke('POST', WRITER_RECOVERY_CAPABILITY_PATH, { body: validReset })).statusCode).toBe(410);
    expect(test.hashPassword).not.toHaveBeenCalled();
    test.service.consume.mockResolvedValueOnce(null);
    expect((await test.invoke('POST', WRITER_RECOVERY_CAPABILITY_PATH, { body: validReset })).statusCode).toBe(410);
    expect(test.clearSessionCookie).not.toHaveBeenCalled();
  });
  it.each([{ origin: false }, { limited: true }])('applies origin and capability limiter before password work (%j)', async options => {
    const test = fixture(options);
    expect((await test.invoke('POST', WRITER_RECOVERY_CAPABILITY_PATH, { body: validReset })).statusCode).toBe(options.origin === false ? 403 : 429);
    expect(test.service.isActive).not.toHaveBeenCalled(); expect(test.hashPassword).not.toHaveBeenCalled();
  });
  it.each([false, true])('consumes only a server-hashed strong password, clears the cookie and never auto-signs in (form=%s)', async form => {
    const test = fixture();
    const response = await test.invoke('POST', WRITER_RECOVERY_CAPABILITY_PATH, { body: validReset, form });
    expect(response.statusCode).toBe(200); expect(test.hashPassword).toHaveBeenCalledExactlyOnceWith(password);
    expect(test.service.consume).toHaveBeenCalledExactlyOnceWith(token, 'server_argon_hash', password);
    expect(test.clearSessionCookie).toHaveBeenCalledExactlyOnceWith(response);
    expect(JSON.stringify(response.body)).toContain('Sign in normally');
    expect(JSON.stringify(response.body)).not.toMatch(/PRIVATE|wcr1_|server_argon_hash|EntirelyNewPassword|user_/);
    expect(test.sendEmail).not.toHaveBeenCalled();
  });
  it('uses no logging, automatic session creation or reader mutation in the new boundary', () => {
    const source = readFileSync(new URL('./writerIdentityConsolidationRoutes.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/console\.|createAuthSession|applyPasswordResetUser|discard\(/);
    expect(source).toContain('service.consume(token, await hash(password), password)');
    expect(source).not.toContain('req.get(');
    const content = buildWriterIdentityRecoveryEmail(token);
    expect(content.text).toContain('current login remains unchanged');
    expect(() => buildWriterIdentityRecoveryEmail('pr1_invalid')).toThrow();
  });
});
