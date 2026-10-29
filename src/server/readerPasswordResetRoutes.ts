import type { Express, Request, RequestHandler, Response } from 'express';
import type { UserRecord } from '../types.js';
import { hashPassword, validatePasswordStrength } from './auth.js';
import type { PasswordResetStore } from './passwordResetStore.js';
import { PASSWORD_RESET_TOKEN_PATTERN } from './passwordResetSecurity.js';

export const READER_PASSWORD_RESET_PATH = '/api/auth/password-reset';
export const READER_PASSWORD_RESET_SCRIPT_PATH = `${READER_PASSWORD_RESET_PATH}/form.js`;

// Native navigation forms with no-referrer send Origin:null. CORS-mode fetch
// preserves the genuine Origin without exposing the secret URL as Referer.
// Keep both the global cookie-origin guard and route same-origin check strict.
export const READER_PASSWORD_RESET_FORM_SCRIPT = `(() => {
  'use strict';
  const form = document.getElementById('reader-password-reset-form');
  const button = document.getElementById('reader-password-reset-submit');
  const status = document.getElementById('reader-password-reset-status');
  if (!(form instanceof HTMLFormElement) || !(button instanceof HTMLButtonElement) || !status) return;
  const token = form.elements.namedItem('token');
  const password = form.elements.namedItem('password');
  const confirmation = form.elements.namedItem('confirmPassword');
  if (!(token instanceof HTMLInputElement) || !/^pr1_[A-Za-z0-9_-]{43}$/.test(token.value)
    || !(password instanceof HTMLInputElement) || !(confirmation instanceof HTMLInputElement)) return;
  let busy = false;
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !form.reportValidity()) return;
    if (password.value !== confirmation.value) {
      status.setAttribute('role', 'alert'); status.textContent = 'Enter the same new password in both fields.'; return;
    }
    busy = true; button.disabled = true; form.setAttribute('aria-busy', 'true');
    status.setAttribute('role', 'status'); status.textContent = 'Updating your reader password securely…';
    try {
      const response = await fetch(form.action, {
        method: 'POST', mode: 'cors', credentials: 'same-origin', cache: 'no-store',
        referrerPolicy: 'no-referrer', redirect: 'error', headers: { Accept: 'application/json' },
        body: new URLSearchParams({ token: token.value, password: password.value, confirmPassword: confirmation.value })
      });
      const result = await response.json();
      password.value = ''; confirmation.value = '';
      if (!response.ok || result.success !== true) {
        status.setAttribute('role', 'alert'); status.textContent = typeof result.error === 'string' ? result.error : 'Password reset could not be confirmed. Reopen the link before continuing.';
        if (response.status === 400) { busy = false; button.disabled = false; }
        return;
      }
      token.value = ''; form.remove();
      history.replaceState(null, '', location.pathname);
      status.textContent = 'Your reader password has been updated. Previous reader sessions are signed out. Sign in with your new password to access your existing library.';
      const link = document.createElement('a'); link.href = '/#sign-in'; link.textContent = 'Sign in with your new password'; link.style.color = '#38bdf8'; status.after(link);
    } catch {
      password.value = ''; confirmation.value = '';
      status.setAttribute('role', 'alert'); status.textContent = 'The result is uncertain. Try signing in with your new password; otherwise reopen this link. No automatic retry was sent.';
    } finally { form.removeAttribute('aria-busy'); }
  });
  button.disabled = false;
})();`;

const escapeHtml = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
export function readerPasswordResetPage(token = '', error = '', result?: { title: string; message: string }): string {
  const safeToken = PASSWORD_RESET_TOKEN_PATTERN.test(token) ? token : '';
  const form = !result && safeToken ? `<p style="line-height:1.7;color:#cbd5e1">Use at least eight characters, including a letter and a number or special character. This link works once; requesting another link replaces the previous link.</p>
<form id="reader-password-reset-form" method="post" action="${READER_PASSWORD_RESET_PATH}" style="margin-top:24px;display:grid;gap:16px">
<input type="hidden" name="token" value="${safeToken}">
<label style="display:grid;gap:7px">New password<input type="password" name="password" autocomplete="new-password" minlength="8" maxlength="256" required style="box-sizing:border-box;width:100%;padding:12px;border:1px solid #475569;border-radius:10px;background:#080d17;color:white;font-size:16px"></label>
<label style="display:grid;gap:7px">Confirm new password<input type="password" name="confirmPassword" autocomplete="new-password" minlength="8" maxlength="256" required style="box-sizing:border-box;width:100%;padding:12px;border:1px solid #475569;border-radius:10px;background:#080d17;color:white;font-size:16px"></label>
<button id="reader-password-reset-submit" type="submit" disabled style="border:0;border-radius:10px;background:#0284c7;color:white;padding:13px;font-weight:700">Reset password</button></form>
<p id="reader-password-reset-status" role="status" aria-live="polite" style="line-height:1.7"></p><noscript><p>Enable JavaScript to submit securely without exposing the reset link in a referrer.</p></noscript><script src="${READER_PASSWORD_RESET_SCRIPT_PATH}" defer></script>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${escapeHtml(result?.title || 'Reset your reader password')}</title></head><body style="margin:0;background:#080d17;color:#e2e8f0;font-family:Georgia,serif;min-height:100vh;display:grid;place-items:center;padding:24px;box-sizing:border-box"><main style="width:min(560px,100%);background:#0f172a;border:1px solid #334155;border-radius:20px;padding:32px;box-sizing:border-box;overflow-wrap:anywhere"><p style="font:700 12px Arial,sans-serif;letter-spacing:.16em;text-transform:uppercase;color:#38bdf8">Ink &amp; Witness Narratives</p><h1 style="font-size:30px;color:white">${escapeHtml(result?.title || 'Choose a new password')}</h1>${error ? `<p role="alert" style="color:#fecdd3;line-height:1.5">${escapeHtml(error)}</p>` : ''}${result ? `<p style="line-height:1.7;color:#cbd5e1">${escapeHtml(result.message)}</p>` : ''}${form}<p><a href="/#sign-in" style="color:#38bdf8">Return to reader sign in</a></p></main></body></html>`;
}

