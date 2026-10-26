import React from 'react';
import { ArrowRight, BookOpen, CalendarDays, RefreshCw } from 'lucide-react';

import type { HomepageConfig, SubscriptionPlan } from '../types.js';
import { responsiveImageUrl, responsiveImageSrcSet } from '../utils/responsiveImage.js';

const KES_FORMATTER = new Intl.NumberFormat('en-KE', { maximumFractionDigits: 0 });

function durationLabel(months: number): string {
  if (months === 12) return '1 year';
  if (months > 12 && months % 12 === 0) return `${months / 12} years`;
  return `${months} months`;
}

export interface HomepageReaderPassesProps {
  prioritizeFirstCover?: boolean;
  plans: SubscriptionPlan[];
  config?: HomepageConfig | null;
  onChoosePlan: (plan: SubscriptionPlan) => void;
  initialPlanId?: string | null;
  onInitialPlanHandled?: () => void;
}

export const resolveHomepageSubscriptionDeepLink = (
  plans: SubscriptionPlan[],
  destinationId?: string | null,
): SubscriptionPlan | null => {
  if (!destinationId) return null;
  return plans.find(plan => plan.isPublished !== false && plan.id === destinationId) || null;
};

export const HomepageReaderPasses: React.FC<HomepageReaderPassesProps> = ({
  prioritizeFirstCover = false,
  plans,
  config,
  onChoosePlan,
  initialPlanId,
  onInitialPlanHandled,
}) => {
  const visiblePlans = React.useMemo(
    () => [...plans]
      .filter(plan => plan.isPublished !== false)
      .sort((left, right) => left.order - right.order || left.priceKes - right.priceKes),
    [plans],
  );
  const handledPlanRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!initialPlanId || handledPlanRef.current === initialPlanId) return;
    handledPlanRef.current = initialPlanId;
    const target = resolveHomepageSubscriptionDeepLink(visiblePlans, initialPlanId);
    const targetCard = target ? document.getElementById(`reader-pass-${target.id}`) : null;
    (targetCard || document.getElementById('home-reader-passes'))
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    targetCard?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    onInitialPlanHandled?.();
  }, [initialPlanId, onInitialPlanHandled, visiblePlans]);

  if (visiblePlans.length === 0) return null;

  const heading = config?.homepageSubscriptionsHeading?.trim() || 'Reader Passes';
  const subtitle = config?.homepageSubscriptionsSubtitle?.trim()
    || 'Choose a season of uninterrupted access to every published piece.';
  const badge = config?.homepageSubscriptionsBadge?.trim() || 'Full catalogue access';

  return (
    <section
      id="home-reader-passes"
      aria-labelledby="home-reader-passes-heading"
      className="border-y border-sky-950/80 bg-gradient-to-b from-[#08111f] via-[#0b1424] to-[#0b101b]"
    >
      <div className="mx-auto w-full max-w-6xl px-4 py-9 sm:px-6 sm:py-12">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.28em] text-sky-400">
              {badge}
            </p>
            <h2 id="home-reader-passes-heading" className="mt-2 font-display text-3xl font-bold text-white sm:text-4xl">
              {heading}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-400 sm:text-base">{subtitle}</p>
          </div>
          <p className="max-w-sm rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-[11px] leading-relaxed text-slate-400">
            Sign in once. Your pass follows your reader account across sessions, and renewal never removes remaining paid time.
          </p>
        </header>

        <div className="mt-7 flex snap-x snap-mandatory gap-4 overflow-x-auto pb-3 md:grid md:grid-cols-2 md:overflow-visible xl:grid-cols-4">
          {visiblePlans.map((plan, index) => (
            <article
              key={plan.id}
              id={`reader-pass-${plan.id}`}
              data-subscription-plan-id={plan.id}
              className="group flex min-w-[82%] snap-center flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/80 shadow-xl shadow-black/15 transition hover:-translate-y-0.5 hover:border-sky-800 sm:min-w-[46%] md:min-w-0"
            >
              <div className="relative aspect-[4/3] overflow-hidden bg-gradient-to-br from-sky-950 via-slate-900 to-[#080d17]">
                <div className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
                  <BookOpen className="h-12 w-12 text-sky-500/35" />
                </div>
                {plan.coverImage ? (
                  <img
                    src={responsiveImageUrl(plan.coverImage, 640)}
                    srcSet={responsiveImageSrcSet(plan.coverImage, [320, 480, 640, 960])}
                    sizes="(min-width: 1280px) 264px, (min-width: 768px) 45vw, (min-width: 640px) 46vw, 82vw"
                    width={640}
                    height={480}
                    alt={plan.coverImageAlt || ''}
                    loading={prioritizeFirstCover && index === 0 ? 'eager' : 'lazy'}
                    fetchPriority={prioritizeFirstCover && index === 0 ? 'high' : 'auto'}
                    decoding="async"
                    style={{
                      objectPosition: `${plan.coverPosition?.x ?? 50}% ${plan.coverPosition?.y ?? 50}%`
                    }}
                    className="h-full w-full object-cover opacity-80 transition duration-500 group-hover:scale-[1.025] group-hover:opacity-95"
                  />
                ) : null}
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-transparent" />
                {plan.badge ? (
                  <span className="absolute left-3 top-3 rounded-full border border-amber-700/70 bg-amber-950/90 px-2.5 py-1 font-mono text-[9px] font-semibold uppercase tracking-wider text-amber-200">
                    {plan.badge}
                  </span>
                ) : null}
              </div>

              <div className="flex flex-1 flex-col p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-display text-xl font-bold text-white">{plan.name}</p>
                    <p className="mt-1 inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-sky-400">
                      <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
                      {durationLabel(plan.durationMonths)}
                    </p>
                  </div>
                  <p className="shrink-0 text-right">
                    <span className="block font-display text-xl font-bold text-emerald-300">
                      KSh {KES_FORMATTER.format(plan.priceKes)}
                    </span>
                    <span className="block text-[10px] text-slate-500">one payment</span>
                  </p>
                </div>

                <p className="mt-3 flex-1 text-sm leading-relaxed text-slate-400">{plan.description}</p>
                <div className="mt-4 flex items-center gap-2 text-[11px] text-slate-400">
                  {plan.renewable ? (
                    <>
                      <RefreshCw className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                      Renewable from your current expiry
                    </>
                  ) : (
                    <>Fixed access period</>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => onChoosePlan(plan)}
                  className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-sky-500 px-4 py-3 text-xs font-bold text-slate-950 transition hover:bg-sky-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                >
                  Choose {plan.name}
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
};
