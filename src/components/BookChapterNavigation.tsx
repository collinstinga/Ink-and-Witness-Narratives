import React from 'react';
import { BookOpen, ChevronLeft, ChevronRight } from 'lucide-react';
import type { Article } from '../types.js';
import type { ChapterBookContext } from '../utils/bookCatalogue.js';

interface BookChapterNavigationProps {
  context: ChapterBookContext;
  articleId: string;
  onReadArticle: (article: Article) => void;
}

/** Each chapter opens through the normal reader; this is never an access grant. */
export const BookChapterNavigation: React.FC<BookChapterNavigationProps> = ({
  context, articleId, onReadArticle,
}) => {
  const index = context.chapters.findIndex(chapter => chapter.id === articleId);
  if (index < 0 || context.book.kind !== 'book' || !context.book.isPublished) return null;
  const previous = context.chapters[index - 1];
  const next = context.chapters[index + 1];
  return (
    <nav aria-label={`Chapters in ${context.book.name}`} className="my-8 space-y-4 rounded-2xl border border-emerald-800/50 bg-emerald-950/20 p-4 sm:p-6">
      <div>
        <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-emerald-300"><BookOpen className="h-4 w-4" aria-hidden="true" />Chapter {index + 1} of {context.chapters.length}</p>
        <h4 className="mt-2 font-display text-lg font-bold text-white">{context.book.name}</h4>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <button type="button" disabled={!previous} onClick={() => previous && onReadArticle(previous)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:border-emerald-600 disabled:opacity-35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300" aria-label={previous ? `Previous chapter: ${previous.title}` : 'No previous chapter'}><ChevronLeft className="h-4 w-4" aria-hidden="true" />Previous</button>
        <button type="button" disabled={!next} onClick={() => next && onReadArticle(next)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-emerald-700 bg-emerald-950/60 px-3 py-2 text-sm text-emerald-200 hover:border-emerald-500 disabled:opacity-35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300" aria-label={next ? `Next chapter: ${next.title}` : 'No next chapter'}>Next chapter<ChevronRight className="h-4 w-4" aria-hidden="true" /></button>
      </div>
      <details className="text-sm text-slate-300">
        <summary className="cursor-pointer py-2 font-semibold text-emerald-200">All chapters</summary>
        <ol className="mt-2 space-y-1">
          {context.chapters.map((chapter, chapterIndex) => <li key={chapter.id}>
            <button type="button" onClick={() => onReadArticle(chapter)} aria-current={chapter.id === articleId ? 'page' : undefined} className="w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-slate-800 aria-[current=page]:bg-emerald-950 aria-[current=page]:text-emerald-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300">{chapterIndex + 1}. {chapter.title}</button>
          </li>)}
        </ol>
      </details>
      <p className="text-[11px] leading-relaxed text-slate-500">Your place and bookmarks stay with each chapter. Chapters you do not own open their preview; existing purchase and subscription access is checked securely.</p>
    </nav>
  );
};
