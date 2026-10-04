import { describe, expect, it } from 'vitest';
import { Article, ContentBundle, ContentCollection, HomepageConfig } from '../types.js';
import { resolveHomepageCuration } from './homepageCuration.js';

function piece(id: string, publishedAt: string, status: Article['status'] = 'published'): Article {
  return {
    id,
    title: id,
    subtitle: '',
    slug: id,
    excerpt: '',
    content: '',
    category: 'Essays',
    categories: ['Essays'],
    topics: [],
    status,
    isPaid: true,
    priceKes: 100,
    readTimeMinutes: 5,
    publishedAt,
    createdAt: publishedAt,
    updatedAt: publishedAt,
    downloadsCount: 0,
    previewParagraphs: [],
    tags: []
  };
}

function collection(id: string, pieceIds: string[], order: number, isPublished = true): ContentCollection {
  return {
    id,
    name: id,
    slug: id,
    description: '',
    pieceIds,
    order,
    isPublished,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  };
}

function bundle(
  id: string,
  pieceIds: string[],
  updatedAt: string,
  isPublished = true
): ContentBundle {
  return {
    id,
    name: id,
    slug: id,
    description: '',
    pieceIds,
    priceKes: 500,
    isPublished,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt
  };
}

describe('homepage curation', () => {
  const articles = [
    piece('piece-1', '2026-01-01'),
    piece('piece-2', '2026-02-01'),
    piece('piece-3', '2026-03-01'),
    piece('piece-4', '2026-04-01'),
    piece('draft-piece', '2026-05-01', 'draft')
  ];
  const collections = [
    collection('collection-a', ['piece-1', 'piece-2'], 2),
    collection('collection-b', ['piece-3'], 1),
    collection('hidden', ['piece-4'], 0, false)
  ];
  const bundles = [
    bundle('bundle-a', ['piece-1', 'piece-2'], '2026-04-01T00:00:00.000Z'),
    bundle('bundle-b', ['piece-3', 'piece-4'], '2026-05-01T00:00:00.000Z'),
    bundle('draft-bundle', ['piece-1', 'piece-4'], '2026-06-01T00:00:00.000Z', false),
    bundle('stale-bundle', ['piece-1', 'draft-piece'], '2026-07-01T00:00:00.000Z')
  ];

  it('uses published collections in writer order and never repeats their pieces individually', () => {
    const result = resolveHomepageCuration({
      homepageCollectionIds: ['collection-a', 'collection-b'],
      homepageBundleIds: ['bundle-a'],
      homepagePieceIds: ['piece-1', 'piece-4', 'piece-3', 'piece-4']
    }, collections, bundles, articles);

    expect(result.collections.map(item => item.id)).toEqual(['collection-a', 'collection-b']);
    expect(result.bundles.map(item => item.id)).toEqual(['bundle-a']);
    expect(result.pieces.map(item => item.id)).toEqual(['piece-4']);
  });

  it('defaults to a restrained collection shelf and latest unrepresented pieces for legacy settings', () => {
    const result = resolveHomepageCuration({} as HomepageConfig, collections, bundles, articles);

    expect(result.collections.map(item => item.id)).toEqual(['collection-b', 'collection-a']);
    expect(result.bundles.map(item => item.id)).toEqual(['bundle-b', 'bundle-a']);
    expect(result.pieces).toEqual([]);
  });

  it('honours explicit empty shelves and ignores stale or unpublished identifiers', () => {
    expect(resolveHomepageCuration({
      homepageCollectionIds: [],
      homepageBundleIds: [],
      homepagePieceIds: []
    }, collections, bundles, articles)).toEqual({ collections: [], bundles: [], pieces: [] });

    const stale = resolveHomepageCuration({
      homepageCollectionIds: ['hidden', 'missing'],
      homepageBundleIds: ['draft-bundle', 'stale-bundle', 'missing', 'bundle-a'],
      homepagePieceIds: ['draft-piece', 'missing', 'piece-2']
    }, collections, bundles, articles);
    expect(stale.collections).toEqual([]);
    expect(stale.bundles.map(item => item.id)).toEqual(['bundle-a']);
    expect(stale.pieces).toEqual([]);
  });
});
