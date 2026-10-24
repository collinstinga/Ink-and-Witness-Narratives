import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  Check,
  Circle,
  Link2,
  MessageCircle,
  PartyPopper,
  Share2,
  Sparkles,
  X,
} from 'lucide-react';

import type {
  AffiliateLiteraryCircleMembership,
  LiteraryCircleOnboardingStatus,
  LiteraryCircleOnboardingContent,
} from '../../types.js';
import {
  DEFAULT_LITERARY_CIRCLE_ONBOARDING_STEPS,
  normalizeLiteraryCircleOnboardingContent
} from '../../utils/literaryCircleOnboarding.js';
import { getSafeCommunityInviteUrl } from './LiteraryCircleMembershipOverview.js';

export interface LiteraryCircleOnboardingUpdate {
  completedStepId?: string;
  status?: LiteraryCircleOnboardingStatus;
}

interface RecommendedPiece {
  id: string;
  title: string;
}

interface LiteraryCircleOnboardingPanelProps {
  onboarding: AffiliateLiteraryCircleMembership['onboarding'];
  affiliateCode: string;
  recommendedPieces: RecommendedPiece[];
  content?: LiteraryCircleOnboardingContent;
  community?: {
    enabled: boolean;
    title: string;
    whatsappInviteUrl?: string;
  };
  onUpdate: (update: LiteraryCircleOnboardingUpdate) => Promise<void>;
  onOpenCatalogue?: () => void;
  onOpenLinkBuilder?: () => void;
  onOpenPromotionalResources?: () => void;
}

export const LITERARY_CIRCLE_ONBOARDING_STEPS = DEFAULT_LITERARY_CIRCLE_ONBOARDING_STEPS;

