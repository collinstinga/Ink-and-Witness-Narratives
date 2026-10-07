import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Clock,
  Layers3,
  LockKeyhole,
  Smartphone,
  X,
} from 'lucide-react';

import type { Article, Category, ContentBundle, ContentCollection, HomepageConfig } from '../types.js';
import { normalizeHomepageSections, type HomepageSectionId } from '../homepageSections.js';
import { HomepageBundles, type HomepageBundle } from './HomepageBundles.js';
import { buildHomepageLibrarySections, HomepageLibraryGuide } from './HomepageLibraryGuide.js';

const MAX_HOMEPAGE_COLLECTIONS = 6;
const MAX_HOMEPAGE_BUNDLES = 6;
const MAX_HOMEPAGE_PIECES = 8;
const FALLBACK_COVER =
  'https://images.unsplash.com/photo-1455390582262-044cdead277a?auto=format&fit=crop&w=900&q=80';
const KES_FORMATTER = new Intl.NumberFormat('en-KE', { maximumFractionDigits: 0 });

type PublicView = 'home' | 'all-pieces' | 'about' | 'how-to-pay' | 'support';

export interface HomepageDiscoveryProps {
  config?: HomepageConfig | null;
  bundles: HomepageBundle[];
  collections: ContentCollection[];
  categories: Category[];
  allArticles: Article[];
  pieces: Article[];
  unlockedTokens: Record<string, unknown>;
  onReadArticle: (article: Article) => void;
  onUnlockArticle: (article: Article) => void;
  onPurchaseBundle: (bundle: ContentBundle, checkoutArticle: Article) => void;
  onSelectCategory: (categoryName: string) => void;
  onNavigate: (view: PublicView) => void;
  heroSection?: React.ReactNode;
  newsletterSection?: React.ReactNode;
}

export interface HomepageCollectionView {
  collection: ContentCollection;
  pieces: Article[];
}

export interface HomepageDiscoveryModel {
  bundles: HomepageBundle[];
  collections: HomepageCollectionView[];
  pieces: Article[];
}

const isPublished = (article: Article): boolean => article.status === 'published' || !article.status;

/**
 * Builds the public discovery shelves without trusting either API response to be
 * perfectly clean. The first occurrence wins, preserving the writer's ordering.
 */
export const buildHomepageDiscoveryModel = (
  collections: ContentCollection[],
  allArticles: Article[],
  pieces: Article[],
  bundles: HomepageBundle[] = [],
): HomepageDiscoveryModel => {
  const articleById = new Map<string, Article>();
  allArticles.forEach((article) => {
    if (article?.id && isPublished(article) && !articleById.has(article.id)) {
      articleById.set(article.id, article);
    }
  });

  const seenCollectionIds = new Set<string>();
  const seenBundleIds = new Set<string>();
  const representedPieceIds = new Set<string>();
  const resolvedBundles: HomepageBundle[] = [];
  const resolvedCollections: HomepageCollectionView[] = [];

  bundles.forEach((bundle) => {
    if (
      resolvedBundles.length >= MAX_HOMEPAGE_BUNDLES ||
      !bundle?.id ||
      !bundle.isPublished ||
      bundle.priceKes <= 0 ||
      !bundle.checkoutArticle ||
      seenBundleIds.has(bundle.id)
    ) {
      return;
    }

    seenBundleIds.add(bundle.id);
    const seenPieceIds = new Set<string>();
    const bundlePieces = (bundle.pieces || []).flatMap((candidate) => {
      const article = candidate?.id ? articleById.get(candidate.id) : null;
      if (!article || seenPieceIds.has(article.id)) return [];
      seenPieceIds.add(article.id);
      return [article];
    });
    if (bundlePieces.length < 2) return;
    bundlePieces.forEach((article) => representedPieceIds.add(article.id));
    resolvedBundles.push({ ...bundle, pieces: bundlePieces });
  });

  collections.forEach((collection) => {
    if (
      resolvedCollections.length >= MAX_HOMEPAGE_COLLECTIONS ||
      !collection?.id ||
      !collection.isPublished ||
      seenCollectionIds.has(collection.id)
    ) {
      return;
    }

    seenCollectionIds.add(collection.id);
    const seenPieceIds = new Set<string>();
    const collectionPieces = (collection.pieceIds || []).flatMap((pieceId) => {
      representedPieceIds.add(pieceId);
      if (seenPieceIds.has(pieceId)) return [];
      seenPieceIds.add(pieceId);
      const article = articleById.get(pieceId);
      return article ? [article] : [];
    });

    // An empty public card has no useful destination and should not occupy the shelf.
    if (collectionPieces.length === 0) return;
    resolvedCollections.push({ collection, pieces: collectionPieces });
  });

  const seenHomepagePieceIds = new Set<string>();
  const resolvedPieces: Article[] = [];
  pieces.forEach((candidate) => {
    if (
      resolvedPieces.length >= MAX_HOMEPAGE_PIECES ||
      !candidate?.id ||
      representedPieceIds.has(candidate.id) ||
      seenHomepagePieceIds.has(candidate.id)
    ) {
      return;
    }

    const article = articleById.get(candidate.id) || (isPublished(candidate) ? candidate : null);
    if (!article) return;
    seenHomepagePieceIds.add(candidate.id);
    resolvedPieces.push(article);
  });

  return { bundles: resolvedBundles, collections: resolvedCollections, pieces: resolvedPieces };
};

