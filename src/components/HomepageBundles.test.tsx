import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { Article } from '../types.js';
import { HomepageBundles, type HomepageBundle } from './HomepageBundles.js';

const piece = (id: string): Article => ({
  id,
  title: `Piece ${id}`,
  subtitle: '',
  slug: `piece-${id}`,
  excerpt: '',
  content: '',
  category: 'Narrative',
  status: 'published',
  isPaid: true,
  priceKes: 300,
  readTimeMinutes: 4,
  publishedAt: '2026-10-04',
  createdAt: '2026-10-04',
  updatedAt: '2026-10-04',
  downloadsCount: 0,
  previewParagraphs: [],
  tags: [],
});

describe('HomepageBundles', () => {
  it('explains permanent access and presents the writer price as one purchase', () => {
    const first = piece('one');
    const checkoutArticle = piece('bundle:starter');
    const bundle: HomepageBundle = {
      id: 'starter',
      name: 'Starter Shelf',
      slug: 'starter-shelf',
      description: 'A first set.',
      pieceIds: [first.id],
      pieces: [first],
      checkoutArticle,
      priceKes: 750,
      coverImage: '/bundle.jpg',
      coverPosition: { x: 18, y: 82 },
      isPublished: true,
      createdAt: '2026-10-04',
      updatedAt: '2026-10-04',
    };

    const markup = renderToStaticMarkup(
      <HomepageBundles bundles={[bundle]} onPurchaseBundle={vi.fn()} />,
    );

    expect(markup).toContain('id="home-reading-bundles"');
    expect(markup).toContain('data-bundle-id="starter"');
    expect(markup).toContain('permanently adds every included piece');
    expect(markup).toContain('KSh 750');
    expect(markup).toContain('Buy Starter Shelf bundle for KSh 750');
    expect(markup).toContain('View contents');
    expect(markup).toContain('View every piece in Starter Shelf');
    expect(markup).toContain('object-position:18% 82%');
  });
});
