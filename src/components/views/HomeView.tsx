import React, { useEffect, useState } from 'react';
import { ArrowRight, Feather, Sparkles } from 'lucide-react';
import { Article, AuthorProfile, Category, ContentBundle, ContentCollection, HomepageConfig, SubscriptionPlan } from '../../types.js';
import { api } from '../../utils/api.js';
import { normalizeHomepageSections, type HomepageSectionId } from '../../homepageSections.js';
import { HomepageDiscovery } from '../HomepageDiscovery.js';
import type { HomepageBundle } from '../HomepageBundles.js';
import { HomepageReaderPasses } from '../HomepageReaderPasses.js';
import { ReaderCommunityHub } from '../ReaderCommunityHub.js';

interface HomeViewProps {
  author: AuthorProfile | null;
  articles: Article[];
  categories: Category[];
  unlockedTokens: Record<string, any>;
  onReadArticle: (article: Article) => void;
  onUnlockArticle: (article: Article) => void;
  onPurchaseBundle: (bundle: ContentBundle, checkoutArticle: Article) => void;
  onPurchaseSubscription: (plan: SubscriptionPlan) => void;
  onSelectCategory: (categoryName: string) => void;
  onNavigate: (view: 'home' | 'all-pieces' | 'about' | 'how-to-pay' | 'support') => void;
  onOpenTip: () => void;
  deepLink?: HomepageDeepLink | null;
  onDeepLinkHandled?: () => void;
}

export type HomepageDeepLink = {
  kind: 'collection' | 'bundle' | 'subscription';
  id: string;
};

const HOMEPAGE_DEEP_LINK_KEYS: HomepageDeepLink['kind'][] = [
  'collection',
  'bundle',
  'subscription',
];
const SAFE_HOMEPAGE_DESTINATION_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,127})$/;

/**
 * Reads a single, unambiguous homepage destination. URLSearchParams has
 * already decoded the value, so do not decode it again here.
 */
export const parseHomepageDeepLink = (
  hashParams: URLSearchParams,
  searchParams: URLSearchParams,
): HomepageDeepLink | null => {
  const destinations: HomepageDeepLink[] = [];
  for (const kind of HOMEPAGE_DEEP_LINK_KEYS) {
    const values = [hashParams.get(kind), searchParams.get(kind)]
      .filter((value): value is string => typeof value === 'string')
      .map(value => value.trim())
      .filter(Boolean);
    const distinctValues = [...new Set(values)];
    if (distinctValues.length > 1) return null;
    const value = distinctValues[0];
    if (value && SAFE_HOMEPAGE_DESTINATION_ID.test(value)) {
      destinations.push({ kind, id: value });
    }
  }
  return destinations.length === 1 ? destinations[0] : null;
};

interface HomepageHeroProps {
  backgroundUrl: string;
  background: HomepageConfig['welcomeBackground'];
  overlayOpacity: number;
  heroBadge: string;
  heroHeadline: string;
  tagline: string;
  authorIdentity: string;
  onExplore: () => void;
}

const HomepageHero: React.FC<HomepageHeroProps> = ({
  backgroundUrl,
  background,
  overlayOpacity,
  heroBadge,
  heroHeadline,
  tagline,
  authorIdentity,
  onExplore,
}) => (
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
            objectFit: background.fit === 'contain' ? 'contain' : background.fit === 'custom' ? 'fill' : 'cover',
            objectPosition: `${background.positionX ?? 50}% ${background.positionY ?? 50}%`,
            transform: `scale(${(background.zoom || 100) / 100})`,
            transformOrigin: `${background.positionX ?? 50}% ${background.positionY ?? 50}%`,
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
          onClick={onExplore}
          className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-slate-700/80 bg-slate-950/85 px-6 py-2.5 font-mono text-xs text-slate-200 shadow-lg backdrop-blur-md transition-all hover:bg-slate-900 hover:text-white"
        >
          <span>Explore the Writing</span>
          <ArrowRight className="h-3.5 w-3.5 text-sky-400" />
        </button>
      </div>
    </div>
  </section>
);

