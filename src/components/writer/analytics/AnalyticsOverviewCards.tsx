import React from 'react';
import { 
  DollarSign, 
  ShoppingBag, 
  Users, 
  TrendingUp, 
  Clock, 
  Heart, 
  ArrowUpRight, 
  ArrowDownRight, 
  Minus, 
  AlertCircle,
  CheckCircle2,
  ShieldAlert
} from 'lucide-react';
import { DetailedAnalytics } from '../../../types.js';

interface AnalyticsOverviewCardsProps {
  data: DetailedAnalytics;
  onNavigateTab?: (tab: any) => void;
}

export const AnalyticsOverviewCards: React.FC<AnalyticsOverviewCardsProps> = ({ 
  data,
  onNavigateTab
}) => {
  const { 
    revenue, 
    purchases, 
    readers, 
    conversion, 
    pendingPayments, 
    tips, 
    cashFlow, 
    growth 
  } = data;

  const renderGrowthBadge = (value: number | undefined) => {
    if (value === undefined || isNaN(value)) return null;
    if (value > 0) {
      return (
        <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[11px] font-mono font-medium bg-emerald-950/80 border border-emerald-800/60 text-emerald-400">
          <ArrowUpRight className="w-3 h-3" />
          +{value}%
        </span>
      );
    }
    if (value < 0) {
      return (
        <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[11px] font-mono font-medium bg-rose-950/80 border border-rose-800/60 text-rose-400">
          <ArrowDownRight className="w-3 h-3" />
          {value}%
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[11px] font-mono font-medium bg-slate-800/80 border border-slate-700 text-slate-400">
        <Minus className="w-3 h-3" />
        0%
      </span>
    );
  };

  return (
    <div id="analytics-overview-cards" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
      
      {/* 1. CONFIRMED REVENUE */}
      <div className="p-4 rounded-2xl bg-gradient-to-br from-[#0e1726] to-[#070b13] border border-emerald-900/50 shadow-sm relative overflow-hidden flex flex-col justify-between group hover:border-emerald-700/60 transition-colors">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-mono text-emerald-400/90">
            <span className="uppercase tracking-wider font-semibold">Confirmed Revenue</span>
            <DollarSign className="w-4 h-4 text-emerald-400" />
          </div>
          
          <div className="text-2xl font-display font-bold text-white tracking-tight">
            KES {revenue.totalConfirmedKes.toLocaleString()}
          </div>
        </div>

        <div className="pt-3 mt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px] font-mono text-slate-400">
          <div className="truncate">
            <span className="text-emerald-400">Sales KES {revenue.salesRevenueKes.toLocaleString()}</span>
            {revenue.tipsRevenueKes > 0 && (
              <span className="text-rose-300 ml-1.5">+ Tips {revenue.tipsRevenueKes.toLocaleString()}</span>
            )}
          </div>
          {renderGrowthBadge(growth?.revenueGrowth)}
        </div>
      </div>

      {/* 2. CONFIRMED PURCHASES */}
      <div className="p-4 rounded-2xl bg-gradient-to-br from-[#0e1726] to-[#070b13] border border-sky-900/40 shadow-sm relative overflow-hidden flex flex-col justify-between group hover:border-sky-700/60 transition-colors">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-mono text-sky-400/90">
            <span className="uppercase tracking-wider font-semibold">Purchases</span>
            <ShoppingBag className="w-4 h-4 text-sky-400" />
          </div>
          
          <div className="text-2xl font-display font-bold text-white tracking-tight">
            {purchases.confirmedCount.toLocaleString()}
          </div>
        </div>

        <div className="pt-3 mt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px] font-mono text-slate-400">
          <span>Avg KES {purchases.averageOrderValueKes}</span>
          {renderGrowthBadge(growth?.purchasesGrowth)}
        </div>
      </div>

      {/* 3. UNIQUE READERS */}
      <div className="p-4 rounded-2xl bg-gradient-to-br from-[#0e1726] to-[#070b13] border border-slate-800 shadow-sm relative overflow-hidden flex flex-col justify-between group hover:border-slate-700 transition-colors">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-mono text-slate-400">
            <span className="uppercase tracking-wider font-semibold">Unique Readers</span>
            <Users className="w-4 h-4 text-indigo-400" />
          </div>
          
          <div className="text-2xl font-display font-bold text-white tracking-tight">
            {readers.uniqueReadersCount.toLocaleString()}
          </div>
        </div>

        <div className="pt-3 mt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px] font-mono text-slate-400">
          <span>{readers.totalArticleViews.toLocaleString()} views</span>
          {renderGrowthBadge(growth?.readersGrowth)}
        </div>
      </div>

      {/* 4. CONVERSION RATE */}
      <div className="p-4 rounded-2xl bg-gradient-to-br from-[#0e1726] to-[#070b13] border border-amber-900/40 shadow-sm relative overflow-hidden flex flex-col justify-between group hover:border-amber-700/60 transition-colors">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-mono text-amber-400/90">
            <span className="uppercase tracking-wider font-semibold">Conversion</span>
            <TrendingUp className="w-4 h-4 text-amber-400" />
          </div>
          
          <div className="text-2xl font-display font-bold text-amber-300 tracking-tight">
            {conversion.overallConversionRate}%
          </div>
        </div>

        <div className="pt-3 mt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px] font-mono text-slate-400">
          <span className="truncate">{purchases.confirmedCount} of {readers.uniqueReadersCount} readers</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
            conversion.overallConversionRate >= 10 
              ? 'bg-emerald-950 text-emerald-400' 
              : conversion.overallConversionRate >= 4 
              ? 'bg-sky-950 text-sky-400' 
              : 'bg-slate-800 text-slate-400'
          }`}>
            {conversion.overallConversionRate >= 10 ? 'High' : conversion.overallConversionRate >= 4 ? 'Good' : 'Standard'}
          </span>
        </div>
      </div>

      {/* 5. PENDING PAYMENTS (NOT CASH EARNED) */}
      <div className={`p-4 rounded-2xl bg-gradient-to-br from-[#0e1726] to-[#070b13] border shadow-sm relative overflow-hidden flex flex-col justify-between group transition-colors ${
        pendingPayments.count > 0 ? 'border-amber-700/60 hover:border-amber-500' : 'border-slate-800'
      }`}>
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-mono text-amber-300">
            <span className="uppercase tracking-wider font-semibold flex items-center gap-1">
              <span>Pending</span>
              {pendingPayments.count > 0 && (
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
              )}
            </span>
            <Clock className="w-4 h-4 text-amber-400" />
          </div>
          
          <div className="text-2xl font-display font-bold text-amber-200 tracking-tight">
            KES {pendingPayments.totalAmountKes.toLocaleString()}
          </div>
        </div>

        <div className="pt-3 mt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px] font-mono text-slate-400">
          <span>{pendingPayments.count} awaiting settlement</span>
          {onNavigateTab && pendingPayments.count > 0 && (
            <button
              onClick={() => onNavigateTab('payments')}
              className="text-[10px] text-amber-400 hover:text-amber-300 underline font-semibold cursor-pointer"
            >
              Reconcile
            </button>
          )}
        </div>
      </div>

      {/* 6. READER TIPS & PATRONAGE */}
      <div className="p-4 rounded-2xl bg-gradient-to-br from-[#0e1726] to-[#070b13] border border-rose-900/40 shadow-sm relative overflow-hidden flex flex-col justify-between group hover:border-rose-700/60 transition-colors">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-mono text-rose-400/90">
            <span className="uppercase tracking-wider font-semibold">Reader Tips</span>
            <Heart className="w-4 h-4 text-rose-400" />
          </div>
          
          <div className="text-2xl font-display font-bold text-rose-300 tracking-tight">
            KES {tips.totalTipsKes.toLocaleString()}
          </div>
        </div>

        <div className="pt-3 mt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px] font-mono text-slate-400">
          <span>{tips.verifiedTipsCount} gifts</span>
          <span className="text-slate-400">Avg KES {tips.averageTipKes}</span>
        </div>
      </div>

    </div>
  );
};
