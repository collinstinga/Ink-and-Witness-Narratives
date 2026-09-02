import React from 'react';
import { 
  Filter, 
  Eye, 
  BookOpen, 
  CreditCard, 
  CheckCircle2, 
  ArrowDown, 
  ArrowRight,
  TrendingUp,
  Percent
} from 'lucide-react';
import { FunnelStage } from '../../../types.js';

interface ConversionFunnelProps {
  funnel: {
    viewsToPurchaseRate: number;
    previewToCheckoutRate: number;
    checkoutToPurchaseRate: number;
    overallRate: number;
    stages: FunnelStage[];
  };
}

export const ConversionFunnel: React.FC<ConversionFunnelProps> = ({ funnel }) => {
  const { stages = [], viewsToPurchaseRate, previewToCheckoutRate, checkoutToPurchaseRate, overallRate } = funnel;

  const stageIcons = {
    view: Eye,
    preview: BookOpen,
    checkout: CreditCard,
    purchase: CheckCircle2
  };

  const stageColors = {
    view: {
      bg: 'bg-indigo-950/40',
      border: 'border-indigo-800/60',
      text: 'text-indigo-400',
      bar: 'bg-indigo-500'
    },
    preview: {
      bg: 'bg-sky-950/40',
      border: 'border-sky-800/60',
      text: 'text-sky-400',
      bar: 'bg-sky-500'
    },
    checkout: {
      bg: 'bg-amber-950/40',
      border: 'border-amber-800/60',
      text: 'text-amber-400',
      bar: 'bg-amber-500'
    },
    purchase: {
      bg: 'bg-emerald-950/40',
      border: 'border-emerald-800/60',
      text: 'text-emerald-400',
      bar: 'bg-emerald-500'
    }
  };

  return (
    <div id="analytics-conversion-funnel" className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-6">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-amber-400 mb-1">
            <Filter className="w-4 h-4" />
            <span>Reader Journey &amp; Conversion Pipeline</span>
          </div>
          <h3 className="font-serif font-bold text-xl text-white">
            End-to-End Conversion Funnel
          </h3>
          <p className="text-xs text-slate-400 font-sans mt-0.5">
            Tracing readers from initial title impression to preview reading, checkout intent, and verified purchase.
          </p>
        </div>

        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono">
          <span className="text-slate-400">Total Purchase Efficiency:</span>
          <span className="text-emerald-400 font-bold">{overallRate || viewsToPurchaseRate || 0}%</span>
        </div>
      </div>

      {/* Funnel Visual Stages (Grid of 4) */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 relative">
        {stages.map((stage, idx) => {
          const Icon = stageIcons[stage.stage as keyof typeof stageIcons] || Eye;
          const colors = stageColors[stage.stage as keyof typeof stageColors] || stageColors.view;
          const isLast = idx === stages.length - 1;

          return (
            <div key={stage.stage} className="relative flex flex-col justify-between p-4 rounded-xl bg-slate-950/80 border border-slate-800/80 space-y-3 group hover:border-slate-700 transition-colors">
              
              {/* Stage Top */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider font-semibold">
                    Stage 0{idx + 1}
                  </span>
                  <div className={`p-1.5 rounded-lg ${colors.bg} ${colors.border} border`}>
                    <Icon className={`w-3.5 h-3.5 ${colors.text}`} />
                  </div>
                </div>

                <h4 className="font-sans font-semibold text-xs text-white">
                  {stage.label}
                </h4>
              </div>

              {/* Stage Count & Percentage */}
              <div className="space-y-2">
                <div className="flex items-baseline justify-between">
                  <div className="text-xl font-mono font-bold text-white">
                    {stage.count.toLocaleString()}
                  </div>
                  <span className="text-xs font-mono text-slate-400 font-medium">
                    {stage.percentageOfTop}% of views
                  </span>
                </div>

                {/* Progress bar */}
                <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden">
                  <div 
                    className={`h-full ${colors.bar} rounded-full transition-all duration-500`}
                    style={{ width: `${Math.max(4, stage.percentageOfTop)}%` }}
                  />
                </div>
              </div>

              {/* Conversion from previous step */}
              <div className="pt-2 border-t border-slate-900 flex items-center justify-between text-[11px] font-mono">
                {idx === 0 ? (
                  <span className="text-slate-500">Funnel Top Baseline</span>
                ) : (
                  <>
                    <span className="text-slate-400">Step Retention:</span>
                    <span className="text-emerald-400 font-bold">
                      {stage.conversionFromPrevious}%
                    </span>
                  </>
                )}
              </div>

              {/* Desktop connector arrow */}
              {!isLast && (
                <div className="hidden md:flex absolute -right-3 top-1/2 -translate-y-1/2 z-10 w-6 h-6 rounded-full bg-slate-900 border border-slate-700 items-center justify-center text-slate-400 shadow-md">
                  <ArrowRight className="w-3 h-3" />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Funnel Diagnostic Insights */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 font-mono text-xs">
        <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-1">
          <div className="text-slate-400 flex items-center justify-between">
            <span>Preview Reading Depth:</span>
            <span className="text-sky-300 font-bold">
              {stages[1]?.percentageOfTop || 0}%
            </span>
          </div>
          <p className="text-[11px] text-slate-500 font-sans">
            Readers who dive past title into preview excerpt paragraphs.
          </p>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-1">
          <div className="text-slate-400 flex items-center justify-between">
            <span>Checkout Intent Rate:</span>
            <span className="text-amber-300 font-bold">
              {previewToCheckoutRate}%
            </span>
          </div>
          <p className="text-[11px] text-slate-500 font-sans">
            Preview readers who open M-Pesa or Bank payment modal.
          </p>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-1">
          <div className="text-slate-400 flex items-center justify-between">
            <span>STK / Checkout Completion:</span>
            <span className="text-emerald-400 font-bold">
              {checkoutToPurchaseRate}%
            </span>
          </div>
          <p className="text-[11px] text-slate-500 font-sans">
            Payment modal opens that complete successfully into unlocked licenses.
          </p>
        </div>
      </div>

    </div>
  );
};