function noStore(_req: Request, res: Response, next: () => void) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('CDN-Cache-Control', 'no-store'); res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive'); next();
}
const plainObject = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));

/** Reader-only capabilities remain separate from owner identity consolidation.
 * GET is a read: email scanners cannot consume the one-use capability. */
export function registerReaderPasswordResetRoutes(app: Pick<Express, 'get' | 'post'>, options: {
  service: Pick<PasswordResetStore, 'isActive' | 'consume'>;
  sameOrigin: RequestHandler;
  capabilityLimiter: RequestHandler;
  clearSessionCookie: (res: Response) => void;
  applyPasswordResetUser: (user: UserRecord) => Promise<void>;
  hashPassword?: typeof hashPassword;
}): void {
  const hash = options.hashPassword || hashPassword;
  app.get(READER_PASSWORD_RESET_SCRIPT_PATH, noStore, (_req, res) => res.type('application/javascript').send(READER_PASSWORD_RESET_FORM_SCRIPT));
  app.get(READER_PASSWORD_RESET_PATH, noStore, options.capabilityLimiter, async (req, res) => {
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    if (!PASSWORD_RESET_TOKEN_PATTERN.test(token)) return res.status(400).type('html').send(readerPasswordResetPage('', '', {
      title: 'Reset link unavailable', message: 'This password reset link is invalid or incomplete. Request a new link from reader sign in.',
    }));
    try {
      if (!await options.service.isActive(token)) return res.status(410).type('html').send(readerPasswordResetPage('', '', {
        title: 'Reset link unavailable', message: 'This link has expired, has already been used, or was replaced by a newer request. Open the latest reset email or request a new link.',
      }));
      return res.type('html').send(readerPasswordResetPage(token));
    } catch { return res.status(503).type('html').send(readerPasswordResetPage('', '', {
      title: 'Password reset temporarily unavailable', message: 'Account services could not verify this link. Try opening it again shortly.',
    })); }
  });
  app.post(READER_PASSWORD_RESET_PATH, noStore, options.sameOrigin, options.capabilityLimiter, async (req, res) => {
    const htmlForm = Boolean(req.is('application/x-www-form-urlencoded')) && req.headers.accept !== 'application/json';
    const token = plainObject(req.body) && typeof req.body.token === 'string' ? req.body.token.trim() : '';
    const reject = (status: number, message: string) => htmlForm
      ? res.status(status).type('html').send(readerPasswordResetPage(token, message))
      : res.status(status).json({ success: false, error: message });
    if (Object.keys(req.query).length || !plainObject(req.body)
      || Object.keys(req.body).some(key => !['token', 'password', 'confirmPassword'].includes(key))
      || !PASSWORD_RESET_TOKEN_PATTERN.test(token)) return reject(400, 'This password reset request is invalid. Request a new reader reset link.');
    const { password, confirmPassword } = req.body;
    if (typeof password !== 'string' || password.length > 256 || password !== confirmPassword) return reject(400, 'Enter the same new password in both fields.');
    const strength = validatePasswordStrength(password);
    if (!strength.valid) return reject(400, strength.error || 'Choose a stronger password.');
    try {
      // Check expiry before expensive hashing; consume rechecks atomically and
      // remains the only operation that can change credentials or revoke access.
      if (!await options.service.isActive(token)) return reject(410, 'This reset link expired, was already used, or was replaced. Open the latest reset email or request a new link.');
      const result = await options.service.consume(token, await hash(password));
      if (!result) return reject(410, 'This reset link expired, was already used, or was replaced. Open the latest reset email or request a new link.');
      await options.applyPasswordResetUser(result.user).catch(() => {
        console.warn('[Auth Security] Reader reset committed; local session cleanup will finish on the next request.');
      });
      options.clearSessionCookie(res);
      if (htmlForm) return res.type('html').send(readerPasswordResetPage('', '', {
        title: 'Password updated', message: 'Your reader password has been changed. Previous reader sessions are signed out. Sign in with your new password to access your existing library.',
      }));
      return res.json({ success: true, message: 'Password updated. Sign in with your new password.' });
    } catch { return reject(503, 'Password reset could not be confirmed. Try signing in with your new password; otherwise reopen this link. No automatic retry was sent.'); }
  });
}
