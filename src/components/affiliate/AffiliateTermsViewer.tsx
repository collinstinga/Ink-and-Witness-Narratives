import React, { useState } from 'react';
import { 
  FileText, 
  CheckSquare, 
  Square, 
  AlertCircle, 
  CheckCircle2, 
  ChevronDown, 
  ChevronUp, 
  ShieldCheck,
  Scale
} from 'lucide-react';
import { 
  AFFILIATE_TERMS_TITLE,
  AFFILIATE_TERMS_SUBTITLE,
  AFFILIATE_TERMS_PREAMBLE,
  AFFILIATE_TERMS_SECTIONS,
  AFFILIATE_TERMS_CHECKBOXES,
  AFFILIATE_TERMS_VERSION
} from '../../data/affiliateTerms.js';

interface AffiliateTermsViewerProps {
  checkedMap: Record<string, boolean>;
  onToggleCheck: (id: string) => void;
  onCheckAll: () => void;
  isDashboardModal?: boolean;
}

export const AffiliateTermsViewer: React.FC<AffiliateTermsViewerProps> = ({
  checkedMap = {},
  onToggleCheck,
  onCheckAll,
  isDashboardModal = false
}) => {
  const [expandedSections, setExpandedSections] = useState<Record<number, boolean>>({
    0: true,
    1: true,
    2: true,
    3: true,
    4: true,
    5: true,
    6: true,
    7: true
  });

  const toggleSection = (index: number) => {
    setExpandedSections(prev => ({
      ...prev,
      [index]: !prev[index]
    }));
  };

  const totalRequired = AFFILIATE_TERMS_CHECKBOXES.length;
  const checkedCount = AFFILIATE_TERMS_CHECKBOXES.filter(c => Boolean(checkedMap?.[c.id])).length;
  const allChecked = checkedCount === totalRequired;

  return (
    <div className="space-y-4 text-left">
      {/* Terms Header */}
      <div className="p-4 rounded-xl bg-slate-900/90 border border-cyan-500/30 shadow-inner">
        <div className="flex items-center gap-2.5 mb-1.5">
          <Scale className="w-5 h-5 text-cyan-400 shrink-0" />
          <div>
            <span className="text-[10px] font-mono tracking-widest text-cyan-400 font-semibold uppercase">
              {AFFILIATE_TERMS_TITLE} (Version {AFFILIATE_TERMS_VERSION})
            </span>
            <h3 className="text-base font-serif font-bold text-white tracking-wide">
              {AFFILIATE_TERMS_SUBTITLE}
            </h3>
          </div>
        </div>
        <p className="text-xs text-slate-300 italic font-sans leading-relaxed">
          {AFFILIATE_TERMS_PREAMBLE}
        </p>
      </div>

      {/* Scrollable Terms & Conditions Box */}
      <div className="max-h-60 sm:max-h-72 overflow-y-auto pr-1.5 space-y-3 custom-scrollbar rounded-xl bg-slate-950/80 border border-slate-800 p-3.5">
        {AFFILIATE_TERMS_SECTIONS.map((section, idx) => (
          <div 
            key={idx} 
            className="border border-slate-800/80 rounded-lg overflow-hidden bg-slate-900/50"
          >
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                toggleSection(idx);
              }}
              className="w-full px-3 py-2 text-left flex items-center justify-between bg-slate-900/90 hover:bg-slate-800/80 transition-colors text-xs font-mono font-semibold text-slate-200 cursor-pointer"
            >
              <span className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400"></span>
                {section.title}
              </span>
              {expandedSections[idx] ? (
                <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              )}
            </button>
            {expandedSections[idx] && (
              <div className="p-3 text-[12px] font-sans text-slate-300 space-y-1.5 border-t border-slate-800/60 leading-relaxed bg-slate-950/40">
                {section.content.map((p, pIdx) => (
                  <p key={pIdx} className={p.startsWith('•') ? 'pl-2 text-slate-300' : ''}>
                    {p}
                  </p>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Required Checkboxes Header & Progress */}
      <div className="pt-2 border-t border-slate-800/80">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span className="text-xs font-mono font-bold text-slate-200">
              Required Acknowledgments ({checkedCount}/{totalRequired})
            </span>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onCheckAll();
            }}
            className="text-[11px] font-mono text-cyan-400 hover:text-cyan-300 underline cursor-pointer"
          >
            {allChecked ? 'Uncheck All' : 'Agree & Check All (9)'}
          </button>
        </div>

        {/* Progress bar */}
        <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden mb-3">
          <div 
            className={`h-full transition-all duration-300 ${
              allChecked ? 'bg-emerald-500' : 'bg-cyan-500'
            }`}
            style={{ width: `${(checkedCount / totalRequired) * 100}%` }}
          />
        </div>

        {/* 9 Required Checkboxes */}
        <div className="space-y-2">
          {AFFILIATE_TERMS_CHECKBOXES.map((item, index) => {
            const isChecked = Boolean(checkedMap?.[item.id]);
            return (
              <button
                key={item.id}
                id={`affiliate-term-checkbox-${item.id}`}
                type="button"
                role="checkbox"
                aria-checked={isChecked}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (typeof onToggleCheck === 'function') {
                    onToggleCheck(item.id);
                  }
                }}
                className={`w-full text-left flex items-start gap-2.5 p-2.5 rounded-lg border transition-all cursor-pointer select-none text-xs leading-relaxed ${
                  isChecked
                    ? 'bg-emerald-950/20 border-emerald-700/60 text-slate-200'
                    : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-300 hover:border-slate-700'
                }`}
              >
                <span className="mt-0.5 shrink-0">
                  {isChecked ? (
                    <CheckSquare className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <Square className="w-4 h-4 text-slate-500" />
                  )}
                </span>
                <span className="flex-1 font-sans">
                  <strong className="font-mono text-[11px] text-slate-400 mr-1.5">
                    {index + 1}.
                  </strong>
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
