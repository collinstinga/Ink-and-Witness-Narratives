import React from 'react';
import { Check, Eye, Layers3, LibraryBig, ShoppingBag, X } from 'lucide-react';

import type { Article, ContentBookQuote, ContentBundle, HomepageConfig } from '../types.js';
import { responsiveImageUrl, responsiveImageSrcSet } from '../utils/responsiveImage.js';
import { isBookQuoteFor, orderedBookChapters } from '../utils/bookCatalogue.js';

export type HomepageBundle = ContentBundle & {
  pieces: Article[];
  checkoutArticle: Article;
};

interface HomepageBundlesProps {
  bundles: HomepageBundle[];
  config?: HomepageConfig | null;
  onPurchaseBundle: (bundle: ContentBundle, checkoutArticle: Article) => void;
  onPreviewPiece?: (article: Article) => void;
  onReadPiece?: (article: Article) => void;
  getBookQuote?: (bookId: string) => Promise<ContentBookQuote>;
  readerIdentity?: string | null;
  initialBundleId?: string | null;
  onInitialBundleHandled?: () => void;
}

const KES_FORMATTER = new Intl.NumberFormat('en-KE', { maximumFractionDigits: 0 });

export const resolveHomepageBundleDeepLink = (
  bundles: HomepageBundle[],
  destinationId?: string | null,
): HomepageBundle | null => {
  if (!destinationId) return null;
  return bundles.find(bundle => bundle.id === destinationId || bundle.slug === destinationId) || null;
};

