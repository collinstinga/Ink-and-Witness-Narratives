import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Check,
  Copy,
  Download,
  Filter,
  Image as ImageIcon,
  Search,
  Share2,
  Sparkles,
} from 'lucide-react';

import type {
  LiteraryCirclePromotionalResource,
  LiteraryCircleResourceKind,
  LiteraryCircleResourceLibrary,
} from '../../types.js';
import {
  createAffiliateReferralUrl,
  type AffiliateReferralDestination,
} from '../../utils/affiliateReferralDestination.js';

interface LiteraryCircleResourcesLibraryProps {
  library: LiteraryCircleResourceLibrary;
  affiliateCode: string;
  origin?: string;
  onOpenLinkBuilder: (
    destination: AffiliateReferralDestination,
    campaign?: string,
  ) => void;
  now?: string;
}

const KIND_LABELS: Record<LiteraryCircleResourceKind, string> = {
  campaign_kit: 'Campaign kit',
  social_copy: 'Social copy',
  piece_cover: 'Piece cover',
  excerpt: 'Approved excerpt',
  guidance: 'Campaign guidance',
  subscription_campaign: 'Reader Pass campaign',
};

const KIND_OPTIONS = (Object.entries(KIND_LABELS) as Array<[LiteraryCircleResourceKind, string]>);
const SAFE_ASSET_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/;

