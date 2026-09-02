import React, { useState, useEffect, useCallback } from 'react';
import { 
  BarChart3, 
  RefreshCw, 
  Download, 
  Calendar, 
  ShieldCheck, 
  Sliders, 
  Flame, 
  Filter, 
  TrendingUp, 
  DollarSign, 
  FileText,
  Clock,
  Sparkles,
  ChevronDown
} from 'lucide-react';
import { DetailedAnalytics, Article } from '../../types.js';
import { api } from '../../utils/api.js';

import { AnalyticsOverviewCards } from './analytics/AnalyticsOverviewCards.js';
import { TimeSeriesChart } from './analytics/TimeSeriesChart.js';
import { ConversionFunnel } from './analytics/ConversionFunnel.js';
import { EditorialInsights } from './analytics/EditorialInsights.js';
import { HomepageEditorialControl } from './analytics/HomepageEditorialControl.js';
import { PiecePerformanceTable } from './analytics/PiecePerformanceTable.js';
import { FinancialCashFlowSummary } from './analytics/FinancialCashFlowSummary.js';

interface WriterAnalyticsProps {
  articles?: Article[];
  onEditPiece?: (piece: Article) => void;
  onPreviewPiece?: (piece: Article) => void;
  onNavigateTab?: (tab: any) => void;
  onRefresh?: () => void;
}

type PeriodFilter = 'today' | '7d' | '30d' | '90d' | 'this_year' | 'all_time' | 'custom';

