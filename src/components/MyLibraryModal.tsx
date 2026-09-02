import React, { useState } from 'react';
import { 
  X, 
  BookmarkCheck, 
  BookOpen, 
  FileText, 
  CheckCircle2, 
  Trash2,
  ShieldCheck
} from 'lucide-react';
import { Article } from '../types.js';
import { clearStoredTokens } from '../utils/api.js';

interface MyLibraryModalProps {
  isOpen: boolean;
  onClose: () => void;
  articles: Article[];
  onReadArticle: (article: Article) => void;
  onExploreCatalog: () => void;
}

export const MyLibraryModal: React.FC<MyLibraryModalProps> = ({
  isOpen,
  onClose,
  articles,
  onReadArticle,
  onExploreCatalog
}) => {
  const [clearedNotice, setClearedNotice] = useState(false);

  if (!isOpen) return null;

  const handleClearData = async () => {
    clearStoredTokens();
    try {
      await fetch('/api/reset-data', { method: 'POST' });
    } catch {
      // ignore
    }
    setClearedNotice(true);
    setTimeout(() => {
      setClearedNotice(false);
      window.location.reload();
    }, 1200);
  };

  return (
    <div 
      id="my-library-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md overflow-y-auto"
    >
      <div className="relative w-full max-w-2xl rounded-3xl bg-[#0d1424] border border-slate-700 shadow-2xl overflow-hidden my-6">
        
        {/* Header */}
        <div className="px-6 py-4 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-sky-950 border border-sky-600/40 flex items-center justify-center text-sky-400">
              <BookmarkCheck className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-display font-bold text-base text-white tracking-wide">
                READER LIBRARY
              </h3>
              <p className="text-[11px] font-mono text-slate-400">
                {articles.length} Unlocked In-Browser Monographs
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              id="btn-clear-stored-data"
              onClick={handleClearData}
              title="Clear Local Cached Data"
              className="p-1.5 rounded-lg bg-slate-900 hover:bg-rose-950/60 border border-slate-800 hover:border-rose-800 text-slate-400 hover:text-rose-300 text-xs font-mono flex items-center gap-1 transition-colors cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Reset Cache</span>
            </button>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Clear Notice Banner */}
        {clearedNotice && (
          <div className="bg-emerald-950/90 border-b border-emerald-800 text-emerald-300 text-xs font-mono p-3 text-center flex items-center justify-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>M-Pesa details &amp; stored cache have been cleared successfully. Refreshing...</span>
          </div>
        )}

        {/* Library Content */}
        <div className="p-6 sm:p-7 space-y-4 max-h-[75vh] overflow-y-auto">
          {articles.length === 0 ? (
            <div className="text-center py-10 space-y-4">
              <div className="w-12 h-12 rounded-2xl bg-slate-900 border border-slate-800 text-slate-400 flex items-center justify-center mx-auto">
                <BookOpen className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-semibold text-slate-200">Your library is currently empty</p>
                <p className="text-xs text-slate-400 font-sans">Purchased pieces will be permanently saved here for online reading across your devices.</p>
              </div>
              <button
                onClick={() => {
                  onClose();
                  onExploreCatalog();
                }}
                className="px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold tracking-wide transition-colors"
              >
                Browse Monograph Catalog
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {articles.map(art => (
                <div 
                  key={art.id}
                  className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 group hover:border-slate-700 transition-colors"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-sky-950 text-sky-400 border border-sky-800">
                        {art.category}
                      </span>
                      <span className="text-[10px] font-mono text-emerald-400 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" />
                        <span>Purchased &amp; Active</span>
                      </span>
                    </div>
                    <h4 className="font-display font-bold text-sm sm:text-base text-slate-100">
                      {art.title}
                    </h4>
                    <p className="text-xs text-slate-400 font-serif line-clamp-1">
                      By Jake (@its_bigboy_jake) • Protected Online Edition
                    </p>
                  </div>

                  <div className="flex items-center gap-2 w-full sm:w-auto shrink-0">
                    <button
                      onClick={() => {
                        onClose();
                        onReadArticle(art);
                      }}
                      className="w-full sm:w-auto py-2 px-5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-md shadow-sky-950/60"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>Open Reader</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
};
