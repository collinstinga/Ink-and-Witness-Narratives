import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { Article, Category } from '../types.js';
import { buildHomepageLibrarySections, HomepageLibraryGuide } from './HomepageLibraryGuide.js';

const article = (id: string, category: string, status: Article['status'] = 'published'): Article => ({
  id,
  title: `Piece ${id}`,
  subtitle: '',
  slug: `piece-${id}`,
  excerpt: '',
  content: '',
  category,
  status,
  isPaid: false,
  priceKes: 0,
  readTimeMinutes: 3,
  publishedAt: '2026-10-04',
  createdAt: '2026-10-04',
  updatedAt: '2026-10-04',
  downloadsCount: 0,
  previewParagraphs: [],
  tags: [],
});

const category = (id: string, name: string, order: number, isEnabled = true): Category => ({
  id,
  name,
  slug: name.toLowerCase(),
  description: `${name} stories`,
  order,
  isEnabled,
  createdAt: '2026-10-04',
});

describe('HomepageLibraryGuide', () => {
  it('uses the writer category order and excludes empty, disabled, and draft-only shelves', () => {
    const sections = buildHomepageLibrarySections(
      [
        category('thrillers', 'Thrillers', 2),
        category('adventure', 'Adventure', 1),
        category('hidden', 'Hidden', 0, false),
        category('empty', 'Empty', 3),
      ],
      [
        article('a', 'Adventure'),
        article('t', 'Thrillers'),
        article('draft', 'Empty', 'draft'),
        article('hidden', 'Hidden'),
      ],
    );

    expect(sections.map(({ category: item }) => item.name)).toEqual(['Adventure', 'Thrillers']);
  });

  it('renders category destinations without repeating piece cards', () => {
    const markup = renderToStaticMarkup(
      <HomepageLibraryGuide
        categories={[category('adventure', 'Adventure', 0)]}
        articles={[article('a', 'Adventure')]}
        onSelectCategory={vi.fn()}
      />,
    );

    expect(markup).toContain('id="home-library-guide"');
    expect(markup).toContain('data-library-category="Adventure"');
    expect(markup).toContain('Browse Adventure, 1 piece');
    expect(markup).not.toContain('data-piece-id=');
  });
});
