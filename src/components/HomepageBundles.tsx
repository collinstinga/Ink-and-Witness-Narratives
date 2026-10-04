import React from 'react';
import { Check, Layers3, LibraryBig, ShoppingBag } from 'lucide-react';

import type { Article, ContentBundle, HomepageConfig } from '../types.js';

export type HomepageBundle = ContentBundle & {
  pieces: Article[];
  checkoutArticle: Article;
};

interface HomepageBundlesProps {
  bundles: HomepageBundle[];
  config?: HomepageConfig | null;
  onPurchaseBundle: (bundle: ContentBundle, checkoutArticle: Article) => void;
}

const KES_FORMATTER = new Intl.NumberFormat('en-KE', { maximumFractionDigits: 0 });

export const HomepageBundles: React.FC<HomepageBundlesProps> = ({
  bundles,
  config,
  onPurchaseBundle,
}) => {
  if (bundles.length === 0) return null;

  const heading = config?.homepageBundlesHeading?.trim() || 'Reading Bundles';
  const subtitle = config?.homepageBundlesSubtitle?.trim() ||
    'Choose a complete reading set. One payment permanently adds every included piece to your library.';

  return (
    <section id="home-reading-bundles" aria-labelledby="home-bundles-heading" className="space-y-7">
      <header className="max-w-2xl space-y-2">
        <p className="inline-flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.3em] text-emerald-400/90">
          <ShoppingBag className="h-3.5 w-3.5" aria-hidden="true" />
          Buy a complete set
        </p>
        <h2 id="home-bundles-heading" className="font-display text-2xl font-bold tracking-tight text-slate-100 sm:text-3xl">
          {heading}
        </h2>
        <p className="text-sm leading-relaxed text-slate-400 sm:text-base">{subtitle}</p>
      </header>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {bundles.map((bundle) => {
          const pieceCount = bundle.pieces.length;
          const coverImage = bundle.coverImage || bundle.pieces[0]?.coverImage;
          return (
            <article
              key={bundle.id}
              data-bundle-id={bundle.id}
              className="overflow-hidden rounded-3xl border border-emerald-950/80 bg-gradient-to-br from-slate-950 via-slate-950 to-emerald-950/30 shadow-xl shadow-black/15"
            >
              <div className="grid min-h-full grid-cols-1 sm:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
                <div className="relative min-h-52 overflow-hidden bg-emerald-950/30 sm:min-h-full">
                  <span className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
                    <Layers3 className="h-14 w-14 text-emerald-400/40" />
                  </span>
                  {coverImage ? (
                    <img
                      src={coverImage}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      referrerPolicy="no-referrer"
                      onError={(event) => { event.currentTarget.style.display = 'none'; }}
                      className="absolute inset-0 h-full w-full object-cover opacity-75"
                    />
                  ) : null}
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/10 to-transparent sm:bg-gradient-to-r sm:from-transparent sm:to-slate-950/80" />
                  <span className="absolute bottom-4 left-4 inline-flex items-center gap-1.5 rounded-full border border-emerald-700/50 bg-slate-950/90 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-emerald-300 backdrop-blur">
                    <LibraryBig className="h-3.5 w-3.5" aria-hidden="true" />
                    {pieceCount} {pieceCount === 1 ? 'piece' : 'pieces'}
                  </span>
                </div>

                <div className="flex flex-col p-5 sm:p-6">
                  <h3 className="font-display text-xl font-bold leading-tight text-white sm:text-2xl">{bundle.name}</h3>
                  {bundle.description && (
                    <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-slate-400">{bundle.description}</p>
                  )}

                  <ul className="mt-4 space-y-1.5" aria-label={`Pieces included in ${bundle.name}`}>
                    {bundle.pieces.slice(0, 3).map((piece) => (
                      <li key={piece.id} className="flex items-start gap-2 text-xs leading-relaxed text-slate-300">
                        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden="true" />
                        <span className="line-clamp-1">{piece.title}</span>
                      </li>
                    ))}
                    {pieceCount > 3 && (
                      <li className="pl-5 text-[11px] text-slate-500">+ {pieceCount - 3} more</li>
                    )}
                  </ul>

                  <div className="mt-auto flex items-end justify-between gap-4 pt-6">
                    <div>
                      <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-slate-500">Bundle price</p>
                      <p className="mt-1 font-display text-2xl font-bold text-emerald-300">
                        KSh {KES_FORMATTER.format(bundle.priceKes)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onPurchaseBundle(bundle, bundle.checkoutArticle)}
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-xs font-bold text-slate-950 transition hover:bg-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
                      aria-label={`Buy ${bundle.name} bundle for KSh ${KES_FORMATTER.format(bundle.priceKes)}`}
                    >
                      <ShoppingBag className="h-4 w-4" aria-hidden="true" />
                      Buy bundle
                    </button>
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
};
