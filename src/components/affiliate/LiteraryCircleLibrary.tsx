import React, { useMemo } from 'react';
import { ArrowUpRight, BookOpen, Clock3, Sparkles } from 'lucide-react';

import type { Article } from '../../types.js';

interface LiteraryCircleLibraryProps {
  articles: Article[];
  onOpenArticle: (article: Article) => void;
}

const timestamp = (value?: string): number => {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
};

export const orderLiteraryCircleLibrary = (articles: Article[]): Article[] => (
  [...articles]
    .filter(article => !article.status || article.status === 'published')
    .sort((left, right) => {
      if (Boolean(left.featured) !== Boolean(right.featured)) return left.featured ? -1 : 1;
      return timestamp(right.publishedAt || right.updatedAt) - timestamp(left.publishedAt || left.updatedAt);
    })
);

export const LiteraryCircleLibrary: React.FC<LiteraryCircleLibraryProps> = ({
  articles,
  onOpenArticle,
}) => {
  const orderedArticles = useMemo(() => orderLiteraryCircleLibrary(articles), [articles]);
  const newestIds = useMemo(
    () => new Set(
      [...orderedArticles]
        .sort((left, right) => timestamp(right.publishedAt || right.updatedAt) - timestamp(left.publishedAt || left.updatedAt))
        .slice(0, 3)
        .map(article => article.id)
    ),
    [orderedArticles]
  );

  return (
    <section
      aria-labelledby="literary-circle-library-heading"
      className="rounded-2xl border border-emerald-300/20 bg-gradient-to-br from-emerald-950/20 via-slate-950/80 to-cyan-950/20 p-4 sm:p-6"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-300">
            Complimentary library
          </p>
          <h2 id="literary-circle-library-heading" className="mt-1 font-serif text-2xl font-bold text-white">
            Read before you recommend
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-300">
            Every published piece is available while your Literary Circle access is active. Opening a piece here does not create a sale or commission.
          </p>
        </div>
        <div className="inline-flex w-fit items-center gap-2 rounded-xl border border-emerald-300/20 bg-emerald-400/10 px-3 py-2 font-mono text-xs font-bold text-emerald-200">
          <BookOpen aria-hidden="true" className="h-4 w-4" />
          {orderedArticles.length} {orderedArticles.length === 1 ? 'piece' : 'pieces'} unlocked
        </div>
      </div>

      {orderedArticles.length === 0 ? (
        <div className="mt-5 rounded-xl border border-dashed border-slate-700 bg-black/20 px-4 py-8 text-center text-sm text-slate-400">
          Published pieces will appear here as soon as they are available.
        </div>
      ) : (
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {orderedArticles.map(article => {
            const isNew = newestIds.has(article.id);
            return (
              <article key={article.id} className="group overflow-hidden rounded-2xl border border-white/10 bg-slate-950/75 transition hover:border-emerald-300/30">
                {article.coverImage ? (
                  <div className="aspect-[16/9] overflow-hidden bg-slate-900">
                    <img
                      src={article.coverImage}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      referrerPolicy="no-referrer"
                      onError={(event) => { event.currentTarget.style.display = 'none'; }}
                      className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
                    />
                  </div>
                ) : (
                  <div className="flex aspect-[16/9] items-center justify-center bg-gradient-to-br from-slate-900 to-emerald-950/40 text-emerald-300/70">
                    <BookOpen aria-hidden="true" className="h-8 w-8" />
                  </div>
                )}
                <div className="p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    {isNew && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-cyan-300/30 bg-cyan-400/10 px-2 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-cyan-200">
                        <Sparkles aria-hidden="true" className="h-3 w-3" />
                        New to the Circle
                      </span>
                    )}
                    {article.featured && (
                      <span className="rounded-full border border-amber-300/30 bg-amber-400/10 px-2 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-amber-200">
                        Recommended
                      </span>
                    )}
                  </div>
                  <h3 className="mt-3 line-clamp-2 font-serif text-lg font-bold leading-snug text-white">{article.title}</h3>
                  {article.excerpt && (
                    <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-slate-400">{article.excerpt}</p>
                  )}
                  <div className="mt-3 flex items-center gap-3 text-[11px] text-slate-500">
                    {article.category && <span>{article.category}</span>}
                    {article.showReadTime !== false && article.readTimeMinutes > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <Clock3 aria-hidden="true" className="h-3 w-3" />
                        {article.readTimeMinutes} min
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => onOpenArticle(article)}
                    className="mt-4 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-emerald-300/30 bg-emerald-400/10 px-3 py-2 font-mono text-xs font-bold text-emerald-100 transition hover:bg-emerald-400/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
                    aria-label={`Read ${article.title} with Literary Circle access`}
                  >
                    Read complimentary
                    <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
};
