import React, { useState, useEffect } from 'react';
import { 
  BookOpen, 
  ArrowRight, 
  Sparkles, 
  Smartphone, 
  Calendar, 
  Clock, 
  Flame,
  CheckCircle2, 
  FileText, 
  Compass, 
  Feather
} from 'lucide-react';
import { Article, AuthorProfile, HomepageConfig, Topic } from '../../types.js';
import { api } from '../../utils/api.js';
import { HorizontalPieceCarousel } from '../HorizontalPieceCarousel.js';
import { TopicCatalogueSection } from '../TopicCatalogueSection.js';
import { TopicReaderModal } from '../TopicReaderModal.js';

interface HomeViewProps {
  author: AuthorProfile | null;
  articles: Article[];
  unlockedTokens: Record<string, any>;
  onReadArticle: (article: Article) => void;
  onUnlockArticle: (article: Article) => void;
  onNavigate: (view: 'home' | 'all-pieces' | 'about' | 'how-to-pay' | 'support') => void;
  onOpenTip: () => void;
}

// Tasteful, minimal editorial section separator matching Ink & Witness typography and dark aesthetic
const SectionSeparator: React.FC<{ id?: string }> = ({ id }) => (
  <div id={id} className="max-w-5xl mx-auto px-4 sm:px-6 my-10 sm:my-14 lg:my-16">
    <div className="relative flex items-center justify-center">
      <div className="w-full border-t border-slate-800/80 bg-gradient-to-r from-transparent via-slate-700/60 to-transparent h-px" />
      <div className="absolute px-3 bg-[#0b101b] text-slate-600 flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-slate-700/80" />
        <span className="w-1 h-1 rounded-full bg-sky-500/50" />
        <span className="w-1.5 h-1.5 rounded-full bg-slate-700/80" />
      </div>
    </div>
  </div>
);

