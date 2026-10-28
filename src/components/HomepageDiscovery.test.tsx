import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { Article, ContentCollection } from '../types.js';
import type { HomepageBundle } from './HomepageBundles.js';
import {
  buildHomepageDiscoveryModel,
  HomepageDiscovery,
  resolveHomepageCollectionDeepLink,
} from './HomepageDiscovery.js';

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

const bundle = (id: string, pieces: Article[]): HomepageBundle => ({
  id,
  name: `Bundle ${id}`,
  slug: `bundle-${id}`,
  description: `Description for ${id}`,
  pieceIds: pieces.map((article) => article.id),
  priceKes: 800,
  isPublished: true,
  createdAt: '2026-10-03',
  updatedAt: '2026-10-03',
  pieces,
  checkoutArticle: piece(`bundle:${id}`),
});

describe('HomepageDiscovery', () => {
  it('resolves a collection referral destination by stable id or public slug', () => {
    const target = collection('one', ['piece-one']);
    const view = { collection: target, pieces: [piece('one')] };
    expect(resolveHomepageCollectionDeepLink([view], target.id)).toBe(view);
    expect(resolveHomepageCollectionDeepLink([view], target.slug)).toBe(view);
    expect(resolveHomepageCollectionDeepLink([view], 'missing')).toBeNull();
  });

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
        bundles={[]}
        categories={[]}
        allArticles={[inCollection, standalone]}
        pieces={[inCollection, standalone, standalone]}
        unlockedTokens={{}}
        onReadArticle={vi.fn()}
        onUnlockArticle={vi.fn()}
        onPurchaseBundle={vi.fn()}
        onSelectCategory={vi.fn()}
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

  it('keeps bundle pieces off the standalone shelf and ignores invalid bundles', () => {
    const inBundle = piece('in-bundle');
    const alsoInBundle = piece('also-in-bundle');
    const standalone = piece('standalone');
    const valid = bundle('valid', [inBundle, alsoInBundle]);
    const unpublished: HomepageBundle = { ...bundle('hidden', [standalone]), isPublished: false };
    const model = buildHomepageDiscoveryModel(
      [],
      [inBundle, alsoInBundle, standalone],
      [inBundle, alsoInBundle, standalone],
      [valid, unpublished],
    );

    expect(model.bundles.map((item) => item.id)).toEqual(['valid']);
    expect(model.pieces.map((item) => item.id)).toEqual(['standalone']);
  });

  it('honors the writer choice to keep book chapters individually listed', () => {
    const first = piece('one');
    const second = piece('two');
    const book: HomepageBundle = { ...bundle('book', [first, second]), kind: 'book', pieceIds: [second.id, first.id], showChaptersSeparately: true };
    const separate = buildHomepageDiscoveryModel([], [first, second], [first, second], [book]);
    expect(separate.bundles[0].pieces.map(item => item.id)).toEqual(['two', 'one']);
    expect(separate.pieces.map(item => item.id)).toEqual(['one', 'two']);
    const combined = buildHomepageDiscoveryModel([], [first, second], [first, second], [{ ...book, showChaptersSeparately: false }]);
    expect(combined.pieces).toEqual([]);
  });

  it('does not hide chapters behind a disabled book shelf', () => {
    const first = piece('one');
    const second = piece('two');
    const book: HomepageBundle = { ...bundle('book', [first, second]), kind: 'book', showChaptersSeparately: false };
    const markup = renderToStaticMarkup(<HomepageDiscovery
      config={{ sections: [{ id: 'bundles', isVisible: false, order: 0 }] } as any}
      bundles={[book]} collections={[]} categories={[]} allArticles={[first, second]} pieces={[first, second]}
      unlockedTokens={{}} onReadArticle={vi.fn()} onUnlockArticle={vi.fn()} onPurchaseBundle={vi.fn()}
      onSelectCategory={vi.fn()} onNavigate={vi.fn()}
    />);
    expect(markup).not.toContain('data-bundle-id="book"');
    expect(markup).toContain('data-piece-id="one"');
    expect(markup).toContain('data-piece-id="two"');
  });

  it('honors writer section visibility and renders sections in the saved order', () => {
    const inCollection = piece('in-collection');
    const standalone = piece('standalone');
    const markup = renderToStaticMarkup(
      <HomepageDiscovery
        config={{
          welcomeBackground: { imageUrl: '', fit: 'cover', positionX: 50, positionY: 50, zoom: 100, overlayStrength: 25 },
          mostSellingPieceIds: [],
          sections: [
            { id: 'collections', isVisible: true, order: 1 },
            { id: 'newsletter', isVisible: true, order: 2 },
            { id: 'hero', isVisible: false, order: 3 },
            { id: 'pieces', isVisible: true, order: 4 },
            { id: 'bundles', isVisible: false, order: 5 },
            { id: 'library', isVisible: false, order: 6 },
          ],
        }}
        collections={[collection('positioned', [inCollection.id], {
          coverImage: '/collection.jpg',
          coverPosition: { x: 12, y: 78 },
        })]}
        bundles={[]}
        categories={[]}
        allArticles={[inCollection, standalone]}
        pieces={[standalone]}
        unlockedTokens={{}}
        onReadArticle={vi.fn()}
        onUnlockArticle={vi.fn()}
        onPurchaseBundle={vi.fn()}
        onSelectCategory={vi.fn()}
        onNavigate={vi.fn()}
        heroSection={<section id="controlled-hero">Hero</section>}
        newsletterSection={<section id="controlled-newsletter">Newsletter</section>}
      />,
    );

    expect(markup).not.toContain('id="controlled-hero"');
    expect(markup).toContain('id="controlled-newsletter"');
    expect(markup).toContain('object-position:12% 78%');
    expect(markup.indexOf('id="home-curated-collections"')).toBeLessThan(
      markup.indexOf('id="controlled-newsletter"'),
    );
    expect(markup.indexOf('id="controlled-newsletter"')).toBeLessThan(
      markup.indexOf('id="home-individual-pieces"'),
    );
  });
});
