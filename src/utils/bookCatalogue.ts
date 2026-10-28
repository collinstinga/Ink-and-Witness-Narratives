import type { Article, ContentBookQuote, ContentBundle } from '../types.js';

export interface ChapterBookContext {
  book: ContentBundle;
  chapters: Article[];
}

/** Validate the display contract; the payment server remains authoritative. */
export function isBookQuoteFor(book: ContentBundle, value: unknown): value is ContentBookQuote {
  if (!value || typeof value !== 'object') return false;
  const quote = value as ContentBookQuote;
  if (quote.bookId !== book.id || typeof quote.bookUpdatedAt !== 'string' || quote.bookUpdatedAt !== book.updatedAt || typeof quote.alreadyOwned !== 'boolean'
    || !Number.isSafeInteger(quote.listPriceKes) || quote.listPriceKes < 1
    || !Number.isSafeInteger(quote.amountKes) || quote.amountKes < 0 || quote.amountKes > quote.listPriceKes
    || quote.creditKes !== quote.listPriceKes - quote.amountKes
    || !['full_price', 'remaining_chapters'].includes(quote.pricingPolicy)
    || !Array.isArray(quote.ownedPieceIds) || !Array.isArray(quote.remainingPieceIds)) return false;
  const ids = new Set(book.pieceIds);
  const owned = new Set(quote.ownedPieceIds);
  return quote.ownedPieceIds.every(id => typeof id === 'string' && ids.has(id))
    && quote.remainingPieceIds.every(id => typeof id === 'string' && ids.has(id) && !owned.has(id))
    && quote.alreadyOwned === (quote.remainingPieceIds.length === 0)
    && (quote.alreadyOwned ? quote.amountKes === 0 : quote.amountKes >= 1);
}

/** Catalogue presentation only: never deletes chapters or changes their access. */
export function visibleStandaloneArticles(articles: Article[], books: ContentBundle[]): Article[] {
  const hiddenChapterIds = new Set(books
    .filter(book => book.kind === 'book' && book.isPublished && book.showChaptersSeparately === false)
    .flatMap(book => book.pieceIds));
  return articles.filter(article => !hiddenChapterIds.has(article.id));
}

/** Resolve stable chapter IDs in the writer's order, without exposing drafts. */
export function orderedBookChapters(book: ContentBundle, articles: Article[]): Article[] {
  const byId = new Map(articles
    .filter(article => article.status === 'published' || !article.status)
    .map(article => [article.id, article]));
  const seen = new Set<string>();
  return book.pieceIds.flatMap(id => {
    const chapter = byId.get(id);
    if (!chapter || seen.has(id)) return [];
    seen.add(id);
    return [chapter];
  });
}

export function resolveChapterBook(
  articleId: string,
  articles: Article[],
  books: ContentBundle[],
): ChapterBookContext | null {
  const book = books.find(candidate => candidate.kind === 'book'
    && candidate.isPublished && candidate.pieceIds.includes(articleId));
  if (!book) return null;
  const chapters = orderedBookChapters(book, articles);
  return chapters.some(chapter => chapter.id === articleId) ? { book, chapters } : null;
}
