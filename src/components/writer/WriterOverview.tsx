import React from 'react';
import { 
  FileText, 
  Globe, 
  Edit3, 
  DollarSign, 
  Heart, 
  TrendingUp, 
  Plus, 
  Eye, 
  Clock, 
  ArrowUpRight, 
  CheckCircle2, 
  AlertCircle,
  Sparkles,
  CreditCard,
  Layers
} from 'lucide-react';
import { DashboardStats, Article, PaymentTransaction } from '../../types.js';

interface WriterOverviewProps {
  stats: DashboardStats | null;
  loading: boolean;
  onNavigateTab: (tab: any) => void;
  onEditPiece: (article: Article) => void;
  onNewPiece: () => void;
  onSavePermanently?: () => Promise<void> | void;
  savingPermanently?: boolean;
}

export const WriterOverview: React.FC<WriterOverviewProps> = ({
  stats,
  loading,
  onNavigateTab,
  onEditPiece,
  onNewPiece,
  onSavePermanently,
  savingPermanently = false
}) => {
  if (loading || !stats) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-28 bg-slate-900/60 rounded-2xl border border-slate-800" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map(n => (
            <div key={n} className="h-28 bg-slate-900/60 rounded-xl border border-slate-800" />
          ))}
        </div>
      </div>
    );
  }

  const statCards = [
    {
      title: "Total Catalog",
      value: stats.totalPieces,
      sub: `${stats.publishedPieces} Live • ${stats.draftPieces} Drafts`,
      icon: Layers,
      color: "text-sky-400",
      bg: "bg-sky-950/30 border-sky-800/40",
      onClick: () => onNavigateTab('pieces')
    },
    {
      title: "Published Pieces",
      value: stats.publishedPieces,
      sub: "Active on public site",
      icon: Globe,
      color: "text-emerald-400",
      bg: "bg-emerald-950/30 border-emerald-800/40",
      onClick: () => onNavigateTab('published')
    },
    {
      title: "Private Drafts",
      value: stats.draftPieces,
      sub: "Works in progress",
      icon: Edit3,
      color: "text-amber-400",
      bg: "bg-amber-950/30 border-amber-800/40",
      onClick: () => onNavigateTab('drafts')
    },
    {
      title: "Pay-to-Read Pieces",
      value: stats.paidPieces,
      sub: "Monetized monographs",
      icon: CreditCard,
      color: "text-indigo-400",
      bg: "bg-indigo-950/30 border-indigo-800/40",
      onClick: () => onNavigateTab('pieces')
    },
    {
      title: "Pay-to-Read Revenue",
      value: `KES ${stats.payToReadSalesKes.toLocaleString()}`,
      sub: `${stats.verifiedPurchasesCount} verified unlocks`,
      icon: DollarSign,
      color: "text-cyan-400",
      bg: "bg-cyan-950/30 border-cyan-800/40",
      onClick: () => onNavigateTab('payments')
    },
    {
      title: "Reader Tips (Till 1618656)",
      value: `KES ${stats.tipsReceivedKes.toLocaleString()}`,
      sub: `${stats.verifiedTipsCount} patron donations`,
      icon: Heart,
      color: "text-rose-400",
      bg: "bg-rose-950/30 border-rose-800/40",
      onClick: () => onNavigateTab('tips')
    }
  ];

  return (
    <div className="space-y-8">
      {/* Welcome Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#0d1527] via-[#0f1d36] to-[#0d1527] border border-slate-800/90 p-6 sm:p-8 shadow-xl">
        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-sky-950/80 border border-sky-800/60 text-xs font-mono text-sky-300 mb-3">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Ink &amp; Witness Author Studio</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-serif font-bold text-white tracking-tight">
              Welcome back, Jake.
            </h1>
            <p className="text-sm text-slate-300 mt-1 max-w-xl">
              Manage your private monographs, publish new strategic essays, track Pay-to-Read sales, and monitor reader tips received via M-Pesa Till 1618656.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            {onSavePermanently && (
              <button
                id="overview-save-permanently-btn"
                onClick={onSavePermanently}
                disabled={savingPermanently}
                className="px-4 py-3 rounded-xl bg-slate-900/90 hover:bg-slate-800 border border-sky-600/60 hover:border-sky-400 text-sky-200 hover:text-white font-medium text-sm flex items-center gap-2 shadow-lg shadow-sky-950/40 transition-all cursor-pointer"
                title="Atomically commit all monographs and configurations to Cloud Firestore"
              >
                <Sparkles className="w-4 h-4 text-amber-300" />
                <span>{savingPermanently ? 'Saving Baseline...' : 'Save Permanently'}</span>
              </button>
            )}
            <button
              onClick={onNewPiece}
              className="px-5 py-3 rounded-xl bg-gradient-to-r from-sky-600 to-cyan-600 hover:from-sky-500 hover:to-cyan-500 text-white font-medium text-sm flex items-center gap-2 shadow-lg shadow-sky-950/50 hover:shadow-sky-500/20 transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Write New Piece</span>
            </button>
          </div>
        </div>
      </div>

      {/* Metric Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {statCards.map((card, idx) => {
          const Icon = card.icon;
          return (
            <div
              key={idx}
              onClick={card.onClick}
              className={`p-5 rounded-xl border ${card.bg} hover:border-slate-700 transition-all cursor-pointer group shadow-sm`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono uppercase tracking-wider text-slate-400">
                  {card.title}
                </span>
                <div className={`p-2 rounded-lg bg-slate-900/80 border border-slate-800 ${card.color} group-hover:scale-110 transition-transform`}>
                  <Icon className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-3">
                <div className="text-2xl font-serif font-bold text-white tracking-tight">
                  {card.value}
                </div>
                <div className="text-xs text-slate-400 mt-1 font-sans">
                  {card.sub}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Two Column Section: Recent Pieces & Recent Transactions */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left Column: Recent Pieces */}
        <div className="lg:col-span-7 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-sky-400" />
              <h2 className="text-base font-semibold text-white">Recent Pieces</h2>
            </div>
            <button
              onClick={() => onNavigateTab('pieces')}
              className="text-xs font-mono text-sky-400 hover:text-sky-300 flex items-center gap-1 cursor-pointer"
            >
              <span>View All Pieces</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="bg-[#0b1120] border border-slate-800/80 rounded-xl divide-y divide-slate-800/80 shadow-md overflow-hidden">
            {stats.recentPieces.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-sm">
                No pieces found. Click "Write New Piece" to begin.
              </div>
            ) : (
              stats.recentPieces.map((piece) => {
                const isPublished = piece.status === 'published';
                return (
                  <div
                    key={piece.id}
                    className="p-4 sm:p-5 flex items-center justify-between gap-4 hover:bg-slate-800/30 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-medium ${
                          isPublished
                            ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/60'
                            : 'bg-amber-950/80 text-amber-300 border border-amber-800/60'
                        }`}>
                          {isPublished ? (
                            <>
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                              Published
                            </>
                          ) : (
                            <>
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                              Draft
                            </>
                          )}
                        </span>
                        
                        <span className="text-xs font-mono text-slate-400">
                          {piece.isPaid ? `KES ${piece.priceKes}` : 'Free'}
                        </span>

                        <span className="text-xs text-slate-500 hidden sm:inline">
                          • {piece.category}
                        </span>
                      </div>

                      <h3 className="text-sm font-medium text-slate-100 truncate">
                        {piece.title}
                      </h3>

                      <p className="text-xs text-slate-400 truncate mt-0.5">
                        {piece.subtitle || piece.excerpt}
                      </p>
                    </div>

                    <button
                      onClick={() => onEditPiece(piece)}
                      className="shrink-0 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 hover:text-white border border-slate-700 transition-colors flex items-center gap-1.5 cursor-pointer"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>Edit</span>
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Recent M-Pesa Transactions */}
        <div className="lg:col-span-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-emerald-400" />
              <h2 className="text-base font-semibold text-white">Recent Payments</h2>
            </div>
            <button
              onClick={() => onNavigateTab('payments')}
              className="text-xs font-mono text-emerald-400 hover:text-emerald-300 flex items-center gap-1 cursor-pointer"
            >
              <span>View Ledger</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="bg-[#0b1120] border border-slate-800/80 rounded-xl divide-y divide-slate-800/80 shadow-md overflow-hidden">
            {stats.recentTransactions.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-sm">
                No recent transactions.
              </div>
            ) : (
              stats.recentTransactions.slice(0, 5).map((tx) => {
                const isTip = tx.type === 'TIP';
                const isSuccess = tx.status === 'SUCCESS';

                return (
                  <div
                    key={tx.id || tx.checkoutRequestId}
                    className="p-3.5 sm:p-4 flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono uppercase ${
                          isTip 
                            ? 'bg-rose-950/80 text-rose-300 border border-rose-800/60'
                            : 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/60'
                        }`}>
                          {isTip ? 'Author Tip' : 'Pay-to-Read'}
                        </span>
                        <span className="font-mono text-slate-400 text-[11px]">
                          {tx.mpesaReceiptNumber || 'PENDING'}
                        </span>
                      </div>
                      <p className="text-slate-200 truncate font-medium mt-1">
                        {tx.articleTitle || (isTip ? 'Tip to Author' : 'Monograph Access')}
                      </p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {new Date(tx.createdAt).toLocaleDateString()} • {tx.phoneNumber}
                      </p>
                    </div>

                    <div className="text-right shrink-0">
                      <div className="font-mono font-bold text-white">
                        KES {tx.amount}
                      </div>
                      <span className={`text-[10px] font-mono ${
                        isSuccess ? 'text-emerald-400' : 'text-amber-400'
                      }`}>
                        {tx.status}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

      </div>
    </div>
  );
};
