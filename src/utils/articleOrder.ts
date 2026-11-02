import type { Article } from '../types.js';

function timestamp(value: string): number {
  const time = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? time : -Infinity;
}

function publicationTime(article: Article): number {
  const published = timestamp(article.publishedAt);
  return published !== -Infinity ? published : timestamp(article.createdAt);
}

/** Display chronology only. Editing a piece must not count as publishing it. */
export function orderArticlesNewestFirst(articles: readonly Article[]): Article[] {
  return [...articles].sort((left, right) => (
    publicationTime(right) - publicationTime(left)
    || timestamp(right.createdAt) - timestamp(left.createdAt)
    || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
  ));
}