export const HomeView: React.FC<HomeViewProps> = ({
  author,
  articles,
  unlockedTokens,
  onReadArticle,
  onUnlockArticle,
  onNavigate,
}) => {
  const [homepageConfig, setHomepageConfig] = useState<HomepageConfig | null>(null);
  const [mostSellingPieces, setMostSellingPieces] = useState<Article[]>([]);
  const [pieceOfTheWeek, setPieceOfTheWeek] = useState<Article | null>(null);
  const [selectedTopic, setSelectedTopic] = useState<Topic | null>(null);
  const [loadingConfig, setLoadingConfig] = useState<boolean>(true);

  // Fetch homepage curation from backend
  useEffect(() => {
    const fetchHomepage = async () => {
      try {
        setLoadingConfig(true);
        const data = await api.getHomepageData();
        if (data) {
          setHomepageConfig(data.config);
          if (data.mostSellingPieces && data.mostSellingPieces.length > 0) {
            setMostSellingPieces(data.mostSellingPieces);
          }
          if (data.pieceOfTheWeek) {
            setPieceOfTheWeek(data.pieceOfTheWeek);
          }
        }
      } catch (err) {
        console.warn('Could not fetch curated homepage config, using default resolution:', err);
      } finally {
        setLoadingConfig(false);
      }
    };

    fetchHomepage();
  }, [articles]);

  // Published articles list
  const publishedArticles = articles.filter(a => a.status === 'published' || !a.status);

  // Section 1: Piece of the Week resolution (Single piece - UNCHANGED)
  const resolvedPieceOfTheWeek = pieceOfTheWeek || 
    publishedArticles.find(a => a.featured) || 
    publishedArticles[0] || 
    null;

  // Section 2: Most Selling resolution (Preserves existing ranking/selection logic)
  const resolvedMostSelling = mostSellingPieces.length > 0
    ? mostSellingPieces
    : publishedArticles;

  // Section 3: Latest from the Ink resolution (sorted newest first)
  const latestFromTheInk = [...publishedArticles]
    .sort((a, b) => {
      const timeA = new Date(a.publishedAt || a.createdAt || 0).getTime();
      const timeB = new Date(b.publishedAt || b.createdAt || 0).getTime();
      return timeB - timeA;
    });

  // Section 4: Explore Other Pieces (Catalogue ordering)
  const exploreOtherPieces = publishedArticles.filter(
    a => resolvedPieceOfTheWeek ? a.id !== resolvedPieceOfTheWeek.id : true
  );
  const resolvedExploreCatalogue = exploreOtherPieces.length > 0 ? exploreOtherPieces : publishedArticles;

  // Background Settings
  const bgSettings = homepageConfig?.welcomeBackground || {
    imageUrl: author?.welcomeBackgroundUrl || '/uploads/author_cover-1786702522341-772b89830648.jpg',
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

  const activeBanner = (homepageConfig?.banners || []).find(b => b.isVisible);

  const tagline = homepageConfig?.heroQuote || "“I write because the heart keeps a ledger the tongue is too proud to read.”";
  const authorIdentity = homepageConfig?.heroSubheadline || "An archive of lived experience, intimacy, power, and memory authored by Jake.";
  const heroHeadline = homepageConfig?.heroHeadline || "INK & WITNESS";
  const heroBadge = homepageConfig?.heroBadge || "Ink & Witness Narratives";

  const isSectionVisible = (sectionId: string) => {
    if (!homepageConfig?.sections || homepageConfig.sections.length === 0) return true;
    const sec = homepageConfig.sections.find(s => s.id === sectionId);
    return sec ? sec.isVisible !== false : true;
  };

  const isPieceOfTheWeekUnlocked = resolvedPieceOfTheWeek 
    ? Boolean(unlockedTokens[resolvedPieceOfTheWeek.id] || resolvedPieceOfTheWeek.isUnlocked) 
    : false;

  return (
    <div id="home-view" className="space-y-0">
      
      {/* Announcement Banner if configured and active */}
      {activeBanner && (
        <div 
          id="home-announcement-banner" 
          className={`w-full py-2.5 px-4 text-center text-xs font-medium border-b transition-all flex items-center justify-center gap-3 z-30 relative ${
            activeBanner.bgStyle === 'indigo'
              ? 'bg-indigo-950 text-indigo-200 border-indigo-800'
              : activeBanner.bgStyle === 'amber'
              ? 'bg-amber-950 text-amber-200 border-amber-800'
              : activeBanner.bgStyle === 'emerald'
              ? 'bg-emerald-950 text-emerald-200 border-emerald-800'
              : 'bg-sky-950 text-sky-200 border-sky-800'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5 shrink-0 opacity-80" />
          <span>{activeBanner.text}</span>
          {activeBanner.linkText && activeBanner.linkUrl && (
            <a 
              href={activeBanner.linkUrl} 
              className="underline font-bold hover:text-white transition-colors shrink-0 ml-1"
            >
              {activeBanner.linkText} &rarr;
            </a>
          )}
        </div>
      )}

      {/* ============================================================ */}
      {/* HERO / INTRODUCTION (PHOTOGRAPHIC BACKGROUND) */}
      {/* ============================================================ */}
      <section 
        id="home-hero" 
        className="relative overflow-hidden w-full min-h-[480px] sm:min-h-[540px] lg:min-h-[620px] flex items-center justify-center pt-28 pb-16 sm:pt-36 sm:pb-24 lg:pt-44 lg:pb-32 text-center"
      >
        {/* Background Photograph */}
        {backgroundUrl && (
          <div className="absolute inset-0 w-full h-full pointer-events-none select-none z-0 overflow-hidden">
            <img 
              src={backgroundUrl} 
              alt="Ink &amp; Witness Narratives Hero Background" 
              referrerPolicy="no-referrer"
              style={{
                objectFit: bgSettings.fit === 'contain' ? 'contain' : bgSettings.fit === 'custom' ? 'fill' : 'cover',
                objectPosition: `${bgSettings.positionX ?? 50}% ${bgSettings.positionY ?? 50}%`,
                transform: `scale(${(bgSettings.zoom || 100) / 100})`,
                transformOrigin: `${bgSettings.positionX ?? 50}% ${bgSettings.positionY ?? 50}%`,
              }}
              className="w-full h-full"
            />

            {/* Dark Overlay */}
            <div 
              className="absolute inset-0 bg-[#070b14]"
              style={{ opacity: overlayOpacity }}
            />

            {/* Smooth edge blend */}
            <div className="absolute inset-0 bg-gradient-to-b from-[#070b14]/50 via-transparent to-[#0b101b]" />
            <div className="absolute inset-0 bg-radial-[circle_at_center] from-transparent via-black/20 to-black/60" />
          </div>
        )}

        {/* Hero Content Layer */}
        <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 space-y-6">
          
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-950/80 border border-slate-800/80 text-[11px] font-mono uppercase tracking-widest text-sky-400 backdrop-blur-md">
            <Feather className="w-3 h-3 text-sky-400" />
            <span>{heroBadge}</span>
          </div>

          <h1 className="font-display text-4xl sm:text-6xl lg:text-7xl font-bold tracking-tight text-white leading-[1.1] drop-shadow-[0_4px_16px_rgba(0,0,0,0.9)]">
            {heroHeadline}
          </h1>

          <p className="font-serif italic text-xl sm:text-2xl lg:text-3xl text-slate-100 font-light max-w-3xl mx-auto leading-relaxed drop-shadow-[0_2px_12px_rgba(0,0,0,0.95)]">
            {tagline}
          </p>

          <p className="text-xs sm:text-sm lg:text-base text-slate-200/90 max-w-2xl mx-auto font-sans leading-relaxed drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)] font-normal">
            {authorIdentity}
          </p>

          {/* Quick Browse Scroll Indicator */}
          <div className="pt-3">
            <button
              onClick={() => {
                const el = document.getElementById('home-topic-catalogue');
                if (el) el.scrollIntoView({ behavior: 'smooth' });
                else {
                  const el2 = document.getElementById('home-piece-of-the-week');
                  if (el2) el2.scrollIntoView({ behavior: 'smooth' });
                }
              }}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full bg-slate-950/85 hover:bg-slate-900 border border-slate-700/80 text-xs font-mono text-slate-200 hover:text-white backdrop-blur-md transition-all shadow-lg cursor-pointer"
            >
              <span>Explore Featured Works</span>
              <ArrowRight className="w-3.5 h-3.5 text-sky-400" />
            </button>
          </div>

        </div>
      </section>

      {/* ============================================================ */}
      {/* NEW READER DISCOVERY SECTION: FIND WHAT SPEAKS TO YOU */}
      {/* ============================================================ */}
      <TopicCatalogueSection
        articles={publishedArticles}
        onSelectTopic={(topic) => setSelectedTopic(topic)}
        selectedTopicSlug={selectedTopic?.slug}
      />

      {/* Separator between Topic Catalogue and Piece of the Week */}
      <SectionSeparator id="sep-topics-piece-of-week" />

      {/* ============================================================ */}
      {/* 1. HOMEPAGE SECTION 1 — PIECE OF THE WEEK (UNCHANGED) */}
      {/* ============================================================ */}
      {resolvedPieceOfTheWeek && (
        <section 
          id="home-piece-of-the-week" 
          className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-sky-400">
              <Sparkles className="w-4 h-4" />
              <span>Piece of the Week</span>
            </div>
            <span className="text-[11px] font-mono text-slate-500">Featured Editorial Monograph</span>
          </div>

          <div className="rounded-3xl bg-gradient-to-r from-slate-900 via-[#10192e] to-slate-900 border border-sky-500/40 p-6 sm:p-10 shadow-2xl relative overflow-hidden">
            {/* Ambient glow */}
            <div className="absolute top-0 right-0 w-96 h-96 bg-sky-500/10 rounded-full blur-3xl pointer-events-none" />

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center relative z-10">
              
              {/* Left Details (7 cols) */}
              <div className="lg:col-span-7 space-y-4">
                <div className="flex flex-wrap items-center gap-3 text-xs font-mono text-slate-400">
                  <span className="px-3 py-1 rounded-md bg-sky-950 text-sky-300 border border-sky-800/80 font-medium">
                    {resolvedPieceOfTheWeek.category}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    {resolvedPieceOfTheWeek.readTimeMinutes} min read
                  </span>
                  <span>•</span>
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                    {resolvedPieceOfTheWeek.publishedAt}
                  </span>
                </div>

                <h2 
                  onClick={() => onReadArticle(resolvedPieceOfTheWeek)}
                  className="font-display font-bold text-2xl sm:text-4xl text-white hover:text-sky-300 transition-colors leading-tight cursor-pointer"
                >
                  {resolvedPieceOfTheWeek.title}
                </h2>

                {resolvedPieceOfTheWeek.subtitle && (
                  <p className="font-serif italic text-base sm:text-lg text-slate-300 font-light leading-relaxed">
                    {resolvedPieceOfTheWeek.subtitle}
                  </p>
                )}

                <p className="text-xs sm:text-sm text-slate-300/90 leading-relaxed font-sans">
                  {resolvedPieceOfTheWeek.excerpt}
                </p>

                {/* Action Button */}
                <div className="pt-3">
                  {isPieceOfTheWeekUnlocked ? (
                    <button
                      id="btn-read-piece-of-week"
                      onClick={() => onReadArticle(resolvedPieceOfTheWeek)}
                      className="px-8 py-3.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-semibold text-xs tracking-wider transition-all flex items-center gap-2 shadow-lg shadow-sky-950 cursor-pointer"
                    >
                      <BookOpen className="w-4 h-4" />
                      <span>Read</span>
                    </button>
                  ) : (
                    <button
                      id="btn-unlock-piece-of-week"
                      onClick={() => onUnlockArticle(resolvedPieceOfTheWeek)}
                      className="px-8 py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs tracking-wider transition-all flex items-center gap-2 shadow-lg shadow-emerald-950 cursor-pointer"
                    >
                      <Smartphone className="w-4 h-4 text-emerald-200" />
                      <span>Pay to Read — KSh {resolvedPieceOfTheWeek.priceKes}</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Right Large Cover Photo (5 cols) */}
              <div className="lg:col-span-5">
                <div 
                  onClick={() => onReadArticle(resolvedPieceOfTheWeek)}
                  className="relative rounded-2xl overflow-hidden border border-slate-700/80 shadow-2xl h-64 sm:h-72 cursor-pointer group bg-slate-950"
                >
                  <img 
                    src={resolvedPieceOfTheWeek.coverImage || "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=800&q=80"}
                    alt={resolvedPieceOfTheWeek.title}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 opacity-85 group-hover:opacity-100"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#0b101b]/90 via-transparent to-transparent" />
                  
                  <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between text-xs font-mono text-slate-300">
                    <span className="px-2.5 py-1 rounded bg-slate-900/90 border border-slate-700">
                      Editorial Spotlight
                    </span>
                    <span className="px-2.5 py-1 rounded bg-emerald-950/90 border border-emerald-700 text-emerald-300 font-bold">
                      KES {resolvedPieceOfTheWeek.priceKes}
                    </span>
                  </div>
                </div>
              </div>

            </div>
          </div>
        </section>
      )}

      {/* Separator between Piece of the Week and Most Selling */}
      <SectionSeparator id="sep-piece-of-week-most-selling" />

      {/* ============================================================ */}
      {/* 2. HOMEPAGE SECTION 2 — MOST SELLING (HORIZONTAL CAROUSEL) */}
      {/* ============================================================ */}
      <section 
        id="home-most-selling" 
        className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6"
      >
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-800/80 pb-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-amber-400 mb-1">
              <Flame className="w-4 h-4" />
              <span>Curated Selection</span>
            </div>
            <h2 className="font-serif font-bold text-2xl sm:text-3xl text-white">
              Most Selling Pieces
            </h2>
            <p className="text-xs sm:text-sm text-slate-400 font-sans mt-1">
              Essential monographs and highly collected treatises.
            </p>
          </div>

          <button
            onClick={() => onNavigate('all-pieces')}
            className="inline-flex items-center gap-1.5 text-xs font-mono text-sky-400 hover:text-sky-300 transition-colors group cursor-pointer"
          >
            <span>Explore All Pieces</span>
            <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
          </button>
        </div>

        {/* Horizontal One-Piece-at-a-time Carousel */}
        <HorizontalPieceCarousel
          id="carousel-most-selling"
          articles={resolvedMostSelling}
          unlockedTokens={unlockedTokens}
          onReadArticle={onReadArticle}
          onUnlockArticle={onUnlockArticle}
          emptyMessage="No monographs currently featured in Most Selling."
        />
      </section>

      {/* Separator between Most Selling and Latest from the Ink */}
      <SectionSeparator id="sep-most-selling-latest-ink" />

      {/* ============================================================ */}
      {/* 3. HOMEPAGE SECTION 3 — LATEST FROM THE INK (HORIZONTAL CAROUSEL) */}
      {/* ============================================================ */}
      <section 
        id="home-latest-from-the-ink" 
        className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6"
      >
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-800/80 pb-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-sky-400 mb-1">
              <BookOpen className="w-4 h-4" />
              <span>Recent Dispatches</span>
            </div>
            <h2 className="font-serif font-bold text-2xl sm:text-3xl text-white">
              Latest from the Ink
            </h2>
            <p className="text-xs sm:text-sm text-slate-400 font-sans mt-1">
              The newest published monographs, reflections, and essays — fresh from the desk.
            </p>
          </div>

          <button
            onClick={() => onNavigate('all-pieces')}
            className="inline-flex items-center gap-1.5 text-xs font-mono text-sky-400 hover:text-sky-300 transition-colors group cursor-pointer"
          >
            <span>View All Archives</span>
            <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
          </button>
        </div>

        {/* Horizontal One-Piece-at-a-time Carousel */}
        <HorizontalPieceCarousel
          id="carousel-latest-ink"
          articles={latestFromTheInk}
          unlockedTokens={unlockedTokens}
          onReadArticle={onReadArticle}
          onUnlockArticle={onUnlockArticle}
          emptyMessage="New pieces will appear here automatically upon publication."
        />
      </section>

      {/* Separator between Latest from the Ink and Explore Other Pieces */}
      <SectionSeparator id="sep-latest-ink-explore-other" />

      {/* ============================================================ */}
      {/* 4. HOMEPAGE SECTION 4 — EXPLORE OTHER PIECES (HORIZONTAL CAROUSEL & ARCHIVE CTA) */}
      {/* ============================================================ */}
      <section 
        id="home-explore-other-pieces" 
        className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pb-16 sm:pb-24 space-y-8"
      >
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-800/80 pb-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-indigo-400 mb-1">
              <Compass className="w-4 h-4" />
              <span>Archive Catalog</span>
            </div>
            <h2 className="font-serif font-bold text-2xl sm:text-3xl text-white">
              Explore Other Pieces
            </h2>
            <p className="text-xs sm:text-sm text-slate-400 font-sans mt-1">
              Browse through essays, reflections, and philosophical monographs in the catalog.
            </p>
          </div>

          <button
            onClick={() => onNavigate('all-pieces')}
            className="inline-flex items-center gap-1.5 text-xs font-mono text-sky-400 hover:text-sky-300 transition-colors group cursor-pointer"
          >
            <span>Full Catalog View</span>
            <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
          </button>
        </div>

        {/* Horizontal One-Piece-at-a-time Carousel */}
        <HorizontalPieceCarousel
          id="carousel-explore-other"
          articles={resolvedExploreCatalogue}
          unlockedTokens={unlockedTokens}
          onReadArticle={onReadArticle}
          onUnlockArticle={onUnlockArticle}
          emptyMessage="No additional catalogue pieces found."
        />

        {/* Supporting Full Archive Jump Card */}
        <div className="p-6 sm:p-8 rounded-2xl bg-slate-900/50 border border-slate-800/80 text-center space-y-4 max-w-2xl mx-auto">
          <p className="text-xs text-slate-400 font-sans">
            Looking for a specific category, tag, or title? Search and filter the full archive with category sorting and deep search.
          </p>
          <div>
            <button
              id="home-explore-all-pieces-btn"
              onClick={() => onNavigate('all-pieces')}
              className="px-6 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white border border-slate-700 hover:border-slate-600 font-bold text-xs tracking-wider transition-all inline-flex items-center gap-2 cursor-pointer shadow-md hover:shadow-lg"
            >
              <span>Open All Pieces Archive</span>
              <ArrowRight className="w-3.5 h-3.5 text-sky-400" />
            </button>
          </div>
        </div>
      </section>

      {/* Reader Topic Dialogue & 1-piece-at-a-time Mobile Reader Modal */}
      {selectedTopic && (
        <TopicReaderModal
          topic={selectedTopic}
          articles={publishedArticles}
          unlockedTokens={unlockedTokens}
          onClose={() => setSelectedTopic(null)}
          onReadArticle={onReadArticle}
          onUnlockArticle={onUnlockArticle}
        />
      )}

    </div>
  );
};
