import { Article, ContentBundle, ContentCollection, HomepageConfig } from '../types.js';

const MAX_HOMEPAGE_COLLECTIONS = 6;
const MAX_HOMEPAGE_BUNDLES = 6;
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
  config: Pick<HomepageConfig, 'homepageCollectionIds' | 'homepageBundleIds' | 'homepagePieceIds'>,
  collections: ContentCollection[],
  bundles: ContentBundle[],
  articles: Article[]
): { collections: ContentCollection[]; bundles: ContentBundle[]; pieces: Article[] } {
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

  // A homepage bundle must be immediately purchasable. This mirrors the
  // checkout guard: every referenced piece must still be published and a
  // bundle must contain at least two distinct pieces.
  const publishedBundles = bundles
    .filter(bundle => bundle.isPublished)
    .filter(bundle => {
      const pieceIds = uniqueIds(bundle.pieceIds, 30);
      return pieceIds.length >= 2
        && pieceIds.length === bundle.pieceIds.length
        && pieceIds.every(id => articleById.has(id));
    })
    .sort((left, right) => {
      const updatedDifference = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
      return (Number.isFinite(updatedDifference) ? updatedDifference : 0)
        || left.name.localeCompare(right.name);
    });
  const bundleById = new Map(publishedBundles.map(bundle => [bundle.id, bundle]));
  const configuredBundleIds = config.homepageBundleIds === undefined
    ? publishedBundles.slice(0, 4).map(bundle => bundle.id)
    : uniqueIds(config.homepageBundleIds, MAX_HOMEPAGE_BUNDLES);
  const selectedBundles = configuredBundleIds
    .map(id => bundleById.get(id))
    .filter((bundle): bundle is ContentBundle => Boolean(bundle));

  const representedPieceIds = new Set<string>();
  for (const bundle of selectedBundles) {
    for (const pieceId of bundle.pieceIds) {
      representedPieceIds.add(pieceId);
    }
  }
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

  return { collections: selectedCollections, bundles: selectedBundles, pieces };
}