const isArticleAccessible = (
  article: Article,
  unlockedTokens: Record<string, unknown>,
): boolean => Boolean(
  !article.isPaid ||
  article.isUnlocked ||
  unlockedTokens[article.id] ||
  (article.slug && unlockedTokens[article.slug]),
);

const formatPrice = (priceKes: number): string =>
  KES_FORMATTER.format(priceKes || 0);

const ShelfHeading: React.FC<{
  id: string;
  eyebrow: string;
  heading: string;
  subtitle: string;
}> = ({ id, eyebrow, heading, subtitle }) => (
  <header className="max-w-2xl space-y-2">
    <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.3em] text-sky-400/90">
      {eyebrow}
    </p>
    <h2 id={id} className="font-display text-2xl font-bold tracking-tight text-slate-100 sm:text-3xl">
      {heading}
    </h2>
    <p className="text-sm leading-relaxed text-slate-400 sm:text-base">{subtitle}</p>
  </header>
);

const DiscoverySectionFrame: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
    {children}
  </div>
);

export const HomepageDiscovery: React.FC<HomepageDiscoveryProps> = ({
  config,
  bundles,
  collections,
  categories,
  allArticles,
  pieces,
  unlockedTokens,
  onReadArticle,
  onUnlockArticle,
  onPurchaseBundle,
  onSelectCategory,
  onNavigate,
  heroSection,
  newsletterSection,
}) => {
  const model = useMemo(
    () => buildHomepageDiscoveryModel(collections, allArticles, pieces, bundles),
    [collections, allArticles, pieces, bundles],
  );
  const [activeCollection, setActiveCollection] = useState<HomepageCollectionView | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const hasLibrarySections = useMemo(
    () => buildHomepageLibrarySections(categories, allArticles).length > 0,
    [categories, allArticles],
  );

  const closeCollection = useCallback(() => setActiveCollection(null), []);
  const openCollection = useCallback((collection: HomepageCollectionView) => {
    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    setActiveCollection(collection);
  }, []);

  useEffect(() => {
    if (!activeCollection) return;

    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeCollection();
        return;
      }

      if (event.key !== 'Tab') return;
      const dialog = closeButtonRef.current?.closest('[role="dialog"]');
      if (!(dialog instanceof HTMLElement)) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter((element) => element.getAttribute('aria-hidden') !== 'true');
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = priorOverflow;
      window.requestAnimationFrame(() => previouslyFocusedRef.current?.focus());
    };
  }, [activeCollection, closeCollection]);

  const handleRead = useCallback((article: Article) => {
    closeCollection();
    onReadArticle(article);
  }, [closeCollection, onReadArticle]);

  const handleUnlock = useCallback((article: Article) => {
    closeCollection();
    onUnlockArticle(article);
  }, [closeCollection, onUnlockArticle]);

  const collectionsHeading = config?.homepageCollectionsHeading?.trim() || 'Curated Collections';
  const collectionsSubtitle = config?.homepageCollectionsSubtitle?.trim() ||
    'Read by mood, season, or the thread that pulls you in.';
  const piecesHeading = config?.homepagePiecesHeading?.trim() || 'Individual Pieces';
  const piecesSubtitle = config?.homepagePiecesSubtitle?.trim() ||
    'Standalone writing, selected from the archive.';

  const collectionsSection = model.collections.length > 0 ? (
    <section id="home-curated-collections" aria-labelledby="home-collections-heading" className="space-y-7">
      <div>
        <ShelfHeading
          id="home-collections-heading"
          eyebrow="Explore by collection"
          heading={collectionsHeading}
          subtitle={collectionsSubtitle}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {model.collections.map((entry) => {
          const coverImage = entry.collection.coverImage || entry.pieces[0]?.coverImage;
          const coverPosition = entry.collection.coverImage ? entry.collection.coverPosition : undefined;
          const countLabel = `${entry.pieces.length} ${entry.pieces.length === 1 ? 'piece' : 'pieces'}`;
          return (
            <button
              key={entry.collection.id}
              type="button"
              data-collection-id={entry.collection.id}
              onClick={() => openCollection(entry)}
              aria-label={`Open ${entry.collection.name} collection, ${countLabel}`}
              className="group overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/55 text-left shadow-lg shadow-black/10 transition hover:-translate-y-0.5 hover:border-sky-800/80 hover:bg-slate-900/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b101b]"
            >
              <span className="relative block aspect-[16/10] overflow-hidden bg-gradient-to-br from-sky-950 via-slate-900 to-slate-950">
                <span className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
                  <Layers3 className="h-10 w-10 text-sky-400/45" />
                </span>
                {coverImage ? (
                  <img
                    src={coverImage}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                    onError={(event) => { event.currentTarget.style.display = 'none'; }}
                    style={{ objectPosition: `${coverPosition?.x ?? 50}% ${coverPosition?.y ?? 50}%` }}
                    className="h-full w-full object-cover opacity-75 transition duration-500 group-hover:scale-[1.025] group-hover:opacity-90"
                  />
                ) : null}
                <span className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-transparent" />
                <span className="absolute bottom-3 left-3 inline-flex items-center gap-1.5 rounded-full border border-slate-700/80 bg-slate-950/85 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-slate-300 backdrop-blur">
                  <Layers3 className="h-3 w-3 text-sky-400" aria-hidden="true" />
                  {countLabel}
                </span>
              </span>
              <span className="block space-y-2 p-5">
                <span className="flex items-start justify-between gap-3">
                  <span className="font-display text-lg font-bold leading-snug text-slate-100 transition group-hover:text-sky-300">
                    {entry.collection.name}
                  </span>
                  <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-slate-500 transition group-hover:translate-x-0.5 group-hover:text-sky-400" aria-hidden="true" />
                </span>
                {entry.collection.description && (
                  <span className="line-clamp-2 block text-sm leading-relaxed text-slate-400">
                    {entry.collection.description}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  ) : null;

  const piecesSection = model.pieces.length > 0 ? (
    <div className="space-y-8">
      <section id="home-individual-pieces" aria-labelledby="home-pieces-heading" className="space-y-7">
        <div>
          <ShelfHeading
            id="home-pieces-heading"
            eyebrow="From the archive"
            heading={piecesHeading}
            subtitle={piecesSubtitle}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {model.pieces.map((article) => {
            const isAccessible = isArticleAccessible(article, unlockedTokens);
            return (
              <article
                key={article.id}
                data-piece-id={article.id}
                className="group flex min-h-full flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/55 transition hover:border-slate-700 hover:bg-slate-900/65"
              >
                <button
                  type="button"
                  onClick={() => onReadArticle(article)}
                  aria-label={`Preview ${article.title}`}
                  className="relative block aspect-[16/9] overflow-hidden bg-slate-950 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-400"
                >
                  <img
                    src={article.coverImage || FALLBACK_COVER}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover opacity-65 transition duration-500 group-hover:scale-[1.025] group-hover:opacity-80"
                  />
                  <span className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/15 to-transparent" />
                  <span className="absolute bottom-3 left-3 rounded-full border border-slate-700/80 bg-slate-950/85 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-slate-300 backdrop-blur">
                    {article.category || 'Narrative'}
                  </span>
                </button>

                <div className="flex flex-1 flex-col p-5">
                  <div className="mb-3 flex items-center justify-between gap-3 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                    {article.showReadTime !== false ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Clock className="h-3 w-3" aria-hidden="true" />
                        {article.readTimeMinutes || 1} min read
                      </span>
                    ) : <span />}
                    <span className={isAccessible ? 'text-sky-400' : 'text-amber-400'}>
                      {isAccessible ? 'Ready to read' : `KSh ${formatPrice(article.priceKes)}`}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => onReadArticle(article)}
                    className="text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                  >
                    <h3 className="font-display text-lg font-bold leading-snug text-slate-100 transition group-hover:text-sky-300">
                      {article.title}
                    </h3>
                  </button>
                  {article.excerpt && (
                    <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-slate-400">{article.excerpt}</p>
                  )}

                  <div className="mt-auto pt-5">
                    {isAccessible ? (
                      <button
                        type="button"
                        onClick={() => onReadArticle(article)}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-sky-500 px-4 py-2.5 text-xs font-bold text-slate-950 transition hover:bg-sky-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                      >
                        {article.isUnlocked || unlockedTokens[article.id] || unlockedTokens[article.slug]
                          ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                          : <BookOpen className="h-4 w-4" aria-hidden="true" />}
                        Read piece
                      </button>
                    ) : (
                      <div className="grid grid-cols-[auto_1fr] gap-2">
                        <button
                          type="button"
                          onClick={() => onReadArticle(article)}
                          className="rounded-xl border border-slate-700 px-3 py-2.5 text-xs font-semibold text-slate-300 transition hover:border-slate-600 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                        >
                          Preview
                        </button>
                        <button
                          type="button"
                          onClick={() => onUnlockArticle(article)}
                          className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-500 px-3 py-2.5 text-xs font-bold text-slate-950 transition hover:bg-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
                        >
                          <Smartphone className="h-4 w-4" aria-hidden="true" />
                          Unlock
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <div className="flex justify-center border-t border-slate-800/80 pt-8">
        <button
          type="button"
          onClick={() => onNavigate('all-pieces')}
          className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/60 px-5 py-2.5 text-xs font-semibold text-slate-200 transition hover:border-sky-700 hover:text-sky-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
        >
          Explore the full archive
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  ) : null;

  const sectionNodes: Record<HomepageSectionId, React.ReactNode> = {
    hero: heroSection || null,
    newsletter: newsletterSection || null,
    bundles: model.bundles.length > 0 ? (
      <DiscoverySectionFrame>
        <HomepageBundles bundles={model.bundles} config={config} onPurchaseBundle={onPurchaseBundle} />
      </DiscoverySectionFrame>
    ) : null,
    library: hasLibrarySections ? (
      <DiscoverySectionFrame>
        <HomepageLibraryGuide
          articles={allArticles}
          categories={categories}
          config={config}
          onSelectCategory={onSelectCategory}
        />
      </DiscoverySectionFrame>
    ) : null,
    collections: collectionsSection ? <DiscoverySectionFrame>{collectionsSection}</DiscoverySectionFrame> : null,
    pieces: piecesSection ? <DiscoverySectionFrame>{piecesSection}</DiscoverySectionFrame> : null,
  };
  const homepageSections = useMemo(
    () => normalizeHomepageSections(config?.sections),
    [config?.sections],
  );

  return (
    <div id="home-discovery">
      {homepageSections.map(section => (
        section.isVisible && sectionNodes[section.id as HomepageSectionId] ? (
          <React.Fragment key={section.id}>
            {sectionNodes[section.id as HomepageSectionId]}
          </React.Fragment>
        ) : null
      ))}

      {activeCollection && (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center bg-black/80 p-0 backdrop-blur-sm sm:items-center sm:p-6"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeCollection();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="homepage-collection-dialog-title"
            aria-describedby="homepage-collection-dialog-description"
            className="flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-3xl border border-slate-800 bg-[#0b101b] shadow-2xl shadow-black/70 sm:rounded-3xl"
          >
            <header className="flex items-start justify-between gap-4 border-b border-slate-800 px-5 py-5 sm:px-7">
              <div className="min-w-0 space-y-1.5">
                <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-sky-400">Collection</p>
                <h2 id="homepage-collection-dialog-title" className="font-display text-2xl font-bold text-white">
                  {activeCollection.collection.name}
                </h2>
                <p id="homepage-collection-dialog-description" className="max-w-2xl text-sm leading-relaxed text-slate-400">
                  {activeCollection.collection.description ||
                    `${activeCollection.pieces.length} selected pieces from Ink & Witness.`}
                </p>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={closeCollection}
                aria-label="Close collection"
                className="shrink-0 rounded-full border border-slate-700 bg-slate-900 p-2 text-slate-400 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </header>

            <div className="space-y-3 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">
              {activeCollection.pieces.map((article) => {
                const isAccessible = isArticleAccessible(article, unlockedTokens);
                return (
                  <article
                    key={article.id}
                    data-collection-piece-id={article.id}
                    className="grid grid-cols-[72px_1fr] gap-4 rounded-2xl border border-slate-800 bg-slate-950/60 p-3 sm:grid-cols-[96px_1fr_auto] sm:items-center"
                  >
                    <img
                      src={article.coverImage || FALLBACK_COVER}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      referrerPolicy="no-referrer"
                      className="h-20 w-[72px] rounded-xl object-cover opacity-80 sm:h-24 sm:w-24"
                    />
                    <div className="min-w-0">
                      <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                        {article.category || 'Narrative'}
                      </p>
                      <h3 className="font-display text-base font-bold leading-snug text-slate-100 sm:text-lg">
                        {article.title}
                      </h3>
                      <p className="mt-1 line-clamp-1 text-xs text-slate-400">{article.excerpt}</p>
                    </div>
                    <div className="col-span-2 grid grid-cols-2 gap-2 sm:col-span-1 sm:flex sm:justify-end">
                      {!isAccessible && (
                        <button
                          type="button"
                          onClick={() => handleRead(article)}
                          className="rounded-xl border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                        >
                          Preview
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => isAccessible ? handleRead(article) : handleUnlock(article)}
                        className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 ${
                          isAccessible
                            ? 'bg-sky-500 text-slate-950 hover:bg-sky-400 focus-visible:ring-sky-300'
                            : 'bg-emerald-500 text-slate-950 hover:bg-emerald-400 focus-visible:ring-emerald-300'
                        }`}
                      >
                        {isAccessible
                          ? <BookOpen className="h-4 w-4" aria-hidden="true" />
                          : <LockKeyhole className="h-4 w-4" aria-hidden="true" />}
                        {isAccessible ? 'Read' : `Unlock · KSh ${formatPrice(article.priceKes)}`}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
