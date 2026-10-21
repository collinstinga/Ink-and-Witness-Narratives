import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  Users,
} from 'lucide-react';

import type {
  AffiliateAnalyticsFilters,
  AffiliateAnalyticsReport,
  AffiliatePublicProfile,
  Article,
} from '../../types.js';
import { api } from '../../utils/api.js';

type AnalyticsQuery = AffiliateAnalyticsFilters & {
  startDate?: string;
  endDate?: string;
};

interface LiteraryCircleAnalyticsAdminProps {
  affiliates: AffiliatePublicProfile[];
  articles: Article[];
}

interface AffiliateAnalyticsReportViewProps {
  report: AffiliateAnalyticsReport;
}

const DAY_MS = 86_400_000;
const NAIROBI_TIME_ZONE = 'Africa/Nairobi';

function nairobiDate(value: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: NAIROBI_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function initialQuery(): AnalyticsQuery {
  const now = new Date();
  return {
    startDate: nairobiDate(new Date(now.getTime() - 89 * DAY_MS)),
    endDate: nairobiDate(now),
  };
}

function formatKes(value: number): string {
  return `KES ${value.toLocaleString('en-KE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

function coverageLabel(value: AffiliateAnalyticsReport['buyerMetrics']['coverage']): string {
  if (value === 'complete') return 'Complete pseudonymous coverage';
  if (value === 'partial') return 'Partial pseudonymous lower bound';
  return 'Not enabled';
}

function trafficCoverageText(report: AffiliateAnalyticsReport): string {
  if (report.referralTraffic.coverage === 'complete') {
    return report.referralTraffic.conversionRate === null
      ? 'Complete click history for this range; conversion remains withheld until purchases can be matched to a bounded click cohort.'
      : 'Complete click history for this range; conversion can be calculated.';
  }
  if (report.referralTraffic.reason === 'unsupported_filter') {
    return 'Click attribution does not support every selected filter, so conversion is withheld.';
  }
  if (report.referralTraffic.coverage === 'partial') {
    const coverageReasons = report.referralTraffic.coverageReasons
      ?? [report.referralTraffic.reason];
    if (coverageReasons.length === 1 && coverageReasons[0] === 'settling_window') {
      return 'Recent clicks are still settling; displayed visits are complete only through the stated query cutoff and conversion is withheld.';
    }
    return 'Partial retained click history; displayed visits are a lower bound and conversion is withheld.';
  }
  return 'No reliable click history is available for this range; conversion is withheld.';
}

function AnalyticsMetric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/55 p-4">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-2 text-xl font-semibold text-slate-100">{value}</p>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">{hint}</p>
    </div>
  );
}

export function AffiliateAnalyticsReportView({ report }: AffiliateAnalyticsReportViewProps) {
  const buyerMetricsAvailable = report.buyerMetrics.coverage !== 'unavailable';
  const clicksAvailable = report.referralTraffic.clicks !== null;
  const conversionAvailable = report.referralTraffic.conversionRate !== null;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-2 rounded-2xl border border-cyan-400/20 bg-cyan-950/10 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-cyan-300">Verified performance window</p>
          <p className="mt-1 text-sm text-slate-200">
            {report.window.startDate} to {report.window.endDate} · {report.window.days} days
          </p>
        </div>
        <p className="text-xs text-slate-500">Africa/Nairobi · generated {new Date(report.generatedAt).toLocaleString('en-KE')}</p>
      </div>

      <section aria-labelledby="affiliate-analytics-totals-heading" className="space-y-3">
        <h3 id="affiliate-analytics-totals-heading" className="font-serif text-xl font-semibold text-white">Verified earnings overview</h3>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <AnalyticsMetric label="Verified sales" value={report.totals.verifiedSales.toLocaleString()} hint={`${report.totals.pieceSales} pieces · ${report.totals.bundleSales} bundles · ${report.totals.subscriptionSales} subscriptions`} />
          <AnalyticsMetric label="Gross sales" value={formatKes(report.totals.grossSalesKes)} hint="Verified affiliate-attributed payments only" />
          <AnalyticsMetric label="Commission recorded" value={formatKes(report.totals.commissionsRecordedKes)} hint={`${formatKes(report.totals.commissionsPaidKes)} already marked paid`} />
          <AnalyticsMetric label="Retained revenue" value={formatKes(report.totals.retainedRevenueKes)} hint="Gross sales less recorded affiliate commission" />
        </div>
      </section>

      <section aria-labelledby="affiliate-analytics-coverage-heading" className="grid gap-3 lg:grid-cols-2">
        <h3 id="affiliate-analytics-coverage-heading" className="sr-only">Analytics data coverage</h3>
        <div className="rounded-2xl border border-violet-400/20 bg-violet-950/10 p-4">
          <div className="flex items-center gap-2 text-violet-200">
            <Users aria-hidden="true" className="h-4 w-4" />
            <h4 className="font-mono text-xs font-bold uppercase tracking-[0.16em]">Paying reader coverage</h4>
          </div>
          <p className="mt-3 text-sm font-semibold text-white">{coverageLabel(report.buyerMetrics.coverage)}</p>
          {buyerMetricsAvailable ? (
            <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
              <div><dt className="text-slate-500">Unique readers</dt><dd className="mt-1 text-slate-200">{report.buyerMetrics.uniquePayingReaders ?? '—'}</dd></div>
              <div><dt className="text-slate-500">Repeat purchases</dt><dd className="mt-1 text-slate-200">{report.buyerMetrics.repeatPurchases ?? '—'}</dd></div>
            </dl>
          ) : (
            <p className="mt-2 text-xs leading-relaxed text-slate-400">Buyer identity projection is deliberately disabled in this checkpoint. No customer identifiers were loaded into this report.</p>
          )}
        </div>

        <div className="rounded-2xl border border-sky-400/20 bg-sky-950/10 p-4">
          <div className="flex items-center gap-2 text-sky-200">
            <TrendingUp aria-hidden="true" className="h-4 w-4" />
            <h4 className="font-mono text-xs font-bold uppercase tracking-[0.16em]">Referral traffic coverage</h4>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
            <div><dt className="text-slate-500">Known clicks</dt><dd className="mt-1 text-slate-200">{clicksAvailable ? report.referralTraffic.clicks?.toLocaleString() : 'Unavailable'}</dd></div>
            <div><dt className="text-slate-500">Conversion</dt><dd className="mt-1 text-slate-200">{conversionAvailable ? `${(report.referralTraffic.conversionRate || 0).toFixed(1)}%` : 'Withheld'}</dd></div>
          </dl>
          <p className="mt-3 text-xs leading-relaxed text-slate-400">{trafficCoverageText(report)}</p>
          {report.referralTraffic.coverage !== 'unavailable'
            && report.referralTraffic.queriedThrough && (
            <p className="mt-2 text-[11px] text-slate-500">
              Click data queried through {new Date(report.referralTraffic.queriedThrough).toLocaleString('en-KE')}.
            </p>
          )}
        </div>
      </section>

      <section aria-labelledby="affiliate-analytics-accounts-heading" className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
        <div className="flex items-center gap-2">
          <ShieldCheck aria-hidden="true" className="h-4 w-4 text-emerald-300" />
          <h3 id="affiliate-analytics-accounts-heading" className="font-serif text-lg font-semibold text-white">Partner participation</h3>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          <div><dt className="text-slate-500">Registered</dt><dd className="mt-1 text-base font-semibold text-slate-100">{report.accounts.registered}</dd></div>
          <div><dt className="text-slate-500">Active</dt><dd className="mt-1 text-base font-semibold text-emerald-300">{report.accounts.active}</dd></div>
          <div><dt className="text-slate-500">Lifetime sellers</dt><dd className="mt-1 text-base font-semibold text-slate-100">{report.accounts.withLifetimeVerifiedSales}</dd></div>
          <div><dt className="text-slate-500">Sold in range</dt><dd className="mt-1 text-base font-semibold text-cyan-300">{report.accounts.withVerifiedSalesInWindow}</dd></div>
        </dl>
      </section>

      <section aria-labelledby="affiliate-analytics-monthly-heading" className="space-y-3">
        <h3 id="affiliate-analytics-monthly-heading" className="font-serif text-lg font-semibold text-white">Monthly verified trend</h3>
        <div className="overflow-x-auto rounded-2xl border border-slate-800" tabIndex={0} role="region" aria-label="Monthly affiliate performance table">
          <table className="min-w-[680px] w-full text-left text-xs">
            <caption className="sr-only">Verified affiliate sales, revenue, commission, and retained revenue by month</caption>
            <thead className="bg-slate-950/90 font-mono uppercase tracking-[0.12em] text-slate-500">
              <tr>
                <th scope="col" className="p-3">Month</th>
                <th scope="col" className="p-3 text-right">Sales</th>
                <th scope="col" className="p-3 text-right">Gross</th>
                <th scope="col" className="p-3 text-right">Commission</th>
                <th scope="col" className="p-3 text-right">Retained</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 bg-slate-900/40 text-slate-300">
              {report.monthly.length > 0 ? report.monthly.map(row => (
                <tr key={row.periodKey}>
                  <th scope="row" className="p-3 font-mono text-slate-200">{row.periodKey}</th>
                  <td className="p-3 text-right">{row.verifiedSales}</td>
                  <td className="p-3 text-right">{formatKes(row.grossSalesKes)}</td>
                  <td className="p-3 text-right">{formatKes(row.commissionsRecordedKes)}</td>
                  <td className="p-3 text-right">{formatKes(row.retainedRevenueKes)}</td>
                </tr>
              )) : (
                <tr><td colSpan={5} className="p-6 text-center text-slate-500">No verified sales in this range.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <section aria-labelledby="affiliate-analytics-partners-heading" className="space-y-3">
          <h3 id="affiliate-analytics-partners-heading" className="font-serif text-lg font-semibold text-white">Top partners</h3>
          <div className="overflow-x-auto rounded-2xl border border-slate-800" tabIndex={0} role="region" aria-label="Top affiliate partners table">
            <table className="min-w-[540px] w-full text-left text-xs">
              <caption className="sr-only">Top affiliate partners ranked by verified sales</caption>
              <thead className="bg-slate-950/90 font-mono uppercase tracking-[0.12em] text-slate-500"><tr><th scope="col" className="p-3">Partner</th><th scope="col" className="p-3 text-right">Sales</th><th scope="col" className="p-3 text-right">Gross</th><th scope="col" className="p-3 text-right">Commission</th></tr></thead>
              <tbody className="divide-y divide-slate-800 bg-slate-900/40 text-slate-300">
                {report.topAffiliates.length > 0 ? report.topAffiliates.map(row => (
                  <tr key={row.affiliateId}><th scope="row" className="p-3"><span className="block text-slate-100">{row.affiliateName}</span><span className="font-mono text-[11px] text-slate-500">{row.affiliateCode}</span></th><td className="p-3 text-right">{row.verifiedSales}</td><td className="p-3 text-right">{formatKes(row.grossSalesKes)}</td><td className="p-3 text-right">{formatKes(row.commissionsRecordedKes)}</td></tr>
                )) : <tr><td colSpan={4} className="p-6 text-center text-slate-500">No ranked partners in this range.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby="affiliate-analytics-offers-heading" className="space-y-3">
          <h3 id="affiliate-analytics-offers-heading" className="font-serif text-lg font-semibold text-white">Top offers</h3>
          <div className="overflow-x-auto rounded-2xl border border-slate-800" tabIndex={0} role="region" aria-label="Top affiliate offers table">
            <table className="min-w-[480px] w-full text-left text-xs">
              <caption className="sr-only">Pieces, bundles, and subscriptions ranked by verified affiliate sales</caption>
              <thead className="bg-slate-950/90 font-mono uppercase tracking-[0.12em] text-slate-500"><tr><th scope="col" className="p-3">Offer</th><th scope="col" className="p-3">Type</th><th scope="col" className="p-3 text-right">Sales</th><th scope="col" className="p-3 text-right">Gross</th></tr></thead>
              <tbody className="divide-y divide-slate-800 bg-slate-900/40 text-slate-300">
                {report.topOffers.length > 0 ? report.topOffers.map(row => (
                  <tr key={`${row.purchaseKind}:${row.offerId}`}><th scope="row" className="p-3 text-slate-100">{row.title}</th><td className="p-3 capitalize">{row.purchaseKind}</td><td className="p-3 text-right">{row.verifiedSales}</td><td className="p-3 text-right">{formatKes(row.grossSalesKes)}</td></tr>
                )) : <tr><td colSpan={4} className="p-6 text-center text-slate-500">No ranked offers in this range.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section aria-labelledby="affiliate-analytics-integrity-heading" className="rounded-2xl border border-amber-400/20 bg-amber-950/10 p-4">
        <div className="flex items-center gap-2 text-amber-200">
          <AlertTriangle aria-hidden="true" className="h-4 w-4" />
          <h3 id="affiliate-analytics-integrity-heading" className="font-mono text-xs font-bold uppercase tracking-[0.16em]">Integrity exclusions</h3>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-slate-400">
          {report.integrity.unverifiedRecordsExcluded} unverified, {report.integrity.invalidRecordsExcluded} invalid, and {report.integrity.duplicateRecordsExcluded} duplicate records were excluded. Complimentary access never counts as a sale.
        </p>
      </section>
    </div>
  );
}

export default function LiteraryCircleAnalyticsAdmin({ affiliates, articles }: LiteraryCircleAnalyticsAdminProps) {
  const initialQueryRef = useRef<AnalyticsQuery | null>(null);
  if (!initialQueryRef.current) initialQueryRef.current = initialQuery();
  const [query, setQuery] = useState<AnalyticsQuery>(initialQueryRef.current);
  const [report, setReport] = useState<AffiliateAnalyticsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestIdRef = useRef(0);

  const loadReport = useCallback(async (nextQuery: AnalyticsQuery) => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError('');
    try {
      const nextReport = await api.getAdminAffiliateAnalytics(nextQuery);
      if (requestId === requestIdRef.current) setReport(nextReport);
    } catch (loadError) {
      if (requestId === requestIdRef.current) {
        setError(loadError instanceof Error ? loadError.message : 'Affiliate analytics could not be loaded.');
      }
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadReport(initialQueryRef.current || {});
    return () => {
      requestIdRef.current += 1;
    };
  }, [loadReport]);

  const updateQuery = (key: keyof AnalyticsQuery, value: string) => {
    setQuery(current => ({ ...current, [key]: value || undefined }));
  };

  return (
    <section aria-labelledby="literary-circle-analytics-heading" className="space-y-5 animate-in fade-in">
      <header className="rounded-2xl border border-cyan-400/20 bg-gradient-to-br from-cyan-950/25 via-slate-950/80 to-violet-950/20 p-5">
        <div className="flex items-start gap-3">
          <div className="rounded-xl border border-cyan-300/20 bg-cyan-400/10 p-2.5 text-cyan-200"><BarChart3 aria-hidden="true" className="h-5 w-5" /></div>
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-cyan-300">Literary Circle analytics</p>
            <h2 id="literary-circle-analytics-heading" className="mt-1 font-serif text-2xl font-semibold text-white">Verified growth, without exposing readers</h2>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-400">Reports use the already-loaded affiliate and commission ledgers. Coverage labels show where retained click history or privacy-safe buyer analysis is incomplete.</p>
          </div>
        </div>
      </header>

      <form
        className="grid gap-3 rounded-2xl border border-slate-800 bg-slate-950/50 p-4 md:grid-cols-2 xl:grid-cols-4"
        onSubmit={event => {
          event.preventDefault();
          void loadReport(query);
        }}
      >
        <label className="space-y-1.5 text-xs text-slate-400"><span>Start date</span><input type="date" required value={query.startDate || ''} max={query.endDate} onChange={event => updateQuery('startDate', event.target.value)} className="min-h-11 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 text-slate-100" /></label>
        <label className="space-y-1.5 text-xs text-slate-400"><span>End date</span><input type="date" required value={query.endDate || ''} min={query.startDate} max={nairobiDate(new Date())} onChange={event => updateQuery('endDate', event.target.value)} className="min-h-11 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 text-slate-100" /></label>
        <label className="space-y-1.5 text-xs text-slate-400"><span>Affiliate</span><select value={query.affiliateId || ''} onChange={event => updateQuery('affiliateId', event.target.value)} className="min-h-11 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 text-slate-100"><option value="">All affiliates</option>{affiliates.map(affiliate => <option key={affiliate.id} value={affiliate.id}>{affiliate.name} ({affiliate.affiliateCode})</option>)}</select></label>
        <label className="space-y-1.5 text-xs text-slate-400"><span>Purchase type</span><select value={query.purchaseKind || ''} onChange={event => updateQuery('purchaseKind', event.target.value)} className="min-h-11 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 text-slate-100"><option value="">All purchases</option><option value="piece">Pieces</option><option value="bundle">Bundles</option><option value="subscription">Subscriptions</option></select></label>
        <label className="space-y-1.5 text-xs text-slate-400"><span>Piece</span><select value={query.articleId || ''} onChange={event => updateQuery('articleId', event.target.value)} className="min-h-11 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 text-slate-100"><option value="">All pieces</option>{articles.map(article => <option key={article.id} value={article.id}>{article.title}</option>)}</select></label>
        <label className="space-y-1.5 text-xs text-slate-400"><span>Subscription plan ID</span><input value={query.subscriptionPlanId || ''} onChange={event => updateQuery('subscriptionPlanId', event.target.value)} placeholder="All plans" maxLength={256} className="min-h-11 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 text-slate-100 placeholder:text-slate-600" /></label>
        <label className="space-y-1.5 text-xs text-slate-400"><span>Recorded tier ID</span><input value={query.literaryCircleTierId || ''} onChange={event => updateQuery('literaryCircleTierId', event.target.value)} placeholder="All tiers" maxLength={256} className="min-h-11 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 text-slate-100 placeholder:text-slate-600" /></label>
        <div className="flex items-end"><button type="submit" disabled={loading} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-cyan-300/30 bg-cyan-400/10 px-4 font-mono text-xs font-bold text-cyan-100 transition hover:bg-cyan-400/20 disabled:cursor-wait disabled:opacity-60">{loading ? <RefreshCw aria-hidden="true" className="h-4 w-4 animate-spin" /> : <BarChart3 aria-hidden="true" className="h-4 w-4" />}{loading ? 'Loading report…' : 'Apply filters'}</button></div>
      </form>

      <div aria-live="polite">
        {error ? (
          <div role="alert" className="rounded-2xl border border-rose-400/30 bg-rose-950/20 p-4 text-sm text-rose-100">
            <p>{error}</p>
            <button type="button" onClick={() => void loadReport(query)} className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-xl border border-rose-300/30 px-4 font-mono text-xs font-bold"><RefreshCw aria-hidden="true" className="h-4 w-4" /> Retry</button>
          </div>
        ) : loading && !report ? (
          <div role="status" className="flex min-h-48 items-center justify-center gap-2 rounded-2xl border border-slate-800 bg-slate-950/40 text-sm text-slate-400"><RefreshCw aria-hidden="true" className="h-4 w-4 animate-spin" /> Loading verified affiliate analytics…</div>
        ) : report ? (
          <AffiliateAnalyticsReportView report={report} />
        ) : null}
      </div>
    </section>
  );
}
