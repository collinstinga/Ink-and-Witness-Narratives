import React, { useState, useEffect } from 'react';
import { 
  X, 
  BookOpen, 
  Compass, 
  Sparkles, 
  ArrowRight, 
  ArrowLeft, 
  Clock, 
  Calendar, 
  Flame, 
  Lock, 
  CheckCircle2, 
  Smartphone,
  Share2,
  ChevronRight,
  ChevronLeft
} from 'lucide-react';
import { Topic, Article } from '../types.js';
import { api } from '../utils/api.js';

interface TopicReaderModalProps {
  topic: Topic | null;
  articles: Article[];
  unlockedTokens: Record<string, any>;
  onClose: () => void;
  onReadArticle: (article: Article) => void;
  onUnlockArticle: (article: Article) => void;
}

export const TopicReaderModal: React.FC<TopicReaderModalProps> = ({
  topic,
  articles,
  unlockedTokens,
  onClose,
  onReadArticle,
  onUnlockArticle,
}) => {
  const [activeIndex, setActiveIndex] = useState<number>(0);
  const [viewMode, setViewMode] = useState<'focused' | 'list'>('focused');
  const [topicArticles, setTopicArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    if (!topic) return;

    // Reset index when topic changes
    setActiveIndex(0);

    const loadTopicPieces = async () => {
      try {
        setLoading(true);
        // Fetch from API
        const data = await api.getTopic(topic.id || topic.slug);
        if (data && Array.isArray(data.pieces)) {
          const publishedOnly = data.pieces.filter(a => a.status === 'published' || !a.status);
          setTopicArticles(publishedOnly);
        } else {
          // Fallback matching strictly by assigned pieceIds / topics
          const published = articles.filter(a => a.status === 'published' || !a.status);
          const pieceIds = topic.pieceIds || [];
          const matched = published.filter(a => 
            pieceIds.includes(a.id) ||
            (a.topics && (a.topics.includes(topic.slug) || a.topics.includes(topic.name) || a.topics.includes(topic.id)))
          );
          setTopicArticles(matched);
        }
      } catch {
        // Fallback matching strictly by assigned pieceIds / topics
        const published = articles.filter(a => a.status === 'published' || !a.status);
        const pieceIds = topic.pieceIds || [];
        const matched = published.filter(a => 
          pieceIds.includes(a.id) ||
          (a.topics && (a.topics.includes(topic.slug) || a.topics.includes(topic.name) || a.topics.includes(topic.id)))
        );
        setTopicArticles(matched);
      } finally {
        setLoading(false);
      }
    };

    loadTopicPieces();
  }, [topic, articles]);

  if (!topic) return null;

  const currentPiece = topicArticles[activeIndex] || topicArticles[0];
  const isCurrentUnlocked = currentPiece ? Boolean(unlockedTokens[currentPiece.id] || currentPiece.isUnlocked || !currentPiece.isPaid) : false;

  const handleNext = () => {
    if (activeIndex < topicArticles.length - 1) {
      setActiveIndex(prev => prev + 1);
    }
  };

  const handlePrev = () => {
    if (activeIndex > 0) {
      setActiveIndex(prev => prev - 1);
    }
  };

  return (
    <div 
      id="topic-reader-modal-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 md:p-6 bg-black/85 backdrop-blur-md animate-fade-in overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div 
        id="topic-reader-modal-card"
        className="relative w-full max-w-4xl bg-[#0b101b] border border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] my-auto"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 sm:px-8 py-5 border-b border-slate-800/80 bg-slate-950/60 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-sky-400 shrink-0">
              <Compass className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono uppercase tracking-widest text-sky-400">
                  Reader Catalogue
                </span>
                <span className="text-slate-600">&bull;</span>
                <span className="text-xs font-mono text-slate-400">
                  {topicArticles.length} {topicArticles.length === 1 ? 'piece' : 'pieces'}
                </span>
              </div>
              <h2 className="font-display text-xl sm:text-2xl font-bold text-white truncate">
                {topic.name}
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* View Mode Toggle (Focused 1-at-a-time vs Grid/List) */}
            <div className="hidden sm:flex items-center bg-slate-900 border border-slate-800 rounded-full p-1 text-xs font-mono">
              <button
                onClick={() => setViewMode('focused')}
                className={`px-3 py-1 rounded-full transition-all cursor-pointer ${
                  viewMode === 'focused'
                    ? 'bg-sky-500/20 text-sky-300 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Story Flow
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`px-3 py-1 rounded-full transition-all cursor-pointer ${
                  viewMode === 'list'
                    ? 'bg-sky-500/20 text-sky-300 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                All Stories ({topicArticles.length})
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-2.5 rounded-full bg-slate-900 border border-slate-800 text-slate-400 hover:text-white hover:border-slate-700 transition-all cursor-pointer"
              aria-label="Close topic catalogue"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Topic Tagline */}
        {topic.description && (
          <div className="px-5 sm:px-8 py-3 bg-slate-950/30 border-b border-slate-800/40 text-xs sm:text-sm text-slate-300 font-serif italic font-light shrink-0">
            &ldquo;{topic.description}&rdquo;
          </div>
        )}

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-8 space-y-6">
          {loading ? (
            <div className="py-20 text-center space-y-3">
              <div className="w-8 h-8 border-2 border-sky-400 border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-xs font-mono text-slate-400 uppercase tracking-wider">Curating monographs for {topic.name}...</p>
            </div>
          ) : topicArticles.length === 0 ? (
            <div className="py-16 text-center space-y-3 max-w-md mx-auto">
              <BookOpen className="w-10 h-10 text-slate-600 mx-auto" />
              <p className="font-serif italic text-lg text-slate-300">No public stories currently filed under {topic.name}.</p>
              <p className="text-xs text-slate-500 font-sans">Check back soon as Jake writes and publishes new reflections.</p>
            </div>
          ) : viewMode === 'focused' && currentPiece ? (
            /* ============================================================ */
            /* 1-PIECE-AT-A-TIME FOCUSED READING EXPERIENCE */
            /* ============================================================ */
            <div className="space-y-6">
              {/* Stepper Indicator */}
              <div className="flex items-center justify-between text-xs font-mono text-slate-400 pb-2 border-b border-slate-800/60">
                <span>Story {activeIndex + 1} of {topicArticles.length}</span>
                <div className="flex items-center gap-1.5">
                  {topicArticles.map((_, i) => (
                    <button
                      key={i}
                      onClick={() => setActiveIndex(i)}
                      className={`h-1.5 rounded-full transition-all cursor-pointer ${
                        i === activeIndex 
                          ? 'w-6 bg-sky-400' 
                          : 'w-2 bg-slate-700 hover:bg-slate-500'
                      }`}
                      aria-label={`Jump to piece ${i + 1}`}
                    />
                  ))}
                </div>
              </div>

              {/* Active Piece Card */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-6 bg-slate-900/50 border border-slate-800 rounded-2xl p-5 sm:p-7">
                {/* Cover Image Column */}
                {currentPiece.coverImage && (
                  <div className="md:col-span-5 relative rounded-xl overflow-hidden aspect-[4/3] md:aspect-[3/4] bg-slate-950 border border-slate-800">
                    <img 
                      src={currentPiece.coverImage} 
                      alt={currentPiece.title}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                    {currentPiece.category && (
                      <div className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-slate-950/85 backdrop-blur-md border border-slate-800 text-[10px] font-mono text-sky-300">
                        {currentPiece.category}
                      </div>
                    )}
                  </div>
                )}

                {/* Content Column */}
                <div className={`${currentPiece.coverImage ? 'md:col-span-7' : 'md:col-span-12'} flex flex-col justify-between space-y-4`}>
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-3 text-xs font-mono text-slate-400">
                      {currentPiece.readTimeMinutes && (
                        <span className="flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5 text-slate-500" />
                          <span>{currentPiece.readTimeMinutes} min read</span>
                        </span>
                      )}
                      {currentPiece.publishedAt && (
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5 text-slate-500" />
                          <span>{currentPiece.publishedAt}</span>
                        </span>
                      )}
                    </div>

                    <h3 className="font-display text-2xl sm:text-3xl font-bold text-white leading-tight">
                      {currentPiece.title}
                    </h3>

                    {currentPiece.subtitle && (
                      <p className="font-serif italic text-base text-slate-300">
                        {currentPiece.subtitle}
                      </p>
                    )}

                    {currentPiece.synopsis ? (
                      <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800/80 text-xs sm:text-sm text-slate-300 leading-relaxed font-sans font-light">
                        <span className="text-sky-400 font-mono text-[10px] uppercase tracking-wider block mb-1">Author Synopsis</span>
                        {currentPiece.synopsis}
                      </div>
                    ) : currentPiece.excerpt ? (
                      <p className="text-xs sm:text-sm text-slate-300 line-clamp-3 leading-relaxed font-light">
                        {currentPiece.excerpt}
                      </p>
                    ) : null}
                  </div>

                  {/* Actions Bar */}
                  <div className="pt-4 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-slate-400">Access:</span>
                      {isCurrentUnlocked ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-mono bg-emerald-950/60 border border-emerald-800/80 text-emerald-300">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Unlocked</span>
                        </span>
                      ) : currentPiece.isPaid ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-mono bg-amber-950/60 border border-amber-800/80 text-amber-300 font-bold">
                          <span>KES {(currentPiece.priceKes || 1050).toLocaleString()}</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-mono bg-sky-950/60 border border-sky-800/80 text-sky-300">
                          <span>Complimentary</span>
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {isCurrentUnlocked ? (
                        <button
                          onClick={() => {
                            onClose();
                            onReadArticle(currentPiece);
                          }}
                          className="px-5 py-2.5 rounded-full bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs font-mono flex items-center gap-2 transition-all cursor-pointer shadow-lg shadow-sky-500/20"
                        >
                          <BookOpen className="w-4 h-4" />
                          <span>Read Full Story</span>
                        </button>
                      ) : (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              onClose();
                              onReadArticle(currentPiece);
                            }}
                            className="px-4 py-2.5 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-mono transition-all cursor-pointer"
                          >
                            Preview Excerpt
                          </button>
                          <button
                            onClick={() => {
                              onClose();
                              onUnlockArticle(currentPiece);
                            }}
                            className="px-5 py-2.5 rounded-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs font-mono flex items-center gap-1.5 transition-all cursor-pointer shadow-lg shadow-emerald-500/20"
                          >
                            <Smartphone className="w-4 h-4" />
                            <span>Unlock via M-Pesa</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Navigation Chevrons: Previous / Next Story */}
              <div className="flex items-center justify-between pt-2">
                <button
                  onClick={handlePrev}
                  disabled={activeIndex === 0}
                  className={`flex items-center gap-2 px-4 py-2 rounded-full border text-xs font-mono transition-all cursor-pointer ${
                    activeIndex > 0
                      ? 'border-slate-700 bg-slate-900 text-slate-200 hover:text-white hover:border-slate-600'
                      : 'border-slate-800/40 bg-slate-950/20 text-slate-600 opacity-40 cursor-not-allowed'
                  }`}
                >
                  <ChevronLeft className="w-4 h-4" />
                  <span>Previous Story</span>
                </button>

                <span className="text-xs font-mono text-slate-500 hidden sm:inline-block">
                  Topic: {topic.name}
                </span>

                <button
                  onClick={handleNext}
                  disabled={activeIndex >= topicArticles.length - 1}
                  className={`flex items-center gap-2 px-4 py-2 rounded-full border text-xs font-mono transition-all cursor-pointer ${
                    activeIndex < topicArticles.length - 1
                      ? 'border-slate-700 bg-slate-900 text-slate-200 hover:text-white hover:border-slate-600'
                      : 'border-slate-800/40 bg-slate-950/20 text-slate-600 opacity-40 cursor-not-allowed'
                  }`}
                >
                  <span>Next Story</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          ) : (
            /* ============================================================ */
            /* MULTI-PIECE LIST / GRID VIEW */
            /* ============================================================ */
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {topicArticles.map((art, idx) => {
                const isUnlocked = Boolean(unlockedTokens[art.id] || art.isUnlocked || !art.isPaid);
                return (
                  <div
                    key={art.id}
                    className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 hover:border-slate-700 transition-all flex flex-col justify-between space-y-4 group"
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
                        <span>{art.category || 'Monograph'}</span>
                        <span>{art.readTimeMinutes || 4} min read</span>
                      </div>
                      <h4 className="font-display text-lg font-bold text-white group-hover:text-sky-300 transition-colors leading-snug">
                        {art.title}
                      </h4>
                      {art.excerpt && (
                        <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed font-light">
                          {art.excerpt}
                        </p>
                      )}
                    </div>

                    <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between">
                      <span className="text-xs font-mono font-bold text-amber-400">
                        {isUnlocked ? 'Unlocked' : art.isPaid ? `KES ${(art.priceKes || 1050).toLocaleString()}` : 'Free'}
                      </span>
                      <button
                        onClick={() => {
                          onClose();
                          if (isUnlocked) onReadArticle(art);
                          else onUnlockArticle(art);
                        }}
                        className="px-3.5 py-1.5 rounded-full bg-slate-800 hover:bg-sky-500 hover:text-slate-950 text-slate-200 text-xs font-mono transition-all cursor-pointer"
                      >
                        {isUnlocked ? 'Read Story' : 'Explore'} &rarr;
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 sm:px-8 py-4 border-t border-slate-800/80 bg-slate-950/80 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs font-mono text-slate-500 shrink-0">
          <span>Ink &amp; Witness Narratives &bull; Buy Goods Till 1618656</span>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            Close Catalogue
          </button>
        </div>
      </div>
    </div>
  );
};
