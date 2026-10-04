import React, { useMemo } from 'react';
import { ArrowRight, BookOpen, LibraryBig } from 'lucide-react';

import type { Article, Category, HomepageConfig } from '../types.js';

interface HomepageLibraryGuideProps {
  articles: Article[];
  categories: Category[];
  config?: HomepageConfig | null;
  onSelectCategory: (categoryName: string) => void;
}

interface LibrarySection {
  category: Category;
  pieceCount: number;
}

export const buildHomepageLibrarySections = (
  categories: Category[],
  articles: Article[],
): LibrarySection[] => {
  const published = articles.filter((article) => article.status === 'published' || !article.status);

  return [...categories]
    .filter((category) => category?.id && category.isEnabled !== false)
    .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
    .map((category) => ({
      category,
      pieceCount: published.filter((article) => (
        article.category === category.name || article.categories?.includes(category.name)
      )).length,
    }))
    .filter((section) => section.pieceCount > 0)
    .slice(0, 8);
};

export const HomepageLibraryGuide: React.FC<HomepageLibraryGuideProps> = ({
  articles,
  categories,
  config,
  onSelectCategory,
}) => {
  const sections = useMemo(
    () => buildHomepageLibrarySections(categories, articles),
    [articles, categories],
  );

  if (sections.length === 0) return null;

  const heading = config?.homepageLibraryHeading?.trim() || 'Find Your Shelf';
  const subtitle = config?.homepageLibrarySubtitle?.trim() ||
    'Browse by feeling, subject, or the kind of story you want today.';

  return (
    <section id="home-library-guide" aria-labelledby="home-library-guide-heading" className="space-y-7">
      <header className="max-w-2xl space-y-2">
        <p className="inline-flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.3em] text-sky-400/90">
          <LibraryBig className="h-3.5 w-3.5" aria-hidden="true" />
          Library guide
        </p>
        <h2 id="home-library-guide-heading" className="font-display text-2xl font-bold tracking-tight text-slate-100 sm:text-3xl">
          {heading}
        </h2>
        <p className="text-sm leading-relaxed text-slate-400 sm:text-base">{subtitle}</p>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {sections.map(({ category, pieceCount }, index) => (
          <button
            key={category.id}
            type="button"
            data-library-category={category.name}
            onClick={() => onSelectCategory(category.name)}
            className="group flex min-h-36 flex-col justify-between rounded-2xl border border-slate-800 bg-slate-950/55 p-5 text-left transition hover:-translate-y-0.5 hover:border-sky-800/80 hover:bg-slate-900/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
            aria-label={`Browse ${category.name}, ${pieceCount} ${pieceCount === 1 ? 'piece' : 'pieces'}`}
          >
            <span className="flex items-start justify-between gap-3">
              <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-slate-500">
                Shelf {String(index + 1).padStart(2, '0')}
              </span>
              <BookOpen className="h-4 w-4 text-sky-400/80" aria-hidden="true" />
            </span>
            <span className="mt-6 block">
              <span className="flex items-end justify-between gap-3">
                <span className="font-display text-lg font-bold leading-tight text-slate-100 transition group-hover:text-sky-300">
                  {category.name}
                </span>
                <ArrowRight className="h-4 w-4 shrink-0 text-slate-500 transition group-hover:translate-x-0.5 group-hover:text-sky-400" aria-hidden="true" />
              </span>
              {category.description && (
                <span className="mt-2 line-clamp-2 block text-xs leading-relaxed text-slate-400">
                  {category.description}
                </span>
              )}
              <span className="mt-3 block font-mono text-[10px] uppercase tracking-wider text-slate-500">
                {pieceCount} {pieceCount === 1 ? 'piece' : 'pieces'}
              </span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
};
