import { describe, expect, it } from 'vitest';
import type { Article, ContentBundle } from '../types.js';
import { quoteChapterBook, validateChapterBookMetadata, validateContentBundleMembers, validateContentBundlePieceIds } from './chapterBooks.js';

const chapter = (id: string, priceKes = 100, extra: Partial<Article> = {}): Article => ({
  id, title: id, priceKes, isPaid: true, status: 'published', ...extra
} as Article);
const chapters = [chapter('chapter-1'), chapter('chapter-2', 200), chapter('chapter-3', 300)];
const book = (extra: Partial<ContentBundle> = {}): ContentBundle => ({
  id: 'book-1', kind: 'book', name: 'One Complete Book', slug: 'one-book', description: '',
  pieceIds: ['chapter-1', 'chapter-2', 'chapter-3'], priceKes: 500, isPublished: true,
  createdAt: '2026-10-28T00:00:00.000Z', updatedAt: '2026-10-28T00:00:00.000Z',
  existingOwnerPricing: 'remaining_chapters', ...extra
});

describe('chaptered books: non-destructive metadata and members', () => {
  it('defaults old bundles safely and preserves book settings omitted by an old client', () => {
    expect(validateChapterBookMetadata({})).toEqual({ kind: 'bundle', showChaptersSeparately: true, existingOwnerPricing: 'full_price' });
    expect(validateChapterBookMetadata({ name: 'Revised' }, book({ showChaptersSeparately: false })))
      .toEqual({ kind: 'book', showChaptersSeparately: false, existingOwnerPricing: 'remaining_chapters' });
  });

  it.each([
    null, [], { kind: 'novel' }, { kind: null }, { kind: 'book', showChaptersSeparately: 'false' },
    { kind: 'book', showChaptersSeparately: 0 }, { kind: 'book', existingOwnerPricing: 'free' },
    { kind: 'bundle', existingOwnerPricing: 'remaining_chapters' }, { kind: 'bundle', showChaptersSeparately: false }
  ])('rejects invalid or misleading metadata %j', input => {
    expect(() => validateChapterBookMetadata(input)).toThrow();
  });

  it.each([
    undefined, ['chapter-1'], ['chapter-1', 'chapter-1'], ['chapter-1', ' chapter-2'],
    ['chapter-1', '../chapter-2'], ['chapter-1', 2], Array.from({ length: 31 }, (_, index) => `chapter-${index}`)
  ])('rejects invalid, duplicate or oversized members %j', value => {
    expect(() => validateContentBundlePieceIds(value)).toThrow();
  });

  it('keeps original IDs and exact writer chapter order without mutating articles', () => {
    const source = structuredClone(chapters);
    const reversed = book({ pieceIds: ['chapter-3', 'chapter-1', 'chapter-2'] });
    expect(validateContentBundleMembers(reversed, chapters).map(value => value.id)).toEqual(reversed.pieceIds);
    expect(chapters).toEqual(source);
  });

  it('allows draft composition but refuses publishing or checkout with missing or unpublished chapters', () => {
    const drafts = [chapter('chapter-1'), chapter('chapter-2', 100, { status: 'draft' })];
    const selected = book({ isPublished: false, pieceIds: ['chapter-1', 'chapter-2'] });
    expect(validateContentBundleMembers(selected, drafts)).toHaveLength(2);
    expect(() => validateContentBundleMembers({ ...selected, isPublished: true }, drafts)).toThrow('Publish every');
    expect(() => validateContentBundleMembers(selected, drafts, { requirePublished: true })).toThrow('Publish every');
    expect(() => validateContentBundleMembers(book(), drafts)).toThrow();
  });
});