export const HomepageBundles: React.FC<HomepageBundlesProps> = ({
  bundles,
  config,
  onPurchaseBundle,
  onPreviewPiece,
  onReadPiece,
  getBookQuote,
  readerIdentity,
  initialBundleId,
  onInitialBundleHandled,
}) => {
  const [activeBundleId, setActiveBundleId] = React.useState<string | null>(null);
  // Resolve the current public object, rather than retaining an old price or
  // chapter list while the writer's latest catalogue refreshes underneath it.
  const activeBundle = bundles.find(bundle => bundle.id === activeBundleId) || null;
  const closeButtonRef = React.useRef<HTMLButtonElement>(null);
  const handledBundleRef = React.useRef<string | null>(null);
  const [quoteRequest, setQuoteRequest] = React.useState(0);
  const [quoteState, setQuoteState] = React.useState<{
    bookId: string; readerIdentity?: string | null; revision: string; quote?: ContentBookQuote; error?: string;
  } | null>(null);
  const quoteRevision = activeBundle
    ? `${activeBundle.updatedAt}:${activeBundle.priceKes}:${activeBundle.existingOwnerPricing}:${activeBundle.pieceIds.join(',')}` : '';
  const bookQuote = activeBundle?.kind === 'book' && getBookQuote
    && quoteState?.bookId === activeBundle.id && quoteState.readerIdentity === readerIdentity && quoteState.revision === quoteRevision
    ? quoteState.quote : undefined;
  const quoteError = activeBundle?.kind === 'book' && getBookQuote
    && quoteState?.bookId === activeBundle.id && quoteState.readerIdentity === readerIdentity && quoteState.revision === quoteRevision
    ? quoteState.error : undefined;
  const quotePending = activeBundle?.kind === 'book' && !!getBookQuote && !bookQuote && !quoteError;

  React.useEffect(() => {
    const book = activeBundle;
    setQuoteState(null);
    if (!book || book.kind !== 'book' || !getBookQuote) return;
    const bookId = book.id;
    let disposed = false;
    void getBookQuote(bookId).then(quote => {
      if (!isBookQuoteFor(book, quote)) {
        throw new Error('A current book price could not be verified.');
      }
      if (!disposed) setQuoteState({ bookId, readerIdentity, revision: quoteRevision, quote });
    }).catch(() => {
      if (!disposed) setQuoteState({ bookId, readerIdentity, revision: quoteRevision, error: 'Your book price could not be verified. Try again before paying.' });
    });
    return () => { disposed = true; };
  }, [activeBundle?.id, activeBundle?.kind, getBookQuote, readerIdentity, quoteRequest, quoteRevision]);

  React.useEffect(() => {
    if (!initialBundleId || handledBundleRef.current === initialBundleId) return;
    handledBundleRef.current = initialBundleId;
    const target = resolveHomepageBundleDeepLink(bundles, initialBundleId);
    document.getElementById('home-reading-bundles')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (target) setActiveBundleId(target.id);
    onInitialBundleHandled?.();
  }, [bundles, initialBundleId, onInitialBundleHandled]);

  React.useEffect(() => {
    if (!activeBundle) return;
    const priorOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = 'hidden';
    const frame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setActiveBundleId(null); }
      if (event.key !== 'Tab') return;
      const dialog = closeButtonRef.current?.closest('[role="dialog"]');
      if (!(dialog instanceof HTMLElement)) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex="0"]'));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = priorOverflow;
      window.requestAnimationFrame(() => previouslyFocused?.focus());
    };
  }, [activeBundle?.id]);

  if (bundles.length === 0) return null;

  const heading = config?.homepageBundlesHeading?.trim() || (bundles.some(bundle => bundle.kind === 'book') ? 'Books & Reading Bundles' : 'Reading Bundles');
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
          const isBook = bundle.kind === 'book';
          const pieces = isBook ? orderedBookChapters(bundle, bundle.pieces) : bundle.pieces;
          const pieceCount = pieces.length;
          const coverImage = bundle.coverImage || bundle.pieces[0]?.coverImage;
          const coverPosition = bundle.coverImage ? bundle.coverPosition : undefined;
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
                      src={responsiveImageUrl(coverImage, 640)}
                      srcSet={responsiveImageSrcSet(coverImage, [320, 480, 640, 960])}
                      sizes="(min-width: 1024px) 230px, (min-width: 640px) 38vw, 92vw"
                      width={640}
                      height={480}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      referrerPolicy="no-referrer"
                      onError={(event) => { event.currentTarget.style.display = 'none'; }}
                      style={{ objectPosition: `${coverPosition?.x ?? 50}% ${coverPosition?.y ?? 50}%` }}
                      className="absolute inset-0 h-full w-full object-cover opacity-75"
                    />
                  ) : null}
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/10 to-transparent sm:bg-gradient-to-r sm:from-transparent sm:to-slate-950/80" />
                  <span className="absolute bottom-4 left-4 inline-flex items-center gap-1.5 rounded-full border border-emerald-700/50 bg-slate-950/90 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-emerald-300 backdrop-blur">
                    <LibraryBig className="h-3.5 w-3.5" aria-hidden="true" />
                    {isBook ? 'Book · ' : ''}{pieceCount} {isBook ? (pieceCount === 1 ? 'chapter' : 'chapters') : (pieceCount === 1 ? 'piece' : 'pieces')}
                  </span>
                </div>

                <div className="flex flex-col p-5 sm:p-6">
                  <h3 className="font-display text-xl font-bold leading-tight text-white sm:text-2xl">{bundle.name}</h3>
                  {bundle.description && (
                    <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-slate-400">{bundle.description}</p>
                  )}

                  <ul className="mt-4 space-y-1.5" aria-label={`${isBook ? 'Chapters' : 'Pieces'} included in ${bundle.name}`}>
                    {pieces.slice(0, 3).map((piece, index) => (
                      <li key={piece.id} className="flex items-start gap-2 text-xs leading-relaxed text-slate-300">
                        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden="true" />
                        <span className="line-clamp-1">{isBook ? `${index + 1}. ` : ''}{piece.title}</span>
                      </li>
                    ))}
                    {pieceCount > 3 && (
                      <li className="pl-5 text-[11px] text-slate-500">+ {pieceCount - 3} more</li>
                    )}
                  </ul>

                  <div className="mt-auto space-y-3 pt-6">
                    <div>
                      <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-slate-500">{isBook ? 'Complete book price' : 'Bundle price'}</p>
                      <p className="mt-1 font-display text-2xl font-bold text-emerald-300">
                        KSh {KES_FORMATTER.format(bundle.priceKes)}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setActiveBundleId(bundle.id)}
                        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-xs font-bold text-slate-200 transition hover:border-sky-700 hover:text-sky-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                        aria-label={`View every ${isBook ? 'chapter' : 'piece'} in ${bundle.name}`}
                      >
                        <Eye className="h-4 w-4" aria-hidden="true" />
                        View contents
                      </button>
                      <button
                        type="button"
                        onClick={() => isBook ? setActiveBundleId(bundle.id) : onPurchaseBundle(bundle, bundle.checkoutArticle)}
                        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-3 py-2.5 text-xs font-bold text-slate-950 transition hover:bg-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
                        aria-label={isBook ? `Read or buy ${bundle.name}` : `Buy ${bundle.name} bundle for KSh ${KES_FORMATTER.format(bundle.priceKes)}`}
                      >
                        <ShoppingBag className="h-4 w-4" aria-hidden="true" />
                        {isBook ? 'Open book' : 'Buy bundle'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {activeBundle && (
        <div
          className="fixed inset-0 z-[110] flex items-end justify-center bg-black/80 p-0 backdrop-blur-sm sm:items-center sm:p-6"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setActiveBundleId(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="bundle-contents-title"
            className="flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-3xl border border-emerald-900/70 bg-[#0b101b] shadow-2xl sm:rounded-3xl"
          >
            <header className="flex items-start justify-between gap-4 border-b border-slate-800 px-5 py-5 sm:px-7">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-emerald-400">{activeBundle.kind === 'book' ? 'Book chapters' : 'Bundle contents'}</p>
                <h2 id="bundle-contents-title" className="mt-1 font-display text-2xl font-bold text-white">{activeBundle.name}</h2>
                <p className="mt-1 text-sm text-slate-400">
                  {activeBundle.pieces.length} {activeBundle.kind === 'book' ? 'chapters' : 'pieces'} · KSh {KES_FORMATTER.format(activeBundle.priceKes)} for permanent library access
                </p>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={() => setActiveBundleId(null)}
                aria-label="Close bundle contents"
                className="shrink-0 rounded-full border border-slate-700 bg-slate-900 p-2 text-slate-400 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </header>

            <div className="space-y-3 overflow-y-auto px-5 py-5 sm:px-7">
              {(activeBundle.kind === 'book' ? orderedBookChapters(activeBundle, activeBundle.pieces) : activeBundle.pieces).map((piece, index) => (
                <article key={piece.id} className="grid grid-cols-[64px_1fr_auto] items-center gap-3 rounded-2xl border border-slate-800 bg-slate-950/65 p-3 sm:grid-cols-[88px_1fr_auto] sm:gap-4">
                  <img
                    src={responsiveImageUrl(piece.coverImage || activeBundle.coverImage || '', 320)}
                    width={88}
                    height={88}
                    decoding="async"
                    alt=""
                    loading="lazy"
                    className="h-16 w-16 rounded-xl bg-slate-900 object-cover sm:h-20 sm:w-20"
                  />
                  <div className="min-w-0">
                    <p className="font-mono text-[9px] uppercase tracking-wider text-slate-500">{activeBundle.kind === 'book' ? `Chapter ${index + 1}` : piece.category || 'Narrative'}</p>
                    <h3 className="mt-1 font-display text-sm font-bold leading-snug text-white sm:text-base">{piece.title}</h3>
                    {piece.excerpt && <p className="mt-1 line-clamp-1 text-xs text-slate-500">{piece.excerpt}</p>}
                    {bookQuote?.ownedPieceIds.includes(piece.id) && <p className="mt-1 text-[11px] text-emerald-300">Already in your library</p>}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveBundleId(null);
                      if (activeBundle.kind === 'book' && (piece.isUnlocked || bookQuote?.ownedPieceIds.includes(piece.id) || piece.isPaid === false) && onReadPiece) onReadPiece(piece);
                      else (onPreviewPiece || onReadPiece)?.(piece);
                    }}
                    disabled={!onPreviewPiece && !onReadPiece}
                    className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-sky-800 bg-sky-950/40 px-3 py-2 text-xs font-semibold text-sky-200 hover:border-sky-600 disabled:opacity-40"
                    aria-label={`${activeBundle.kind === 'book' && (piece.isUnlocked || bookQuote?.ownedPieceIds.includes(piece.id) || piece.isPaid === false) && onReadPiece ? 'Read' : 'Preview'} ${piece.title}`}
                  >
                    <Eye className="h-4 w-4" aria-hidden="true" />
                    <span className="hidden sm:inline">{activeBundle.kind === 'book' && (piece.isUnlocked || bookQuote?.ownedPieceIds.includes(piece.id) || piece.isPaid === false) && onReadPiece ? 'Read' : 'Preview'}</span>
                  </button>
                </article>
              ))}
            </div>

            <footer className="border-t border-slate-800 bg-slate-950/80 px-5 py-4 sm:px-7">
              {activeBundle.kind === 'book' && <div className="mb-3 text-xs leading-relaxed text-slate-400" role="status">
                {quotePending ? 'Checking the chapters you already own…' : quoteError ? <>{quoteError} <button type="button" onClick={() => setQuoteRequest(value => value + 1)} className="font-semibold text-sky-300 underline">Retry price check</button></> : bookQuote?.alreadyOwned ? 'No further purchase is needed for these chapters. Open a chapter above.' : bookQuote ? <>Your price: <strong className="text-emerald-300">KSh {KES_FORMATTER.format(bookQuote.amountKes)}</strong>{bookQuote.creditKes > 0 ? ` · KSh ${KES_FORMATTER.format(bookQuote.creditKes)} credit for chapters already owned.` : '. Existing chapter access is preserved.'}</> : activeBundle.existingOwnerPricing === 'remaining_chapters' ? 'Sign in to check your price for the chapters you do not yet own. Previous purchases stay in your library.' : 'One payment adds the included chapters permanently. Previous purchases stay in your library.'}
              </div>}
              <button
                type="button"
                disabled={!!quotePending || !!quoteError || !!bookQuote?.alreadyOwned}
                onClick={() => {
                  const bundle = activeBundle;
                  setActiveBundleId(null);
                  onPurchaseBundle(bundle, bookQuote ? { ...bundle.checkoutArticle, priceKes: bookQuote.amountKes, prices: { KES: bookQuote.amountKes }, bookCheckoutUpdatedAt: bookQuote.bookUpdatedAt } : bundle.checkoutArticle);
                }}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 text-xs font-bold text-slate-950 hover:bg-emerald-400 disabled:opacity-40"
              >
                <ShoppingBag className="h-4 w-4" aria-hidden="true" />
                {bookQuote?.alreadyOwned ? 'All chapters are already available' : activeBundle.kind === 'book' ? `Buy complete book · KSh ${KES_FORMATTER.format(bookQuote?.amountKes ?? activeBundle.priceKes)}` : `Buy all ${activeBundle.pieces.length} pieces · KSh ${KES_FORMATTER.format(activeBundle.priceKes)}`}
              </button>
            </footer>
          </div>
        </div>
      )}
    </section>
  );
};
