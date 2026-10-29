import { describe, expect, it, vi } from 'vitest';
import type { RequestHandler } from 'express';
import { readerPasswordResetPage, registerReaderPasswordResetRoutes, READER_PASSWORD_RESET_FORM_SCRIPT,
  READER_PASSWORD_RESET_PATH, READER_PASSWORD_RESET_SCRIPT_PATH } from './readerPasswordResetRoutes.js';

const token = `pr1_${'a'.repeat(43)}`;
const password = 'SyntheticReaderPassword1!';
function fixture(options: { sameOrigin?: boolean; limited?: boolean } = {}) {
  const routes = new Map<string, RequestHandler[]>();
  let active = true;
  const service = { isActive: vi.fn(async (_token: unknown) => active), consume: vi.fn(async (_token: unknown, _hash: string) => {
    if (!active) return null; active = false;
    return { user: { id: 'user_synthetic_reader', role: 'client', email: 'PRIVATE_EMAIL', passwordHash: 'PRIVATE_HASH' }, resetAt: 'PRIVATE_RESET_TIME' } as any;
  }) };
  const guards: string[] = [];
  const clearSessionCookie = vi.fn(), applyPasswordResetUser = vi.fn(async (_user: any) => {}), hashPassword = vi.fn(async (_password: string) => '$argon2id$synthetic-hash');
  registerReaderPasswordResetRoutes({
    get: (path: string, ...handlers: RequestHandler[]) => routes.set(`GET ${path}`, handlers),
    post: (path: string, ...handlers: RequestHandler[]) => routes.set(`POST ${path}`, handlers),
  } as any, { service, clearSessionCookie, applyPasswordResetUser, hashPassword,
    sameOrigin: (_req, res, next) => { guards.push('origin'); if (options.sameOrigin === false) res.status(403).json({ success: false, error: 'Origin rejected' }); else next(); },
    capabilityLimiter: (_req, res, next) => { guards.push('limit'); if (options.limited) res.status(429).json({ success: false }); else next(); },
  });
  const invoke = async (method: 'GET' | 'POST', path = READER_PASSWORD_RESET_PATH, input: { query?: any; body?: any; form?: boolean; accept?: string } = {}) => {
    const req: any = { query: input.query || {}, body: input.body, headers: { accept: input.accept },
      is: (type: string) => input.form && type === 'application/x-www-form-urlencoded' };
    const res: any = { statusCode: 200, headers: {}, body: undefined,
      setHeader(name: string, value: string) { this.headers[name] = value; return this; },
      status(code: number) { this.statusCode = code; return this; }, type(type: string) { this.headers['Content-Type'] = type; return this; },
      json(value: unknown) { this.body = value; return this; }, send(value: string) { this.body = value; return this; } };
    for (const handler of routes.get(`${method} ${path}`) || []) {
      let next = false; await handler(req, res, () => { next = true; }); if (!next) break;
    }
    return res;
  };
  return { routes, guards, service, clearSessionCookie, applyPasswordResetUser, hashPassword, invoke };
}
const request = { token, password, confirmPassword: password };

