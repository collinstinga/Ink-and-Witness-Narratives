import React, { useEffect, useState } from 'react';
import { ArrowRight, Feather, Sparkles } from 'lucide-react';
import { Article, AuthorProfile, ContentCollection, HomepageConfig } from '../../types.js';
import { api } from '../../utils/api.js';
import { HomepageDiscovery } from '../HomepageDiscovery.js';
import { NewsletterSignup } from '../NewsletterSignup.js';

interface HomeViewProps {
  author: AuthorProfile | null;
  articles: Article[];
  unlockedTokens: Record<string, any>;
  onReadArticle: (article: Article) => void;
  onUnlockArticle: (article: Article) => void;
  onNavigate: (view: 'home' | 'all-pieces' | 'about' | 'how-to-pay' | 'support') => void;
  onOpenTip: () => void;
}

export const HomeView: React.FC<HomeViewProps> = ({
  author,
  articles,
  unlockedTokens,
  onReadArticle,
  onUnlockArticle,
  onNavigate,
}) => {
  const [homepageConfig, setHomepageConfig] = useState<HomepageConfig | null>(null);
  const [homepageCollections, setHomepageCollections] = useState<ContentCollection[] | null>(null);
  const [homepagePieces, setHomepagePieces] = useState<Article[] | null>(null);

  useEffect(() => {
    let requestSequence = 0;
    let disposed = false;

    const fetchHomepage = async () => {
      const requestId = ++requestSequence;
      try {
        const data = await api.getHomepageData();
        if (!disposed && requestId === requestSequence && data) {
          setHomepageConfig(data.config);
          setHomepageCollections(data.collections || []);
          setHomepagePieces(data.pieces || []);
        }
      } catch (error) {
        if (!disposed && requestId === requestSequence) {
          console.warn('Could not fetch homepage curation; using the published archive fallback.', error);
          setHomepageCollections([]);
          setHomepagePieces(null);
        }
      }
    };

    void fetchHomepage();
    const refreshAfterSave = () => { void fetchHomepage(); };
    const refreshOtherTab = (event: StorageEvent) => {
      if (event.key === 'ink-homepage-version') void fetchHomepage();
    };
    window.addEventListener('ink-homepage-updated', refreshAfterSave);
    window.addEventListener('storage', refreshOtherTab);
    return () => {
      disposed = true;
      window.removeEventListener('ink-homepage-updated', refreshAfterSave);
      window.removeEventListener('storage', refreshOtherTab);
    };
  }, []);

  const publishedArticles = articles.filter(article => article.status === 'published' || !article.status);
  const visiblePieces = homepagePieces ?? publishedArticles.slice(0, 8);
  const bgSettings = homepageConfig?.welcomeBackground || {
    imageUrl: author?.welcomeBackgroundUrl || '',
    fit: 'cover',
    positionX: 50,
    positionY: 50,
    zoom: 100,
    overlayStrength: 25,
  };
  const backgroundUrl = bgSettings.imageUrl || author?.welcomeBackgroundUrl || '';
  const overlayOpacity = typeof bgSettings.overlayStrength === 'number'
    ? bgSettings.overlayStrength / 100
    : 0.25;
  const activeBanner = (homepageConfig?.banners || []).find(banner => banner.isVisible);
  const tagline = homepageConfig?.heroQuote || '“I write because the heart keeps a ledger the tongue is too proud to read.”';
  const authorIdentity = homepageConfig?.heroSubheadline || 'An archive of lived experience, intimacy, power, and memory authored by Jake.';
  const heroHeadline = homepageConfig?.heroHeadline || 'INK & WITNESS';
  const heroBadge = homepageConfig?.heroBadge || 'Ink & Witness Narratives';

  const scrollToDiscovery = () => {
    const target = document.getElementById('home-curated-collections')
      || document.getElementById('home-curated-pieces');
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div id="home-view">
      {activeBanner && (
        <div
          id="home-announcement-banner"
          className={`relative z-30 flex w-full items-center justify-center gap-3 border-b px-4 py-2.5 text-center text-xs font-medium transition-all ${
            activeBanner.bgStyle === 'indigo'
              ? 'border-indigo-800 bg-indigo-950 text-indigo-200'
              : activeBanner.bgStyle === 'amber'
                ? 'border-amber-800 bg-amber-950 text-amber-200'
                : activeBanner.bgStyle === 'emerald'
                  ? 'border-emerald-800 bg-emerald-950 text-emerald-200'
                  : 'border-sky-800 bg-sky-950 text-sky-200'
          }`}
        >
          <Sparkles className="h-3.5 w-3.5 shrink-0 opacity-80" />
          <span>{activeBanner.text}</span>
          {activeBanner.linkText && activeBanner.linkUrl && (
            <a href={activeBanner.linkUrl} className="ml-1 shrink-0 font-bold underline transition-colors hover:text-white">
              {activeBanner.linkText} &rarr;
            </a>
          )}
        </div>
      )}

      <section
        id="home-hero"
        className="relative flex min-h-[480px] w-full items-center justify-center overflow-hidden pb-16 pt-28 text-center sm:min-h-[540px] sm:pb-24 sm:pt-36 lg:min-h-[620px] lg:pb-32 lg:pt-44"
      >
        {backgroundUrl && (
          <div className="pointer-events-none absolute inset-0 z-0 h-full w-full select-none overflow-hidden">
            <img
              src={backgroundUrl}
              alt="Ink & Witness Narratives"
              referrerPolicy="no-referrer"
              style={{
                objectFit: bgSettings.fit === 'contain' ? 'contain' : bgSettings.fit === 'custom' ? 'fill' : 'cover',
                objectPosition: `${bgSettings.positionX ?? 50}% ${bgSettings.positionY ?? 50}%`,
                transform: `scale(${(bgSettings.zoom || 100) / 100})`,
                transformOrigin: `${bgSettings.positionX ?? 50}% ${bgSettings.positionY ?? 50}%`,
              }}
              className="h-full w-full"
            />
            <div className="absolute inset-0 bg-[#070b14]" style={{ opacity: overlayOpacity }} />
            <div className="absolute inset-0 bg-gradient-to-b from-[#070b14]/50 via-transparent to-[#0b101b]" />
            <div className="absolute inset-0 bg-radial-[circle_at_center] from-transparent via-black/20 to-black/60" />
          </div>
        )}

        <div className="relative z-10 mx-auto max-w-4xl space-y-6 px-4 sm:px-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-800/80 bg-slate-950/80 px-3 py-1 font-mono text-[11px] uppercase tracking-widest text-sky-400 backdrop-blur-md">
            <Feather className="h-3 w-3" />
            <span>{heroBadge}</span>
          </div>
          <h1 className="font-display text-4xl font-bold leading-[1.1] tracking-tight text-white drop-shadow-[0_4px_16px_rgba(0,0,0,0.9)] sm:text-6xl lg:text-7xl">
            {heroHeadline}
          </h1>
          <p className="mx-auto max-w-3xl font-serif text-xl font-light italic leading-relaxed text-slate-100 drop-shadow-[0_2px_12px_rgba(0,0,0,0.95)] sm:text-2xl lg:text-3xl">
            {tagline}
          </p>
          <p className="mx-auto max-w-2xl text-xs font-normal leading-relaxed text-slate-200/90 drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)] sm:text-sm lg:text-base">
            {authorIdentity}
          </p>
          <div className="pt-3">
            <button
              type="button"
              onClick={scrollToDiscovery}
              className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-slate-700/80 bg-slate-950/85 px-6 py-2.5 font-mono text-xs text-slate-200 shadow-lg backdrop-blur-md transition-all hover:bg-slate-900 hover:text-white"
            >
              <span>Explore the Writing</span>
              <ArrowRight className="h-3.5 w-3.5 text-sky-400" />
            </button>
          </div>
        </div>
      </section>

      <HomepageDiscovery
        config={homepageConfig}
        collections={homepageCollections || []}
        allArticles={publishedArticles}
        pieces={visiblePieces}
        unlockedTokens={unlockedTokens}
        onReadArticle={onReadArticle}
        onUnlockArticle={onUnlockArticle}
        onNavigate={onNavigate}
      />

      <div className="border-t border-slate-800/70">
        <NewsletterSignup />
      </div>
    </div>
  );
};
