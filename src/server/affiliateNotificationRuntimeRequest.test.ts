import { describe, expect, it } from 'vitest';
import { isAffiliateNotificationCronAuthorized, parseAffiliateNotificationRuntimeRequest } from './affiliateNotificationRuntimeRequest.js';

describe('notification runtime HTTP boundary', () => {
  it.each(['prepare', 'dispatch'] as const)('accepts mode %s only', mode => {
    expect(parseAffiliateNotificationRuntimeRequest({ mode })).toBe(mode);
  });
  it.each([null, undefined, [], 'dispatch', {}, { mode: 'send' }, { mode: 'DISPATCH' },
    { mode: 'dispatch', recipient: 'other@example.test' }, { mode: 'dispatch', intentIds: [] },
    { mode: 'prepare', now: '2026-10-01' }, { mode: 'dispatch', env: {} }, { mode: 'dispatch', sendEmail: true },
  ])('rejects unsupported runtime input %#', body => {
    expect(parseAffiliateNotificationRuntimeRequest(body)).toBeNull();
  });
  it('does not inherit an application key or accept weak/default cron configuration', () => {
    expect(isAffiliateNotificationCronAuthorized('Bearer undefined', {})).toBe(false);
    expect(isAffiliateNotificationCronAuthorized('Bearer short', { CRON_SECRET: 'short' })).toBe(false);
    expect(isAffiliateNotificationCronAuthorized(`Bearer ${'a'.repeat(32)}`, { SESSION_SIGNING_SECRET: 'a'.repeat(32) })).toBe(false);
    expect(isAffiliateNotificationCronAuthorized(`Bearer ${'a'.repeat(32)} `, { CRON_SECRET: `${'a'.repeat(32)} ` })).toBe(false);
  });
  it('requires the exact bearer secret and rejects malformed headers', () => {
    const env = { CRON_SECRET: 'reviewed-test-only-'.padEnd(48, 'x') };
    expect(isAffiliateNotificationCronAuthorized(`Bearer ${env.CRON_SECRET}`, env)).toBe(true);
    for (const value of [undefined, [], '', env.CRON_SECRET, `bearer ${env.CRON_SECRET}`,
      `Bearer ${env.CRON_SECRET}x`, `Bearer ${env.CRON_SECRET.slice(0, -1)}y`, 'x'.repeat(521)]) {
      expect(isAffiliateNotificationCronAuthorized(value, env)).toBe(false);
    }
  });
});