describe('reader password recovery HTTP boundary', () => {
  it('opens a private reset page without consuming its capability, including repeated scanner visits', async () => {
    const h = fixture();
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await h.invoke('GET', undefined, { query: { token } });
      expect(response.statusCode).toBe(200); expect(response.body).toContain('reader-password-reset-form');
      expect(response.body).toContain(READER_PASSWORD_RESET_SCRIPT_PATH);
      expect(response.body).toMatch(/id="reader-password-reset-submit"[^>]+disabled/);
      expect(response.headers).toMatchObject({ 'Cache-Control': 'private, no-store, max-age=0', 'Referrer-Policy': 'no-referrer',
        'CDN-Cache-Control': 'no-store', 'Vercel-CDN-Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow, noarchive' });
    }
    expect(h.service.isActive).toHaveBeenCalledTimes(2); expect(h.service.consume).not.toHaveBeenCalled(); expect(h.hashPassword).not.toHaveBeenCalled();
    expect(h.clearSessionCookie).not.toHaveBeenCalled(); expect(h.applyPasswordResetUser).not.toHaveBeenCalled();
  });

  it('serves a capability-free same-origin script that keeps Origin while omitting Referer', async () => {
    const h = fixture(), response = await h.invoke('GET', READER_PASSWORD_RESET_SCRIPT_PATH);
    expect(response.headers['Content-Type']).toBe('application/javascript'); expect(response.body).toBe(READER_PASSWORD_RESET_FORM_SCRIPT);
    expect(response.body).toContain("mode: 'cors'"); expect(response.body).toContain("referrerPolicy: 'no-referrer'");
    expect(response.body).toContain("headers: { Accept: 'application/json' }");
    expect(response.body).toContain("credentials: 'same-origin'"); expect(response.body).toContain("redirect: 'error'");
    expect(response.body).toContain('if (busy || !form.reportValidity()) return;');
    expect(response.body).toContain("history.replaceState(null, '', location.pathname)");
    expect(response.body).not.toContain(token); expect(response.body).not.toContain('setInterval(');
    expect(h.service.isActive).not.toHaveBeenCalled();
  });

  it('rejects malformed, expired and writer-purpose reset links without hashing or credential changes', async () => {
    const h = fixture();
    expect((await h.invoke('GET', undefined, { query: { token: `wcr1_${'a'.repeat(43)}` } })).statusCode).toBe(400);
    h.service.isActive.mockResolvedValueOnce(false);
    const expired = await h.invoke('GET', undefined, { query: { token } });
    expect(expired.statusCode).toBe(410); expect(expired.body).toContain('latest reset email'); expect(expired.body).not.toContain(token);
    expect(h.service.consume).not.toHaveBeenCalled(); expect(h.hashPassword).not.toHaveBeenCalled();
  });

  it.each([{ sameOrigin: false }, { limited: true }])('applies strict origin and rate guards before hashing or consuming: %j', async options => {
    const h = fixture(options), response = await h.invoke('POST', undefined, { body: request });
    expect(response.statusCode).toBe(options.sameOrigin === false ? 403 : 429);
    expect(response.headers['Referrer-Policy']).toBe('no-referrer');
    expect(h.service.isActive).not.toHaveBeenCalled(); expect(h.service.consume).not.toHaveBeenCalled(); expect(h.hashPassword).not.toHaveBeenCalled();
  });

  it.each([undefined, null, [], { ...request, email: 'arbitrary@example.invalid' }, { ...request, userId: 'user_otheraccount' },
    { ...request, token: `wcr1_${'a'.repeat(43)}` }, { ...request, confirmPassword: 'different' },
    { ...request, password: 'short', confirmPassword: 'short' }])('rejects malformed input or weak/mismatched passwords: %j', async body => {
    const h = fixture(), response = await h.invoke('POST', undefined, { body });
    expect(response.statusCode).toBe(400); expect(h.service.consume).not.toHaveBeenCalled(); expect(h.hashPassword).not.toHaveBeenCalled();
  });

  it('checks expiry before expensive hashing and rejects query-selected changes', async () => {
    const h = fixture();
    expect((await h.invoke('POST', undefined, { query: { userId: 'user_otheraccount' }, body: request })).statusCode).toBe(400);
    h.service.isActive.mockResolvedValueOnce(false);
    expect((await h.invoke('POST', undefined, { body: request })).statusCode).toBe(410);
    expect(h.hashPassword).not.toHaveBeenCalled(); expect(h.service.consume).not.toHaveBeenCalled();
  });

  it('consumes once, clears the current cookie and reports JSON to the URL-encoded fetch without exposing account records', async () => {
    const h = fixture();
    const response = await h.invoke('POST', undefined, { body: request, form: true, accept: 'application/json' });
    expect(response.statusCode).toBe(200); expect(response.body).toEqual({ success: true, message: 'Password updated. Sign in with your new password.' });
    expect(h.service.consume).toHaveBeenCalledExactlyOnceWith(token, '$argon2id$synthetic-hash');
    expect(h.hashPassword).toHaveBeenCalledExactlyOnceWith(password);
    expect(h.clearSessionCookie).toHaveBeenCalledOnce(); expect(h.applyPasswordResetUser).toHaveBeenCalledOnce();
    expect(JSON.stringify(response.body)).not.toMatch(/PRIVATE|pr1_|user_|passwordHash/);
    expect((await h.invoke('POST', undefined, { body: request, accept: 'application/json' })).statusCode).toBe(410);
    expect(h.service.consume).toHaveBeenCalledOnce(); expect(h.hashPassword).toHaveBeenCalledOnce();
  });

  it('returns a safe uncertain outcome without automatic retry after a persistence error', async () => {
    const h = fixture(); h.service.consume.mockRejectedValueOnce(new Error('PRIVATE storage failure'));
    const response = await h.invoke('POST', undefined, { body: request, accept: 'application/json' });
    expect(response.statusCode).toBe(503); expect(response.body.error).toContain('No automatic retry');
    expect(JSON.stringify(response.body)).not.toMatch(/PRIVATE|pr1_|user_/);
    expect(h.service.consume).toHaveBeenCalledOnce(); expect(h.clearSessionCookie).not.toHaveBeenCalled();
  });

  it('escapes error markup and never embeds a malformed capability in the form', () => {
    const page = readerPasswordResetPage('bad<script>', '<img src=x onerror=alert(1)>');
    expect(page).not.toContain('<img'); expect(page).not.toContain('value="bad'); expect(page).toContain('&lt;img');
  });
});
