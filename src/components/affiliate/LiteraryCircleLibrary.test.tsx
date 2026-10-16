import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { Article } from '../../types.js';
import { LiteraryCircleLibrary, orderLiteraryCircleLibrary } from './LiteraryCircleLibrary.js';

const article = (overrides: Partial<Article>): Article => ({
  id: 'piece-one',
  title: 'Piece One',
  subtitle: '',
  slug: 'piece-one',
  excerpt: 'A short description.',
  content: '',
  category: 'Reflection',
  status: 'published',
  isPaid: true,
  priceKes: 300,
  readTimeMinutes: 5,
  publishedAt: '2026-01-01',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  downloadsCount: 0,
  previewParagraphs: [],
  tags: [],
  ...overrides,
});

describe('LiteraryCircleLibrary', () => {
  it('keeps drafts out and places writer recommendations first', () => {
    const ordered = orderLiteraryCircleLibrary([
      article({ id: 'newer', title: 'Newer', publishedAt: '2026-03-01' }),
      article({ id: 'featured', title: 'Featured', featured: true, publishedAt: '2025-01-01' }),
      article({ id: 'draft', title: 'Draft', status: 'draft' }),
    ]);

    expect(ordered.map(item => item.id)).toEqual(['featured', 'newer']);
  });

  it('renders unlocked catalogue context without calling complimentary access a purchase', () => {
    const markup = renderToStaticMarkup(
      <LiteraryCircleLibrary
        articles={[article({ id: 'first', title: 'The First Piece', featured: true })]}
        onOpenArticle={() => undefined}
      />
    );

    expect(markup).toContain('Complimentary library');
    expect(markup).toContain('1 piece unlocked');
    expect(markup).toContain('does not create a sale or commission');
    expect(markup).toContain('Read The First Piece with Literary Circle access');
  });
});
