import { describe, expect, it } from 'vitest';
import type { Article, ContentBundle } from '../types.js';
import { isBookQuoteFor, orderedBookChapters, resolveChapterBook, visibleStandaloneArticles } from './bookCatalogue.js';

const article = (id: string, status: Article['status'] = 'published'): Article => ({ id, status, title: id, content: '' } as Article);
const book = (overrides: Partial<ContentBundle> = {}): ContentBundle => ({
  id: 'book', name: 'One complete book', kind: 'book', isPublished: true,
  pieceIds: ['chapter-b', 'chapter-a'], showChaptersSeparately: false, updatedAt: '2026-10-28T12:00:00.000Z',
  ...overrides,
} as ContentBundle);

describe('book catalogue presentation without entitlement mutation', () => {
  const articles = [article('chapter-a'), article('chapter-b'), article('individual')];

  it('uses explicit chapter IDs and writer ordering, never title matching', () => {
    expect(orderedBookChapters(book({ pieceIds: ['chapter-b', 'chapter-b', 'missing', 'chapter-a', 'draft'] }), [...articles, article('draft', 'draft')]).map(item => item.id))
      .toEqual(['chapter-b', 'chapter-a']);
    expect(articles.map(item => item.id)).toEqual(['chapter-a', 'chapter-b', 'individual']);
  });

  it('hides chapters only for an expressly combined published book', () => {
    expect(visibleStandaloneArticles(articles, [book()]).map(item => item.id)).toEqual(['individual']);
    for (const separate of [true, undefined]) {
      expect(visibleStandaloneArticles(articles, [book({ showChaptersSeparately: separate })])).toEqual(articles);
    }
    expect(visibleStandaloneArticles(articles, [book({ isPublished: false })])).toEqual(articles);
    expect(visibleStandaloneArticles(articles, [book({ kind: 'bundle' })])).toEqual(articles);
  });

  it('resolves published book context while retaining original chapter objects and IDs', () => {
    const context = resolveChapterBook('chapter-a', articles, [book()]);
    expect(context?.chapters.map(item => item.id)).toEqual(['chapter-b', 'chapter-a']);
    expect(context?.chapters[1]).toBe(articles[0]);
    expect(resolveChapterBook('individual', articles, [book()])).toBeNull();
    expect(resolveChapterBook('chapter-a', articles, [book({ isPublished: false })])).toBeNull();
    expect(resolveChapterBook('chapter-a', [article('chapter-a', 'draft')], [book()])).toBeNull();
  });

  it('rejects mismatched, malformed or zero-cost unowned quote displays', () => {
    const quote = { bookId: 'book', bookUpdatedAt: '2026-10-28T12:00:00.000Z', listPriceKes: 600, amountKes: 300, creditKes: 300, ownedPieceIds: ['chapter-a'], remainingPieceIds: ['chapter-b'], alreadyOwned: false, pricingPolicy: 'remaining_chapters' };
    expect(isBookQuoteFor(book(), quote)).toBe(true);
    for (const change of [
      { bookId: 'other' }, { bookUpdatedAt: 'stale-revision' }, { amountKes: 0, creditKes: 600 }, { amountKes: NaN },
      { creditKes: 500 }, { alreadyOwned: true }, { ownedPieceIds: ['unknown'] },
      { remainingPieceIds: ['chapter-a'] }, { ownedPieceIds: undefined },
    ]) expect(isBookQuoteFor(book(), { ...quote, ...change })).toBe(false);
    expect(isBookQuoteFor(book(), { ...quote, amountKes: 0, creditKes: 600, remainingPieceIds: [], alreadyOwned: true })).toBe(true);
  });
});