export const LiteraryCircleOnboardingPanel: React.FC<LiteraryCircleOnboardingPanelProps> = ({
  onboarding,
  affiliateCode,
  recommendedPieces,
  content,
  community,
  onUpdate,
  onOpenCatalogue,
  onOpenLinkBuilder,
  onOpenPromotionalResources,
}) => {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const displayContent = useMemo(() => normalizeLiteraryCircleOnboardingContent(content), [content]);
  const steps = displayContent.steps;
  const completedIds = useMemo(() => new Set(onboarding.completedStepIds), [onboarding.completedStepIds]);
  const firstIncompleteIndex = steps.findIndex(step => !completedIds.has(step.id));
  const currentIndex = firstIncompleteIndex === -1
    ? steps.length - 1
    : firstIncompleteIndex;
  const currentStep = steps[currentIndex];
  const completedCount = steps.filter(step => completedIds.has(step.id)).length;
  const visibleStepNumber = Math.min(completedCount + 1, steps.length);
  const isLastStep = currentIndex === steps.length - 1;
  const safeCommunityInviteUrl = community?.enabled
    ? getSafeCommunityInviteUrl(community.whatsappInviteUrl)
    : null;

  if (onboarding.status === 'completed' || onboarding.status === 'dismissed') return null;

  const applyUpdate = async (update: LiteraryCircleOnboardingUpdate) => {
    setSaving(true);
    setError('');
    try {
      await onUpdate(update);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'We could not save your onboarding progress. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const completeCurrentStep = () => applyUpdate({
    completedStepId: currentStep.id,
    status: isLastStep ? 'completed' : 'in_progress',
  });

  const upgradeWelcome = onboarding.audience === 'existing_upgrade';

  return (
    <section
      aria-labelledby="literary-circle-onboarding-heading"
      className="rounded-2xl border border-cyan-300/25 bg-slate-900/75 p-4 shadow-lg shadow-black/10 sm:p-5"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-300/30 bg-cyan-400/10 text-cyan-200">
            <PartyPopper aria-hidden="true" className="h-5 w-5" />
          </div>
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-300">
              One-time guided welcome · {visibleStepNumber} of {steps.length}
            </p>
            <h2 id="literary-circle-onboarding-heading" className="mt-1 font-serif text-xl font-bold text-white">
              {upgradeWelcome ? displayContent.upgradeTitle : displayContent.welcomeTitle}
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">
              {displayContent.description || (upgradeWelcome
                ? 'Your account, referral identity, sales history, commissions, and wallet remain intact.'
                : 'Take a quick tour, choose your first reads, and prepare your first authentic recommendation.')}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => applyUpdate({ status: 'dismissed' })}
          disabled={saving}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-800 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 disabled:cursor-wait disabled:opacity-50"
          aria-label="Dismiss the Literary Circle welcome guide"
          title="Dismiss guide"
        >
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>

      <ol aria-label="Literary Circle onboarding steps" className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {steps.map((step, index) => {
          const complete = completedIds.has(step.id);
          const current = step.id === currentStep.id;
          return (
            <li
              key={step.id}
              aria-current={current ? 'step' : undefined}
              className={`flex min-h-12 items-center gap-2 rounded-xl border px-2.5 py-2 text-[11px] leading-tight ${
                complete
                  ? 'border-emerald-300/20 bg-emerald-400/5 text-emerald-200'
                  : current
                    ? 'border-cyan-300/40 bg-cyan-400/10 text-white'
                    : 'border-slate-700/70 bg-slate-950/30 text-slate-500'
              }`}
            >
              <span className="shrink-0">
                {complete
                  ? <Check aria-hidden="true" className="h-3.5 w-3.5" />
                  : current
                    ? <Sparkles aria-hidden="true" className="h-3.5 w-3.5 text-cyan-300" />
                    : <Circle aria-hidden="true" className="h-3 w-3" />}
              </span>
              <span><span className="sr-only">Step {index + 1}: </span>{step.title}</span>
            </li>
          );
        })}
      </ol>

      <div className="mt-4 rounded-2xl border border-slate-700/80 bg-slate-950/55 p-4 sm:p-5">
        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.15em] text-cyan-300">
          Step {currentIndex + 1}
        </p>
        <h3 className="mt-1 font-serif text-lg font-bold text-white">{currentStep.title}</h3>
        <p className="mt-1 text-sm leading-relaxed text-slate-300">{currentStep.description}</p>

        {currentStep.id === 'complimentary_access' && onOpenCatalogue && (
          <button
            type="button"
            onClick={onOpenCatalogue}
            className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-xl border border-emerald-300/30 bg-emerald-400/10 px-3 py-2 font-mono text-xs font-bold text-emerald-200 transition hover:bg-emerald-400/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
          >
            <BookOpen aria-hidden="true" className="h-4 w-4" />
            Browse my unlocked catalogue
          </button>
        )}

        {currentStep.id === 'referral_links' && (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-slate-700 bg-black/25 px-3 py-2.5">
            <Link2 aria-hidden="true" className="h-4 w-4 shrink-0 text-cyan-300" />
            <code className="break-all text-xs text-cyan-200">/r/{affiliateCode}</code>
          </div>
        )}

        {currentStep.id === 'recommended_reads' && (
          <div className="mt-4">
            {recommendedPieces.length > 0 ? (
              <ol className="grid gap-2 sm:grid-cols-3">
                {recommendedPieces.slice(0, 3).map((piece, index) => (
                  <li key={piece.id} className="rounded-xl border border-amber-200/15 bg-amber-300/5 p-3 text-xs text-amber-100">
                    <span className="mr-1 font-mono text-amber-300">{index + 1}.</span> {piece.title}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="rounded-xl border border-slate-700 bg-slate-900 p-3 text-xs text-slate-400">
                Your first reading recommendations will appear when published pieces are available.
              </p>
            )}
          </div>
        )}

        {currentStep.id === 'first_link' && onOpenLinkBuilder && (
          <button
            type="button"
            onClick={onOpenLinkBuilder}
            className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-xl border border-cyan-300/30 bg-cyan-400/10 px-3 py-2 font-mono text-xs font-bold text-cyan-200 transition hover:bg-cyan-400/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
          >
            <Share2 aria-hidden="true" className="h-4 w-4" />
            Open link &amp; campaign builder
          </button>
        )}

        {currentStep.id === 'promotional_resources' && onOpenPromotionalResources && (
          <button
            type="button"
            onClick={onOpenPromotionalResources}
            className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-xl border border-fuchsia-300/30 bg-fuchsia-400/10 px-3 py-2 font-mono text-xs font-bold text-fuchsia-200 transition hover:bg-fuchsia-400/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-300"
          >
            <Sparkles aria-hidden="true" className="h-4 w-4" />
            Open promotional resources
          </button>
        )}

        {currentStep.id === 'community_invitation' && community?.enabled && (
          <div className="mt-4 rounded-xl border border-violet-300/20 bg-violet-400/5 p-3">
            <p className="text-xs font-semibold text-violet-200">{community.title}</p>
            {safeCommunityInviteUrl && (
              <a
                href={safeCommunityInviteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex min-h-10 items-center gap-2 rounded-xl border border-violet-300/30 bg-violet-400/10 px-3 py-2 font-mono text-xs font-bold text-violet-200 transition hover:bg-violet-400/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
              >
                <MessageCircle aria-hidden="true" className="h-4 w-4" />
                View invitation — joining is optional
              </a>
            )}
          </div>
        )}

        {error && (
          <p role="alert" className="mt-4 rounded-xl border border-rose-400/30 bg-rose-950/40 p-3 text-xs text-rose-200">
            {error}
          </p>
        )}

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[11px] text-slate-500">Progress is saved to this affiliate account.</p>
          <button
            type="button"
            onClick={completeCurrentStep}
            disabled={saving}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-teal-400 px-4 py-2.5 font-mono text-xs font-bold text-slate-950 shadow-lg shadow-cyan-950/30 transition hover:from-cyan-400 hover:to-teal-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 disabled:cursor-wait disabled:opacity-60"
          >
            {saving ? 'Saving progress…' : isLastStep ? 'Complete my welcome' : 'Mark complete & continue'}
            {!saving && <ArrowRight aria-hidden="true" className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </section>
  );
};