describe('chaptered-book quotes', () => {
  it('charges the current full book price without any verified purchased chapters', () => {
    expect(quoteChapterBook(book(), chapters, [])).toEqual({
      bookId: 'book-1', bookUpdatedAt: '2026-10-28T00:00:00.000Z', listPriceKes: 500, amountKes: 500, creditKes: 0,
      ownedPieceIds: [], remainingPieceIds: ['chapter-1', 'chapter-2', 'chapter-3'],
      alreadyOwned: false, pricingPolicy: 'remaining_chapters'
    });
  });

  it('credits only supplied verified ownership and rounds the remaining share upwards', () => {
    expect(quoteChapterBook(book(), chapters, ['chapter-1', 'unrelated', 'chapter-1'])).toMatchObject({
      amountKes: 417, creditKes: 83, ownedPieceIds: ['chapter-1'], remainingPieceIds: ['chapter-2', 'chapter-3']
    });
    expect(quoteChapterBook(book(), chapters, ['chapter-1', 'chapter-2'])).toMatchObject({ amountKes: 250, creditKes: 250 });
  });

  it('does not treat a single purchased chapter as full-book ownership', () => {
    expect(quoteChapterBook(book(), chapters, ['chapter-2'])).toMatchObject({ alreadyOwned: false, amountKes: 334 });
  });

  it('never trusts public client unlock flags or free-preview flags as paid ownership', () => {
    const clientLike = chapters.map(value => ({ ...value, isUnlocked: true }));
    expect(quoteChapterBook(book(), clientLike, [])).toMatchObject({ amountKes: 500, creditKes: 0, alreadyOwned: false });
  });

  it('applies no automatic discount when the writer chooses full price', () => {
    expect(quoteChapterBook(book({ existingOwnerPricing: 'full_price' }), chapters, ['chapter-1', 'chapter-2']))
      .toMatchObject({ amountKes: 500, creditKes: 0, alreadyOwned: false, pricingPolicy: 'full_price' });
  });

  it.each(['full_price', 'remaining_chapters'] as const)('prevents duplicate charges when all chapters are owned (%s)', policy => {
    expect(quoteChapterBook(book({ existingOwnerPricing: policy }), chapters, chapters.map(value => value.id)))
      .toMatchObject({ amountKes: 0, creditKes: 500, alreadyOwned: true, remainingPieceIds: [] });
  });

  it('does not credit free chapters against paid ones', () => {
    const mixed = [chapter('chapter-1', 0, { isPaid: false }), chapter('chapter-2', 100), chapter('chapter-3', 300)];
    expect(quoteChapterBook(book(), mixed, ['chapter-1'])).toMatchObject({ amountKes: 500, creditKes: 0, remainingPieceIds: ['chapter-2', 'chapter-3'] });
    expect(quoteChapterBook(book(), mixed, ['chapter-2'])).toMatchObject({ amountKes: 375, creditKes: 125 });
    expect(quoteChapterBook(book(), mixed, ['chapter-2', 'chapter-3'])).toMatchObject({ amountKes: 0, alreadyOwned: true });
  });

  it('keeps a minimum whole-shilling charge while a paid chapter remains', () => {
    expect(quoteChapterBook(book({ priceKes: 1 }), chapters, ['chapter-1', 'chapter-2']))
      .toMatchObject({ amountKes: 1, creditKes: 0, alreadyOwned: false });
  });

  it('does not extend a previous edition purchase automatically to a newly added chapter', () => {
    const nextEdition = [...chapters, chapter('chapter-4', 400)];
    expect(quoteChapterBook(book({ pieceIds: nextEdition.map(value => value.id) }), nextEdition, chapters.map(value => value.id)))
      .toMatchObject({ amountKes: 200, creditKes: 300, remainingPieceIds: ['chapter-4'], alreadyOwned: false });
  });

  it.each([0, -1, 1.5, NaN, Infinity, 1_000_001])('refuses invalid book prices %s', priceKes => {
    expect(() => quoteChapterBook(book({ priceKes }), chapters, [])).toThrow('whole-shilling price');
  });

  it.each(['', 'not-a-date', ' 2026-10-28T00:00:00.000Z '])('refuses an invalid saved book revision %s', updatedAt => {
    expect(() => quoteChapterBook(book({ updatedAt }), chapters, [])).toThrow('valid saved revision');
  });

  it.each([0, -1, NaN, Infinity, 1_000_001])('refuses malformed paid-chapter price weights %s', priceKes => {
    expect(() => quoteChapterBook(book(), [chapter('chapter-1', priceKes), ...chapters.slice(1)], ['chapter-2']))
      .toThrow('Every paid chapter');
  });

  it('refuses normal bundles, unpublished books, deleted chapters and scheduled members', () => {
    expect(() => quoteChapterBook(book({ kind: 'bundle', existingOwnerPricing: 'full_price' }), chapters, [])).toThrow('unavailable');
    expect(() => quoteChapterBook(book({ isPublished: false }), chapters, [])).toThrow('unavailable');
    expect(() => quoteChapterBook(book(), chapters.slice(1), [])).toThrow('no longer exists');
    expect(() => quoteChapterBook(book(), [chapter('chapter-1', 100, { status: 'scheduled' }), ...chapters.slice(1)], []))
      .toThrow('Publish every');
  });

  it('does not mutate chapter records or the purchase identity while recalculating price', () => {
    const inputBook = book();
    const prior = structuredClone(inputBook);
    const source = structuredClone(chapters);
    quoteChapterBook(inputBook, chapters, new Set(['chapter-1']));
    expect(inputBook).toEqual(prior);
    expect(chapters).toEqual(source);
  });
});
