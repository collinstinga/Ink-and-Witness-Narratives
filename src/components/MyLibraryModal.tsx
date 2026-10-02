import React, { useEffect, useRef, useState } from 'react';
import { 
  X, 
  BookmarkCheck, 
  BookOpen, 
  FileText, 
  CheckCircle2,
  Trash2,
  Clock3,
  Sparkles,
  Layers3,
  PackageOpen
} from 'lucide-react';
import { Article, ContentBundle, LibraryArticle, ReaderHomeItem, ReaderHomeResponse } from '../types.js';
import { api, clearStoredTokens } from '../utils/api.js';

function getAccessLabel(source: LibraryArticle['libraryAccessSource']): string {
  if (source === 'MANUAL_GRANT') return 'Writer-granted & Active';
  if (source === 'SYSTEM') return 'Account-provided & Active';
  return 'Purchased & Active';
}

interface MyLibraryModalProps {
  isOpen: boolean;
  onClose: () => void;
  articles: LibraryArticle[];
  onReadArticle: (article: Article) => void;
  onExploreCatalog: () => void;
  onPurchaseBundle?: (bundle: ContentBundle, checkoutArticle: Article) => void;
  isLoading?: boolean;
  error?: string;
}

export const MyLibraryModal: React.FC<MyLibraryModalProps> = ({
  isOpen,
  onClose,
  articles,
  onReadArticle,
  onExploreCatalog,
  onPurchaseBundle,
  isLoading = false,
  error = ''
}) => {
  const [clearedNotice, setClearedNotice] = useState(false);
  const [readerHome, setReaderHome] = useState<ReaderHomeResponse | null>(null);
  const [homeLoading, setHomeLoading] = useState(false);
  const reloadTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    setHomeLoading(true);
    api.getReaderHome()
      .then(result => { if (active) setReaderHome(result); })
      .catch(() => { if (active) setReaderHome(null); })
      .finally(() => { if (active) setHomeLoading(false); });
    return () => { active = false; };
  }, [isOpen, articles.length]);

  useEffect(() => () => {
    if (reloadTimerRef.current !== null) {
      window.clearTimeout(reloadTimerRef.current);
    }
  }, []);

  if (!isOpen) return null;

  const handleClearData = () => {
    clearStoredTokens();
    if (reloadTimerRef.current !== null) {
      window.clearTimeout(reloadTimerRef.current);
    }
    setClearedNotice(true);
    reloadTimerRef.current = window.setTimeout(() => {
      reloadTimerRef.current = null;
      setClearedNotice(false);
      window.location.reload();
    }, 1200);
  };

  const openHomeItem = (item: ReaderHomeItem) => {
    onClose();
    onReadArticle(item.article);
  };

  const compactPieceRow = (item: ReaderHomeItem, label?: string) => (
    <button
      key={item.article.id}
      type="button"
      onClick={() => openHomeItem(item)}
      className="group min-w-[15rem] max-w-[18rem] flex-1 rounded-2xl border border-slate-800 bg-slate-950/80 p-4 text-left transition-colors hover:border-sky-700"
    >
      <span className="text-[10px] font-mono uppercase tracking-wider text-sky-400">{label || item.article.category}</span>
      <span className="mt-1 block line-clamp-2 font-display text-sm font-bold text-slate-100">{item.article.title}</span>
      {item.progress && (
        <span className="mt-3 block">
          <span className="mb-1 flex justify-between text-[10px] font-mono text-slate-400">
            <span>{item.progress.activeChapterTitle || 'Reading progress'}</span>
            <span>{Math.round(item.progress.percent)}%</span>
          </span>
          <span className="block h-1.5 overflow-hidden rounded-full bg-slate-800">
            <span className="block h-full rounded-full bg-sky-500" style={{ width: `${Math.max(2, item.progress.percent)}%` }} />
          </span>
        </span>
      )}
    </button>
  );

  return (
    <div 
      id="my-library-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="my-library-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md overflow-y-auto"
    >
      <div className="relative w-full max-w-2xl rounded-3xl bg-[#0d1424] border border-slate-700 shadow-2xl overflow-hidden my-6">
        
        {/* Header */}
        <div className="px-6 py-4 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-sky-950 border border-sky-600/40 flex items-center justify-center text-sky-400">
              <BookmarkCheck className="w-4 h-4" />
            </div>
            <div>
              <h3 id="my-library-title" className="font-display font-bold text-base text-white tracking-wide">
                READER LIBRARY
              </h3>
              <p className="text-[11px] font-mono text-slate-400">
                {articles.length} Unlocked In-Browser Monographs
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              id="btn-clear-stored-data"
              onClick={handleClearData}
              disabled={clearedNotice}
              title="Clear purchase tokens cached only on this device"
              className="p-1.5 rounded-lg bg-slate-900 hover:bg-rose-950/60 border border-slate-800 hover:border-rose-800 text-slate-400 hover:text-rose-300 text-xs font-mono flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-wait"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Reset Cache</span>
            </button>

            <button
              onClick={onClose}
              aria-label="Close reader library"
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Clear Notice Banner */}
        {clearedNotice && (
          <div className="bg-emerald-950/90 border-b border-emerald-800 text-emerald-300 text-xs font-mono p-3 text-center flex items-center justify-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>Local purchase cache cleared. Account-synced access is unchanged. Refreshing...</span>
          </div>
        )}

        {/* Library Content */}
        <div className="p-6 sm:p-7 space-y-4 max-h-[75vh] overflow-y-auto">
          {homeLoading && !readerHome && (
            <p className="text-center text-xs text-sky-300" role="status">Preparing your personalized reader home…</p>
          )}

          {readerHome && readerHome.continueReading.length > 0 && (
            <section className="space-y-3" aria-labelledby="continue-reading-title">
              <div className="flex items-center gap-2">
                <Clock3 className="h-4 w-4 text-sky-400" />
                <h4 id="continue-reading-title" className="font-display text-base font-bold text-white">Continue Reading</h4>
              </div>
              <div className="flex gap-3 overflow-x-auto pb-2">
                {readerHome.continueReading.map(item => compactPieceRow(item, 'Continue where you left off'))}
              </div>
            </section>
          )}

          {readerHome && readerHome.recentlyViewed.length > 0 && (
            <section className="space-y-3 border-t border-slate-800 pt-4" aria-labelledby="recently-viewed-title">
              <div className="flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-indigo-400" />
                <h4 id="recently-viewed-title" className="font-display text-base font-bold text-white">Recently Viewed</h4>
              </div>
              <div className="flex gap-3 overflow-x-auto pb-2">
                {readerHome.recentlyViewed.slice(0, 6).map(item => compactPieceRow(item))}
              </div>
            </section>
          )}

          {readerHome && readerHome.recommendations.length > 0 && (
            <section className="space-y-3 border-t border-slate-800 pt-4" aria-labelledby="recommendations-title">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-amber-400" />
                <div>
                  <h4 id="recommendations-title" className="font-display text-base font-bold text-white">Recommended for You</h4>
                  <p className="text-[11px] text-slate-400">Based on the themes and collections you read.</p>
                </div>
              </div>
              <div className="flex gap-3 overflow-x-auto pb-2">
                {readerHome.recommendations.slice(0, 6).map(item => compactPieceRow(item))}
              </div>
            </section>
          )}

          {readerHome && readerHome.collections.length > 0 && (
            <section className="space-y-3 border-t border-slate-800 pt-4" aria-labelledby="collections-title">
              <div className="flex items-center gap-2">
                <Layers3 className="h-4 w-4 text-teal-400" />
                <h4 id="collections-title" className="font-display text-base font-bold text-white">Writer Collections</h4>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {readerHome.collections.map(collection => (
                  <div key={collection.id} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                    <p className="font-display text-sm font-bold text-white">{collection.name}</p>
                    <p className="mt-1 line-clamp-2 text-xs text-slate-400">{collection.description}</p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {collection.pieces.slice(0, 4).map(piece => (
                        <button key={piece.id} type="button" onClick={() => { onClose(); onReadArticle(piece); }} className="rounded-full border border-slate-700 px-2 py-1 text-[10px] text-sky-300 hover:border-sky-600">
                          {piece.title}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {readerHome && readerHome.bundles.length > 0 && (
            <section className="space-y-3 border-t border-slate-800 pt-4" aria-labelledby="bundles-title">
              <div className="flex items-center gap-2">
                <PackageOpen className="h-4 w-4 text-emerald-400" />
                <h4 id="bundles-title" className="font-display text-base font-bold text-white">Reading Bundles</h4>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {readerHome.bundles.map(bundle => {
                  const checkoutArticle: Article = {
                    id: `bundle:${bundle.id}`,
                    title: bundle.name,
                    subtitle: `${bundle.pieces.length} pieces • permanent account access`,
                    slug: `bundle-${bundle.slug}`,
                    excerpt: bundle.description,
                    content: '', category: 'Bundle', categories: ['Bundle'], topics: [], status: 'published',
                    isPaid: true, priceKes: bundle.priceKes, readTimeMinutes: 0, showReadTime: false,
                    publishedAt: bundle.updatedAt.slice(0, 10), createdAt: bundle.createdAt, updatedAt: bundle.updatedAt,
                    coverImage: bundle.coverImage || bundle.pieces[0]?.coverImage,
                    downloadsCount: 0, previewParagraphs: [], tags: ['Bundle']
                  };
                  return (
                    <div key={bundle.id} className="rounded-2xl border border-emerald-800/50 bg-emerald-950/20 p-4">
                      <p className="font-display text-sm font-bold text-white">{bundle.name}</p>
                      <p className="mt-1 text-xs text-slate-400">{bundle.pieces.length} pieces • KSh {bundle.priceKes.toLocaleString()}</p>
                      <button type="button" onClick={() => onPurchaseBundle?.(bundle, checkoutArticle)} className="mt-3 w-full rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-500">
                        Unlock Complete Bundle
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {articles.length > 0 && (
            <div className="flex items-center gap-2 border-t border-slate-800 pt-4">
              <BookmarkCheck className="h-4 w-4 text-emerald-400" />
              <h4 className="font-display text-base font-bold text-white">Your Complete Library</h4>
            </div>
          )}
          {isLoading && articles.length > 0 && (
            <p className="text-center text-xs text-sky-300" role="status" aria-live="polite">
              Verifying account-synced access… locally stored purchases are shown below.
            </p>
          )}
          {error && (
            <div className="rounded-xl border border-amber-800/70 bg-amber-950/40 px-4 py-3 text-center" role="alert">
              <p className="text-sm font-semibold text-amber-300">Account library temporarily unavailable</p>
              <p className="mt-1 text-xs text-slate-300">{error}</p>
            </div>
          )}
          {isLoading && articles.length === 0 ? (
            <div className="text-center py-10 space-y-3" role="status" aria-live="polite">
              <div className="w-8 h-8 rounded-full border-2 border-slate-700 border-t-sky-400 animate-spin mx-auto" />
              <p className="text-sm text-slate-300">Loading your verified library…</p>
            </div>
          ) : error && articles.length === 0 ? (
            <p className="py-4 text-center text-xs text-slate-400">
              Account-backed pieces remain hidden until verification succeeds.
            </p>
          ) : articles.length === 0 ? (
            <div className="text-center py-10 space-y-4">
              <div className="w-12 h-12 rounded-2xl bg-slate-900 border border-slate-800 text-slate-400 flex items-center justify-center mx-auto">
                <BookOpen className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-semibold text-slate-200">Your library is currently empty</p>
                <p className="text-xs text-slate-400 font-sans">Purchased pieces will be permanently saved here for online reading across your devices.</p>
              </div>
              <button
                onClick={() => {
                  onClose();
                  onExploreCatalog();
                }}
                className="px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold tracking-wide transition-colors"
              >
                Browse Monograph Catalog
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {articles.map(art => (
                <div 
                  key={art.id}
                  className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 group hover:border-slate-700 transition-colors"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-sky-950 text-sky-400 border border-sky-800">
                        {art.category}
                      </span>
                      <span className="text-[10px] font-mono text-emerald-400 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" />
                        <span>
                          {getAccessLabel(art.libraryAccessSource)}
                        </span>
                      </span>
                    </div>
                    <h4 className="font-display font-bold text-sm sm:text-base text-slate-100">
                      {art.title}
                    </h4>
                    <p className="text-xs text-slate-400 font-serif line-clamp-1">
                      By Jake (@its_bigboy_jake) • Protected Online Edition
                    </p>
                  </div>

                  <div className="flex items-center gap-2 w-full sm:w-auto shrink-0">
                    <button
                      onClick={() => {
                        onClose();
                        onReadArticle(art);
                      }}
                      className="w-full sm:w-auto py-2 px-5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-md shadow-sky-950/60"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>Open Reader</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
};
