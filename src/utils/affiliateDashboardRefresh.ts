import type { AffiliatePayoutRequest } from '../types.js';

/** Bound fresh ledger reads to one a minute; hidden dashboards do not poll. */
export const AFFILIATE_DASHBOARD_REFRESH_INTERVAL_MS = 60_000;
export const MAX_AFFILIATE_PAYOUT_STATUS_IDS = 10;
export type AffiliatePayoutStatusItem = Pick<AffiliatePayoutRequest, 'id' | 'status' | 'paidAt' | 'paymentReference'>;
const PAYOUT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

export function validAffiliatePayoutStatusIds(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.length <= MAX_AFFILIATE_PAYOUT_STATUS_IDS
    && value.every(id => typeof id === 'string' && PAYOUT_ID.test(id)) && new Set(value).size === value.length;
}

export function unfinishedAffiliatePayoutIds(payouts: readonly AffiliatePayoutStatusItem[]): string[] {
  return [...new Set(payouts.filter(payout => ['PENDING', 'APPROVED', 'PROCESSING'].includes(payout.status))
    .map(payout => payout.id).filter(id => PAYOUT_ID.test(id)))].slice(0, MAX_AFFILIATE_PAYOUT_STATUS_IDS);
}

/** A status/evidence change warrants one fresh complete accounting snapshot. */
export function affiliatePayoutStatusChanged(current: readonly AffiliatePayoutStatusItem[], fresh: readonly AffiliatePayoutStatusItem[]): boolean {
  const byId = new Map(current.map(payout => [payout.id, payout]));
  return fresh.some(payout => {
    const previous = byId.get(payout.id);
    return !previous || previous.status !== payout.status
      || (previous.paidAt || undefined) !== (payout.paidAt || undefined)
      || (previous.paymentReference || undefined) !== (payout.paymentReference || undefined);
  });
}

export function shouldRefreshAffiliateDashboard(input: {
  visible: boolean;
  inFlight: boolean;
  lastAttemptAt: number;
  now: number;
}): boolean {
  return input.visible && !input.inFlight
    && input.now - input.lastAttemptAt >= AFFILIATE_DASHBOARD_REFRESH_INTERVAL_MS;
}
