import React, { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  BookOpen,
  Crown,
  Plus,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
} from 'lucide-react';

import type {
  AffiliatePublicProfile,
  LiteraryCircleAffiliatePerformanceReport,
  LiteraryCircleCommunityPost,
  LiteraryCircleComplimentaryAccessStatus,
  LiteraryCircleSettings,
  LiteraryCircleTierDefinition,
} from '../../types.js';

export interface LiteraryCircleMembershipAdminPatch {
  complimentaryAccessStatus?: LiteraryCircleComplimentaryAccessStatus;
  complimentaryAccessReason?: string;
  manualTierId?: string | null;
  foundingMember?: true;
}

interface LiteraryCircleAdminPanelProps {
  settings: LiteraryCircleSettings;
  affiliates: AffiliatePublicProfile[];
  performanceReports?: LiteraryCircleAffiliatePerformanceReport[];
  savingSettings: boolean;
  savingAffiliateId?: string;
  onSaveSettings: (
    settings: LiteraryCircleSettings,
    confirmCommissionPolicyActivation: boolean,
  ) => Promise<LiteraryCircleSettings>;
  onUpdateMembership: (
    affiliateId: string,
    patch: LiteraryCircleMembershipAdminPatch,
  ) => Promise<void>;
}

function cloneSettings(settings: LiteraryCircleSettings): LiteraryCircleSettings {
  return JSON.parse(JSON.stringify(settings)) as LiteraryCircleSettings;
}

function performancePeriodLabel(periodKey: string): string {
  const parsed = new Date(`${periodKey}-01T00:00:00+03:00`);
  return Number.isFinite(parsed.getTime())
    ? parsed.toLocaleDateString('en-KE', { month: 'long', year: 'numeric', timeZone: 'Africa/Nairobi' })
    : periodKey;
}

export function isoToLocalDateTime(value?: string): string {
  if (!value) return '';
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return '';
  const offset = parsed.getTimezoneOffset() * 60_000;
  return new Date(parsed.getTime() - offset).toISOString().slice(0, 16);
}

export function localDateTimeToIso(value: string): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : undefined;
}

function nextTierId(tiers: LiteraryCircleTierDefinition[]): string {
  const used = new Set(tiers.map(tier => tier.id));
  let index = tiers.length + 1;
  while (used.has(`literary-tier-${index}`)) index += 1;
  return `literary-tier-${index}`;
}

