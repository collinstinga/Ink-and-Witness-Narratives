import { describe, expect, it, vi } from 'vitest';
import type { Article, ContentBundle } from '../types.js';
import { createChapterBookQuoteHandler, loadChapterBookCheckout, requireCurrentBookPrice } from './chapterBookCheckout.js';

const user = { id: 'reader-a', email: 'reader@example.test', role: 'client' };
const articles = ['a', 'b', 'c'].map(id => ({ id, status: 'published', isPaid: true, priceKes: 100 } as Article));
const book: ContentBundle = { id: 'book-a', name: 'Book', slug: 'book', description: '', pieceIds: ['c', 'a', 'b'], kind: 'book', existingOwnerPricing: 'remaining_chapters', priceKes: 300, isPublished: true, createdAt: '2026-10-28', updatedAt: '2026-10-28' };
function deps() {
  return { getBook: vi.fn(async () => book), getPublishedArticles: vi.fn(async () => articles), getPurchasedChapterIds: vi.fn(async () => ['a']) };
}

describe('chapter-book quote boundary', () => {
  it('loads current server-owned purchase IDs without granting or copying any content', async () => {
    const dependencies = deps();
    const result = await loadChapterBookCheckout('book-a', user, dependencies);
    expect(result.quote).toMatchObject({ amountKes: 200, creditKes: 100, ownedPieceIds: ['a'], remainingPieceIds: ['c', 'b'] });
    expect(dependencies.getPurchasedChapterIds).toHaveBeenCalledWith(user, ['c', 'a', 'b']);
    expect(result).not.toHaveProperty('content');
  });
  it.each([undefined, null, { ...user, role: 'admin' }])('does not query purchases without a reader identity: %s', async identity => {
    const dependencies = deps();
    await expect(loadChapterBookCheckout('book-a', identity, dependencies)).rejects.toMatchObject({ status: 401 });
    expect(dependencies.getBook).not.toHaveBeenCalled();
  });
  it('rejects invalid identifiers before any data lookup', async () => {
    const dependencies = deps();
    await expect(loadChapterBookCheckout('../users', user, dependencies)).rejects.toMatchObject({ status: 400 });
    expect(dependencies.getBook).not.toHaveBeenCalled();
  });
  it.each([{ ...book, isPublished: false }, { ...book, kind: 'bundle' as const }])('never exposes unpublished books or reinterprets normal bundles', async value => {
    const dependencies = { ...deps(), getBook: vi.fn(async () => value) };
    await expect(loadChapterBookCheckout('book-a', user, dependencies)).rejects.toMatchObject({ status: 404 });
  });
  it('fails closed when a chapter is withdrawn', async () => {
    await expect(loadChapterBookCheckout('book-a', user, { ...deps(), getPublishedArticles: async () => articles.slice(0, 2) })).rejects.toMatchObject({ status: 409 });
  });
  it('does not substitute stale purchases if Firestore is unavailable', async () => {
    const dependencies = { ...deps(), getPurchasedChapterIds: vi.fn(async () => { throw new Error('unavailable'); }) };
    await expect(loadChapterBookCheckout('book-a', user, dependencies)).rejects.toMatchObject({ status: 503, message: 'Book pricing is temporarily unavailable. Please retry before paying.' });
  });
  it('allows only the exact displayed fresh whole-shilling price', async () => {
    const { quote } = await loadChapterBookCheckout('book-a', user, deps());
    expect(requireCurrentBookPrice(quote, 200)).toBe(200);
    for (const amount of [300, 1, 0, '200', undefined, NaN]) expect(() => requireCurrentBookPrice(quote, amount)).toThrow('price or chapter ownership has changed');
    expect(() => requireCurrentBookPrice({ ...quote, amountKes: 0, alreadyOwned: true }, 0)).toThrow('already have purchase access');
  });
  it('returns a private no-store quote and hides provider details on an outage', async () => {
    const handler = createChapterBookQuoteHandler({ ...deps(), getBook: async () => { throw new Error('private detail'); } });
    const res = { setHeader: vi.fn(), status: vi.fn(), json: vi.fn() };
    res.status.mockReturnValue(res);
    await handler({ params: { id: 'book-a' }, user } as any, res as any);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store, max-age=0');
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ error: 'Book pricing is temporarily unavailable. Please retry before paying.' });
  });
});
