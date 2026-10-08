import React from 'react';
import { Image as ImageIcon, Sparkles, ShieldCheck } from 'lucide-react';
import { Article, AuthorProfile } from '../../types.js';
import { PhotosAndBrandingSection } from './PhotosAndBrandingSection.js';

interface WriterMediaProps {
  author: AuthorProfile | null;
  pieces: Article[];
  onAuthorUpdated: (updated: AuthorProfile) => void;
  onPiecesUpdated?: (updated: Article[]) => void;
}

export const WriterMedia: React.FC<WriterMediaProps> = ({
  author,
  pieces,
  onAuthorUpdated,
  onPiecesUpdated
}) => {
  if (!author) {
    return (
      <div
        id="writer-media-loading"
        className="rounded-3xl border border-sky-900/60 bg-slate-950/70 px-6 py-12 text-center"
        role="status"
        aria-live="polite"
      >
        <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-sky-400 border-t-transparent" />
        <p className="font-mono text-sm text-sky-200">Loading Media &amp; Branding safely…</p>
        <p className="mt-2 text-xs text-slate-500">Your saved assets remain unchanged while the author profile loads.</p>
      </div>
    );
  }

  return (
    <div id="writer-media-view" className="space-y-8">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/80 pb-6">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-sky-400 mb-1">
            <ImageIcon className="w-4 h-4" />
            <span>Visual Asset Pipeline &amp; Media Repository</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-serif font-bold text-white">
            Media &amp; Branding Studio
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 font-sans mt-1">
            Upload, replace, and curate all monograph covers, author portrait, hero banners, site logos, and browser favicons.
          </p>
        </div>

        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-950/80 border border-emerald-800/60 text-xs font-mono text-emerald-300">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          <span>Permanent File Persistence Layer</span>
        </div>
      </div>

      {/* Main Asset Management System */}
      <PhotosAndBrandingSection
        author={author}
        pieces={pieces}
        onAuthorUpdated={onAuthorUpdated}
        onPiecesUpdated={onPiecesUpdated}
      />
    </div>
  );
};