function parsedTime(value?: string): number | null {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

export function getVisibleLiteraryCircleResources(
  library: LiteraryCircleResourceLibrary,
  now = new Date().toISOString(),
): LiteraryCirclePromotionalResource[] {
  if (!library.enabled) return [];
  const nowMs = parsedTime(now) ?? Date.now();
  return [...library.items]
    .filter(item => item.isPublished)
    .filter(item => {
      const startsAt = parsedTime(item.publishedAt);
      return !item.publishedAt || (startsAt !== null && startsAt <= nowMs);
    })
    .filter(item => {
      const expiresAt = parsedTime(item.expiresAt);
      return !item.expiresAt || (expiresAt !== null && expiresAt > nowMs);
    })
    .sort((left, right) => (
      left.order - right.order
      || (parsedTime(right.publishedAt) ?? 0) - (parsedTime(left.publishedAt) ?? 0)
      || left.id.localeCompare(right.id)
    ));
}

export function getNextResourceRefreshDelay(
  library: LiteraryCircleResourceLibrary,
  nowMs: number,
): number | null {
  let nearestBoundary = Number.POSITIVE_INFINITY;
  for (const item of library.items) {
    for (const value of [item.publishedAt, item.expiresAt]) {
      const boundary = parsedTime(value);
      if (boundary !== null && boundary > nowMs && boundary < nearestBoundary) {
        nearestBoundary = boundary;
      }
    }
  }
  if (!Number.isFinite(nearestBoundary)) return null;
  return Math.min(60_000, Math.max(50, nearestBoundary - nowMs + 25));
}

export function getResourceReferralDestination(
  item: LiteraryCirclePromotionalResource,
): AffiliateReferralDestination {
  if (item.destination.kind === 'home') return { type: 'home' };
  return { type: item.destination.kind, id: item.destination.id } as AffiliateReferralDestination;
}

export function getShareableResourceImageUrl(assetId?: string): string | null {
  if (!assetId || !SAFE_ASSET_ID.test(assetId)) return null;
  return `/api/assets/${encodeURIComponent(assetId)}`;
}

async function copyToClipboard(value: string): Promise<void> {
  if (!navigator?.clipboard?.writeText) {
    throw new Error('Clipboard access is unavailable in this browser.');
  }
  await navigator.clipboard.writeText(value);
}

export const LiteraryCircleResourcesLibrary: React.FC<LiteraryCircleResourcesLibraryProps> = ({
  library,
  affiliateCode,
  origin,
  onOpenLinkBuilder,
  now,
}) => {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<'all' | LiteraryCircleResourceKind>('all');
  const [copiedKey, setCopiedKey] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [liveNowMs, setLiveNowMs] = useState(() => Date.now());
  const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshDelay = now || !library.enabled
    ? null
    : getNextResourceRefreshDelay(library, liveNowMs);
  useEffect(() => {
    if (refreshDelay === null) return;
    const timer = setTimeout(() => setLiveNowMs(Date.now()), refreshDelay);
    return () => clearTimeout(timer);
  }, [refreshDelay, liveNowMs]);

  useEffect(() => () => {
    if (copyResetTimerRef.current) clearTimeout(copyResetTimerRef.current);
  }, []);

  const effectiveNow = now || new Date(liveNowMs).toISOString();
  const visibleItems = useMemo(
    () => getVisibleLiteraryCircleResources(library, effectiveNow),
    [effectiveNow, library],
  );
  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('en');
    return visibleItems.filter(item => {
      if (kind !== 'all' && item.kind !== kind) return false;
      if (!normalizedQuery) return true;
      return [item.title, item.description, item.body, KIND_LABELS[item.kind]]
        .some(value => value?.toLocaleLowerCase('en').includes(normalizedQuery));
    });
  }, [kind, query, visibleItems]);

  if (!library.enabled) return null;

  const resolvedOrigin = origin
    || (typeof window !== 'undefined' ? window.location.origin : 'https://inkandwitness-narratives.co.ke');

  const markCopied = async (key: string, value: string, message: string) => {
    try {
      await copyToClipboard(value);
      setCopiedKey(key);
      setStatusMessage(message);
      if (copyResetTimerRef.current) clearTimeout(copyResetTimerRef.current);
      copyResetTimerRef.current = setTimeout(() => {
        setCopiedKey(current => current === key ? '' : current);
        setStatusMessage('');
      }, 2_500);
    } catch (error) {
      setCopiedKey('');
      setStatusMessage(error instanceof Error ? error.message : 'The text could not be copied.');
    }
  };

  return (
    <section
      aria-labelledby="literary-circle-resources-heading"
      className="overflow-hidden rounded-2xl border border-fuchsia-300/20 bg-gradient-to-br from-fuchsia-950/20 via-slate-950/85 to-cyan-950/20"
    >
      <header className="border-b border-white/10 p-4 sm:p-6">
        <p className="inline-flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-fuchsia-300">
          <Sparkles aria-hidden="true" className="h-3.5 w-3.5" />
          Writer-approved partner toolkit
        </p>
        <h2 id="literary-circle-resources-heading" className="mt-2 font-serif text-2xl font-bold text-white">
          {library.title}
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-300">{library.description}</p>
      </header>

      <div className="space-y-5 p-4 sm:p-6">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(11rem,15rem)]">
          <label className="relative block">
            <span className="sr-only">Search promotional resources</span>
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-500" />
            <input
              type="search"
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Search resources"
              className="min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950/80 py-2 pl-10 pr-3 text-sm text-white outline-none placeholder:text-slate-600 focus:border-fuchsia-400 focus:ring-2 focus:ring-fuchsia-400/20"
            />
          </label>
          <label className="relative block">
            <span className="sr-only">Filter resources by type</span>
            <Filter aria-hidden="true" className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-500" />
            <select
              value={kind}
              onChange={event => setKind(event.target.value as 'all' | LiteraryCircleResourceKind)}
              className="min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950/80 py-2 pl-10 pr-3 text-sm text-white outline-none focus:border-fuchsia-400 focus:ring-2 focus:ring-fuchsia-400/20"
            >
              <option value="all">All resource types</option>
              {KIND_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </div>

        <p className="sr-only" aria-live="polite">{statusMessage}</p>

        {filteredItems.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-700 bg-black/20 px-4 py-10 text-center">
            <ImageIcon aria-hidden="true" className="mx-auto h-7 w-7 text-fuchsia-300/60" />
            <p className="mt-3 text-sm font-semibold text-slate-200">
              {visibleItems.length ? 'No resources match this filter' : 'No published resources yet'}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {visibleItems.length ? 'Try a different word or resource type.' : 'Writer-approved campaign materials will appear here.'}
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {filteredItems.map(item => {
              const destination = getResourceReferralDestination(item);
              const referralUrl = createAffiliateReferralUrl({
                origin: resolvedOrigin,
                affiliateCode,
                destination,
                campaign: item.campaignCode,
              });
              const imageUrl = getShareableResourceImageUrl(item.assetId);
              const bodyCopyKey = `${item.id}:body`;
              const linkCopyKey = `${item.id}:link`;
              return (
                <article key={item.id} className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-950/75">
                  {imageUrl && (
                    <div className="aspect-[16/10] overflow-hidden border-b border-white/10 bg-black/30">
                      <img
                        src={imageUrl}
                        alt={item.assetAlt || ''}
                        loading="lazy"
                        decoding="async"
                        className="h-full w-full object-contain"
                      />
                    </div>
                  )}
                  <div className="flex flex-1 flex-col p-4 sm:p-5">
                    <span className="self-start rounded-full border border-fuchsia-300/25 bg-fuchsia-400/10 px-2.5 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-fuchsia-200">
                      {KIND_LABELS[item.kind]}
                    </span>
                    <h3 className="mt-3 font-serif text-lg font-bold text-white">{item.title}</h3>
                    {item.description && <p className="mt-2 text-sm leading-relaxed text-slate-300">{item.description}</p>}
                    {item.body && (
                      <blockquote className="mt-3 whitespace-pre-line rounded-xl border border-white/10 bg-black/20 p-3 text-sm leading-relaxed text-slate-300">
                        {item.body}
                      </blockquote>
                    )}

                    <div className="mt-auto grid gap-2 pt-4 sm:grid-cols-2">
                      {item.body && (
                        <button
                          type="button"
                          onClick={() => void markCopied(bodyCopyKey, item.body!, `Approved copy for “${item.title}” copied.`)}
                          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-fuchsia-300/25 bg-fuchsia-400/10 px-3 py-2 text-xs font-bold text-fuchsia-100 transition hover:bg-fuchsia-400/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-300"
                        >
                          {copiedKey === bodyCopyKey ? <Check aria-hidden="true" className="h-4 w-4" /> : <Copy aria-hidden="true" className="h-4 w-4" />}
                          {copiedKey === bodyCopyKey ? 'Copy saved' : 'Copy approved text'}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void markCopied(linkCopyKey, referralUrl, `Tracked referral link for “${item.title}” copied.`)}
                        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-cyan-300/25 bg-cyan-400/10 px-3 py-2 text-xs font-bold text-cyan-100 transition hover:bg-cyan-400/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                      >
                        {copiedKey === linkCopyKey ? <Check aria-hidden="true" className="h-4 w-4" /> : <Share2 aria-hidden="true" className="h-4 w-4" />}
                        {copiedKey === linkCopyKey ? 'Link copied' : 'Copy tracked link'}
                      </button>
                      {imageUrl && (
                        <a
                          href={imageUrl}
                          download
                          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-600 bg-slate-900 px-3 py-2 text-xs font-bold text-slate-200 transition hover:border-slate-400 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
                        >
                          <Download aria-hidden="true" className="h-4 w-4" /> Download artwork
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => onOpenLinkBuilder(destination, item.campaignCode)}
                        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-600 bg-slate-900 px-3 py-2 text-xs font-bold text-slate-200 transition hover:border-cyan-400/50 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                      >
                        Open link builder <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
};
