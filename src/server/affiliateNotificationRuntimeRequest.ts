import crypto from 'crypto';
import type { AffiliateNotificationRuntimeMode } from '../types.js';

/** HTTP callers choose a mode only. Sources, recipients, clocks and transports
 * are always server-owned; even otherwise valid runtime options are forbidden. */
export function parseAffiliateNotificationRuntimeRequest(body: unknown): AffiliateNotificationRuntimeMode | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).length !== 1 || !Object.hasOwn(body, 'mode')) return null;
  const mode = (body as { mode: unknown }).mode;
  return mode === 'prepare' || mode === 'dispatch' ? mode : null;
}

/** No default/shared application key. Missing or weak cron configuration keeps
 * unattended execution locked, independently of the delivery review gate. */
export function isAffiliateNotificationCronAuthorized(authorization: unknown, env: NodeJS.ProcessEnv = process.env): boolean {
  const secret = env.CRON_SECRET;
  if (typeof secret !== 'string' || secret.length < 32 || secret.length > 512 || secret.trim() !== secret
    || typeof authorization !== 'string' || authorization.length > 520) return false;
  const actual = Buffer.from(authorization);
  const expected = Buffer.from(`Bearer ${secret}`);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
