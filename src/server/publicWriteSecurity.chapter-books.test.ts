import { describe, expect, it, vi } from 'vitest';
import { publicWriteValidators } from './publicWriteSecurity.js';
import { requireCurrentBookEdition, requireCurrentBookPrice } from './chapterBookCheckout.js';
import { quoteChapterBook } from './chapterBooks.js';
import type { Article, ContentBundle } from '../types.js';

const revision = '2026-10-28T12:00:00.000Z';
const book: ContentBundle = { id: 'book-one', kind: 'book', name: 'Book', slug: 'book', description: '',
  pieceIds: ['a', 'b'], existingOwnerPricing: 'remaining_chapters', priceKes: 200,
  isPublished: true, createdAt: revision, updatedAt: revision };
const articles = ['a', 'b'].map(id => ({ id, status: 'published', isPaid: true, priceKes: 100 } as Article));
const payload = { articleId: 'bundle:book-one', phoneNumber: '0700000000', amount: 100, bookUpdatedAt: revision };

function validate(body: Record<string, unknown>) {
  const next = vi.fn();
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  const req = { body: structuredClone(body) };
  publicWriteValidators.stkPush(req as any, res as any, next);
  return { req, res, next };
}

describe('book checkout: real public request validator to edition/price boundary', () => {
  it('preserves the reviewed edition through the real validator into the price guard', () => {
    const { req, next } = validate(payload);
    expect(next).toHaveBeenCalledOnce();
    expect(req.body.bookUpdatedAt).toBe(revision);
    requireCurrentBookEdition(book, req.body.bookUpdatedAt);
    const quote = quoteChapterBook(book, articles, ['a']);
    expect(requireCurrentBookPrice(quote, req.body.amount)).toBe(100);
    expect(book.pieceIds).toEqual(['a', 'b']);
  });
  it('retains existing standalone checkout without requiring book metadata', () => {
    const { next } = validate({ articleId: 'piece-one', phoneNumber: '0700000000', amount: 100 });
    expect(next).toHaveBeenCalledOnce();
  });
  it.each([{}, 42, 'not-a-date', `${revision} `, 'x'.repeat(81)])('blocks malformed edition metadata %j', bookUpdatedAt => {
    const { next, res } = validate({ ...payload, bookUpdatedAt });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });
  it('does not initiate anything for a stale edition even if the price is unchanged', () => {
    const { req, next } = validate({ ...payload, bookUpdatedAt: '2026-10-27T12:00:00.000Z' });
    expect(next).toHaveBeenCalledOnce();
    const provider = vi.fn();
    expect(() => { requireCurrentBookEdition(book, req.body.bookUpdatedAt); provider(); }).toThrow('book edition has changed');
    expect(provider).not.toHaveBeenCalled();
  });
  it('still rejects arbitrary new fields rather than weakening the request allowlist', () => {
    const { next, res } = validate({ ...payload, isUnlocked: true });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
