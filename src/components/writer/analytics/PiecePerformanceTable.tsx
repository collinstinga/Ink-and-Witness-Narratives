import React, { useState } from 'react';
import { 
  FileText, 
  Search, 
  ArrowUpDown, 
  Download, 
  Eye, 
  Edit3, 
  ShoppingBag, 
  Heart, 
  CheckCircle2, 
  Clock, 
  Award, 
  Flame,
  ArrowUpRight
} from 'lucide-react';
import { PiecePerformanceItem, Article } from '../../../types.js';

interface PiecePerformanceTableProps {
  pieces: PiecePerformanceItem[];
  articles: Article[];
  onEditPiece?: (piece: Article) => void;
  onPreviewPiece?: (piece: Article) => void;
}

export const PiecePerformanceTable: React.FC<PiecePerformanceTableProps> = ({
  pieces = [],
  articles = [],
  onEditPiece,
  onPreviewPiece
}) => {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortField, setSortField] = useState<keyof PiecePerformanceItem>('revenueKes');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  // Categories list
  const categories = ['all', ...Array.from(new Set(pieces.map(p => p.category).filter(Boolean)))];

  // Filtering
  const filtered = pieces.filter(item => {
    if (categoryFilter !== 'all' && item.category.toLowerCase() !== categoryFilter.toLowerCase()) {
      return false;
    }
    if (statusFilter !== 'all' && item.status !== statusFilter) {
      return false;
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        item.title.toLowerCase().includes(q) ||
        item.slug.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Sorting
  const sorted = [...filtered].sort((a, b) => {
    let valA = a[sortField];
    let valB = b[sortField];

    if (typeof valA === 'string') {
      valA = valA.toLowerCase();
      valB = (valB as string).toLowerCase();
    }

    if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
    if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  const handleSort = (field: keyof PiecePerformanceItem) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  // CSV Export for Piece Analytics
  const handleExportPiecesCsv = () => {
    const headers = [
      'Piece Title', 
      'Slug', 
      'Category', 
      'Status', 
      'Price (KES)', 
      'Views', 
      'Preview Reads', 
      'Purchases', 
      'Conversion Rate (%)', 
      'Sales Revenue (KES)', 
      'Tips Total (KES)', 
      'Total Gross (KES)', 
      'Published Date'
    ];

    const rows = sorted.map(p => [
      `"${p.title.replace(/"/g, '""')}"`,
      `"${p.slug}"`,
      `"${p.category}"`,
      p.status,
      p.priceKes,
      p.viewsCount,
      p.previewCount,
      p.purchasesCount,
      p.conversionRate,
      p.revenueKes,
      p.tipsTotalKes,
      p.totalGrossKes,
      `"${p.publishedAt || ''}"`
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ink-and-witness-pieces-performance-${Date.now()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div id="analytics-piece-performance-table" className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-6">
      
      {/* Top Header & Search/Filter Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-sky-400 mb-1">
            <FileText className="w-4 h-4" />
            <span>Monograph Performance &amp; Unit Economics</span>
          </div>
          <h3 className="font-serif font-bold text-xl text-white">
            Comprehensive Piece Performance
          </h3>
          <p className="text-xs text-slate-400 font-sans mt-0.5">
            Real-time reader interest, conversion rates, confirmed sales, and reader tip totals across your entire published repertoire.
          </p>
        </div>

        {/* Action button */}
        <button
          onClick={handleExportPiecesCsv}
          className="px-3.5 py-2 rounded-xl bg-slate-950 hover:bg-slate-850 border border-slate-700 text-slate-200 hover:text-white text-xs font-mono font-medium inline-flex items-center gap-2 transition-colors cursor-pointer self-start lg:self-auto"
        >
          <Download className="w-3.5 h-3.5 text-sky-400" />
          <span>Export Pieces CSV</span>
        </button>
      </div>

      {/* Filter Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search piece title or slug..."
            className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs font-sans text-white focus:outline-none focus:border-sky-500 placeholder:text-slate-500"
          />
        </div>

        {/* Category filter */}
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-200 focus:outline-none focus:border-sky-500"
        >
          {categories.map(cat => (
            <option key={cat} value={cat}>
              {cat === 'all' ? 'All Categories' : cat}
            </option>
          ))}
        </select>

        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-200 focus:outline-none focus:border-sky-500"
        >
          <option value="all">All Statuses</option>
          <option value="published">Published</option>
          <option value="draft">Drafts</option>
        </select>
      </div>

      {/* Table */}
      <div className="overflow-x-auto border border-slate-800 rounded-xl">
        <table className="w-full text-left text-xs font-sans">
          <thead className="bg-[#090e1a] text-slate-400 font-mono uppercase tracking-wider text-[10px] border-b border-slate-800 select-none">
            <tr>
              <th 
                className="py-3 px-4 font-medium cursor-pointer hover:text-white"
                onClick={() => handleSort('title')}
              >
                <div className="flex items-center gap-1.5">
                  <span>Monograph Title</span>
                  <ArrowUpDown className="w-3 h-3 text-slate-500" />
                </div>
              </th>

              <th 
                className="py-3 px-3 font-medium cursor-pointer hover:text-white text-center"
                onClick={() => handleSort('status')}
              >
                <div className="flex items-center justify-center gap-1">
                  <span>Status</span>
                  <ArrowUpDown className="w-3 h-3 text-slate-500" />
                </div>
              </th>

              <th 
                className="py-3 px-3 font-medium cursor-pointer hover:text-white text-right"
                onClick={() => handleSort('viewsCount')}
              >
                <div className="flex items-center justify-end gap-1">
                  <span>Views</span>
                  <ArrowUpDown className="w-3 h-3 text-slate-500" />
                </div>
              </th>

              <th 
                className="py-3 px-3 font-medium cursor-pointer hover:text-white text-right"
                onClick={() => handleSort('previewCount')}
              >
                <div className="flex items-center justify-end gap-1">
                  <span>Previews</span>
                  <ArrowUpDown className="w-3 h-3 text-slate-500" />
                </div>
              </th>

              <th 
                className="py-3 px-3 font-medium cursor-pointer hover:text-white text-right"
                onClick={() => handleSort('purchasesCount')}
              >
                <div className="flex items-center justify-end gap-1">
                  <span>Sales</span>
                  <ArrowUpDown className="w-3 h-3 text-slate-500" />
                </div>
              </th>

              <th 
                className="py-3 px-3 font-medium cursor-pointer hover:text-white text-right"
                onClick={() => handleSort('conversionRate')}
              >
                <div className="flex items-center justify-end gap-1">
                  <span>Conv %</span>
                  <ArrowUpDown className="w-3 h-3 text-slate-500" />
                </div>
              </th>

              <th 
                className="py-3 px-3 font-medium cursor-pointer hover:text-white text-right"
                onClick={() => handleSort('revenueKes')}
              >
                <div className="flex items-center justify-end gap-1">
                  <span>Sales (KES)</span>
                  <ArrowUpDown className="w-3 h-3 text-slate-500" />
                </div>
              </th>

              <th 
                className="py-3 px-3 font-medium cursor-pointer hover:text-white text-right"
                onClick={() => handleSort('tipsTotalKes')}
              >
                <div className="flex items-center justify-end gap-1">
                  <span>Tips (KES)</span>
                  <ArrowUpDown className="w-3 h-3 text-slate-500" />
                </div>
              </th>

              <th 
                className="py-3 px-3 font-medium cursor-pointer hover:text-white text-right"
                onClick={() => handleSort('totalGrossKes')}
              >
                <div className="flex items-center justify-end gap-1">
                  <span>Total Gross</span>
                  <ArrowUpDown className="w-3 h-3 text-slate-500" />
                </div>
              </th>

              <th className="py-3 px-4 font-medium text-center">
                Actions
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-800/60 font-mono">
            {sorted.map((item) => {
              const matchedArticle = articles.find(a => a.id === item.articleId);

              return (
                <tr key={item.articleId} className="hover:bg-slate-850/50 transition-colors">
                  {/* Title & Category */}
                  <td className="py-3.5 px-4 font-sans font-medium text-slate-100 max-w-xs">
                    <div className="truncate font-serif font-bold text-white">
                      {item.title}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-[10px] font-mono text-slate-400">
                      <span className="px-1.5 py-0.2 rounded bg-slate-950 border border-slate-800">
                        {item.category}
                      </span>
                      <span>KES {item.priceKes}</span>
                    </div>
                  </td>

                  {/* Status */}
                  <td className="py-3.5 px-3 text-center">
                    {item.status === 'published' ? (
                      <span className="px-2 py-0.5 rounded-full bg-emerald-950/80 border border-emerald-800 text-emerald-400 text-[10px]">
                        Published
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full bg-amber-950/80 border border-amber-800 text-amber-400 text-[10px]">
                        Draft
                      </span>
                    )}
                  </td>

                  {/* Views */}
                  <td className="py-3.5 px-3 text-right text-slate-300">
                    {item.viewsCount.toLocaleString()}
                  </td>

                  {/* Previews */}
                  <td className="py-3.5 px-3 text-right text-slate-400">
                    {item.previewCount.toLocaleString()}
                  </td>

                  {/* Purchases */}
                  <td className="py-3.5 px-3 text-right font-bold text-sky-300">
                    {item.purchasesCount}
                  </td>

                  {/* Conversion */}
                  <td className="py-3.5 px-3 text-right">
                    <span className={`font-bold ${
                      item.conversionRate >= 15 
                        ? 'text-emerald-400' 
                        : item.conversionRate >= 5 
                        ? 'text-sky-400' 
                        : 'text-slate-400'
                    }`}>
                      {item.conversionRate}%
                    </span>
                  </td>

                  {/* Sales KES */}
                  <td className="py-3.5 px-3 text-right font-bold text-emerald-400">
                    KES {item.revenueKes.toLocaleString()}
                  </td>

                  {/* Tips KES */}
                  <td className="py-3.5 px-3 text-right font-bold text-rose-400">
                    KES {item.tipsTotalKes.toLocaleString()}
                  </td>

                  {/* Total Gross */}
                  <td className="py-3.5 px-3 text-right font-bold text-white bg-slate-950/40">
                    KES {item.totalGrossKes.toLocaleString()}
                  </td>

                  {/* Actions */}
                  <td className="py-3.5 px-4 text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      {matchedArticle && onPreviewPiece && (
                        <button
                          onClick={() => onPreviewPiece(matchedArticle)}
                          title="Preview in Reader"
                          className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700 transition-colors cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                      )}

                      {matchedArticle && onEditPiece && (
                        <button
                          onClick={() => onEditPiece(matchedArticle)}
                          title="Edit Piece in Studio"
                          className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700 transition-colors cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}

            {sorted.length === 0 && (
              <tr>
                <td colSpan={10} className="py-8 text-center text-slate-500 font-mono text-xs">
                  No monographs match your current search or filter criteria.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

    </div>
  );
};
