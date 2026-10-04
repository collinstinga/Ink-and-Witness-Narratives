import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { Article, ContentCollection } from '../types.js';
import { buildHomepageDiscoveryModel, HomepageDiscovery } from './HomepageDiscovery.js';

const piece = (id: string, overrides: Partial<Article> = {}): Article => ({
  id,
  title: `Piece ${id}`,
  subtitle: '',
  slug: `piece-${id}`,
  excerpt: `Excerpt for ${id}`,
  content: '',
  category: 'Narratives',
  status: 'published',
  isPaid: true,
  priceKes: 500,
  readTimeMinutes: 5,
  publishedAt: '2026-10-03',
  createdAt: '2026-10-03',
  updatedAt: '2026-10-03',
  downloadsCount: 0,
  previewParagraphs: [],
  tags: [],
  ...overrides,
});

const collection = (
  id: string,
  pieceIds: string[],
  overrides: Partial<ContentCollection> = {},
): ContentCollection => ({
  id,
  name: `Collection ${id}`,
  slug: `collection-${id}`,
  description: `Description for ${id}`,
  pieceIds,
  order: 0,
  isPublished: true,
  createdAt: '2026-10-03',
  updatedAt: '2026-10-03',
  ...overrides,
});

describe('HomepageDiscovery', () => {
  it('preserves curation order while removing duplicates and collection overlap', () => {
    const articles = [piece('in-collection'), piece('standalone'), piece('draft', { status: 'draft' })];
    const model = buildHomepageDiscoveryModel(
      [
        collection('first', ['in-collection', 'in-collection']),
        collection('first', ['standalone']),
        collection('empty', ['missing']),
      ],
      articles,
      [articles[0], articles[1], articles[1], articles[2]],
    );

    expect(model.collections).toHaveLength(1);
    expect(model.collections[0].collection.id).toBe('first');
    expect(model.collections[0].pieces.map((article) => article.id)).toEqual(['in-collection']);
    expect(model.pieces.map((article) => article.id)).toEqual(['standalone']);
  });

  it('renders a restrained, labelled collection shelf and only unique standalone cards', () => {
    const inCollection = piece('in-collection');
    const standalone = piece('standalone');
    const markup = renderToStaticMarkup(
      <HomepageDiscovery
        collections={[collection('one', [inCollection.id])]}
        allArticles={[inCollection, standalone]}
        pieces={[inCollection, standalone, standalone]}
        unlockedTokens={{}}
        onReadArticle={vi.fn()}
        onUnlockArticle={vi.fn()}
        onNavigate={vi.fn()}
      />,
    );

    expect(markup).toContain('id="home-curated-collections"');
    expect(markup).toContain('aria-label="Open Collection one collection, 1 piece"');
    expect(markup).toContain('data-piece-id="standalone"');
    expect(markup).not.toContain('data-piece-id="in-collection"');
    expect(markup.match(/data-piece-id="standalone"/g)).toHaveLength(1);
    expect(markup).toContain('Explore the full archive');
  });
});
