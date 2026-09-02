import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  ChevronLeft, 
  ChevronRight, 
  Clock, 
  Calendar, 
  Smartphone, 
  CheckCircle2, 
  FileText, 
  BookOpen,
  ArrowRight
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Article } from '../types.js';

interface HorizontalPieceCarouselProps {
  id: string;
  articles: Article[];
  unlockedTokens: Record<string, any>;
  onReadArticle: (article: Article) => void;
  onUnlockArticle: (article: Article) => void;
  onSelectTag?: (tag: string) => void;
  emptyMessage?: string;
}

export const HorizontalPieceCarousel: React.FC<HorizontalPieceCarouselProps> = ({
  id,
  articles,
  unlockedTokens,
  onReadArticle,
  onUnlockArticle,
  onSelectTag,
  emptyMessage = "No pieces currently available in this section."
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [direction, setDirection] = useState<number>(0); // 1 = right (next), -1 = left (prev)
  const containerRef = useRef<HTMLDivElement>(null);

  // Keep index in bounds if articles change
  useEffect(() => {
    if (currentIndex >= articles.length) {
      setCurrentIndex(Math.max(0, articles.length - 1));
    }
  }, [articles.length, currentIndex]);

  const total = articles.length;

  const handlePrev = useCallback(() => {
    if (total <= 1) return;
    setDirection(-1);
    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : total - 1));
  }, [total]);

  const handleNext = useCallback(() => {
    if (total <= 1) return;
    setDirection(1);
    setCurrentIndex((prev) => (prev < total - 1 ? prev + 1 : 0));
  }, [total]);

  const handleGoTo = (index: number) => {
    if (index === currentIndex) return;
    setDirection(index > currentIndex ? 1 : -1);
    setCurrentIndex(index);
  };

  // Touch Swipe Handling (robust, preventing vertical scroll interference)
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const touchEndX = useRef<number | null>(null);
  const touchEndY = useRef<number | null>(null);
  const isSwipingHorizontal = useRef<boolean>(false);

  const minSwipeDistance = 45; // pixels required to trigger single-card step

  const onTouchStart = (e: React.TouchEvent) => {
    if (e.targetTouches.length !== 1) return;
    const clientX = e.targetTouches[0].clientX;
    const clientY = e.targetTouches[0].clientY;

    // Android/browser edge-back gesture threshold:
    // If the touch initiates within 28px of either screen bezel edge, allow the system back-swipe gesture
    // to function natively without carousel conflict.
    const screenWidth = typeof window !== 'undefined' ? window.innerWidth : 400;
    if (clientX <= 28 || clientX >= screenWidth - 28) {
      touchStartX.current = null;
      touchStartY.current = null;
      touchEndX.current = null;
      touchEndY.current = null;
      isSwipingHorizontal.current = false;
      return;
    }

    touchStartX.current = clientX;
    touchStartY.current = clientY;
    touchEndX.current = null;
    touchEndY.current = null;
    isSwipingHorizontal.current = false;
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    
    const currentX = e.targetTouches[0].clientX;
    const currentY = e.targetTouches[0].clientY;
    const diffX = Math.abs(currentX - touchStartX.current);
    const diffY = Math.abs(currentY - touchStartY.current);

    // If horizontal motion exceeds vertical motion early on, lock into horizontal swipe
    if (diffX > 10 && diffX > diffY) {
      isSwipingHorizontal.current = true;
    }

    touchEndX.current = currentX;
    touchEndY.current = currentY;
  };

  const onTouchEnd = () => {
    if (touchStartX.current === null || touchEndX.current === null) return;
    
    const distanceX = touchStartX.current - touchEndX.current;
    const distanceY = (touchStartY.current || 0) - (touchEndY.current || 0);

    // Only swipe if predominantly horizontal and meets minimum threshold
    if (Math.abs(distanceX) > Math.abs(distanceY) && Math.abs(distanceX) > minSwipeDistance) {
      if (distanceX > 0) {
        // Swiped Left -> Next piece
        handleNext();
      } else {
        // Swiped Right -> Previous piece
        handlePrev();
      }
    }

    touchStartX.current = null;
    touchStartY.current = null;
    touchEndX.current = null;
    touchEndY.current = null;
    isSwipingHorizontal.current = false;
  };

  // Keyboard navigation when carousel is focused
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      handlePrev();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      handleNext();
    }
  };

  if (total === 0) {
    return (
      <div className="p-8 text-center bg-slate-900/40 rounded-2xl border border-slate-800 text-xs text-slate-400 font-mono">
        {emptyMessage}
      </div>
    );
  }

  const activePiece = articles[currentIndex];
  const isUnlocked = Boolean(unlockedTokens[activePiece.id] || activePiece.isUnlocked);

  // Animation variants for smooth horizontal slide transition
  const slideVariants = {
    enter: (dir: number) => ({
      x: dir > 0 ? 80 : dir < 0 ? -80 : 0,
      opacity: 0,
      scale: 0.98
    }),
    center: {
      x: 0,
      opacity: 1,
      scale: 1,
      transition: {
        x: { type: 'spring', stiffness: 320, damping: 32 },
        opacity: { duration: 0.25 },
        scale: { duration: 0.25 }
      }
    },
    exit: (dir: number) => ({
      x: dir > 0 ? -80 : 80,
      opacity: 0,
      scale: 0.98,
      transition: {
        x: { type: 'spring', stiffness: 320, damping: 32 },
        opacity: { duration: 0.2 },
        scale: { duration: 0.2 }
      }
    })
  };

  return (
    <div 
      id={id}
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      className="relative w-full max-w-2xl mx-auto focus:outline-none select-none touch-pan-y"
      aria-roledescription="carousel"
      aria-label="Editorial Pieces Carousel"
    >
      {/* Top Carousel Navigation & Status Bar */}
      <div className="flex items-center justify-between gap-3 mb-4 px-1">
        
        {/* Position Counter (e.g. 1 / 4) */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono tracking-wider px-2.5 py-1 rounded-md bg-slate-900/90 border border-slate-800 text-slate-300">
            <span className="text-sky-400 font-bold">{currentIndex + 1}</span>
            <span className="text-slate-500 mx-1">/</span>
            <span className="text-slate-400">{total}</span>
          </span>
          <span className="hidden sm:inline-block text-[10px] font-mono text-slate-500">
            Swipe left/right or use arrows
          </span>
        </div>

        {/* Previous / Next Controls */}
        <div className="flex items-center gap-1.5">
          <button
            id={`${id}-prev-btn`}
            type="button"
            onClick={handlePrev}
            disabled={total <= 1}
            aria-label="Previous Piece"
            title="Previous Piece (←)"
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-900/90 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 hover:border-slate-700 transition-all text-xs font-mono disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-sm active:scale-95"
          >
            <ChevronLeft className="w-4 h-4 text-sky-400" />
            <span className="hidden xs:inline">Prev</span>
          </button>

          <button
            id={`${id}-next-btn`}
            type="button"
            onClick={handleNext}
            disabled={total <= 1}
            aria-label="Next Piece"
            title="Next Piece (→)"
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-900/90 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 hover:border-slate-700 transition-all text-xs font-mono disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-sm active:scale-95"
          >
            <span className="hidden xs:inline">Next</span>
            <ChevronRight className="w-4 h-4 text-sky-400" />
          </button>
        </div>
      </div>

      {/* Main Single-Piece View Stage */}
      <div className="relative overflow-hidden min-h-[460px] sm:min-h-[500px]">
        <AnimatePresence initial={false} custom={direction} mode="wait">
          <motion.div
            key={activePiece.id}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            className="w-full"
          >
            <article 
              id={`carousel-card-${activePiece.id}`}
              className={`group rounded-2xl flex flex-col justify-between overflow-hidden transition-all duration-300 ${
                isUnlocked
                  ? 'bg-gradient-to-b from-slate-900/95 via-[#0e1628] to-[#0b101b] border border-sky-500/40 shadow-2xl shadow-sky-950/30'
                  : 'bg-gradient-to-b from-[#0f172a]/95 via-[#0c1220] to-[#080d1a] border border-slate-800/90 shadow-2xl shadow-black/60'
              }`}
            >
              {/* Cover Thumbnail with overlay and badges */}
              <div 
                onClick={() => onReadArticle(activePiece)}
                className="relative h-56 sm:h-64 w-full overflow-hidden bg-slate-950 cursor-pointer"
              >
                <img 
                  src={activePiece.coverImage || "https://images.unsplash.com/photo-1455390582262-044cdead277a?auto=format&fit=crop&w=800&q=80"}
                  alt={activePiece.title}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover object-center group-hover:scale-105 transition-transform duration-700 opacity-80 group-hover:opacity-95"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#0f172a] via-[#0f172a]/40 to-transparent" />

                {/* Top Badges */}
                <div className="absolute top-3.5 left-3.5 right-3.5 flex items-center justify-between pointer-events-none">
                  <span className="text-[11px] font-mono font-medium px-2.5 py-1 rounded-md bg-slate-950/90 border border-slate-700 text-sky-400 backdrop-blur-md shadow-sm">
                    {activePiece.category || 'Editorial Piece'}
                  </span>

                  {isUnlocked ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-mono font-semibold px-2.5 py-1 rounded-md bg-sky-950/90 border border-sky-500/50 text-sky-300 backdrop-blur-md shadow-sm">
                      <CheckCircle2 className="w-3.5 h-3.5 text-sky-400" />
                      <span>UNLOCKED</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[11px] font-mono font-bold px-2.5 py-1 rounded-md bg-emerald-950/90 border border-emerald-500/50 text-emerald-300 backdrop-blur-md shadow-sm">
                      <Smartphone className="w-3.5 h-3.5 text-emerald-400" />
                      <span>KES {activePiece.priceKes}</span>
                    </span>
                  )}
                </div>

                {/* Cover Subtle Swipe Indicator on Mobile */}
                <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between text-[11px] font-mono text-slate-400 pointer-events-none">
                  <span className="flex items-center gap-1 bg-slate-950/80 px-2 py-0.5 rounded border border-slate-800/80 backdrop-blur-sm">
                    <Clock className="w-3 h-3 text-slate-400" />
                    <span>{activePiece.readTimeMinutes || 5} min read</span>
                  </span>
                  <span className="flex items-center gap-1 bg-slate-950/80 px-2 py-0.5 rounded border border-slate-800/80 backdrop-blur-sm">
                    <Calendar className="w-3 h-3 text-slate-400" />
                    <span>{activePiece.publishedAt}</span>
                  </span>
                </div>
              </div>

              {/* Body Details */}
              <div className="p-6 sm:p-7 flex-1 flex flex-col justify-between space-y-5">
                <div className="space-y-3">
                  
                  {/* Title */}
                  <h3 
                    onClick={() => onReadArticle(activePiece)}
                    className="font-display font-bold text-xl sm:text-2xl text-slate-100 hover:text-sky-300 transition-colors leading-tight cursor-pointer"
                  >
                    {activePiece.title}
                  </h3>

                  {/* Subtitle */}
                  {activePiece.subtitle && (
                    <p className="font-serif italic text-sm sm:text-base text-slate-300/90 font-light leading-relaxed">
                      {activePiece.subtitle}
                    </p>
                  )}

                  {/* Excerpt */}
                  <p className="text-xs sm:text-sm text-slate-300/80 leading-relaxed font-sans line-clamp-3">
                    {activePiece.excerpt}
                  </p>

                  {/* Tags */}
                  {activePiece.tags && activePiece.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {activePiece.tags.slice(0, 4).map((tag, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (onSelectTag) onSelectTag(tag);
                          }}
                          className={`text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800/80 hover:bg-sky-950/80 text-slate-400 hover:text-sky-300 border border-slate-700/60 transition-colors ${
                            onSelectTag ? 'cursor-pointer' : ''
                          }`}
                        >
                          #{tag}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Primary Action Button */}
                <div className="pt-4 border-t border-slate-800/80">
                  {isUnlocked ? (
                    <button
                      id={`carousel-btn-read-${activePiece.id}`}
                      type="button"
                      onClick={() => onReadArticle(activePiece)}
                      className="w-full py-3 px-5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold tracking-wide transition-all flex items-center justify-center gap-2 shadow-lg shadow-sky-950/40 cursor-pointer active:scale-[0.99]"
                    >
                      <BookOpen className="w-4 h-4" />
                      <span>Read Complete Piece</span>
                    </button>
                  ) : (
                    <button
                      id={`carousel-btn-unlock-${activePiece.id}`}
                      type="button"
                      onClick={() => onUnlockArticle(activePiece)}
                      className="w-full py-3 px-5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold tracking-wide transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/40 cursor-pointer active:scale-[0.99]"
                    >
                      <Smartphone className="w-4 h-4 text-emerald-200" />
                      <span>Pay to Read — KSh {activePiece.priceKes}</span>
                    </button>
                  )}
                </div>

              </div>
            </article>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Bottom Dot Pagination Indicator */}
      {total > 1 && (
        <div className="flex items-center justify-center gap-2 pt-4 pb-2">
          {articles.map((art, idx) => {
            const isActive = idx === currentIndex;
            return (
              <button
                key={art.id || idx}
                id={`${id}-dot-${idx}`}
                type="button"
                onClick={() => handleGoTo(idx)}
                aria-label={`Go to piece ${idx + 1}: ${art.title}`}
                title={`Piece ${idx + 1}: ${art.title}`}
                className={`transition-all duration-300 rounded-full cursor-pointer ${
                  isActive
                    ? 'w-6 h-2 bg-sky-400 shadow-sm shadow-sky-500/50'
                    : 'w-2 h-2 bg-slate-700 hover:bg-slate-500'
                }`}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};