function nextCommunityPostId(posts: LiteraryCircleCommunityPost[]): string {
  const used = new Set(posts.map(post => post.id));
  const base = `community-${Date.now().toString(36)}`;
  let candidate = base;
  let suffix = 1;
  while (used.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

const COMMUNITY_POST_TYPE_LABELS: Array<{
  value: LiteraryCircleCommunityPost['type'];
  label: string;
}> = [
  { value: 'announcement', label: 'Writer announcement' },
  { value: 'release_preview', label: 'Upcoming release preview' },
  { value: 'exclusive_excerpt', label: 'Exclusive excerpt' },
  { value: 'monthly_campaign', label: 'Monthly reading campaign' },
  { value: 'featured_piece', label: 'Featured literary piece' },
  { value: 'promotional_guidance', label: 'Promotional guidance' },
];

export function isFinancialLiteraryCirclePolicyChange(
  current: LiteraryCircleSettings,
  requested: LiteraryCircleSettings,
): boolean {
  const fingerprint = (settings: LiteraryCircleSettings) => JSON.stringify({
    defaultTierId: settings.defaultTierId,
    qualificationEffectiveFrom: settings.qualificationEffectiveFrom || null,
    tiers: settings.tiers.map(tier => ({
      id: tier.id,
      rank: tier.rank,
      monthlyVerifiedSalesThreshold: tier.monthlyVerifiedSalesThreshold,
      proposedCommissionRate: tier.proposedCommissionRate,
      enabled: tier.enabled,
    })),
    status: settings.commissionPolicy.status,
    effectiveAt: settings.commissionPolicy.effectiveAt || null,
    subscriptionRenewalsEligible: settings.commissionPolicy.subscriptionRenewalsEligible,
  });
  return fingerprint(current) !== fingerprint(requested);
}

const fieldClass = 'min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20';

const PerformanceMetric: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <article className="rounded-xl border border-cyan-300/15 bg-slate-950/45 p-3">
    <p className="font-mono text-[9px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
    <p className="mt-1 font-serif text-lg font-bold text-cyan-100">{value}</p>
  </article>
);

const MembershipRow: React.FC<{
  affiliate: AffiliatePublicProfile;
  tiers: LiteraryCircleTierDefinition[];
  saving: boolean;
  onSave: (patch: LiteraryCircleMembershipAdminPatch) => Promise<void>;
}> = ({ affiliate, tiers, saving, onSave }) => {
  const membership = affiliate.literaryCircle;
  const [accessStatus, setAccessStatus] = useState<LiteraryCircleComplimentaryAccessStatus>(
    membership?.complimentaryAccess.status || 'revoked',
  );
  const [reason, setReason] = useState(membership?.complimentaryAccess.reason || '');
  const [manualTierId, setManualTierId] = useState(
    membership?.tier.source === 'manual' ? membership.tier.id : '',
  );
  const [recognizeFounding, setRecognizeFounding] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setAccessStatus(membership?.complimentaryAccess.status || 'revoked');
    setReason(membership?.complimentaryAccess.reason || '');
    setManualTierId(membership?.tier.source === 'manual' ? membership.tier.id : '');
    setRecognizeFounding(false);
    setError('');
  }, [
    affiliate.id,
    affiliate.updatedAt,
    membership?.complimentaryAccess.status,
    membership?.complimentaryAccess.reason,
    membership?.tier.id,
    membership?.tier.source,
    membership?.foundingMember,
  ]);

  const save = async () => {
    setError('');
    try {
      await onSave({
        complimentaryAccessStatus: accessStatus,
        complimentaryAccessReason: reason.trim(),
        manualTierId: manualTierId || null,
        ...(!membership?.foundingMember && recognizeFounding ? { foundingMember: true as const } : {}),
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Membership could not be saved.');
    }
  };

  return (
    <article className="rounded-2xl border border-slate-700/80 bg-slate-950/45 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-serif text-lg font-bold text-white">{affiliate.name}</h4>
            {membership?.foundingMember && (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/30 bg-amber-300/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-200">
                <Crown aria-hidden="true" className="h-3 w-3" /> Founding
              </span>
            )}
            {!membership && (
              <span className="rounded-full border border-rose-400/30 bg-rose-500/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-rose-200">
                Migration pending
              </span>
            )}
          </div>
          <p className="mt-1 font-mono text-[11px] text-cyan-300">{affiliate.affiliateCode}</p>
          <p className="mt-1 text-xs text-slate-400">
            Account: {affiliate.status} · Purchased reader content remains separate from this privilege.
          </p>
        </div>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-cyan-500 px-4 py-2 font-mono text-xs font-bold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-wait disabled:opacity-60"
        >
          <Save aria-hidden="true" className="h-4 w-4" />
          {saving ? 'Saving…' : 'Save membership'}
        </button>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <label className="text-xs font-semibold text-slate-300">
          Complimentary catalogue access
          <select
            className={`${fieldClass} mt-1.5`}
            value={accessStatus}
            onChange={event => setAccessStatus(event.target.value as LiteraryCircleComplimentaryAccessStatus)}
          >
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="revoked">Revoked</option>
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-300">
          Tier assignment
          <select
            className={`${fieldClass} mt-1.5`}
            value={manualTierId}
            onChange={event => setManualTierId(event.target.value)}
          >
            <option value="">Automatic monthly qualification</option>
            {tiers.filter(tier => tier.enabled).map(tier => (
              <option key={tier.id} value={tier.id}>{tier.name} (manual)</option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-300">
          Access change reason
          <input
            className={`${fieldClass} mt-1.5`}
            value={reason}
            maxLength={500}
            onChange={event => setReason(event.target.value)}
            placeholder="Optional audited note"
          />
        </label>
      </div>

      {!membership?.foundingMember && (
        <label className="mt-3 flex min-h-11 items-center gap-3 rounded-xl border border-amber-300/20 bg-amber-300/5 px-3 py-2 text-xs text-amber-100">
          <input
            type="checkbox"
            checked={recognizeFounding}
            onChange={event => setRecognizeFounding(event.target.checked)}
            className="h-4 w-4 accent-amber-400"
          />
          Permanently recognize this account as a Founding Literary Partner. This cannot be removed later.
        </label>
      )}
      {error && <p role="alert" className="mt-3 text-xs text-rose-300">{error}</p>}
    </article>
  );
};

export const LiteraryCircleAdminPanel: React.FC<LiteraryCircleAdminPanelProps> = ({
  settings,
  affiliates,
  performanceReports = [],
  savingSettings,
  savingAffiliateId,
  onSaveSettings,
  onUpdateMembership,
}) => {
  const [draft, setDraft] = useState(() => cloneSettings(settings));
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const availablePerformancePeriods = useMemo(
    () => [...new Set(performanceReports.flatMap(report => report.periods.map(period => period.periodKey)))].sort().reverse(),
    [performanceReports],
  );
  const [selectedPerformancePeriod, setSelectedPerformancePeriod] = useState(
    () => availablePerformancePeriods[0] || '',
  );

  useEffect(() => {
    if (!dirty) setDraft(cloneSettings(settings));
  }, [settings, dirty]);

  const sortedAffiliates = useMemo(
    () => [...affiliates].sort((left, right) => left.name.localeCompare(right.name)),
    [affiliates],
  );
  const selectedPerformanceRows = useMemo(() => performanceReports.flatMap(report => {
    const period = report.periods.find(candidate => candidate.periodKey === selectedPerformancePeriod);
    return period ? [{ report, period }] : [];
  }).sort((left, right) => (
    right.period.verifiedSales - left.period.verifiedSales
    || right.period.grossSalesKes - left.period.grossSalesKes
    || left.report.affiliateName.localeCompare(right.report.affiliateName)
  )), [performanceReports, selectedPerformancePeriod]);
  const selectedPerformanceTotals = useMemo(() => selectedPerformanceRows.reduce((totals, row) => ({
    verifiedSales: totals.verifiedSales + row.period.verifiedSales,
    grossSalesKes: totals.grossSalesKes + row.period.grossSalesKes,
    commissionEarnedKes: totals.commissionEarnedKes + row.period.commissionEarnedKes,
    retainedRevenueKes: totals.retainedRevenueKes + row.period.retainedRevenueKes,
  }), { verifiedSales: 0, grossSalesKes: 0, commissionEarnedKes: 0, retainedRevenueKes: 0 }), [selectedPerformanceRows]);

  useEffect(() => {
    if (!availablePerformancePeriods.length) {
      if (selectedPerformancePeriod) setSelectedPerformancePeriod('');
      return;
    }
    if (!availablePerformancePeriods.includes(selectedPerformancePeriod)) {
      setSelectedPerformancePeriod(availablePerformancePeriods[0]);
    }
  }, [availablePerformancePeriods, selectedPerformancePeriod]);

  const updateDraft = (next: LiteraryCircleSettings) => {
    setDraft(next);
    setDirty(true);
    setSuccess('');
  };

  const updateTier = (index: number, patch: Partial<LiteraryCircleTierDefinition>) => {
    updateDraft({
      ...draft,
      tiers: draft.tiers.map((tier, tierIndex) => tierIndex === index ? { ...tier, ...patch } : tier),
    });
  };

  const addTier = () => {
    if (draft.tiers.length >= 12) return;
    const id = nextTierId(draft.tiers);
    updateDraft({
      ...draft,
      tiers: [...draft.tiers, {
        id,
        name: `Literary Tier ${draft.tiers.length + 1}`,
        description: 'Configurable Literary Circle recognition tier.',
        rank: Math.max(0, ...draft.tiers.map(tier => tier.rank)) + 1,
        monthlyVerifiedSalesThreshold: 0,
        proposedCommissionRate: 15,
        enabled: true,
        badgeLabel: `Tier ${draft.tiers.length + 1}`,
      }],
    });
  };

  const removeTier = (id: string) => {
    if (id === draft.defaultTierId || draft.tiers.length <= 1) return;
    updateDraft({ ...draft, tiers: draft.tiers.filter(tier => tier.id !== id) });
  };

  const communityPosts = draft.community.posts || [];

  const updateCommunityPost = (id: string, patch: Partial<LiteraryCircleCommunityPost>) => {
    updateDraft({
      ...draft,
      community: {
        ...draft.community,
        posts: communityPosts.map(post => post.id === id ? { ...post, ...patch } : post),
      },
    });
  };

  const addCommunityPost = () => {
    if (communityPosts.length >= 24) return;
    const now = new Date().toISOString();
    updateDraft({
      ...draft,
      community: {
        ...draft.community,
        posts: [...communityPosts, {
          id: nextCommunityPostId(communityPosts),
          type: 'announcement',
          title: 'New Literary Circle update',
          body: 'Add the private announcement, preview, or campaign guidance here.',
          isPublished: false,
          order: communityPosts.length,
          publishedAt: now,
        }],
      },
    });
  };

  const removeCommunityPost = (id: string) => {
    updateDraft({
      ...draft,
      community: {
        ...draft.community,
        posts: communityPosts.filter(post => post.id !== id),
      },
    });
  };

  const saveSettings = async () => {
    setError('');
    setSuccess('');
    const policyChanged = isFinancialLiteraryCirclePolicyChange(settings, draft);
    const confirmationRequired = policyChanged && (
      settings.commissionPolicy.status === 'active'
      || draft.commissionPolicy.status === 'active'
    );
    if (confirmationRequired && draft.commissionPolicy.status === 'active' && !draft.commissionPolicy.effectiveAt) {
      setError('Choose an effective date before activating proposed tier commission rates.');
      return;
    }
    if (
      confirmationRequired
      && draft.commissionPolicy.status === 'active'
      && Date.parse(draft.commissionPolicy.effectiveAt || '') < Date.now() - 5 * 60_000
    ) {
      setError('Choose a current or future effective date for this commission-policy change.');
      return;
    }
    const confirmed = !confirmationRequired || window.confirm(
      'Publish this commission-policy change from the selected effective date? Existing earned commissions will not be recalculated.',
    );
    if (!confirmed) return;
    try {
      const saved = await onSaveSettings(draft, confirmationRequired);
      setDraft(cloneSettings(saved));
      setDirty(false);
      setSuccess(saved.commissionPolicy.status === 'active'
        ? 'Literary Circle policy saved with its confirmed effective date.'
        : 'Literary Circle settings saved. Proposed tier rates remain in draft.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Literary Circle settings could not be saved.');
    }
  };

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl border border-amber-300/25 bg-gradient-to-br from-[#21170f] via-slate-950 to-cyan-950/40">
        <div className="border-b border-white/10 p-5 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-amber-300">Literary Circle Management</p>
              <h3 className="mt-2 font-serif text-2xl font-bold text-white">Access, recognition and future tier policy</h3>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-300">
                Complimentary reading is not a sale. Existing referral identities, historical commissions, wallets and payouts remain unchanged.
              </p>
            </div>
            <label className="flex min-h-12 items-center gap-3 rounded-xl border border-cyan-300/20 bg-black/20 px-4 py-3 text-sm font-semibold text-cyan-100">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={event => updateDraft({ ...draft, enabled: event.target.checked })}
                className="h-4 w-4 accent-cyan-400"
              />
              Programme enabled
            </label>
          </div>
        </div>

        <div className="grid gap-4 p-5 sm:grid-cols-3 sm:p-6">
          <div className="rounded-xl border border-emerald-300/20 bg-emerald-400/5 p-4">
            <BookOpen aria-hidden="true" className="h-5 w-5 text-emerald-300" />
            <p className="mt-3 font-bold text-white">Complimentary access</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">Server-verified on every protected reading request. Purchased titles remain owned if access is revoked.</p>
          </div>
          <div className="rounded-xl border border-amber-300/20 bg-amber-400/5 p-4">
            <Crown aria-hidden="true" className="h-5 w-5 text-amber-300" />
            <p className="mt-3 font-bold text-white">Founding recognition</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">Permanent and independent from monthly performance tiers.</p>
          </div>
          <div className="rounded-xl border border-cyan-300/20 bg-cyan-400/5 p-4">
            <ShieldCheck aria-hidden="true" className="h-5 w-5 text-cyan-300" />
            <p className="mt-3 font-bold text-white">Financial continuity</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">Tier rates are proposals until explicitly activated. No retroactive recalculation.</p>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-700 bg-slate-900/60 p-4 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-serif text-xl font-bold text-white">Membership tiers</h3>
            <p className="mt-1 text-xs text-slate-400">Thresholds use verified sales in an Africa/Nairobi calendar month.</p>
          </div>
          <button
            type="button"
            onClick={addTier}
            disabled={draft.tiers.length >= 12}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-xs font-bold text-cyan-200 disabled:opacity-50"
          >
            <Plus aria-hidden="true" className="h-4 w-4" /> Add tier
          </button>
        </div>

        <div className="mt-5 space-y-4">
          {draft.tiers.map((tier, index) => (
            <article key={tier.id} className="rounded-2xl border border-slate-700/80 bg-slate-950/45 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-wider text-slate-500">Stable ID: {tier.id}</p>
                  <p className="mt-1 text-xs text-slate-400">Rank {tier.rank}</p>
                </div>
                <button
                  type="button"
                  onClick={() => removeTier(tier.id)}
                  disabled={tier.id === draft.defaultTierId || draft.tiers.length <= 1}
                  aria-label={`Remove ${tier.name}`}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-rose-300 hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <Trash2 aria-hidden="true" className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <label className="text-xs font-semibold text-slate-300">Name
                  <input className={`${fieldClass} mt-1.5`} value={tier.name} maxLength={80} onChange={event => updateTier(index, { name: event.target.value })} />
                </label>
                <label className="text-xs font-semibold text-slate-300">Monthly verified sales
                  <input className={`${fieldClass} mt-1.5`} type="number" min={0} step={1} value={tier.monthlyVerifiedSalesThreshold} onChange={event => updateTier(index, { monthlyVerifiedSalesThreshold: Number(event.target.value) })} />
                </label>
                <label className="text-xs font-semibold text-slate-300">Proposed commission (%)
                  <input className={`${fieldClass} mt-1.5`} type="number" min={0.01} max={100} step={0.01} value={tier.proposedCommissionRate} onChange={event => updateTier(index, { proposedCommissionRate: Number(event.target.value) })} />
                </label>
                <label className="text-xs font-semibold text-slate-300">Badge label
                  <input className={`${fieldClass} mt-1.5`} value={tier.badgeLabel || ''} maxLength={80} onChange={event => updateTier(index, { badgeLabel: event.target.value })} />
                </label>
              </div>
              <label className="mt-3 block text-xs font-semibold text-slate-300">Description
                <textarea className={`${fieldClass} mt-1.5 min-h-20`} value={tier.description} maxLength={300} onChange={event => updateTier(index, { description: event.target.value })} />
              </label>
              <label className="mt-3 flex min-h-10 items-center gap-2 text-xs text-slate-300">
                <input type="checkbox" checked={tier.enabled} onChange={event => updateTier(index, { enabled: event.target.checked })} className="h-4 w-4 accent-cyan-400" />
                Tier is eligible for assignment and monthly qualification
              </label>
            </article>
          ))}
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <label className="text-xs font-semibold text-slate-300">Default approved tier
            <select className={`${fieldClass} mt-1.5`} value={draft.defaultTierId} onChange={event => updateDraft({ ...draft, defaultTierId: event.target.value })}>
              {draft.tiers.filter(tier => tier.enabled).map(tier => <option key={tier.id} value={tier.id}>{tier.name}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-300">Introductory participation (days)
            <input className={`${fieldClass} mt-1.5`} type="number" min={0} max={365} step={1} value={draft.introductoryPeriodDays} onChange={event => updateDraft({ ...draft, introductoryPeriodDays: Number(event.target.value) })} />
          </label>
          <label className="text-xs font-semibold text-slate-300">Tier qualification starts
            <input className={`${fieldClass} mt-1.5`} type="datetime-local" value={isoToLocalDateTime(draft.qualificationEffectiveFrom)} onChange={event => updateDraft({ ...draft, qualificationEffectiveFrom: localDateTimeToIso(event.target.value) })} />
          </label>
        </div>
      </section>

      <section className={`rounded-2xl border p-4 sm:p-6 ${draft.commissionPolicy.status === 'active' ? 'border-emerald-300/30 bg-emerald-950/15' : 'border-amber-300/30 bg-amber-950/15'}`}>
        <div className="flex items-start gap-3">
          <Sparkles aria-hidden="true" className="mt-1 h-5 w-5 shrink-0 text-amber-300" />
          <div>
            <h3 className="font-serif text-xl font-bold text-white">Commission policy activation</h3>
            <p className="mt-1 text-sm leading-relaxed text-slate-300">
              {draft.commissionPolicy.status === 'draft'
                ? 'Draft: existing affiliate commission arrangements remain in force.'
                : 'Active: tier rates apply only to eligible transactions from the effective date. Earlier earnings remain unchanged.'}
            </p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <label className="text-xs font-semibold text-slate-300">Policy status
            <select className={`${fieldClass} mt-1.5`} value={draft.commissionPolicy.status} onChange={event => updateDraft({ ...draft, commissionPolicy: { ...draft.commissionPolicy, status: event.target.value as 'draft' | 'active' } })}>
              <option value="draft">Draft — do not apply tier rates</option>
              <option value="active">Active — apply from effective date</option>
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-300">Effective date
            <input className={`${fieldClass} mt-1.5`} type="datetime-local" value={isoToLocalDateTime(draft.commissionPolicy.effectiveAt)} onChange={event => updateDraft({ ...draft, commissionPolicy: { ...draft.commissionPolicy, effectiveAt: localDateTimeToIso(event.target.value) } })} />
          </label>
          <label className="flex min-h-11 items-center gap-3 self-end rounded-xl border border-slate-700 bg-slate-950/50 px-3 py-2 text-xs text-slate-300">
            <input type="checkbox" checked={draft.commissionPolicy.subscriptionRenewalsEligible} onChange={event => updateDraft({ ...draft, commissionPolicy: { ...draft.commissionPolicy, subscriptionRenewalsEligible: event.target.checked } })} className="h-4 w-4 accent-cyan-400" />
            Subscription renewals earn commission
          </label>
        </div>
      </section>

      <section className="rounded-2xl border border-violet-300/20 bg-violet-950/10 p-4 sm:p-6">
        <h3 className="font-serif text-xl font-bold text-white">Private community</h3>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="text-xs font-semibold text-slate-300">Community title
            <input className={`${fieldClass} mt-1.5`} value={draft.community.title} maxLength={120} onChange={event => updateDraft({ ...draft, community: { ...draft.community, title: event.target.value } })} />
          </label>
          <label className="text-xs font-semibold text-slate-300">Private WhatsApp invitation URL
            <input className={`${fieldClass} mt-1.5`} type="url" value={draft.community.whatsappInviteUrl || ''} onChange={event => updateDraft({ ...draft, community: { ...draft.community, whatsappInviteUrl: event.target.value || undefined } })} placeholder="https://chat.whatsapp.com/..." />
          </label>
        </div>
        <label className="mt-3 block text-xs font-semibold text-slate-300">Description
          <textarea className={`${fieldClass} mt-1.5 min-h-24`} value={draft.community.description} maxLength={600} onChange={event => updateDraft({ ...draft, community: { ...draft.community, description: event.target.value } })} />
        </label>
        <div className="mt-5 border-t border-violet-200/10 pt-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h4 className="font-serif text-lg font-bold text-white">Private community bulletin</h4>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">
                Publish announcements, release previews, excerpts, campaigns, featured pieces, and approved promotional guidance. Drafts stay writer-only.
              </p>
            </div>
            <button
              type="button"
              onClick={addCommunityPost}
              disabled={communityPosts.length >= 24}
              className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-violet-300/30 bg-violet-400/10 px-4 py-2 text-xs font-bold text-violet-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus aria-hidden="true" className="h-4 w-4" /> Add bulletin item
            </button>
          </div>

          <div className="mt-4 space-y-4">
            {communityPosts.length ? communityPosts.map(post => (
              <article key={post.id} className="rounded-2xl border border-violet-300/15 bg-slate-950/50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-wider text-slate-500">Stable ID: {post.id}</p>
                    <p className="mt-1 text-xs text-slate-400">Only published, started, unexpired items appear to approved affiliates.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeCommunityPost(post.id)}
                    aria-label={`Delete ${post.title}`}
                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-rose-300 transition hover:bg-rose-500/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
                  >
                    <Trash2 aria-hidden="true" className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <label className="text-xs font-semibold text-slate-300">Type
                    <select className={`${fieldClass} mt-1.5`} value={post.type} onChange={event => updateCommunityPost(post.id, { type: event.target.value as LiteraryCircleCommunityPost['type'] })}>
                      {COMMUNITY_POST_TYPE_LABELS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </label>
                  <label className="text-xs font-semibold text-slate-300">Display order
                    <input className={`${fieldClass} mt-1.5`} type="number" min={0} max={10000} step={1} value={post.order} onChange={event => updateCommunityPost(post.id, { order: Number(event.target.value) })} />
                  </label>
                  <label className="text-xs font-semibold text-slate-300">Publish from
                    <input className={`${fieldClass} mt-1.5`} type="datetime-local" value={isoToLocalDateTime(post.publishedAt)} onChange={event => updateCommunityPost(post.id, { publishedAt: localDateTimeToIso(event.target.value) })} />
                  </label>
                  <label className="text-xs font-semibold text-slate-300">Expire automatically
                    <input className={`${fieldClass} mt-1.5`} type="datetime-local" value={isoToLocalDateTime(post.expiresAt)} onChange={event => updateCommunityPost(post.id, { expiresAt: localDateTimeToIso(event.target.value) })} />
                  </label>
                </div>
                <label className="mt-3 block text-xs font-semibold text-slate-300">Title
                  <input className={`${fieldClass} mt-1.5`} value={post.title} maxLength={120} onChange={event => updateCommunityPost(post.id, { title: event.target.value })} />
                </label>
                <label className="mt-3 block text-xs font-semibold text-slate-300">Private message
                  <textarea className={`${fieldClass} mt-1.5 min-h-28`} value={post.body} maxLength={2000} onChange={event => updateCommunityPost(post.id, { body: event.target.value })} />
                </label>
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  <label className="text-xs font-semibold text-slate-300">Linked piece ID (optional)
                    <input className={`${fieldClass} mt-1.5 font-mono`} value={post.pieceId || ''} maxLength={128} onChange={event => updateCommunityPost(post.id, { pieceId: event.target.value || undefined })} placeholder="Published piece ID" />
                  </label>
                  <label className="text-xs font-semibold text-slate-300">Button label (optional)
                    <input className={`${fieldClass} mt-1.5`} value={post.ctaLabel || ''} maxLength={80} onChange={event => updateCommunityPost(post.id, { ctaLabel: event.target.value || undefined })} placeholder="Open campaign resource" />
                  </label>
                  <label className="text-xs font-semibold text-slate-300">HTTPS resource URL (optional)
                    <input className={`${fieldClass} mt-1.5`} type="url" value={post.ctaUrl || ''} maxLength={1000} onChange={event => updateCommunityPost(post.id, { ctaUrl: event.target.value || undefined })} placeholder="https://…" />
                  </label>
                </div>
                <label className="mt-3 flex min-h-10 items-center gap-2 text-xs text-slate-300">
                  <input type="checkbox" checked={post.isPublished} onChange={event => updateCommunityPost(post.id, { isPublished: event.target.checked })} className="h-4 w-4 accent-violet-400" />
                  Publish this item to approved affiliates
                </label>
              </article>
            )) : (
              <p className="rounded-xl border border-dashed border-slate-700 bg-black/15 p-4 text-sm text-slate-400">
                No bulletin items yet. Add one and keep it as a draft until it is ready.
              </p>
            )}
          </div>
        </div>
        <label className="mt-3 flex min-h-10 items-center gap-2 text-xs text-slate-300">
          <input type="checkbox" checked={draft.community.enabled} onChange={event => updateDraft({ ...draft, community: { ...draft.community, enabled: event.target.checked } })} className="h-4 w-4 accent-violet-400" />
          Show private community information to approved affiliates
        </label>
      </section>

      <div className="flex flex-col gap-3 rounded-2xl border border-slate-700 bg-slate-900/70 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
          {success && <p role="status" className="text-sm text-emerald-300">{success}</p>}
          {!error && !success && <p className="text-xs text-slate-400">Changes are durable only after you save them.</p>}
        </div>
        <button type="button" onClick={saveSettings} disabled={savingSettings || !dirty} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-400 to-cyan-400 px-5 py-3 font-mono text-xs font-bold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50">
          <Save aria-hidden="true" className="h-4 w-4" /> {savingSettings ? 'Saving…' : dirty ? 'Save Literary Circle settings' : 'Settings saved'}
        </button>
      </div>

      {availablePerformancePeriods.length ? (
        <section className="rounded-2xl border border-cyan-300/20 bg-cyan-950/10 p-4 sm:p-6" aria-labelledby="literary-circle-performance-heading">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-start gap-3">
              <BarChart3 aria-hidden="true" className="mt-1 h-5 w-5 shrink-0 text-cyan-300" />
              <div>
                <h3 id="literary-circle-performance-heading" className="font-serif text-xl font-bold text-white">Monthly performance ledger</h3>
                <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-400">
                  Read-only verified-sale reporting in Africa/Nairobi calendar months. Reversed and rejected commissions never inflate totals; recorded transaction tiers and policy versions remain unchanged.
                </p>
              </div>
            </div>
            <label className="text-xs font-semibold text-slate-300">
              Reporting month
              <select
                className={`${fieldClass} mt-1.5 min-w-56`}
                value={selectedPerformancePeriod}
                onChange={event => setSelectedPerformancePeriod(event.target.value)}
              >
                {availablePerformancePeriods.map(periodKey => (
                  <option key={periodKey} value={periodKey}>{performancePeriodLabel(periodKey)}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <PerformanceMetric label="Verified sales" value={selectedPerformanceTotals.verifiedSales.toLocaleString()} />
            <PerformanceMetric label="Gross affiliate sales" value={`KES ${selectedPerformanceTotals.grossSalesKes.toLocaleString()}`} />
            <PerformanceMetric label="Commissions recorded" value={`KES ${selectedPerformanceTotals.commissionEarnedKes.toLocaleString()}`} />
            <PerformanceMetric label="Retained before other costs" value={`KES ${selectedPerformanceTotals.retainedRevenueKes.toLocaleString()}`} />
          </div>

          <div className="mt-4 overflow-x-auto rounded-xl border border-slate-700/80">
            <table className="min-w-[920px] w-full text-left text-xs">
              <thead className="bg-slate-950/80 font-mono text-[10px] uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-3 py-2.5">Partner</th>
                  <th className="px-3 py-2.5 text-right">Verified</th>
                  <th className="px-3 py-2.5 text-right">Gross</th>
                  <th className="px-3 py-2.5 text-right">Commission</th>
                  <th className="px-3 py-2.5">Performance tier</th>
                  <th className="px-3 py-2.5">Recorded snapshots</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 bg-slate-950/35">
                {selectedPerformanceRows.map(({ report, period }) => (
                  <tr key={report.affiliateId}>
                    <td className="px-3 py-3">
                      <span className="font-semibold text-slate-100">{report.affiliateName}</span>
                      <span className="ml-2 font-mono text-[10px] text-cyan-300">{report.affiliateCode}</span>
                      {report.manuallyAssignedTierId && <span className="block text-[9px] text-amber-300">Manual assignment: {report.manuallyAssignedTierId}</span>}
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-cyan-200">
                      {period.verifiedSales}
                      {period.qualifyingSales !== period.verifiedSales && <span className="block text-[9px] text-slate-500">{period.qualifyingSales} qualifying</span>}
                      <span className="block text-[9px] text-slate-500">{period.pieceSales} pieces · {period.bundleSales} bundles · {period.subscriptionSales} passes</span>
                      {period.reversedOrRejectedSales > 0 && <span className="block text-[9px] text-rose-300">{period.reversedOrRejectedSales} excluded</span>}
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-slate-300">KES {period.grossSalesKes.toLocaleString()}</td>
                    <td className="px-3 py-3 text-right font-mono font-bold text-emerald-300">KES {period.commissionEarnedKes.toLocaleString()}</td>
                    <td className="px-3 py-3">
                      <span className="font-semibold text-amber-100">{period.qualifiedTier.name}</span>
                      <span className="ml-1 text-[9px] uppercase text-slate-500">{period.qualificationMode}</span>
                    </td>
                    <td className="px-3 py-3 font-mono text-[10px] text-slate-400">
                      {period.recordedTierIds.length ? `Tier: ${period.recordedTierIds.join(', ')}` : 'No tier-rate sale'}
                      <span className="block">{period.recordedPolicyVersions.length ? `Policy: v${period.recordedPolicyVersions.join(', v')}` : `Report rules: v${period.policyVersion}`}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="rounded-2xl border border-slate-700 bg-slate-900/60 p-4 sm:p-6">
        <div className="flex items-start gap-3">
          <Users aria-hidden="true" className="mt-1 h-5 w-5 text-cyan-300" />
          <div>
            <h3 className="font-serif text-xl font-bold text-white">Affiliate membership control</h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">Suspending complimentary access never removes legitimately purchased reader content or historical earnings.</p>
          </div>
        </div>
        <div className="mt-5 space-y-3">
          {sortedAffiliates.length ? sortedAffiliates.map(affiliate => (
            <MembershipRow
              key={`${affiliate.id}:${affiliate.updatedAt || ''}`}
              affiliate={affiliate}
              tiers={draft.tiers}
              saving={savingAffiliateId === affiliate.id}
              onSave={patch => onUpdateMembership(affiliate.id, patch)}
            />
          )) : (
            <p className="rounded-xl border border-slate-700 bg-slate-950/40 p-4 text-sm text-slate-400">No affiliate accounts are available.</p>
          )}
        </div>
      </section>
    </div>
  );
};
