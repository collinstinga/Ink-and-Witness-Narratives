import React from 'react';
import { 
  ShieldCheck, 
  Clock, 
  XCircle, 
  Globe, 
  CreditCard, 
  Smartphone, 
  Building, 
  DollarSign, 
  Heart,
  TrendingUp,
  AlertCircle
} from 'lucide-react';
import { CashFlowSummary, DetailedAnalytics } from '../../../types.js';

interface FinancialCashFlowSummaryProps {
  cashFlow: CashFlowSummary;
  tips: DetailedAnalytics['tips'];
  revenue: DetailedAnalytics['revenue'];
  onNavigateTab?: (tab: any) => void;
}

export const FinancialCashFlowSummary: React.FC<FinancialCashFlowSummaryProps> = ({
  cashFlow,
  tips,
  revenue,
  onNavigateTab
}) => {
  const {
    confirmedInflowKes,
    pendingInflowKes,
    failedInflowKes,
    totalTransactionAttempts,
    confirmedTransactionCount,
    pendingTransactionCount,
    failedTransactionCount,
    paymentMethodBreakdown
  } = cashFlow;

  const totalInflow = confirmedInflowKes;

  return (
    <div id="analytics-financial-cashflow" className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-6">
      
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-emerald-400 mb-1">
            <ShieldCheck className="w-4 h-4" />
            <span>Financials &amp; Cash Flow Reconciliation</span>
          </div>
          <h3 className="font-serif font-bold text-xl text-white">
            Confirmed vs. Pending Ledger
          </h3>
          <p className="text-xs text-slate-400 font-sans mt-0.5">
            Strict separation of verified settled funds from in-flight requests and cancelled attempts.
          </p>
        </div>

        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-950/80 border border-emerald-800/80 text-xs font-mono text-emerald-300">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          <span>Audit-Grade M-Pesa &amp; Bank Ledger</span>
        </div>
      </div>

      {/* 3-Way Reconciliation Inflow Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        
        {/* Confirmed Cash */}
        <div className="p-4 rounded-xl bg-gradient-to-b from-emerald-950/30 to-slate-950/80 border border-emerald-800/60 space-y-2">
          <div className="flex items-center justify-between text-xs font-mono text-emerald-400">
            <span className="uppercase tracking-wider font-semibold">1. Confirmed Cash Inflow</span>
            <ShieldCheck className="w-4 h-4" />
          </div>
          <div className="text-2xl font-mono font-bold text-white">
            KES {confirmedInflowKes.toLocaleString()}
          </div>
          <p className="text-[11px] font-mono text-slate-400 flex items-center justify-between pt-1 border-t border-slate-800">
            <span>{confirmedTransactionCount} settled payments</span>
            <span className="text-emerald-400 font-bold">100% Earned</span>
          </p>
        </div>

        {/* Pending In-Flight */}
        <div className={`p-4 rounded-xl bg-gradient-to-b from-amber-950/30 to-slate-950/80 border space-y-2 ${
          pendingTransactionCount > 0 ? 'border-amber-700/80' : 'border-slate-800'
        }`}>
          <div className="flex items-center justify-between text-xs font-mono text-amber-300">
            <span className="uppercase tracking-wider font-semibold">2. In-Flight / Pending</span>
            <Clock className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-mono font-bold text-amber-200">
            KES {pendingInflowKes.toLocaleString()}
          </div>
          <p className="text-[11px] font-mono text-slate-400 flex items-center justify-between pt-1 border-t border-slate-800">
            <span>{pendingTransactionCount} awaiting confirmation</span>
            {onNavigateTab && pendingTransactionCount > 0 ? (
              <button 
                onClick={() => onNavigateTab('payments')}
                className="text-amber-400 underline font-semibold hover:text-amber-300 cursor-pointer"
              >
                Reconcile
              </button>
            ) : (
              <span className="text-amber-400">Not Earned</span>
            )}
          </p>
        </div>

        {/* Failed / Cancelled */}
        <div className="p-4 rounded-xl bg-gradient-to-b from-rose-950/20 to-slate-950/80 border border-slate-800 space-y-2">
          <div className="flex items-center justify-between text-xs font-mono text-slate-400">
            <span className="uppercase tracking-wider font-semibold">3. Failed / Timed Out</span>
            <XCircle className="w-4 h-4 text-rose-500" />
          </div>
          <div className="text-2xl font-mono font-bold text-slate-400">
            KES {failedInflowKes.toLocaleString()}
          </div>
          <p className="text-[11px] font-mono text-slate-500 flex items-center justify-between pt-1 border-t border-slate-800">
            <span>{failedTransactionCount} cancelled checkouts</span>
            <span className="text-slate-500">Zero Inflow</span>
          </p>
        </div>

      </div>

      {/* Methods & Tips Breakdown Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Payment Methods (7 cols) */}
        <div className="lg:col-span-7 p-4 rounded-xl bg-slate-950/70 border border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono uppercase tracking-wider text-sky-400 font-semibold">
              Payment Rails Distribution
            </span>
            <span className="text-[11px] font-mono text-slate-500">Verified Revenue</span>
          </div>

          <div className="space-y-3">
            {/* M-Pesa STK Push */}
            <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-md bg-emerald-950 border border-emerald-800 text-emerald-400">
                  <Smartphone className="w-4 h-4" />
                </div>
                <div>
                  <h5 className="font-sans font-medium text-xs text-white">M-Pesa Express STK Push</h5>
                  <span className="text-[10px] font-mono text-slate-400">
                    {paymentMethodBreakdown.mpesa.count} payments settled
                  </span>
                </div>
              </div>

              <div className="text-right font-mono">
                <div className="text-xs font-bold text-emerald-400">
                  KES {paymentMethodBreakdown.mpesa.amountKes.toLocaleString()}
                </div>
                <span className="text-[10px] text-slate-500">
                  {totalInflow > 0 ? Math.round((paymentMethodBreakdown.mpesa.amountKes / totalInflow) * 100) : 0}% of inflow
                </span>
              </div>
            </div>

            {/* Bank Transfer Orders */}
            <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-md bg-sky-950 border border-sky-800 text-sky-400">
                  <Building className="w-4 h-4" />
                </div>
                <div>
                  <h5 className="font-sans font-medium text-xs text-white">Direct Bank Orders</h5>
                  <span className="text-[10px] font-mono text-slate-400">
                    {paymentMethodBreakdown.bank.count} orders settled
                  </span>
                </div>
              </div>

              <div className="text-right font-mono">
                <div className="text-xs font-bold text-sky-400">
                  KES {paymentMethodBreakdown.bank.amountKes.toLocaleString()}
                </div>
                <span className="text-[10px] text-slate-500">
                  {totalInflow > 0 ? Math.round((paymentMethodBreakdown.bank.amountKes / totalInflow) * 100) : 0}% of inflow
                </span>
              </div>
            </div>

            {/* Manual Verification */}
            <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-md bg-amber-950 border border-amber-800 text-amber-400">
                  <CreditCard className="w-4 h-4" />
                </div>
                <div>
                  <h5 className="font-sans font-medium text-xs text-white">Manual Paybill / Code Verifications</h5>
                  <span className="text-[10px] font-mono text-slate-400">
                    {paymentMethodBreakdown.manual.count} verified
                  </span>
                </div>
              </div>

              <div className="text-right font-mono">
                <div className="text-xs font-bold text-amber-400">
                  KES {paymentMethodBreakdown.manual.amountKes.toLocaleString()}
                </div>
                <span className="text-[10px] text-slate-500">
                  {totalInflow > 0 ? Math.round((paymentMethodBreakdown.manual.amountKes / totalInflow) * 100) : 0}% of inflow
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Multi-Currency Patronage (5 cols) */}
        <div className="lg:col-span-5 p-4 rounded-xl bg-slate-950/70 border border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono uppercase tracking-wider text-rose-400 font-semibold flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5" />
              <span>International Reader Patronage</span>
            </span>
            <span className="text-[11px] font-mono text-slate-500">Auto-Converted</span>
          </div>

          <div className="space-y-2">
            {Object.entries(tips.currencyBreakdown).map(([curr, rawStat]) => {
              const stat = rawStat as { count: number; totalOriginal: number; totalKes: number };
              return (
                <div key={curr} className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800 flex items-center justify-between font-mono text-xs">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-200 font-bold text-[10px]">
                      {curr}
                    </span>
                    <span className="text-slate-400 text-[11px]">
                      {stat.count} tip{stat.count === 1 ? '' : 's'}
                    </span>
                  </div>

                  <div className="text-right">
                    <span className="text-rose-300 font-bold">
                      KES {stat.totalKes.toLocaleString()}
                    </span>
                    {curr !== 'KES' && (
                      <div className="text-[10px] text-slate-500">
                        {stat.totalOriginal.toLocaleString()} {curr}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {Object.keys(tips.currencyBreakdown).length === 0 && (
              <div className="py-6 text-center text-xs font-mono text-slate-500">
                No tips received in this period.
              </div>
            )}
          </div>
        </div>

      </div>

    </div>
  );
};
