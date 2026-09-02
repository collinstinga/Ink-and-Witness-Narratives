import React, { useState, useMemo, useRef, useEffect } from 'react';
import { 
  Plus, 
  Search, 
  Edit3, 
  Eye, 
  Trash2, 
  Globe, 
  FileEdit, 
  DollarSign, 
  Clock, 
  Tag,
  Lock,
  MoreVertical
} from 'lucide-react';
import { Article } from '../../types.js';

interface WriterPiecesListProps {
  pieces: Article[];
  loading: boolean;
  filterMode?: 'all' | 'drafts' | 'published';
  onNewPiece: () => void;
  onEditPiece: (article: Article) => void;
  onPreviewPiece: (article: Article) => void;
  onTogglePublish: (id: string) => Promise<void>;
  onDeletePiece: (id: string) => Promise<void>;
}

export const WriterPiecesList: React.FC<WriterPiecesListProps> = ({
  pieces,
  loading,
  filterMode = 'all',
  onNewPiece,
  onEditPiece,
  onPreviewPiece,
  onTogglePublish,
  onDeletePiece
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'published' | 'draft'>(
    filterMode === 'drafts' ? 'draft' : (filterMode === 'published' ? 'published' : 'all')
  );
  const [monetizationFilter, setMonetizationFilter] = useState<'all' | 'paid' | 'free'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'price' | 'downloads'>('newest');
  
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const menuRef = useRef<HTMLDivElement | null>(null);

  // Close contextual menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setActiveMenuId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Extract categories
  const categories = useMemo(() => {
    const set = new Set<string>();
    pieces.forEach(p => {
      if (p.category) set.add(p.category);
      if (p.categories && Array.isArray(p.categories)) {
        p.categories.forEach(c => {
          if (c) set.add(c);
        });
      }
    });
    return Array.from(set);
  }, [pieces]);

  // Filtered & Sorted list
  const filteredPieces = useMemo(() => {
    return pieces.filter(piece => {
      // Status filter
      if (statusFilter !== 'all' && piece.status !== statusFilter) return false;
      
      // Monetization filter
      if (monetizationFilter === 'paid' && (!piece.isPaid || piece.priceKes <= 0)) return false;
      if (monetizationFilter === 'free' && piece.isPaid && piece.priceKes > 0) return false;

      // Category filter
      if (categoryFilter !== 'all') {
        const matchesCat = piece.category === categoryFilter || 
          (piece.categories && piece.categories.includes(categoryFilter));
        if (!matchesCat) return false;
      }

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const inTitle = piece.title.toLowerCase().includes(q);
        const inSubtitle = (piece.subtitle || '').toLowerCase().includes(q);
        const inExcerpt = (piece.excerpt || '').toLowerCase().includes(q);
        const inCategory = (piece.category || '').toLowerCase().includes(q) ||
          (piece.categories && piece.categories.some(c => c.toLowerCase().includes(q)));
        const inTags = (piece.tags || []).some(t => t.toLowerCase().includes(q));
        if (!inTitle && !inSubtitle && !inExcerpt && !inCategory && !inTags) {
          return false;
        }
      }

      return true;
    }).sort((a, b) => {
      if (sortBy === 'newest') {
        const dateA = new Date(a.updatedAt || a.createdAt || a.publishedAt || 0).getTime();
        const dateB = new Date(b.updatedAt || b.createdAt || b.publishedAt || 0).getTime();
        return dateB - dateA;
      }
      if (sortBy === 'oldest') {
        const dateA = new Date(a.createdAt || a.publishedAt || 0).getTime();
        const dateB = new Date(b.createdAt || b.publishedAt || 0).getTime();
        return dateA - dateB;
      }
      if (sortBy === 'price') {
        return (b.priceKes || 0) - (a.priceKes || 0);
      }
      if (sortBy === 'downloads') {
        return (b.downloadsCount || 0) - (a.downloadsCount || 0);
      }
      return 0;
    });
  }, [pieces, statusFilter, monetizationFilter, categoryFilter, searchQuery, sortBy]);

  const handleToggle = async (id: string) => {
    setActiveMenuId(null);
    setTogglingId(id);
    try {
      await onTogglePublish(id);
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    setActiveMenuId(null);
    if (confirm('Are you sure you want to permanently delete this piece? This action cannot be undone.')) {
      setDeletingId(id);
      try {
        await onDeletePiece(id);
      } finally {
        setDeletingId(null);
      }
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Header & Primary Action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-serif font-bold text-white tracking-tight">
            {filterMode === 'drafts' ? 'Private Drafts' : (filterMode === 'published' ? 'Published Monographs' : 'My Pieces')}
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            {pieces.length} total pieces in your private catalog ({pieces.filter(p => p.status === 'published').length} published, {pieces.filter(p => p.status === 'draft').length} drafts)
          </p>
        </div>

        <button
          id="btn-new-piece-primary"
          onClick={onNewPiece}
          className="px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-medium text-xs sm:text-sm flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>Write New Piece</span>
        </button>
      </div>

      {/* Filters & Search Bar */}
      <div className="p-4 rounded-xl bg-[#0b1120] border border-slate-800/80 space-y-3">
        <div className="flex flex-col md:flex-row gap-3">
          
          {/* Search */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by title, topic, tags or keywords..."
              className="w-full pl-9 pr-4 py-2 rounded-lg bg-[#080d1a] border border-slate-700/80 text-white placeholder-slate-500 text-xs focus:outline-none focus:border-sky-500 transition-colors"
            />
          </div>

          {/* Status Filter Tabs */}
          <div className="flex items-center gap-1.5 shrink-0 overflow-x-auto pb-1 md:pb-0">
            <button
              onClick={() => setStatusFilter('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono transition-colors cursor-pointer ${
                statusFilter === 'all'
                  ? 'bg-sky-900/80 text-sky-200 border border-sky-700'
                  : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              All ({pieces.length})
            </button>
            <button
              onClick={() => setStatusFilter('published')}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono transition-colors cursor-pointer ${
                statusFilter === 'published'
                  ? 'bg-emerald-900/80 text-emerald-200 border border-emerald-700'
                  : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              Published ({pieces.filter(p => p.status === 'published').length})
            </button>
            <button
              onClick={() => setStatusFilter('draft')}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono transition-colors cursor-pointer ${
                statusFilter === 'draft'
                  ? 'bg-amber-900/80 text-amber-200 border border-amber-700'
                  : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              Drafts ({pieces.filter(p => p.status === 'draft').length})
            </button>
          </div>
        </div>

        {/* Secondary Filters: Monetization, Category, Sort */}
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-800/60 text-xs">
          
          <div className="flex items-center gap-2">
            <span className="text-slate-500 font-mono">Monetization:</span>
            <select
              value={monetizationFilter}
              onChange={(e) => setMonetizationFilter(e.target.value as any)}
              className="bg-[#080d1a] border border-slate-700/80 text-slate-200 rounded-lg px-2.5 py-1 text-xs focus:outline-none focus:border-sky-500"
            >
              <option value="all">All Pricing</option>
              <option value="paid">Pay to Read Only</option>
              <option value="free">Free Only</option>
            </select>
          </div>

          {categories.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-slate-500 font-mono">Category:</span>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="bg-[#080d1a] border border-slate-700/80 text-slate-200 rounded-lg px-2.5 py-1 text-xs focus:outline-none focus:border-sky-500"
              >
                <option value="all">All Categories</option>
                {categories.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          )}

          <div className="flex items-center gap-2 ml-auto">
            <span className="text-slate-500 font-mono">Sort:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="bg-[#080d1a] border border-slate-700/80 text-slate-200 rounded-lg px-2.5 py-1 text-xs focus:outline-none focus:border-sky-500"
            >
              <option value="newest">Recently Edited</option>
              <option value="oldest">Oldest First</option>
              <option value="price">Highest Price</option>
              <option value="downloads">Most Reads</option>
            </select>
          </div>

        </div>
      </div>

      {/* Pieces List with Contextual Actions Menu */}
      {loading ? (
        <div className="space-y-3 animate-pulse">
          {[1, 2, 3, 4].map(n => (
            <div key={n} className="h-24 bg-slate-900/60 rounded-xl border border-slate-800" />
          ))}
        </div>
      ) : filteredPieces.length === 0 ? (
        <div className="p-12 text-center rounded-2xl bg-[#0b1120] border border-slate-800/80 space-y-3">
          <FileEdit className="w-10 h-10 text-slate-600 mx-auto" />
          <h3 className="text-base font-semibold text-slate-300">No matching pieces found</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            {searchQuery ? `No results for "${searchQuery}". Try adjusting your filters.` : 'You have not created any pieces matching this criteria yet.'}
          </p>
          <button
            onClick={onNewPiece}
            className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Create New Piece</span>
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredPieces.map((piece) => {
            const isPublished = piece.status === 'published';
            const isPaid = piece.isPaid !== false && (piece.priceKes > 0);
            const isMenuOpen = activeMenuId === piece.id;

            return (
              <div
                key={piece.id}
                id={`piece-row-${piece.id}`}
                className="p-4 sm:p-5 rounded-xl bg-[#0b1120] border border-slate-800/80 hover:border-slate-700 transition-all group shadow-sm flex items-center justify-between gap-4 relative"
              >
                {/* Left: Metadata, Title & Excerpt (Clickable to Edit) */}
                <div 
                  onClick={() => onEditPiece(piece)}
                  className="flex-1 min-w-0 space-y-2 cursor-pointer"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Status Badge */}
                    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-mono font-medium ${
                      isPublished
                        ? 'bg-emerald-950/90 text-emerald-300 border border-emerald-800/70'
                        : 'bg-amber-950/90 text-amber-300 border border-amber-800/70'
                    }`}>
                      {isPublished ? (
                        <>
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                          Published
                        </>
                      ) : (
                        <>
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                          Private Draft
                        </>
                      )}
                    </span>

                    {/* Monetization Badge */}
                    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-mono ${
                      isPaid
                        ? 'bg-sky-950/90 text-sky-300 border border-sky-800/70'
                        : 'bg-slate-900 text-slate-400 border border-slate-800'
                    }`}>
                      <DollarSign className="w-3 h-3" />
                      {isPaid ? `KES ${piece.priceKes} (Pay to Read)` : 'Free'}
                    </span>

                    {/* Category */}
                    <span className="text-xs text-slate-400 bg-slate-900/60 border border-slate-800 px-2 py-0.5 rounded">
                      {piece.category || 'General'}
                    </span>

                    {/* Read Time */}
                    <span className="text-xs text-slate-500 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {piece.readTimeMinutes || 5} min read
                    </span>
                  </div>

                  {/* Title & Subtitle */}
                  <div>
                    <h2 className="text-base sm:text-lg font-serif font-bold text-white group-hover:text-sky-300 transition-colors">
                      {piece.title}
                    </h2>
                    <p className="text-xs text-slate-400 line-clamp-1 mt-0.5 leading-relaxed">
                      {piece.subtitle || piece.excerpt}
                    </p>
                  </div>

                  {/* Tags & Dates */}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500 font-mono">
                    <span>Updated: {new Date(piece.updatedAt || piece.createdAt || piece.publishedAt || Date.now()).toLocaleDateString()}</span>
                    {piece.downloadsCount ? <span>Downloads: {piece.downloadsCount}</span> : null}
                    
                    {piece.tags && piece.tags.length > 0 && (
                      <span className="text-slate-400 flex items-center gap-1">
                        <Tag className="w-3 h-3" />
                        {piece.tags.slice(0, 3).join(', ')}
                      </span>
                    )}
                  </div>
                </div>

                {/* Right: Contextual Actions Menu "⋮" */}
                <div className="relative shrink-0" ref={isMenuOpen ? menuRef : null}>
                  <button
                    id={`menu-trigger-${piece.id}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveMenuId(isMenuOpen ? null : piece.id);
                    }}
                    className="p-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 transition-colors cursor-pointer"
                    aria-label="Actions menu"
                    title="More actions"
                  >
                    <MoreVertical className="w-4 h-4" />
                  </button>

                  {/* Contextual Dropdown Menu */}
                  {isMenuOpen && (
                    <div 
                      className="absolute right-0 top-full mt-1.5 w-48 rounded-xl bg-[#0f172a] border border-slate-700 shadow-xl shadow-black/60 py-1.5 z-30 divide-y divide-slate-800"
                    >
                      <div className="py-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveMenuId(null);
                            onEditPiece(piece);
                          }}
                          className="w-full px-3.5 py-2 text-left text-xs text-slate-200 hover:text-white hover:bg-slate-800/80 flex items-center gap-2 transition-colors cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5 text-sky-400" />
                          <span>Edit Monograph</span>
                        </button>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveMenuId(null);
                            onPreviewPiece(piece);
                          }}
                          className="w-full px-3.5 py-2 text-left text-xs text-slate-200 hover:text-white hover:bg-slate-800/80 flex items-center gap-2 transition-colors cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5 text-indigo-400" />
                          <span>Preview Reader View</span>
                        </button>
                      </div>

                      <div className="py-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggle(piece.id);
                          }}
                          disabled={togglingId === piece.id}
                          className="w-full px-3.5 py-2 text-left text-xs text-slate-200 hover:text-white hover:bg-slate-800/80 flex items-center gap-2 transition-colors cursor-pointer disabled:opacity-50"
                        >
                          {isPublished ? (
                            <>
                              <Lock className="w-3.5 h-3.5 text-amber-400" />
                              <span>Unpublish to Draft</span>
                            </>
                          ) : (
                            <>
                              <Globe className="w-3.5 h-3.5 text-emerald-400" />
                              <span>Publish to Live Site</span>
                            </>
                          )}
                        </button>
                      </div>

                      <div className="py-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(piece.id);
                          }}
                          disabled={deletingId === piece.id}
                          className="w-full px-3.5 py-2 text-left text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-950/40 flex items-center gap-2 transition-colors cursor-pointer disabled:opacity-50"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Delete Piece</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
};
