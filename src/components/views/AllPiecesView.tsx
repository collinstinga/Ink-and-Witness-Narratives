import React, { useState, useMemo, useEffect } from 'react';
import { Search, Filter, Plus, BookOpen, Layers, Sparkles } from 'lucide-react';
import { Article, Category } from '../../types.js';
import { ArticleCard } from '../ArticleCard.js';
import { CategoryManagerModal } from '../writer/CategoryManagerModal.js';
import { api } from '../../utils/api.js';

interface AllPiecesViewProps {
  articles: Article[];
  categories?: Category[];
  unlockedTokens: Record<string, any>;
  onReadArticle: (article: Article) => void;
  onUnlockArticle: (article: Article) => void;
  onOpenTip?: (article: Article | null) => void;
  onCategoriesUpdated?: (updated: Category[]) => void;
  onRequestWriterLogin?: () => void;
  selectedCategory?: string;
  onSelectCategory?: (category: string) => void;
  selectedTag?: string | null;
  onSelectTag?: (tag: string | null) => void;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
}

export const AllPiecesView: React.FC<AllPiecesViewProps> = ({
  articles,
  categories: propCategories,
  unlockedTokens,
  onReadArticle,
  onUnlockArticle,
  onOpenTip,
  onCategoriesUpdated,
  onRequestWriterLogin,
  selectedCategory: propCategory,
  onSelectCategory,
  selectedTag: propTag,
  onSelectTag,
  searchQuery: propSearch,
  onSearchChange
}) => {
  const [internalSearchQuery, setInternalSearchQuery] = useState('');
  const [internalCategory, setInternalCategory] = useState('ALL');
  const [internalTag, setInternalTag] = useState<string | null>(null);
  const [customCategories, setCustomCategories] = useState<Category[]>(propCategories || []);
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);

  const activeCategory = propCategory !== undefined ? propCategory : internalCategory;
  const activeTag = propTag !== undefined ? propTag : internalTag;
  const activeSearch = propSearch !== undefined ? propSearch : internalSearchQuery;

  const handleCategoryClick = (cat: string) => {
    if (onSelectCategory) {
      onSelectCategory(cat);
    } else {
      setInternalCategory(cat);
      setInternalTag(null);
    }
  };

  const handleTagClear = () => {
    if (onSelectTag) {
      onSelectTag(null);
    } else {
      setInternalTag(null);
    }
  };

  const handleSearchUpdate = (val: string) => {
    if (onSearchChange) {
      onSearchChange(val);
    } else {
      setInternalSearchQuery(val);
    }
  };

  // Sync or fetch custom categories
  useEffect(() => {
    if (propCategories && propCategories.length > 0) {
      setCustomCategories(propCategories);
    } else {
      api.getCategories()
        .then(cats => setCustomCategories(cats || []))
        .catch(() => {});
    }
  }, [propCategories]);

  const handleCategoriesUpdated = (updated: Category[]) => {
    setCustomCategories(updated);
    if (onCategoriesUpdated) {
      onCategoriesUpdated(updated);
    }
  };

  // Count published articles for each category
  const getCategoryCount = (categoryName: string): number => {
    return articles.filter(a => 
      (a.status === 'published' || !a.status) &&
      (a.category === categoryName || (a.categories && a.categories.includes(categoryName)))
    ).length;
  };

  // Only show categories that have at least one published piece assigned
  const visibleCategories = useMemo(() => {
    return customCategories.filter(cat => getCategoryCount(cat.name) > 0);
  }, [customCategories, articles]);

  // Filtered articles
  const filteredArticles = useMemo(() => {
    return articles.filter(art => {
      const q = activeSearch.toLowerCase().trim();
      const matchesSearch = !q || 
        art.title.toLowerCase().includes(q) ||
        (art.subtitle && art.subtitle.toLowerCase().includes(q)) ||
        art.excerpt.toLowerCase().includes(q) ||
        (art.category && art.category.toLowerCase().includes(q)) ||
        (art.categories && art.categories.some(c => c.toLowerCase().includes(q))) ||
        art.tags.some(t => t.toLowerCase().includes(q));

      const matchesCategory = 
        activeCategory === 'ALL' || 
        art.category === activeCategory ||
        (art.categories && art.categories.includes(activeCategory));

      const matchesTag = !activeTag || art.tags.includes(activeTag);

      return matchesSearch && matchesCategory && matchesTag;
    });
  }, [articles, activeSearch, activeCategory, activeTag]);

  return (
    <div id="all-pieces-view" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-28 pb-20 sm:pt-36 sm:pb-28">
      
      {/* Page Header */}
      <div className="text-center max-w-3xl mx-auto mb-10 sm:mb-14">
        <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-slate-900 border border-slate-800 text-xs font-mono text-sky-400 mb-3">
          <BookOpen className="w-3.5 h-3.5" />
          <span>COMPLETE ARCHIVE</span>
        </div>
        <h1 className="font-display text-3xl sm:text-5xl font-bold text-white tracking-tight">
          Explore Pieces
        </h1>
        <p className="text-slate-400 text-sm sm:text-base mt-3 leading-relaxed">
          The complete published library of stories, essays, and personal reflections.
        </p>
      </div>

      {/* Filter and Search Bar */}
      <div className="mb-10 space-y-4 max-w-5xl mx-auto">
        <div className="flex flex-col sm:flex-row items-center gap-3">
          {/* Search Field */}
          <div className="relative w-full sm:flex-1">
            <Search className="w-4 h-4 text-slate-500 absolute left-4 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              id="search-all-pieces"
              value={activeSearch}
              onChange={(e) => handleSearchUpdate(e.target.value)}
              placeholder="Search pieces by title, theme, or keyword..."
              className="w-full pl-11 pr-4 py-3 rounded-2xl bg-slate-900/90 border border-slate-800 text-white placeholder-slate-500 text-xs sm:text-sm focus:outline-none focus:border-sky-500 transition-colors"
            />
            {activeSearch && (
              <button
                onClick={() => handleSearchUpdate('')}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs text-slate-500 hover:text-slate-300 font-mono cursor-pointer"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Categories Bar */}
        <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-thin">
          <span className="text-[11px] font-mono uppercase text-slate-400 flex items-center gap-1 pl-1 pr-2 shrink-0">
            <Filter className="w-3 h-3 text-sky-400" />
            <span>CATEGORY:</span>
          </span>

          {/* [ALL] Category button */}
          <button
            id="category-pill-all"
            onClick={() => handleCategoryClick('ALL')}
            className={`text-xs font-mono px-3.5 py-1.5 rounded-xl border transition-all shrink-0 cursor-pointer ${
              activeCategory === 'ALL'
                ? 'bg-sky-600 border-sky-500 text-white font-semibold shadow-sm'
                : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
            }`}
          >
            ALL
          </button>

          {/* Custom Categories with published pieces */}
          {visibleCategories.map((cat) => (
            <button
              key={cat.id}
              id={`category-pill-${cat.id}`}
              onClick={() => handleCategoryClick(cat.name)}
              className={`text-xs font-mono px-3.5 py-1.5 rounded-xl border transition-all shrink-0 cursor-pointer ${
                activeCategory === cat.name
                  ? 'bg-sky-600 border-sky-500 text-white font-semibold shadow-sm'
                  : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
              }`}
            >
              {cat.name}
            </button>
          ))}

          {/* + Add Category Button */}
          <button
            id="add-category-btn-search"
            onClick={() => setIsCategoryModalOpen(true)}
            className="inline-flex items-center gap-1.5 text-xs font-mono px-3 py-1.5 rounded-xl bg-slate-900/90 hover:bg-sky-950/60 border border-dashed border-sky-500/50 hover:border-sky-400 text-sky-300 hover:text-sky-200 transition-all shrink-0 cursor-pointer ml-1"
            title="Manage or create custom categories"
          >
            <Plus className="w-3.5 h-3.5 text-sky-400" />
            <span>+ Add Category</span>
          </button>
        </div>

        {/* Active Tag Filter Reset if any */}
        {activeTag && (
          <div className="flex items-center gap-2 text-xs text-sky-400 font-mono bg-sky-950/50 px-3 py-1.5 rounded-xl border border-sky-900/60 w-fit">
            <span>Filtered by tag: #{activeTag}</span>
            <button
              onClick={handleTagClear}
              className="text-slate-400 hover:text-white font-bold ml-1 cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {/* Pieces Grid */}
      {filteredArticles.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-7">
          {filteredArticles.map((article) => (
            <ArticleCard
              key={article.id}
              article={article}
              isUnlocked={Boolean(unlockedTokens[article.id] || article.isUnlocked)}
              onRead={onReadArticle}
              onUnlock={onUnlockArticle}
              onTipAuthor={onOpenTip ? () => onOpenTip(article) : undefined}
              onSelectTag={(tag) => {
                if (onSelectTag) {
                  onSelectTag(tag);
                } else {
                  setInternalTag(tag);
                }
              }}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-20 bg-slate-900/40 rounded-3xl border border-slate-800/80 max-w-2xl mx-auto p-8">
          <Layers className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <h3 className="text-lg font-display font-semibold text-slate-200 mb-2">
            No pieces found matching your criteria
          </h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto mb-6">
            Try adjusting your search query or selecting &quot;ALL&quot; categories to view the full library.
          </p>
          <button
            onClick={() => {
              handleSearchUpdate('');
              handleCategoryClick('ALL');
              handleTagClear();
            }}
            className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-mono text-xs cursor-pointer transition-colors"
          >
            Reset Filters
          </button>
        </div>
      )}

      {/* Category Manager Modal */}
      <CategoryManagerModal
        isOpen={isCategoryModalOpen}
        onClose={() => setIsCategoryModalOpen(false)}
        categories={customCategories}
        articles={articles}
        onCategoriesUpdated={handleCategoriesUpdated}
        onRequestWriterLogin={onRequestWriterLogin}
      />
    </div>
  );
};

