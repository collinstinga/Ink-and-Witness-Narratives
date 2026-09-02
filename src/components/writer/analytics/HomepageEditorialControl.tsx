import React, { useState } from 'react';
import { 
  Award, 
  Flame, 
  Sparkles, 
  Check, 
  Save, 
  RefreshCw, 
  Eye, 
  ShoppingBag, 
  Heart, 
  CheckCircle2,
  ChevronRight,
  Sliders
} from 'lucide-react';
import { HomepagePerformanceItem, Article, HomepageConfig } from '../../../types.js';
import { api } from '../../../utils/api.js';

interface HomepageEditorialControlProps {
  homepagePerformance: {
    pieceOfTheWeek?: HomepagePerformanceItem;
    mostSellingPieces: HomepagePerformanceItem[];
    mostSellingMode?: 'auto' | 'manual';
    autoRankedPieces?: HomepagePerformanceItem[];
  };
  articles: Article[];
  onRefresh?: () => void;
}

export const HomepageEditorialControl: React.FC<HomepageEditorialControlProps> = ({
  homepagePerformance,
  articles = [],
  onRefresh
}) => {
  const [mode, setMode] = useState<'auto' | 'manual'>(
    homepagePerformance.mostSellingMode || 'auto'
  );
  const [selectedPotwId, setSelectedPotwId] = useState<string>(
    homepagePerformance.pieceOfTheWeek?.articleId || (articles[0]?.id || '')
  );
  const [manualSlotIds, setManualSlotIds] = useState<string[]>([
    homepagePerformance.mostSellingPieces[0]?.articleId || articles[0]?.id || '',
    homepagePerformance.mostSellingPieces[1]?.articleId || articles[1]?.id || '',
    homepagePerformance.mostSellingPieces[2]?.articleId || articles[2]?.id || '',
  ]);

  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const publishedArticles = articles.filter(a => a.status === 'published');

  const handleSaveHomepageConfig = async () => {
    try {
      setSaving(true);
      // Fetch current config first to preserve background settings
      const current = await api.getAdminHomepageData();
      const newConfig: HomepageConfig = {
        ...(current?.config || {}),
        pieceOfTheWeekId: selectedPotwId,
        mostSellingMode: mode,
        mostSellingPieceIds: manualSlotIds
      };

      await api.saveAdminHomepageData(newConfig);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error('Failed to update homepage editorial settings:', err);
    } finally {
      setSaving(false);
    }
  };

  const currentPotw = publishedArticles.find(a => a.id === selectedPotwId);
  const potwStats = homepagePerformance.pieceOfTheWeek;

  return (
    <div id="analytics-homepage-editorial-control" className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-6">
      
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-amber-400 mb-1">
            <Sliders className="w-4 h-4" />
            <span>Homepage Section Placement &amp; Editorial Control</span>
          </div>
          <h3 className="font-serif font-bold text-xl text-white">
            Curated Placement Performance
          </h3>
          <p className="text-xs text-slate-400 font-sans mt-0.5">
            Manage high-visibility feature slots and choose whether "Most Selling" ranks automatically by verified purchases or writer curation.
          </p>
        </div>

        {/* Save button */}
        <button
          onClick={handleSaveHomepageConfig}
          disabled={saving}
          className={`px-4 py-2 rounded-xl text-xs font-mono font-semibold flex items-center gap-2 transition-all cursor-pointer shadow-md ${
            saveSuccess
              ? 'bg-emerald-600 text-white'
              : 'bg-sky-600 hover:bg-sky-500 text-white shadow-sky-950/40'
          }`}
        >
          {saving ? (
            <>
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span>Saving...</span>
            </>
          ) : saveSuccess ? (
            <>
              <Check className="w-3.5 h-3.5" />
              <span>Placement Updated</span>
            </>
          ) : (
            <>
              <Save className="w-3.5 h-3.5" />
              <span>Save Placements</span>
            </>
          )}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* PIECE OF THE WEEK ROI & CONTROLLER (5 Cols) */}
        <div className="lg:col-span-5 p-5 rounded-xl bg-gradient-to-b from-sky-950/30 to-slate-950/70 border border-sky-900/50 space-y-4 flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-sky-900/80 border border-sky-700/80 text-[10px] font-mono uppercase tracking-wider text-sky-300 font-bold">
                <Award className="w-3.5 h-3.5 text-amber-400" />
                <span>Piece of the Week</span>
              </span>
              <span className="text-xs font-mono text-emerald-400 font-bold">
                KES {(potwStats?.revenueKes || 0).toLocaleString()}
              </span>
            </div>

            {/* Selector */}
            <div className="space-y-1">
              <label className="text-[11px] font-mono text-slate-400">Featured Article:</label>
              <select
                value={selectedPotwId}
                onChange={(e) => setSelectedPotwId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs font-sans text-white focus:outline-none focus:border-sky-500"
              >
                {publishedArticles.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.title} ({a.category}) - KES {a.priceKes}
                  </option>
                ))}
              </select>
            </div>

            {currentPotw && (
              <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-800 space-y-2">
                <h4 className="font-serif font-bold text-sm text-white truncate">
                  {currentPotw.title}
                </h4>
                <p className="text-xs text-slate-400 font-sans line-clamp-2">
                  {currentPotw.subtitle || currentPotw.synopsis || 'Featured editorial centerpiece on the reader homepage.'}
                </p>
                <div className="flex items-center gap-3 text-[11px] font-mono text-slate-400 pt-1 border-t border-slate-800">
                  <span className="text-slate-300">{potwStats?.views || currentPotw.viewsCount || 0} views</span>
                  <span>•</span>
                  <span className="text-emerald-400 font-semibold">{potwStats?.purchases || currentPotw.downloadsCount || 0} sales</span>
                  <span>•</span>
                  <span className="text-rose-400">{potwStats?.tipsCount || 0} tips</span>
                </div>
              </div>
            )}
          </div>

          <p className="text-[10px] font-mono text-slate-500">
            Showcased with dedicated hero typography and gold badge on the homepage.
          </p>
        </div>

        {/* MOST SELLING SLOTS CONTROLLER (7 Cols) */}
        <div className="lg:col-span-7 p-5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-4">
          
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Flame className="w-4 h-4 text-rose-400" />
              <span className="font-sans font-semibold text-xs text-white">
                Most Selling Narratives Showcase
              </span>
            </div>

            {/* Mode Toggle */}
            <div className="flex items-center gap-1 p-1 bg-slate-900 rounded-lg border border-slate-800 text-xs font-mono">
              <button
                type="button"
                onClick={() => setMode('auto')}
                className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                  mode === 'auto'
                    ? 'bg-sky-600 text-white font-bold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Auto-Rank (By Purchases)
              </button>
              <button
                type="button"
                onClick={() => setMode('manual')}
                className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                  mode === 'manual'
                    ? 'bg-sky-600 text-white font-bold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Manual Curation
              </button>
            </div>
          </div>

          {/* Mode Description */}
          <div className="text-xs font-sans text-slate-400">
            {mode === 'auto' ? (
              <span className="text-emerald-400 font-mono">
                ✓ Algorithmic mode active: Top 3 pieces are ranked purely by verified M-Pesa &amp; Bank purchase volume.
              </span>
            ) : (
              <span className="text-amber-400 font-mono">
                ✏️ Manual mode active: Override ranking and hand-pick the 3 pieces displayed in the Most Selling section.
              </span>
            )}
          </div>

          {/* 3 Slots */}
          <div className="space-y-2.5">
            {[0, 1, 2].map((slotIdx) => {
              const currentSlotItem = homepagePerformance.mostSellingPieces[slotIdx];
              const manualSelectedId = manualSlotIds[slotIdx] || '';

              return (
                <div key={slotIdx} className="p-3 rounded-lg bg-slate-900/60 border border-slate-800 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <span className="w-6 h-6 rounded-md bg-slate-800 border border-slate-700 flex items-center justify-center text-xs font-mono font-bold text-slate-300 shrink-0">
                      #{slotIdx + 1}
                    </span>

                    {mode === 'auto' ? (
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-xs text-white truncate">
                          {currentSlotItem?.article?.title || 'No piece ranked in this slot'}
                        </div>
                        <div className="text-[11px] font-mono text-slate-400">
                          {currentSlotItem ? `${currentSlotItem.purchases} verified sales • KES ${currentSlotItem.revenueKes.toLocaleString()}` : 'Awaiting purchases'}
                        </div>
                      </div>
                    ) : (
                      <div className="flex-1 min-w-0">
                        <select
                          value={manualSelectedId}
                          onChange={(e) => {
                            const updated = [...manualSlotIds];
                            updated[slotIdx] = e.target.value;
                            setManualSlotIds(updated);
                          }}
                          className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-slate-700 text-xs font-sans text-white focus:outline-none focus:border-sky-500 truncate"
                        >
                          <option value="">-- Select Monograph --</option>
                          {publishedArticles.map(a => (
                            <option key={a.id} value={a.id}>
                              {a.title} ({a.category})
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>

                  {currentSlotItem && (
                    <div className="text-right shrink-0">
                      <span className="text-xs font-mono font-bold text-emerald-400">
                        KES {currentSlotItem.revenueKes.toLocaleString()}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

        </div>

      </div>

    </div>
  );
};
