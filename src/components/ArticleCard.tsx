import React from 'react';
import { 
  Download, 
  Clock, 
  Calendar, 
  Smartphone, 
  CheckCircle2, 
  FileText
} from 'lucide-react';
import { Article } from '../types.js';

interface ArticleCardProps {
  article: Article;
  isUnlocked: boolean;
  onRead: (article: Article) => void;
  onUnlock: (article: Article) => void;
  onQuickDownload?: (article: Article) => void;
  onSelectTag?: (tag: string) => void;
  onTipAuthor?: (article: Article) => void;
}

export const ArticleCard: React.FC<ArticleCardProps> = ({
  article,
  isUnlocked,
  onRead,
  onUnlock,
  onQuickDownload,
  onSelectTag,
  onTipAuthor
}) => {
  // Category color mapper
  const getCategoryTheme = (cat: string) => {
    switch (cat) {
      case 'Strategy & Power':
        return 'text-sky-400 bg-sky-950/70 border-sky-800/60';
      case 'Philosophy & Discipline':
        return 'text-indigo-400 bg-indigo-950/70 border-indigo-800/60';
      case 'African Enterprise':
        return 'text-emerald-400 bg-emerald-950/70 border-emerald-800/60';
      case 'Modern Geopolitics':
        return 'text-amber-400 bg-amber-950/70 border-amber-800/60';
      default:
        return 'text-slate-300 bg-slate-900 border-slate-700/80';
    }
  };

  return (
    <article 
      id={`article-card-${article.id}`}
      className={`group relative rounded-2xl flex flex-col justify-between transition-all duration-300 ${
        isUnlocked 
          ? 'bg-gradient-to-b from-slate-900/90 to-[#0e1628] border border-sky-500/40 shadow-lg shadow-sky-950/20' 
          : 'bg-gradient-to-b from-[#0f172a]/90 to-[#0b111e] border border-slate-800 hover:border-slate-700 hover:shadow-xl hover:shadow-black/50'
      }`}
    >
      {/* Top Banner / Image */}
      <div className="relative h-44 w-full rounded-t-2xl overflow-hidden bg-slate-950">
        <img 
          src={article.coverImage || "https://images.unsplash.com/photo-1455390582262-044cdead277a?auto=format&fit=crop&w=800&q=80"}
          alt={article.title}
          referrerPolicy="no-referrer"
          className="w-full h-full object-cover object-center opacity-65 group-hover:opacity-85 group-hover:scale-105 transition-all duration-500"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0f172a] via-[#0f172a]/40 to-transparent" />

        {/* Top Badges */}
        <div className="absolute top-3.5 left-3.5 right-3.5 flex items-center justify-between">
          <span className={`text-[11px] font-mono font-medium px-2.5 py-1 rounded-md border backdrop-blur-md ${getCategoryTheme(article.category)}`}>
            {article.category}
          </span>

          {isUnlocked ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-mono font-semibold px-2.5 py-1 rounded-md bg-sky-950/90 border border-sky-500/50 text-sky-300 shadow-sm backdrop-blur-md">
              <CheckCircle2 className="w-3.5 h-3.5 text-sky-400" />
              <span>UNLOCKED</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[11px] font-mono font-bold px-2.5 py-1 rounded-md bg-emerald-950/90 border border-emerald-500/50 text-emerald-300 shadow-sm backdrop-blur-md">
              <Smartphone className="w-3.5 h-3.5 text-emerald-400" />
              <span>KES {article.priceKes}</span>
            </span>
          )}
        </div>

        {/* Downloads Counter pill on bottom right of image */}
        <div className="absolute bottom-3 right-3.5 flex items-center gap-1 text-[10px] font-mono text-slate-400 bg-slate-950/80 px-2 py-0.5 rounded border border-slate-800 backdrop-blur-sm">
          <Download className="w-3 h-3 text-slate-400" />
          <span>{article.downloadsCount || 0} downloads</span>
        </div>
      </div>

      {/* Card Body Content */}
      <div className="p-5 sm:p-6 flex-1 flex flex-col justify-between">
        <div>
          {/* Metadata Row */}
          <div className="flex items-center gap-3 text-xs text-slate-400 font-mono mb-3">
            <span className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              {article.readTimeMinutes} min read
            </span>
            <span>•</span>
            <span className="flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              {article.publishedAt}
            </span>
          </div>

          {/* Title */}
          <h3 
            onClick={() => onRead(article)}
            className="font-display font-bold text-lg sm:text-xl text-slate-100 group-hover:text-sky-300 transition-colors leading-snug mb-2 cursor-pointer"
          >
            {article.title}
          </h3>

          {/* Subtitle */}
          {article.subtitle && (
            <p className="font-serif italic text-xs sm:text-sm text-slate-400 mb-3 line-clamp-2">
              {article.subtitle}
            </p>
          )}

          {/* Excerpt */}
          <p className="text-xs sm:text-sm text-slate-300/80 leading-relaxed font-sans line-clamp-3 mb-4">
            {article.excerpt}
          </p>

          {/* Tags */}
          <div className="flex flex-wrap gap-1.5 mb-5">
            {article.tags.map((tag, idx) => (
              <button 
                key={idx}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (onSelectTag) onSelectTag(tag);
                }}
                className={`text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800/80 hover:bg-sky-950/80 text-slate-400 hover:text-sky-300 border border-slate-700/60 hover:border-sky-800/80 transition-colors ${
                  onSelectTag ? 'cursor-pointer' : ''
                }`}
              >
                #{tag}
              </button>
            ))}
          </div>
        </div>

        {/* Action Buttons Footer: Single clear action according to hierarchy */}
        <div className="pt-4 border-t border-slate-800/80 flex items-center justify-between">
          {isUnlocked ? (
            <button
              id={`btn-read-${article.id}`}
              onClick={() => onRead(article)}
              className="w-full py-2.5 px-4 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold tracking-wide transition-all flex items-center justify-center gap-2 shadow-sm cursor-pointer"
            >
              <FileText className="w-4 h-4" />
              <span>Read</span>
            </button>
          ) : (
            <button
              id={`btn-pay-to-read-${article.id}`}
              onClick={() => onUnlock ? onUnlock(article) : onRead(article)}
              className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold tracking-wide transition-all flex items-center justify-center gap-2 shadow-sm cursor-pointer"
            >
              <Smartphone className="w-4 h-4 text-emerald-200" />
              <span>Pay to Read — KSh {article.priceKes}</span>
            </button>
          )}
        </div>

      </div>
    </article>
  );
};
