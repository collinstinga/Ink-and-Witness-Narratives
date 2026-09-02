import React, { useRef, useState, useEffect } from 'react';
import { 
  Compass, 
  ChevronLeft, 
  ChevronRight, 
  BookOpen, 
  Sparkles, 
  Flame, 
  Heart, 
  Eye, 
  Feather,
  Layers,
  ArrowUpRight
} from 'lucide-react';
import { Topic, Article } from '../types.js';
import { api } from '../utils/api.js';
import { INITIAL_SEED_TOPICS } from '../data/seedTopics.js';

interface TopicCatalogueSectionProps {
  articles: Article[];
  onSelectTopic: (topic: Topic) => void;
  selectedTopicSlug?: string | null;
}

// Visual accent icons for topics
const getTopicIcon = (slug: string, name: string) => {
  const s = slug.toLowerCase();
  const n = name.toLowerCase();
  if (s.includes('erotica') || n.includes('erotica') || s.includes('desire') || s.includes('lust')) {
    return <Flame className="w-4 h-4 text-amber-400" />;
  }
  if (s.includes('love') || s.includes('heart') || s.includes('intimacy') || n.includes('love')) {
    return <Heart className="w-4 h-4 text-rose-400" />;
  }
  if (s.includes('power') || s.includes('ambition') || s.includes('influence')) {
    return <Sparkles className="w-4 h-4 text-sky-400" />;
  }
  if (s.includes('memory') || s.includes('time') || s.includes('past')) {
    return <Compass className="w-4 h-4 text-indigo-400" />;
  }
  if (s.includes('nature') || s.includes('identity') || s.includes('self') || s.includes('becoming')) {
    return <Eye className="w-4 h-4 text-emerald-400" />;
  }
  return <Feather className="w-4 h-4 text-amber-300" />;
};

