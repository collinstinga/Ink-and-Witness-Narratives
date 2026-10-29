import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { AFFILIATE_DASHBOARD_REFRESH_INTERVAL_MS, affiliatePayoutStatusChanged, shouldRefreshAffiliateDashboard,
  unfinishedAffiliatePayoutIds, type AffiliatePayoutStatusItem } from '../../utils/affiliateDashboardRefresh.js';

const affiliateSource = () => readFileSync(new URL('../affiliate/AffiliateDashboardModal.tsx', import.meta.url), 'utf8');

/** Exercise the actual production probe callback with synthetic services, not
 * a second implementation of its conditional financial refresh logic. This
 * callback contains plain JavaScript; no browser, cloud SDK or real session is used. */
function productionProbeFixture() {
  const source = affiliateSource();
  const start = source.indexOf('backgroundPayoutStatusRefreshRef.current = async () => {');
  const end = source.indexOf('const handleLiteraryCircleOnboardingUpdate', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const data: { payouts: AffiliatePayoutStatusItem[] } = { payouts: [{ id: 'payout_pending', status: 'APPROVED' }] };
  const dashboardRequestIdRef = { current: 1 };
  const payoutStatusRequestInFlightRef = { current: false };
  const lastDashboardAttemptAtRef = { current: 0 };
  const getStatuses = vi.fn(async (ids: string[]) => ({ success: true, payouts: data.payouts.filter(payout => ids.includes(payout.id)).map(payout => ({ ...payout })) }));
  const loadDashboard = vi.fn(async (_manual: boolean, _background: boolean) => {});
  const setFinancialRefreshError = vi.fn();
  const bindings = { data, api: { getAffiliatePayoutStatuses: getStatuses }, unfinishedAffiliatePayoutIds,
    affiliatePayoutStatusChanged, dashboardRequestIdRef, payoutStatusRequestInFlightRef, lastDashboardAttemptAtRef,
    backgroundPayoutStatusRefreshRef: { current: undefined as undefined | (() => Promise<void>) },
    loadDashboard, setFinancialRefreshError, onLogout: vi.fn() };
  const install = new Function(...Object.keys(bindings), `${source.slice(start, end)}\nreturn backgroundPayoutStatusRefreshRef.current;`);
  const probe = install(...Object.values(bindings)) as () => Promise<void>;
  return { ...bindings, getStatuses, probe };
}

describe('Spark-safe financial dashboard refresh', () => {
  it('keeps writer financial reads explicit, without a repeating ledger timer', () => {
    const source = readFileSync(new URL('./AffiliatesAdminTab.tsx', import.meta.url), 'utf8');
    expect(source).not.toContain('setInterval(');
    expect(source).toContain('summaryRequestIdRef');
    expect(source).toContain('Refresh');
  });

  it('only schedules bounded pending-payout probes, never a recurring whole-ledger refresh', () => {
    const source = affiliateSource();
    const start = source.indexOf('const hasUnfinishedPayout =');
    const end = source.indexOf('}, [isOpen, hasUnfinishedPayout, activeTab]);', start);
    expect(start).toBeGreaterThan(-1); expect(end).toBeGreaterThan(start);
    const scheduler = source.slice(start, end);
    expect(source.match(/setInterval\(/g)).toHaveLength(1);
    expect(scheduler).toContain('unfinishedAffiliatePayoutIds(data?.payouts || []).length > 0');
    expect(scheduler).toContain('if (!isOpen) return;');
    expect(scheduler).toContain('if (!shouldRefreshAffiliateDashboard(');
    expect(scheduler).toContain("visible: document.visibilityState === 'visible'");
    expect(scheduler).toContain('inFlight: dashboardRequestsInFlightRef.current.size > 0 || payoutStatusRequestInFlightRef.current');
    expect(scheduler).toContain('lastAttemptAt: lastDashboardAttemptAtRef.current, now: Date.now()');
    expect(scheduler).toContain('if (hasUnfinishedPayout) void backgroundPayoutStatusRefreshRef.current();');
    expect(scheduler).toContain('else void backgroundDashboardRefreshRef.current();');
    // The timer exists only in the pending branch, so its callback can never
    // reach the full-refresh else branch. Focus/visibility events can do so.
    expect(scheduler).toContain('hasUnfinishedPayout ? window.setInterval(refreshIfDue, AFFILIATE_DASHBOARD_REFRESH_INTERVAL_MS) : undefined');
    expect(scheduler).toContain("window.addEventListener('focus', refreshIfDue)");
    expect(scheduler).toContain("document.addEventListener('visibilitychange', refreshIfDue)");
    expect(scheduler).toContain('window.clearInterval(interval)');
    expect(scheduler).not.toContain('api.getAffiliateDashboard(');
    expect(scheduler).not.toContain('loadDashboard(');
  });

  it('uses the one-minute, visible-only, no-overlap gate for every automatic attempt', () => {
    const ready = { visible: true, inFlight: false, lastAttemptAt: 100_000, now: 160_000 };
    expect(AFFILIATE_DASHBOARD_REFRESH_INTERVAL_MS).toBe(60_000);
    expect(shouldRefreshAffiliateDashboard(ready)).toBe(true);
    expect(shouldRefreshAffiliateDashboard({ ...ready, visible: false })).toBe(false);
    expect(shouldRefreshAffiliateDashboard({ ...ready, inFlight: true })).toBe(false);
    expect(shouldRefreshAffiliateDashboard({ ...ready, now: 159_999 })).toBe(false);
    expect(shouldRefreshAffiliateDashboard({ ...ready, now: 99_999 })).toBe(false);
  });

  it('does not re-read any full ledger for repeated unchanged probes or already-finished history', async () => {
    const h = productionProbeFixture();
    h.data.payouts.push({ id: 'historical_paid', status: 'PAID', paymentReference: 'OLDRECEIPT' });
    await h.probe(); await h.probe();
    expect(h.getStatuses).toHaveBeenCalledTimes(2);
    for (const call of h.getStatuses.mock.calls) expect(call[0]).toEqual(['payout_pending']);
    expect(h.loadDashboard).not.toHaveBeenCalled();
    expect(h.lastDashboardAttemptAtRef.current).toBeGreaterThan(0);
    h.data.payouts[0].status = 'PAID';
    await h.probe();
    expect(h.getStatuses).toHaveBeenCalledTimes(2);
    expect(h.loadDashboard).not.toHaveBeenCalled();
  });

  it('deduplicates an in-flight probe and refreshes coherent wallet state exactly once after a changed receipt/status', async () => {
    const h = productionProbeFixture();
    let release!: (result: { success: boolean; payouts: AffiliatePayoutStatusItem[] }) => void;
    h.getStatuses.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const pending = h.probe();
    expect(h.payoutStatusRequestInFlightRef.current).toBe(true);
    await h.probe();
    expect(h.getStatuses).toHaveBeenCalledExactlyOnceWith(['payout_pending']);
    const paid: AffiliatePayoutStatusItem[] = [{ id: 'payout_pending', status: 'PAID', paymentReference: 'QK82910482', paidAt: '2026-10-29T08:00:00.000Z' }];
    h.loadDashboard.mockImplementationOnce(async () => { h.data.payouts = paid; });
    release({ success: true, payouts: paid });
    await pending;
    expect(h.loadDashboard).toHaveBeenCalledExactlyOnceWith(true, true);
    expect(h.payoutStatusRequestInFlightRef.current).toBe(false);
    await h.probe();
    expect(h.getStatuses).toHaveBeenCalledTimes(1);
    expect(h.loadDashboard).toHaveBeenCalledTimes(1);
  });

  it('never probes more than ten exact unfinished IDs, regardless of historical ledger size', async () => {
    const h = productionProbeFixture();
    h.data.payouts = [
      ...Array.from({ length: 12 }, (_, index): AffiliatePayoutStatusItem => ({ id: `payout_pending_${index}`, status: 'PENDING' })),
      ...Array.from({ length: 100 }, (_, index): AffiliatePayoutStatusItem => ({ id: `payout_historical_${index}`, status: 'PAID' })),
    ];
    await h.probe();
    expect(h.getStatuses).toHaveBeenCalledTimes(1);
    expect(h.getStatuses.mock.calls[0][0]).toEqual(Array.from({ length: 10 }, (_, index) => `payout_pending_${index}`));
    expect(h.loadDashboard).not.toHaveBeenCalled();
  });

  it('discards stale probe responses after a newer dashboard request or close', async () => {
    const h = productionProbeFixture();
    let release!: (result: { success: boolean; payouts: AffiliatePayoutStatusItem[] }) => void;
    h.getStatuses.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const pending = h.probe();
    h.dashboardRequestIdRef.current += 1;
    release({ success: true, payouts: [{ id: 'payout_pending', status: 'PAID', paymentReference: 'QK82910482' }] });
    await pending;
    expect(h.loadDashboard).not.toHaveBeenCalled();
    expect(h.setFinancialRefreshError).not.toHaveBeenCalled();
    expect(h.payoutStatusRequestInFlightRef.current).toBe(false);
  });

  it('does not turn a failed status probe into an expensive full-history retry', async () => {
    const h = productionProbeFixture();
    h.getStatuses.mockRejectedValueOnce(new Error('Unavailable'));
    await h.probe();
    expect(h.loadDashboard).not.toHaveBeenCalled();
    expect(h.setFinancialRefreshError).toHaveBeenCalledWith(expect.stringContaining('could not be refreshed'));
    expect(h.payoutStatusRequestInFlightRef.current).toBe(false);
    expect(h.lastDashboardAttemptAtRef.current).toBeGreaterThan(0);
  });

  it('preserves profile drafts when a real payout change triggers a background snapshot', () => {
    const source = affiliateSource();
    const loader = source.slice(source.indexOf('const loadDashboard = async'), source.indexOf('backgroundDashboardRefreshRef.current ='));
    expect(loader).toContain('if (res.affiliate && !isBackgroundRefresh)');
    expect(loader).toContain('setProfileName(res.affiliate.name');
    expect(source).toContain('dashboardRequestIdRef.current += 1;');
  });

  it('uses the single authoritative summary for refreshes and a guarded unsaved settings draft', () => {
    const source = readFileSync(new URL('./AffiliatesAdminTab.tsx', import.meta.url), 'utf8');
    const loadSummary = source.slice(source.indexOf('const loadSummary = async'), source.indexOf('const loadResourceLibrary = async'));
    expect(loadSummary).toContain('await api.getAdminAffiliatesSummary()');
    expect(loadSummary).toContain('setSummary(res)');
    expect(loadSummary).toContain('resolveAffiliateSettingsDraft(current, res.settings, settingsDirtyRef.current)');
    expect(loadSummary).not.toContain('api.getAdminAffiliateSettings(');
    expect(loadSummary).not.toContain('api.getAdminLiteraryCircleSettings(');
    expect(loadSummary).not.toContain('api.getAdminAffiliateCampaigns(');
    expect(loadSummary).not.toContain('current?.settings');
    expect(loadSummary).not.toContain('current?.campaigns');
  });
});