export const HomeView: React.FC<HomeViewProps> = ({
  author,
  articles,
  categories,
  unlockedTokens,
  onReadArticle,
  onUnlockArticle,
  onPurchaseBundle,
  onPurchaseSubscription,
  onSelectCategory,
  onNavigate,
  deepLink,
  onDeepLinkHandled,
}) => {
  const [homepageConfig, setHomepageConfig] = useState<HomepageConfig | null>(null);
  const [homepageBundles, setHomepageBundles] = useState<HomepageBundle[]>([]);
  const [homepageCollections, setHomepageCollections] = useState<ContentCollection[] | null>(null);
  const [homepagePieces, setHomepagePieces] = useState<Article[] | null>(null);
  const [subscriptionPlans, setSubscriptionPlans] = useState<SubscriptionPlan[]>([]);
  const [homepageLoaded, setHomepageLoaded] = useState(false);
  const [requestedDeepLink, setRequestedDeepLink] = useState<HomepageDeepLink | null>(deepLink || null);

  useEffect(() => {
    if (!deepLink) return;
    setHomepageLoaded(false);
    setRequestedDeepLink(deepLink);
  }, [deepLink?.id, deepLink?.kind]);

  useEffect(() => {
    let requestSequence = 0;
    let disposed = false;

    const fetchHomepage = async () => {
      const requestId = ++requestSequence;
      try {
        const data = await api.getHomepageData();
        let nextBundles = data.bundles || [];
        let nextCollections = data.collections || [];
        const destination = requestedDeepLink;

        // Homepage curation is intentionally small. A direct affiliate link may
        // point at another published group, so load just that public discovery
        // target on deep-link landings and place it first for exact navigation.
        if (
          destination?.kind === 'collection'
          && !nextCollections.some(item => item.id === destination.id || item.slug === destination.id)
        ) {
          try {
            const discovery = await api.getDiscoveryCollections();
            const target = discovery.collections.find(
              item => item.id === destination.id || item.slug === destination.id,
            );
            if (target) {
              nextCollections = [target, ...nextCollections.filter(item => item.id !== target.id)];
            }
          } catch {
            // The curated collection shelf remains a safe fallback.
          }
        } else if (
          destination?.kind === 'bundle'
          && !nextBundles.some(item => item.id === destination.id || item.slug === destination.id)
        ) {
          try {
            const discovery = await api.getDiscoveryCollections();
            const target = discovery.bundles.find(
              item => item.id === destination.id || item.slug === destination.id,
            );
            if (target) {
              nextBundles = [target, ...nextBundles.filter(item => item.id !== target.id)];
            }
          } catch {
            // The curated bundle shelf remains a safe fallback.
          }
        }

        if (!disposed && requestId === requestSequence && data) {
          setHomepageConfig(data.config);
          setHomepageBundles(nextBundles);
          setHomepageCollections(nextCollections);
          setHomepagePieces(data.pieces || []);
          setSubscriptionPlans(data.subscriptionPlans || []);
          setHomepageLoaded(true);
        }
      } catch (error) {
        if (!disposed && requestId === requestSequence) {
          console.warn('Could not fetch homepage curation; using the published archive fallback.', error);
          setHomepageCollections([]);
          setHomepageBundles([]);
          setHomepagePieces(null);
          setSubscriptionPlans([]);
          setHomepageLoaded(true);
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
  }, [requestedDeepLink?.id, requestedDeepLink?.kind]);

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
  const normalizedSections = React.useMemo(
    () => normalizeHomepageSections(homepageConfig?.sections),
    [homepageConfig?.sections],
  );

  useEffect(() => {
    if (!homepageLoaded || !deepLink || !onDeepLinkHandled) return;

    const sectionIdByKind: Record<HomepageDeepLink['kind'], HomepageSectionId> = {
      collection: 'collections',
      bundle: 'bundles',
      subscription: 'subscriptions',
    };
    const destinationSection = sectionIdByKind[deepLink.kind];
    const sectionVisible = normalizedSections.some(
      section => section.id === destinationSection && section.isVisible,
    );
    const targetAvailable = deepLink.kind === 'collection'
      ? Boolean(homepageCollections?.some(item => item.id === deepLink.id || item.slug === deepLink.id))
      : deepLink.kind === 'bundle'
        ? homepageBundles.some(item => item.id === deepLink.id || item.slug === deepLink.id)
        : subscriptionPlans.some(plan => plan.isPublished !== false && plan.id === deepLink.id);

    // Exact available targets are handled by the mounted shelf. Missing or
    // writer-hidden targets fall back to the closest available public section.
    if (sectionVisible && targetAvailable) return;

    const fallbackId = deepLink.kind === 'collection'
      ? 'home-curated-collections'
      : deepLink.kind === 'bundle'
        ? 'home-reading-bundles'
        : 'home-reader-passes';
    (document.getElementById(fallbackId) || document.getElementById('home-discovery'))
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    onDeepLinkHandled();
  }, [
    deepLink,
    homepageBundles,
    homepageCollections,
    homepageLoaded,
    normalizedSections,
    onDeepLinkHandled,
    subscriptionPlans,
  ]);

  const scrollToDiscovery = () => {
    const target = document.getElementById('home-reader-passes')
      || document.getElementById('home-reading-bundles')
      || document.getElementById('home-library-guide')
      || document.getElementById('home-curated-collections')
      || document.getElementById('home-individual-pieces');
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

      <HomepageDiscovery
        config={homepageConfig}
        bundles={homepageBundles}
        collections={homepageCollections || []}
        categories={categories}
        allArticles={publishedArticles}
        pieces={visiblePieces}
        unlockedTokens={unlockedTokens}
        onReadArticle={onReadArticle}
        onUnlockArticle={onUnlockArticle}
        onPurchaseBundle={onPurchaseBundle}
        onSelectCategory={onSelectCategory}
        onNavigate={onNavigate}
        initialCollectionId={homepageLoaded && deepLink?.kind === 'collection' ? deepLink.id : null}
        initialBundleId={homepageLoaded && deepLink?.kind === 'bundle' ? deepLink.id : null}
        onInitialDestinationHandled={onDeepLinkHandled}
        heroSection={(
          <HomepageHero
            backgroundUrl={backgroundUrl}
            background={bgSettings}
            overlayOpacity={overlayOpacity}
            heroBadge={heroBadge}
            heroHeadline={heroHeadline}
            tagline={tagline}
            authorIdentity={authorIdentity}
            onExplore={scrollToDiscovery}
          />
        )}
        subscriptionsSection={(
          <HomepageReaderPasses
            plans={subscriptionPlans}
            config={homepageConfig}
            onChoosePlan={onPurchaseSubscription}
            initialPlanId={homepageLoaded && deepLink?.kind === 'subscription' ? deepLink.id : null}
            onInitialPlanHandled={onDeepLinkHandled}
          />
        )}
        newsletterSection={(
          <ReaderCommunityHub config={homepageConfig} />
        )}
      />
    </div>
  );
};