export const WriterAnalytics: React.FC<WriterAnalyticsProps> = ({
  articles = [],
  onEditPiece,
  onPreviewPiece,
  onNavigateTab,
  onRefresh
}) => {
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodFilter>('30d');
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');
  const [showCustomPicker, setShowCustomPicker] = useState<boolean>(false);

  const [data, setData] = useState<DetailedAnalytics | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [exportingCsv, setExportingCsv] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAnalytics = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.getDetailedAnalytics(
        selectedPeriod,
        selectedPeriod === 'custom' ? customStartDate : undefined,
        selectedPeriod === 'custom' ? customEndDate : undefined
      );
      setData(res);
    } catch (err: any) {
      console.error('Failed to fetch detailed analytics:', err);
      setError(err.message || 'Failed to load verified analytics ledger.');
    } finally {
      setLoading(false);
    }
  }, [selectedPeriod, customStartDate, customEndDate]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  const handlePeriodChange = (period: PeriodFilter) => {
    setSelectedPeriod(period);
    if (period === 'custom') {
      setShowCustomPicker(true);
    } else {
      setShowCustomPicker(false);
    }
  };

  const handleApplyCustomDates = () => {
    if (customStartDate && customEndDate) {
      fetchAnalytics();
    }
  };

  const handleExportTransactions = async () => {
    try {
      setExportingCsv(true);
      await api.exportTransactionsCsv();
    } catch (err) {
      console.error('Failed to export transactions CSV:', err);
    } finally {
      setExportingCsv(false);
    }
  };

  const periodLabels: Record<PeriodFilter, string> = {
    today: 'Today',
    '7d': 'Last 7 Days',
    '30d': 'Last 30 Days',
    '90d': 'Last 90 Days',
    this_year: 'This Year',
    all_time: 'All Time',
    custom: 'Custom Window'
  };

  return (
    <div id="writer-analytics-control-centre" className="space-y-8 pb-16">
      
      {/* 1. TOP HEADER & TIME PERIOD SELECTOR BAR */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 border-b border-slate-800/80 pb-6">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-sky-400 mb-1">
            <BarChart3 className="w-4 h-4" />
            <span>Monograph Intelligence &amp; Editorial Control Centre</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-serif font-bold text-white tracking-tight">
            Analytics &amp; Editorial Hub
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 font-sans mt-1 max-w-2xl">
            Real-time analytics, revenue reconciliation, conversion funnels, and curated homepage placement calculated strictly from verified system records.
          </p>
        </div>

        {/* Action Controls & Live Badges */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-950/80 border border-emerald-800/60 text-xs font-mono text-emerald-300">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>100% Verified M-Pesa &amp; Bank Ledger</span>
          </div>

          <button
            onClick={handleExportTransactions}
            disabled={exportingCsv}
            className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 hover:text-white text-xs font-mono inline-flex items-center gap-2 transition-colors cursor-pointer"
            title="Download full transactions ledger as CSV"
          >
            <Download className={`w-3.5 h-3.5 text-emerald-400 ${exportingCsv ? 'animate-bounce' : ''}`} />
            <span>{exportingCsv ? 'Exporting...' : 'Export Transactions CSV'}</span>
          </button>

          <button
            onClick={fetchAnalytics}
            disabled={loading}
            className="p-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer"
            title="Refresh analytics data"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* 2. TIME PERIOD FILTER TABS */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-2 rounded-2xl bg-slate-950/80 border border-slate-800">
        <div className="flex flex-wrap items-center gap-1">
          {(['today', '7d', '30d', '90d', 'this_year', 'all_time', 'custom'] as const).map((period) => {
            const isSelected = selectedPeriod === period;
            return (
              <button
                key={period}
                onClick={() => handlePeriodChange(period)}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-mono font-medium transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-sky-600 text-white font-bold shadow-md shadow-sky-950/40'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                {periodLabels[period]}
              </button>
            );
          })}
        </div>

        {/* Selected Period Active Indicator */}
        <div className="px-3 py-1 text-xs font-mono text-slate-400 text-right sm:text-left">
          Showing data for: <span className="text-white font-semibold">{data?.periodLabel || periodLabels[selectedPeriod]}</span>
        </div>
      </div>

      {/* CUSTOM DATE PICKER (When "Custom" is active) */}
      {selectedPeriod === 'custom' && (
        <div className="p-4 rounded-xl bg-slate-900/90 border border-sky-900/60 flex flex-wrap items-center gap-4 text-xs font-mono">
          <div className="flex items-center gap-2">
            <span className="text-slate-400">Start Date:</span>
            <input
              type="date"
              value={customStartDate}
              onChange={(e) => setCustomStartDate(e.target.value)}
              className="px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white focus:outline-none focus:border-sky-500"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-slate-400">End Date:</span>
            <input
              type="date"
              value={customEndDate}
              onChange={(e) => setCustomEndDate(e.target.value)}
              className="px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white focus:outline-none focus:border-sky-500"
            />
          </div>

          <button
            onClick={handleApplyCustomDates}
            disabled={!customStartDate || !customEndDate}
            className="px-4 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-bold transition-colors cursor-pointer"
          >
            Apply Filter
          </button>
        </div>
      )}

      {/* Loading state */}
      {loading && !data && (
        <div className="py-20 flex flex-col items-center justify-center space-y-4 text-slate-400">
          <div className="w-8 h-8 border-2 border-sky-500/30 border-t-sky-500 rounded-full animate-spin" />
          <p className="text-xs font-mono">Aggregating verified ledger entries &amp; audience interactions...</p>
        </div>
      )}

      {/* Error State */}
      {error && !data && (
        <div className="p-6 rounded-2xl bg-rose-950/20 border border-rose-800/40 text-center space-y-3">
          <p className="text-rose-400 text-sm font-medium">{error}</p>
          <button
            onClick={fetchAnalytics}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-mono inline-flex items-center gap-2 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Retry</span>
          </button>
        </div>
      )}

      {/* Data Loaded */}
      {data && (
        <div className="space-y-8 animate-fadeIn">
          
          {/* 3. EXECUTIVE METRIC CARDS */}
          <AnalyticsOverviewCards 
            data={data}
            onNavigateTab={onNavigateTab}
          />

          {/* 4. TIME-SERIES REVENUE & VOLUME TRAJECTORY GRAPH */}
          <TimeSeriesChart
            timeSeries={data.timeSeries}
            periodLabel={data.periodLabel}
          />

          {/* 5. READER CONVERSION FUNNEL */}
          <ConversionFunnel
            funnel={data.conversionFunnel}
          />

          {/* 6. WHAT DESERVES ATTENTION (EDITORIAL INSIGHTS) */}
          <EditorialInsights
            insights={data.editorialInsights}
            articles={articles}
            onEditPiece={onEditPiece}
            onPreviewPiece={onPreviewPiece}
            onNavigateTab={onNavigateTab}
          />

          {/* 7. HOMEPAGE PLACEMENT & EDITORIAL CONTROL */}
          <HomepageEditorialControl
            homepagePerformance={data.homepagePerformance}
            articles={articles}
            onRefresh={() => {
              fetchAnalytics();
              if (onRefresh) onRefresh();
            }}
          />

          {/* 8. COMPREHENSIVE PIECE PERFORMANCE TABLE */}
          <PiecePerformanceTable
            pieces={data.pieceAnalytics}
            articles={articles}
            onEditPiece={onEditPiece}
            onPreviewPiece={onPreviewPiece}
          />

          {/* 9. FINANCIAL RECONCILIATION & CASH FLOW SUMMARY */}
          <FinancialCashFlowSummary
            cashFlow={data.cashFlow}
            tips={data.tips}
            revenue={data.revenue}
            onNavigateTab={onNavigateTab}
          />

        </div>
      )}

    </div>
  );
};
