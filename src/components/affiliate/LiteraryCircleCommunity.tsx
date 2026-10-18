import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  Megaphone,
  MessageCircle,
  Sparkles,
} from 'lucide-react';

import type {
  Article,
  LiteraryCircleCommunityPost,
  LiteraryCircleSettings,
} from '../../types.js';
import { getSafeCommunityInviteUrl } from './LiteraryCircleMembershipOverview.js';

interface LiteraryCircleCommunityProps {
  community: LiteraryCircleSettings['community'];
  articles: Article[];
  onReadArticle: (article: Article) => void;
  now?: string;
}

const TYPE_LABELS: Record<LiteraryCircleCommunityPost['type'], string> = {
  announcement: 'Writer announcement',
  release_preview: 'Upcoming release',
  exclusive_excerpt: 'Exclusive excerpt',
  monthly_campaign: 'Monthly reading campaign',
  featured_piece: 'Featured piece',
  promotional_guidance: 'Promotional guidance',
};

const parsedTime = (value?: string): number | null => {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

export function getNextCommunityRefreshDelay(
  community: LiteraryCircleSettings['community'],
  nowMs: number,
): number | null {
  let nearestExpiry = Number.POSITIVE_INFINITY;
  for (const post of community.posts || []) {
    const expiry = parsedTime(post.expiresAt);
    if (expiry !== null && expiry > nowMs && expiry < nearestExpiry) nearestExpiry = expiry;
  }
  if (!Number.isFinite(nearestExpiry)) return null;
  return Math.min(60_000, Math.max(50, nearestExpiry - nowMs + 25));
}

export function getVisibleLiteraryCircleCommunityPosts(
  community: LiteraryCircleSettings['community'],
  now = new Date().toISOString(),
): LiteraryCircleCommunityPost[] {
  if (!community.enabled) return [];
  const nowMs = parsedTime(now) ?? Date.now();
  return [...(community.posts || [])]
    .filter(post => post.isPublished)
    .filter(post => {
      const publishedAt = parsedTime(post.publishedAt);
      return !post.publishedAt || (publishedAt !== null && publishedAt <= nowMs);
    })
    .filter(post => {
      const expiresAt = parsedTime(post.expiresAt);
      return !post.expiresAt || (expiresAt !== null && expiresAt > nowMs);
    })
    .sort((left, right) => (
      left.order - right.order
      || (parsedTime(right.publishedAt) ?? 0) - (parsedTime(left.publishedAt) ?? 0)
      || left.id.localeCompare(right.id)
    ));
}

export function getSafeCommunityActionUrl(value?: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

export const LiteraryCircleCommunity: React.FC<LiteraryCircleCommunityProps> = ({
  community,
  articles,
  onReadArticle,
  now,
}) => {
  const [liveNowMs, setLiveNowMs] = useState(() => Date.now());
  const communityRefreshDelay = now || !community.enabled
    ? null
    : getNextCommunityRefreshDelay(community, liveNowMs);
  useEffect(() => {
    if (communityRefreshDelay === null) return;
    const timer = setTimeout(
      () => setLiveNowMs(Date.now()),
      communityRefreshDelay,
    );
    return () => clearTimeout(timer);
  }, [communityRefreshDelay, liveNowMs]);

  const effectiveNow = now || new Date(liveNowMs).toISOString();
  const visiblePosts = useMemo(
    () => getVisibleLiteraryCircleCommunityPosts(community, effectiveNow),
    [community, effectiveNow],
  );
  const articleById = useMemo(
    () => new Map(articles.map(article => [article.id, article])),
    [articles],
  );
  const whatsappInviteUrl = getSafeCommunityInviteUrl(community.whatsappInviteUrl);

  if (!community.enabled) return null;

  return (
    <section
      aria-labelledby="literary-circle-community-heading"
      className="overflow-hidden rounded-2xl border border-violet-300/20 bg-gradient-to-br from-violet-950/25 via-slate-950/80 to-cyan-950/20"
    >
      <header className="border-b border-white/10 p-4 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="inline-flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-violet-300">
              <MessageCircle aria-hidden="true" className="h-3.5 w-3.5" />
              Private partner community
            </p>
            <h2 id="literary-circle-community-heading" className="mt-2 font-serif text-2xl font-bold text-white">
              {community.title}
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-300">{community.description}</p>
          </div>
          {whatsappInviteUrl && (
            <a
              href={whatsappInviteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-emerald-300/30 bg-emerald-400/10 px-4 py-2 font-mono text-xs font-bold text-emerald-200 transition hover:bg-emerald-400/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
            >
              Open private WhatsApp invitation
              <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      </header>

      <div className="p-4 sm:p-6">
        {visiblePosts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-700 bg-black/20 px-4 py-8 text-center text-sm text-slate-400">
            Writer announcements and campaign guidance will appear here.
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {visiblePosts.map(post => {
              const linkedArticle = post.pieceId ? articleById.get(post.pieceId) : undefined;
              const safeActionUrl = getSafeCommunityActionUrl(post.ctaUrl);
              const actionLabel = post.ctaLabel || (linkedArticle ? `Read ${linkedArticle.title}` : 'Open resource');
              return (
                <article key={post.id} className="rounded-2xl border border-white/10 bg-slate-950/70 p-4 sm:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-300/25 bg-violet-400/10 px-2.5 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-violet-200">
                      {post.type === 'featured_piece' ? (
                        <BookOpen aria-hidden="true" className="h-3 w-3" />
                      ) : post.type === 'announcement' ? (
                        <Megaphone aria-hidden="true" className="h-3 w-3" />
                      ) : (
                        <Sparkles aria-hidden="true" className="h-3 w-3" />
                      )}
                      {TYPE_LABELS[post.type]}
                    </span>
                    {post.publishedAt && (
                      <time
                        dateTime={post.publishedAt}
                        className="inline-flex items-center gap-1 text-[10px] text-slate-500"
                      >
                        <CalendarDays aria-hidden="true" className="h-3 w-3" />
                        {new Date(post.publishedAt).toLocaleDateString('en-KE', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </time>
                    )}
                  </div>
                  <h3 className="mt-3 font-serif text-lg font-bold text-white">{post.title}</h3>
                  <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-300">{post.body}</p>
                  {linkedArticle ? (
                    <button
                      type="button"
                      onClick={() => onReadArticle(linkedArticle)}
                      className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-xl border border-cyan-300/30 bg-cyan-400/10 px-3 py-2 font-mono text-xs font-bold text-cyan-100 transition hover:bg-cyan-400/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                    >
                      {actionLabel}
                      <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />
                    </button>
                  ) : safeActionUrl ? (
                    <a
                      href={safeActionUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-xl border border-cyan-300/30 bg-cyan-400/10 px-3 py-2 font-mono text-xs font-bold text-cyan-100 transition hover:bg-cyan-400/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                    >
                      {actionLabel}
                      <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />
                    </a>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
};