export const TopicCatalogueSection: React.FC<TopicCatalogueSectionProps> = ({
  articles,
  onSelectTopic,
  selectedTopicSlug
}) => {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState<boolean>(false);
  const [canScrollRight, setCanScrollRight] = useState<boolean>(true);

  // Load live topics from API
  useEffect(() => {
    let isMounted = true;
    const loadTopics = async () => {
      try {
        setLoading(true);
        const data = await api.getTopics(false);
        if (isMounted && Array.isArray(data)) {
          setTopics(data);
        }
      } catch (err) {
        console.warn('Could not load topics from server:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadTopics();
    return () => { isMounted = false; };
  }, []);

  // Update scroll navigation states
  const checkScroll = () => {
    if (!scrollContainerRef.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = scrollContainerRef.current;
    setCanScrollLeft(scrollLeft > 10);
    setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 10);
  };

  useEffect(() => {
    checkScroll();
    window.addEventListener('resize', checkScroll);
    return () => window.removeEventListener('resize', checkScroll);
  }, [topics]);

  const scroll = (direction: 'left' | 'right') => {
    if (!scrollContainerRef.current) return;
    const scrollAmount = Math.min(scrollContainerRef.current.clientWidth * 0.75, 420);
    scrollContainerRef.current.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth'
    });
    setTimeout(checkScroll, 350);
  };

  // Count published articles explicitly assigned to each topic
  const getTopicArticleCount = (topic: Topic): number => {
    const publishedPieces = articles.filter(a => a.status === 'published' || !a.status);
    const pieceIds = topic.pieceIds || [];
    const directMatches = publishedPieces.filter(a => 
      pieceIds.includes(a.id) ||
      (a.topics && (a.topics.includes(topic.slug) || a.topics.includes(topic.name) || a.topics.includes(topic.id)))
    );
    return directMatches.length;
  };

  const handleTopicClick = (topic: Topic) => {
    try {
      api.trackInteraction('view', undefined, topic.name, {
        type: 'topic_click',
        topicId: topic.id,
        topicSlug: topic.slug,
        topicName: topic.name
      }).catch(() => {});
    } catch {
      // ignore
    }
    onSelectTopic(topic);
  };

  // ONLY display a category if at least ONE actual published piece has been explicitly assigned
  const visibleTopics = topics
    .filter(t => t.homepageVisible !== false)
    .filter(t => getTopicArticleCount(t) > 0);

  if (visibleTopics.length === 0) {
    return null;
  }

  return (
    <section 
      id="home-topic-catalogue" 
      aria-label="Reader Topic Catalogue"
      className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4 pb-2 relative select-none"
    >
      {/* Editorial Section Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-6 border-b border-slate-800/80 pb-4">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-sky-400">
            <Compass className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            <span>Reader Topic Catalogue</span>
          </div>
          
          <h2 className="font-display text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight text-white uppercase">
            FIND WHAT SPEAKS TO YOU
          </h2>
          
          <p className="font-serif italic text-sm sm:text-base text-slate-300 font-light">
            Choose a subject. Stay for the story.
          </p>
        </div>

        {/* Scroll Controls (Desktop & Mobile) */}
        <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
          <button
            id="topic-scroll-left-btn"
            onClick={() => scroll('left')}
            disabled={!canScrollLeft}
            aria-label="Scroll topics left"
            className={`p-2 rounded-full border transition-all cursor-pointer ${
              canScrollLeft
                ? 'border-slate-700 bg-slate-900 text-slate-200 hover:text-white hover:border-slate-500 shadow-md hover:bg-slate-800'
                : 'border-slate-800/50 bg-slate-950/40 text-slate-600 opacity-40 cursor-not-allowed'
            }`}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <button
            id="topic-scroll-right-btn"
            onClick={() => scroll('right')}
            disabled={!canScrollRight}
            aria-label="Scroll topics right"
            className={`p-2 rounded-full border transition-all cursor-pointer ${
              canScrollRight
                ? 'border-slate-700 bg-slate-900 text-slate-200 hover:text-white hover:border-slate-500 shadow-md hover:bg-slate-800'
                : 'border-slate-800/50 bg-slate-950/40 text-slate-600 opacity-40 cursor-not-allowed'
            }`}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Horizontal Carousel of Topic Cards */}
      <div className="relative">
        <div 
          ref={scrollContainerRef}
          onScroll={checkScroll}
          className="flex items-stretch gap-3.5 sm:gap-4 overflow-x-auto scrollbar-none scroll-smooth pb-3 px-1"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {visibleTopics.map((topic, index) => {
            const count = getTopicArticleCount(topic);
            const isSelected = selectedTopicSlug === topic.slug;
            const icon = getTopicIcon(topic.slug, topic.name);

            return (
              <button
                key={topic.id || topic.slug}
                id={`topic-pill-${topic.slug}`}
                onClick={() => handleTopicClick(topic)}
                className={`group relative flex-none w-[240px] sm:w-[270px] text-left p-4 sm:p-5 rounded-2xl border transition-all duration-300 flex flex-col justify-between cursor-pointer ${
                  isSelected
                    ? 'bg-gradient-to-b from-sky-950/70 to-slate-900 border-sky-500/80 shadow-[0_0_24px_rgba(56,189,248,0.25)] ring-1 ring-sky-400/50'
                    : 'bg-slate-900/60 hover:bg-slate-900 border-slate-800 hover:border-slate-700 shadow-lg hover:shadow-xl hover:-translate-y-0.5'
                }`}
              >
                {/* Top Row: Icon + Story Count Badge */}
                <div className="flex items-center justify-between w-full mb-3">
                  <div className="p-2 rounded-xl bg-slate-950/80 border border-slate-800 text-slate-300 group-hover:border-slate-700 group-hover:scale-105 transition-all">
                    {icon}
                  </div>

                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-mono bg-slate-950/80 border border-slate-800 text-slate-400 group-hover:text-slate-200">
                    <BookOpen className="w-3 h-3 text-sky-400/70" />
                    <span>{count > 0 ? `${count} ${count === 1 ? 'piece' : 'pieces'}` : 'Archive'}</span>
                  </span>
                </div>

                {/* Middle: Topic Name & Literary Description */}
                <div className="space-y-1.5 mb-4 flex-1">
                  <h3 className="font-display text-lg sm:text-xl font-bold text-white group-hover:text-sky-300 transition-colors flex items-center justify-between gap-1 leading-snug">
                    <span>{topic.name}</span>
                    <ArrowUpRight className="w-4 h-4 opacity-0 group-hover:opacity-100 text-sky-400 transition-all shrink-0 -translate-x-1 group-hover:translate-x-0" />
                  </h3>
                  
                  {topic.description && (
                    <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed font-sans font-light">
                      {topic.description}
                    </p>
                  )}
                </div>

                {/* Bottom: Action Cue */}
                <div className="pt-2 border-t border-slate-800/60 flex items-center justify-between text-[11px] font-mono text-slate-400 group-hover:text-sky-400 transition-colors">
                  <span>Explore stories</span>
                  <span className="text-xs font-serif italic opacity-60 group-hover:opacity-100">&rarr;</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
};
