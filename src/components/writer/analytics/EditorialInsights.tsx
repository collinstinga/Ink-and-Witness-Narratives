import React from 'react';
import { 
  Sparkles, 
  AlertTriangle, 
  Flame, 
  Clock, 
  ArrowUpRight, 
  Edit3, 
  Eye, 
  Award,
  CreditCard,
  CheckCircle2,
  HelpCircle
} from 'lucide-react';
import { EditorialInsight, Article } from '../../../types.js';

interface EditorialInsightsProps {
  insights: EditorialInsight[];
  articles: Article[];
  onEditPiece?: (piece: Article) => void;
  onPreviewPiece?: (piece: Article) => void;
  onSetPieceOfTheWeek?: (pieceId: string) => void;
  onNavigateTab?: (tab: any) => void;
}

export const EditorialInsights: React.FC<EditorialInsightsProps> = ({
  insights = [],
  articles = [],
  onEditPiece,
  onPreviewPiece,
  onSetPieceOfTheWeek,
  onNavigateTab
}) => {
  if (!insights || insights.length === 0) {
    return (
      <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-4">
        <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-emerald-400">
          <CheckCircle2 className="w-4 h-4" />
          <span>Editorial Health</span>
        </div>
        <p className="text-xs text-slate-400 font-sans">
          All published pieces and transaction channels are running smoothly with no critical attention alerts.
        </p>
      </div>
    );
  }

  const getInsightIcon = (type: EditorialInsight['type']) => {
    switch (type) {
      case 'opportunity': return HelpCircle;
      case 'momentum': return Flame;
      case 'pricing': return AlertTriangle;
      case 'attention': return Clock;
      case 'pending': return CreditCard;
      default: return Sparkles;
    }
  };

  const getInsightColor = (type: EditorialInsight['type']) => {
    switch (type) {
      case 'opportunity':
        return {
          badge: 'bg-amber-950/80 border-amber-800/80 text-amber-300',
          icon: 'text-amber-400',
          border: 'border-amber-900/40 hover:border-amber-700/60',
          gradient: 'from-amber-950/20 to-slate-950/60'
        };
      case 'momentum':
        return {
          badge: 'bg-emerald-950/80 border-emerald-800/80 text-emerald-300',
          icon: 'text-emerald-400',
          border: 'border-emerald-900/40 hover:border-emerald-700/60',
          gradient: 'from-emerald-950/20 to-slate-950/60'
        };
      case 'pricing':
        return {
          badge: 'bg-sky-950/80 border-sky-800/80 text-sky-300',
          icon: 'text-sky-400',
          border: 'border-sky-900/40 hover:border-sky-700/60',
          gradient: 'from-sky-950/20 to-slate-950/60'
        };
      case 'pending':
        return {
          badge: 'bg-rose-950/80 border-rose-800/80 text-rose-300',
          icon: 'text-rose-400',
          border: 'border-rose-900/40 hover:border-rose-700/60',
          gradient: 'from-rose-950/20 to-slate-950/60'
        };
      default:
        return {
          badge: 'bg-indigo-950/80 border-indigo-800/80 text-indigo-300',
          icon: 'text-indigo-400',
          border: 'border-indigo-900/40 hover:border-indigo-700/60',
          gradient: 'from-indigo-950/20 to-slate-950/60'
        };
    }
  };

  const handleAction = (item: EditorialInsight) => {
    if (item.actionType === 'reconcile_payments') {
      if (onNavigateTab) onNavigateTab('payments');
      return;
    }

    const matchedArticle = articles.find(a => a.id === item.articleId);
    if (!matchedArticle) return;

    if (item.actionType === 'edit_preview' || item.actionType === 'review_pricing' || item.actionType === 'finish_draft') {
      if (onEditPiece) onEditPiece(matchedArticle);
    } else if (item.actionType === 'feature_potw') {
      if (onSetPieceOfTheWeek) onSetPieceOfTheWeek(matchedArticle.id);
    } else {
      if (onPreviewPiece) onPreviewPiece(matchedArticle);
    }
  };

  return (
    <div id="analytics-editorial-insights" className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-6">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-amber-400 mb-1">
            <Sparkles className="w-4 h-4" />
            <span>Data-Driven Editorial Intelligence</span>
          </div>
          <h3 className="font-serif font-bold text-xl text-white">
            What Deserves Attention
          </h3>
          <p className="text-xs text-slate-400 font-sans mt-0.5">
            Automated insights identifying high-momentum opportunities, preview optimizations, and revenue blockages.
          </p>
        </div>

        <span className="px-2.5 py-1 rounded-full bg-slate-950 border border-slate-800 text-xs font-mono text-slate-300">
          {insights.length} insight{insights.length === 1 ? '' : 's'} detected
        </span>
      </div>

      {/* Insights Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {insights.map((item) => {
          const Icon = getInsightIcon(item.type);
          const styling = getInsightColor(item.type);

          return (
            <div 
              key={item.id} 
              className={`p-4 rounded-xl bg-gradient-to-b ${styling.gradient} border ${styling.border} space-y-3 flex flex-col justify-between transition-all group`}
            >
              <div className="space-y-2">
                {/* Badge & Type */}
                <div className="flex items-center justify-between gap-2">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono uppercase tracking-wider border ${styling.badge}`}>
                    <Icon className="w-3 h-3" />
                    <span>{item.type}</span>
                  </span>

                  {item.metricValue && (
                    <span className="text-xs font-mono font-bold text-white">
                      {item.metricValue}
                    </span>
                  )}
                </div>

                {/* Title & Description */}
                <h4 className="font-serif font-bold text-sm text-white group-hover:text-amber-200 transition-colors">
                  {item.title}
                </h4>

                <p className="text-xs text-slate-300 font-sans leading-relaxed">
                  {item.description}
                </p>
              </div>

              {/* Action Trigger Button */}
              {item.actionLabel && (
                <div className="pt-3 border-t border-slate-800/80">
                  <button
                    onClick={() => handleAction(item)}
                    className="w-full px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 hover:text-white text-xs font-mono font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <span>{item.actionLabel}</span>
                    <ArrowUpRight className="w-3.5 h-3.5 text-amber-400" />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

    </div>
  );
};
