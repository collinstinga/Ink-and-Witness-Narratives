import type { Request, Response } from 'express';
import type { Article, ContentBookQuote, ContentBundle } from '../types.js';
import { quoteChapterBook } from './chapterBooks.js';

type Reader = { id: string; email: string; role: string };
export interface ChapterBookCheckoutDependencies {
  getBook: (id: string) => Promise<ContentBundle | null>;
  getPublishedArticles: () => Promise<Article[]>;
  getPurchasedChapterIds: (user: Reader, pieceIds: readonly string[]) => Promise<string[]>;
}

export class ChapterBookCheckoutError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

/** A read-only, fresh quote. Never creates a licence or changes a previous sale. */
export async function loadChapterBookCheckout(
  bookId: string,
  user: Reader | null | undefined,
  dependencies: ChapterBookCheckoutDependencies
): Promise<{ book: ContentBundle; quote: ContentBookQuote }> {
  if (!user || user.role !== 'client') {
    throw new ChapterBookCheckoutError(401, 'Sign in to your reader account to check book ownership and pricing.');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(bookId)) {
    throw new ChapterBookCheckoutError(400, 'Choose a valid book.');
  }
  let book: ContentBundle | null;
  try { book = await dependencies.getBook(bookId); } catch {
    throw new ChapterBookCheckoutError(503, 'Book pricing is temporarily unavailable. Please retry before paying.');
  }
  if (!book || book.kind !== 'book' || !book.isPublished) {
    throw new ChapterBookCheckoutError(404, 'This published book is unavailable.');
  }
  let articles: Article[];
  let ownedIds: string[];
  try {
    [articles, ownedIds] = await Promise.all([
      dependencies.getPublishedArticles(),
      dependencies.getPurchasedChapterIds(user, book.pieceIds)
    ]);
  } catch {
    throw new ChapterBookCheckoutError(503, 'Book pricing is temporarily unavailable. Please retry before paying.');
  }
  try {
    return { book, quote: quoteChapterBook(book, articles, ownedIds) };
  } catch {
    throw new ChapterBookCheckoutError(409, 'This book is being updated. Reload its contents before purchasing.');
  }
}

/** Refuse a stale price instead of silently asking the phone to authorize more. */
export function requireCurrentBookEdition(book: ContentBundle, requestedRevision: unknown): void {
  if (typeof requestedRevision !== 'string' || requestedRevision !== book.updatedAt) {
    throw new ChapterBookCheckoutError(409, 'This book edition has changed. Reopen its contents and review the chapters before paying.');
  }
}

export function requireCurrentBookPrice(quote: ContentBookQuote, requestedAmount: unknown): number {
  if (quote.alreadyOwned || quote.amountKes === 0) {
    throw new ChapterBookCheckoutError(409, 'You already have purchase access to every paid chapter. Open the book to read.');
  }
  if (typeof requestedAmount !== 'number' || !Number.isSafeInteger(requestedAmount) || requestedAmount !== quote.amountKes) {
    throw new ChapterBookCheckoutError(409, 'Your book price or chapter ownership has changed. Reopen the book and review the updated price before paying.');
  }
  return quote.amountKes;
}

export function createChapterBookQuoteHandler(dependencies: ChapterBookCheckoutDependencies) {
  return async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    try {
      const result = await loadChapterBookCheckout(req.params.id, (req as Request & { user?: Reader }).user, dependencies);
      return res.json(result.quote);
    } catch (error) {
      if (error instanceof ChapterBookCheckoutError) return res.status(error.status).json({ error: error.message });
      console.error('[Chapter Books] Purchase quote could not be verified.');
      return res.status(503).json({ error: 'Book pricing is temporarily unavailable. Please retry before paying.' });
    }
  };
}
