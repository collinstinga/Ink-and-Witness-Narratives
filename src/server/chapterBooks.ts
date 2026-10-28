import type { Article, ContentBookQuote, ContentBundle } from '../types.js';

export const MAX_BOOK_CHAPTERS = 30;
const PIECE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

type BookMetadata = Required<Pick<ContentBundle, 'kind' | 'showChaptersSeparately' | 'existingOwnerPricing'>>;

/** Strict write validation. Omitted fields from older clients retain existing metadata. */
export function validateChapterBookMetadata(value: unknown, previous?: Partial<ContentBundle> | null): BookMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid book settings.');
  const input = value as Record<string, unknown>;
  const kind = input.kind === undefined ? previous?.kind ?? 'bundle' : input.kind;
  const showChaptersSeparately = input.showChaptersSeparately === undefined
    ? previous?.showChaptersSeparately ?? true
    : input.showChaptersSeparately;
  const existingOwnerPricing = input.existingOwnerPricing === undefined
    ? previous?.existingOwnerPricing ?? 'full_price'
    : input.existingOwnerPricing;
  if (kind !== 'bundle' && kind !== 'book') throw new Error('Choose a bundle or a chaptered book.');
  if (typeof showChaptersSeparately !== 'boolean') throw new Error('Chapter visibility must be on or off.');
  if (existingOwnerPricing !== 'full_price' && existingOwnerPricing !== 'remaining_chapters') {
    throw new Error('Choose a valid existing-reader price policy.');
  }
  if (kind !== 'book' && (!showChaptersSeparately || existingOwnerPricing !== 'full_price')) {
    throw new Error('Chapter visibility and chapter credits apply only to books.');
  }
  return { kind, showChaptersSeparately, existingOwnerPricing };
}

export function validateContentBundlePieceIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 2) throw new Error('A bundle or book must contain at least two pieces.');
  if (value.length > MAX_BOOK_CHAPTERS) throw new Error(`A bundle or book can contain at most ${MAX_BOOK_CHAPTERS} pieces.`);
  const result: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (typeof candidate !== 'string' || !PIECE_ID.test(candidate)) throw new Error('Every chapter must have a valid piece identifier.');
    if (seen.has(candidate)) throw new Error('A piece cannot appear more than once in the same bundle or book.');
    seen.add(candidate);
    result.push(candidate);
  }
  return result;
}

/** Returns authoritative members in the stored chapter order, never catalogue order. */
export function validateContentBundleMembers(
  bundle: Pick<ContentBundle, 'pieceIds' | 'isPublished'>,
  articles: readonly Article[],
  options: { requirePublished?: boolean } = {}
): Article[] {
  const pieceIds = validateContentBundlePieceIds(bundle.pieceIds);
  const byId = new Map(articles.map(article => [article.id, article]));
  const requirePublished = options.requirePublished ?? bundle.isPublished;
  return pieceIds.map(id => {
    const article = byId.get(id);
    if (!article) throw new Error('A selected chapter no longer exists. Refresh before saving or purchasing.');
    if (requirePublished && article.status !== 'published') {
      throw new Error('Publish every included chapter before publishing or purchasing this book or bundle.');
    }
    return article;
  });
}

/**
 * Only server-verified purchase ownership may be supplied here. Access flags,
 * reader passes, affiliate privileges and manual grants are not purchase credit.
 * Paid weights use current individual chapter prices; free chapters weigh zero.
 * Purchases still snapshot ALL chapters, so previous IDs/rights remain intact.
 */
export function quoteChapterBook(
  book: ContentBundle,
  articles: readonly Article[],
  permanentOwnedPieceIds: Iterable<string>
): ContentBookQuote {
  const metadata = validateChapterBookMetadata(book);
  if (metadata.kind !== 'book' || book.isPublished !== true) throw new Error('This published chaptered book is unavailable.');
  if (typeof book.updatedAt !== 'string' || !book.updatedAt || book.updatedAt !== book.updatedAt.trim()
    || book.updatedAt.length > 80 || !Number.isFinite(Date.parse(book.updatedAt))) {
    throw new Error('This book needs a valid saved revision before purchase.');
  }
  if (!Number.isSafeInteger(book.priceKes) || book.priceKes < 1 || book.priceKes > 1_000_000) {
    throw new Error('This book needs a valid whole-shilling price before purchase.');
  }
  const members = validateContentBundleMembers(book, articles, { requirePublished: true });
  const owned = new Set(permanentOwnedPieceIds);
  const ownedPieceIds = members.filter(article => owned.has(article.id)).map(article => article.id);
  const remaining = members.filter(article => article.isPaid !== false && !owned.has(article.id));
  const remainingPieceIds = remaining.map(article => article.id);
  const alreadyOwned = remainingPieceIds.length === 0;
  let amountKes = alreadyOwned ? 0 : book.priceKes;
  if (!alreadyOwned && metadata.existingOwnerPricing === 'remaining_chapters') {
    const weight = (article: Article): number => {
      if (article.isPaid === false) return 0;
      // Do not turn malformed or legacy zero-priced paid chapters into free credits.
      if (!Number.isFinite(article.priceKes) || article.priceKes <= 0 || article.priceKes > 1_000_000) {
        throw new Error('Every paid chapter needs a valid price before chapter credits can be calculated.');
      }
      return Math.max(1, Math.round(article.priceKes * 100));
    };
    const totalWeight = members.reduce((total, article) => total + weight(article), 0);
    const remainingWeight = remaining.reduce((total, article) => total + weight(article), 0);
    // At most 30 × 100,000,000 × 1,000,000, below Number.MAX_SAFE_INTEGER.
    amountKes = Math.min(book.priceKes, Math.max(1, Math.ceil(book.priceKes * remainingWeight / totalWeight)));
  }
  return {
    bookId: book.id,
    bookUpdatedAt: book.updatedAt,
    listPriceKes: book.priceKes,
    amountKes,
    creditKes: book.priceKes - amountKes,
    ownedPieceIds,
    remainingPieceIds,
    alreadyOwned,
    pricingPolicy: metadata.existingOwnerPricing
  };
}
