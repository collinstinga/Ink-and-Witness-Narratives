import React from 'react';
import {
  ArrowUpRight,
  BookOpen,
  Crown,
  Gift,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  Trophy,
} from 'lucide-react';

import type { LiteraryCircleDashboardSummary } from '../../types.js';

interface LiteraryCircleMembershipOverviewProps {
  summary: LiteraryCircleDashboardSummary;
  affiliateName: string;
  activeCommissionRate: number;
  onOpenCatalogue?: () => void;
}

const clampPercent = (value: number): number => Math.min(100, Math.max(0, value));

function periodLabel(periodKey: string): string {
  const parsed = new Date(`${periodKey}-01T00:00:00+03:00`);
  return Number.isFinite(parsed.getTime())
    ? parsed.toLocaleDateString('en-KE', { month: 'short', year: 'numeric', timeZone: 'Africa/Nairobi' })
    : periodKey;
}

export const getSafeCommunityInviteUrl = (value?: string): string | null => {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.toLowerCase();
    return parsed.protocol === 'https:'
      && (hostname === 'whatsapp.com' || hostname === 'chat.whatsapp.com')
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
};

export const LiteraryCircleMembershipOverview: React.FC<LiteraryCircleMembershipOverviewProps> = ({
  summary,
  affiliateName,
  activeCommissionRate,
  onOpenCatalogue,
}) => {
  const progress = clampPercent(summary.progressToNextTierPercent);
  const complimentaryAccessActive = summary.complimentaryAccessStatus === 'active';
  const communityInviteUrl = summary.community.enabled
    ? getSafeCommunityInviteUrl(summary.community.whatsappInviteUrl)
    : null;
  const commissionPolicyIsDraft = summary.commissionPolicyStatus === 'draft';

  return (
    <section
      aria-labelledby="literary-circle-membership-heading"
      className="overflow-hidden rounded-2xl border border-amber-300/30 bg-gradient-to-br from-[#21170f] via-[#101827] to-[#07121b] shadow-xl shadow-black/20"
    >
      <div className="border-b border-white/10 px-4 py-5 sm:px-6 sm:py-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/40 bg-amber-300/10 px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-amber-200">
                <Sparkles aria-hidden="true" className="h-3 w-3" />
                Ink &amp; Witness Literary Circle
              </span>
              {summary.foundingMember && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-300/40 bg-violet-400/10 px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-violet-200">
                  <Crown aria-hidden="true" className="h-3 w-3" />
                  Founding Literary Partner
                </span>
              )}
            </div>
            <h2
              id="literary-circle-membership-heading"
              className="font-serif text-2xl font-bold tracking-tight text-white sm:text-3xl"
            >
              Welcome, {affiliateName}
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-300">
              Read the work, recommend what moved you, and earn from verified readers you introduce.
            </p>
          </div>

          <div className="flex items-center gap-3 rounded-2xl border border-amber-200/20 bg-black/20 p-3.5 lg:max-w-xs">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-amber-300/30 bg-amber-300/10 text-amber-200">
              <Trophy aria-hidden="true" className="h-5 w-5" />
            </div>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-slate-400">Current circle tier</p>
              <p className="font-serif text-lg font-bold text-amber-100">{summary.currentTier.name}</p>
              {summary.currentTier.badgeLabel && (
                <p className="text-xs text-amber-200/80">{summary.currentTier.badgeLabel}</p>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-3 p-4 sm:grid-cols-3 sm:p-6">
        <article className="rounded-2xl border border-emerald-300/20 bg-emerald-950/25 p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-300">Read</span>
            <BookOpen aria-hidden="true" className="h-4 w-4 text-emerald-300" />
          </div>
          <p className="font-serif text-base font-bold text-white">Complimentary catalogue access</p>
          <p className={`mt-1 text-xs font-semibold ${complimentaryAccessActive ? 'text-emerald-300' : 'text-amber-300'}`}>
            {complimentaryAccessActive
              ? 'Active · every current and future published piece'
              : `${summary.complimentaryAccessStatus[0].toUpperCase()}${summary.complimentaryAccessStatus.slice(1)} · purchased titles remain separate`}
          </p>
          <a
            href="#all-pieces"
            onClick={onOpenCatalogue}
            className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-xl border border-emerald-300/30 bg-emerald-400/10 px-3 py-2 font-mono text-xs font-bold text-emerald-200 transition hover:bg-emerald-400/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
          >
            Explore the catalogue
            <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />
          </a>
        </article>

        <article className="rounded-2xl border border-cyan-300/20 bg-cyan-950/20 p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-300">Earn</span>
            <Gift aria-hidden="true" className="h-4 w-4 text-cyan-300" />
          </div>
          <div className="flex flex-wrap items-baseline gap-x-2">
            <p className="font-serif text-2xl font-bold text-white">{summary.currentTier.proposedCommissionRate}%</p>
            <span className="text-xs text-slate-400">
              {commissionPolicyIsDraft ? 'proposed tier rate' : 'tier rate'}
            </span>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-slate-300">
            {commissionPolicyIsDraft
              ? `This policy is still a draft. Your existing ${activeCommissionRate}% arrangement remains in force until the writer activates a new structure.`
              : `Your dashboard currently applies ${activeCommissionRate}% to eligible new verified sales under the active policy.`}
          </p>
          <p className="mt-2 inline-flex items-start gap-1.5 text-[11px] leading-relaxed text-cyan-200/80">
            <ShieldCheck aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Commission already earned is never reduced or recalculated retroactively.
          </p>
        </article>

        <article className="rounded-2xl border border-violet-300/20 bg-violet-950/20 p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-violet-300">Contribute</span>
            <MessageCircle aria-hidden="true" className="h-4 w-4 text-violet-300" />
          </div>
          <p className="font-serif text-base font-bold text-white">Recommend from experience</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-300">
            Read freely, then share personal links to the pieces you can recommend authentically.
          </p>
          {summary.community.enabled && (
            <div className="mt-3 border-t border-violet-200/10 pt-3">
              <p className="text-xs font-semibold text-violet-200">{summary.community.title}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{summary.community.description}</p>
              {communityInviteUrl && (
                <a
                  href={communityInviteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-xl border border-violet-300/30 bg-violet-400/10 px-3 py-2 font-mono text-xs font-bold text-violet-200 transition hover:bg-violet-400/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
                >
                  View private WhatsApp invitation
                  <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          )}
        </article>
      </div>

      <div className="border-t border-white/10 bg-black/15 px-4 py-4 sm:px-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
              {summary.nextTier ? `Next: ${summary.nextTier.name}` : 'Highest tier reached'}
            </p>
            <p className="mt-1 text-xs text-slate-300">
              {summary.nextTier
                ? `${summary.monthlyVerifiedSales} verified this month · ${summary.salesToNextTier} more ${summary.salesToNextTier === 1 ? 'sale' : 'sales'} to qualify`
                : `${summary.monthlyVerifiedSales} verified sales this month · ${summary.lifetimeVerifiedSales} lifetime`}
            </p>
          </div>
          <p className="text-xs font-semibold text-amber-200">{progress}%</p>
        </div>
        <div
          role="progressbar"
          aria-label={summary.nextTier ? `Progress to ${summary.nextTier.name}` : 'Highest tier achieved'}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
          className="mt-2 h-2 overflow-hidden rounded-full bg-slate-950 ring-1 ring-white/10"
        >
          <div
            className="h-full rounded-full bg-gradient-to-r from-amber-400 via-yellow-300 to-emerald-300 transition-[width] duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {summary.performancePeriods?.length ? (
        <div className="border-t border-white/10 px-4 py-5 sm:px-6">
          <div>
            <h3 className="font-serif text-lg font-bold text-white">Six-month performance record</h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">
              Verified sales and recorded earnings stay historical. A projected label means the tier policy was not active for that period.
            </p>
          </div>
          <div
            role="region"
            aria-label="Six-month affiliate performance table"
            tabIndex={0}
            className="mt-4 overflow-x-auto rounded-xl border border-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
          >
            <table className="min-w-[680px] w-full text-left text-xs">
              <caption className="sr-only">
                Verified sales, gross sales, commission, and performance tier for the last six months.
              </caption>
              <thead className="bg-black/25 font-mono text-[10px] uppercase tracking-wide text-slate-400">
                <tr>
                  <th scope="col" className="px-3 py-2.5">Month</th>
                  <th scope="col" className="px-3 py-2.5 text-right">Verified</th>
                  <th scope="col" className="px-3 py-2.5 text-right">Gross sales</th>
                  <th scope="col" className="px-3 py-2.5 text-right">Commission</th>
                  <th scope="col" className="px-3 py-2.5">Performance tier</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10 bg-slate-950/35">
                {summary.performancePeriods.map(period => (
                  <tr key={period.periodKey}>
                    <th scope="row" className="px-3 py-3 font-semibold text-slate-200">
                      {periodLabel(period.periodKey)}{period.isCurrent ? ' · Current' : ''}
                    </th>
                    <td className="px-3 py-3 text-right font-mono text-cyan-200">
                      {period.verifiedSales}
                      {period.qualifyingSales !== period.verifiedSales && (
                        <span className="block text-[11px] text-slate-500">{period.qualifyingSales} qualifying</span>
                      )}
                      <span className="block text-[11px] text-slate-500">{period.pieceSales} pieces · {period.bundleSales} bundles · {period.subscriptionSales} passes</span>
                      {period.reversedOrRejectedSales > 0 && <span className="block text-[11px] text-rose-300">{period.reversedOrRejectedSales} excluded</span>}
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-slate-300">KES {period.grossSalesKes.toLocaleString()}</td>
                    <td className="px-3 py-3 text-right font-mono font-bold text-emerald-300">KES {period.commissionEarnedKes.toLocaleString()}</td>
                    <td className="px-3 py-3">
                      <span className="font-semibold text-amber-100">{period.qualifiedTier.name}</span>
                      <span className="ml-1 text-[11px] uppercase tracking-wide text-slate-500">{period.qualificationMode}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
};
