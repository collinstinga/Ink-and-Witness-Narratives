import { Article, ContentCollection, HomepageConfig } from '../types.js';

const MAX_HOMEPAGE_COLLECTIONS = 6;
const MAX_HOMEPAGE_PIECES = 8;

function uniqueIds(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const candidate of value) {
    if (typeof candidate !== 'string') continue;
    const id = candidate.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
    if (result.length >= limit) break;
  }
  return result;
}

function articleTimestamp(article: Article): number {
  for (const value of [article.publishedAt, article.createdAt, article.updatedAt]) {
    const timestamp = Date.parse(value || '');
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return 0;
}

export function resolveHomepageCuration(
  config: Pick<HomepageConfig, 'homepageCollectionIds' | 'homepagePieceIds'>,
  collections: ContentCollection[],
  articles: Article[]
): { collections: ContentCollection[]; pieces: Article[] } {
  const publishedArticles = articles.filter(article => article.status === 'published' || !article.status);
  const articleById = new Map(publishedArticles.map(article => [article.id, article]));
  const publishedCollections = collections
    .filter(collection => collection.isPublished)
    .sort((left, right) => left.order - right.order || left.name.localeCompare(right.name));
  const collectionById = new Map(publishedCollections.map(collection => [collection.id, collection]));

  const configuredCollectionIds = config.homepageCollectionIds === undefined
    ? publishedCollections.slice(0, 4).map(collection => collection.id)
    : uniqueIds(config.homepageCollectionIds, MAX_HOMEPAGE_COLLECTIONS);
  const selectedCollections = configuredCollectionIds
    .map(id => collectionById.get(id))
    .filter((collection): collection is ContentCollection => Boolean(collection));

  const representedPieceIds = new Set<string>();
  for (const collection of selectedCollections) {
    for (const pieceId of collection.pieceIds) {
      if (articleById.has(pieceId)) representedPieceIds.add(pieceId);
    }
  }

  const configuredPieceIds = config.homepagePieceIds === undefined
    ? [...publishedArticles]
      .sort((left, right) => articleTimestamp(right) - articleTimestamp(left))
      .map(article => article.id)
    : uniqueIds(config.homepagePieceIds, MAX_HOMEPAGE_PIECES);
  const seenPieces = new Set<string>();
  const pieces: Article[] = [];
  for (const id of configuredPieceIds) {
    const article = articleById.get(id);
    if (!article || representedPieceIds.has(id) || seenPieces.has(id)) continue;
    seenPieces.add(id);
    pieces.push(article);
    if (pieces.length >= MAX_HOMEPAGE_PIECES) break;
  }

  return { collections: selectedCollections, pieces };
}
