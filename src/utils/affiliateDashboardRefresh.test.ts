import { describe, expect, it } from 'vitest';
import { AFFILIATE_DASHBOARD_REFRESH_INTERVAL_MS, MAX_AFFILIATE_PAYOUT_STATUS_IDS, affiliatePayoutStatusChanged,
  shouldRefreshAffiliateDashboard, unfinishedAffiliatePayoutIds, validAffiliatePayoutStatusIds,
  type AffiliatePayoutStatusItem } from './affiliateDashboardRefresh.js';

describe('bounded automatic affiliate payment refresh', () => {
  it('waits at least one minute between attempts, including failed attempts', () => {
    expect(AFFILIATE_DASHBOARD_REFRESH_INTERVAL_MS).toBe(60_000);
    const input = { visible: true, inFlight: false, lastAttemptAt: 100_000, now: 159_999 };
    expect(shouldRefreshAffiliateDashboard(input)).toBe(false);
    expect(shouldRefreshAffiliateDashboard({ ...input, now: 160_000 })).toBe(true);
    expect(shouldRefreshAffiliateDashboard({ ...input, lastAttemptAt: 160_000, now: 160_001 })).toBe(false);
  });

  it('never refreshes a hidden or already-loading dashboard or after a backwards clock jump', () => {
    const input = { visible: true, inFlight: false, lastAttemptAt: 100_000, now: 200_000 };
    expect(shouldRefreshAffiliateDashboard({ ...input, visible: false })).toBe(false);
    expect(shouldRefreshAffiliateDashboard({ ...input, inFlight: true })).toBe(false);
    expect(shouldRefreshAffiliateDashboard({ ...input, now: 90_000 })).toBe(false);
  });

  it('probes only up to ten unique unfinished records and excludes paid history', () => {
    const pending = Array.from({ length: 12 }, (_, index): AffiliatePayoutStatusItem => ({ id: `payout_${index}`, status: 'PENDING' }));
    expect(unfinishedAffiliatePayoutIds([
      { id: 'historic_paid', status: 'PAID', paymentReference: 'ORIGINALREF' },
      { id: 'historic_failed', status: 'FAILED' },
      { id: 'invalid/path', status: 'PENDING' },
      pending[0], ...pending,
    ])).toEqual(pending.slice(0, MAX_AFFILIATE_PAYOUT_STATUS_IDS).map(payout => payout.id));
  });

  it.each([[], ['same', 'same'], ['../private'], Array.from({ length: 11 }, (_, i) => `payout_${i}`), ['X'.repeat(257)]])('rejects unsafe or unbounded probe identifiers %j', ids => {
    expect(validAffiliatePayoutStatusIds(ids)).toBe(false);
  });

  it('does not reload full history when the compact status/evidence has not changed', () => {
    const current: AffiliatePayoutStatusItem[] = [{ id: 'payout_one', status: 'APPROVED' }, { id: 'historic_paid', status: 'PAID', paymentReference: 'ORIGINALREF' }];
    expect(validAffiliatePayoutStatusIds(['payout_one'])).toBe(true);
    expect(affiliatePayoutStatusChanged(current, [{ id: 'payout_one', status: 'APPROVED' }])).toBe(false);
    expect(affiliatePayoutStatusChanged(current, [{ id: 'payout_one', status: 'PAID', paymentReference: 'QK82910482', paidAt: '2026-10-29T08:00:00.000Z' }])).toBe(true);
    expect(affiliatePayoutStatusChanged(current, [{ id: 'historic_paid', status: 'PAID', paymentReference: 'NEWREF' }])).toBe(true);
    expect(affiliatePayoutStatusChanged(current, [{ id: 'historic_paid', status: 'PAID', paymentReference: 'ORIGINALREF', paidAt: '2026-10-29T08:00:00.000Z' }])).toBe(true);
  });
});
