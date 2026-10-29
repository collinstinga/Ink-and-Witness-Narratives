import crypto from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import {
  ContentBundle,
  ContentCollection,
  PieceReview,
  ReaderArticleProgress,
  ReaderBookmark,
  ReaderHighlight,
  ReaderReactionType
} from '../types.js';
import { getDb, sanitizeForFirestore } from './db.js';
import { validateChapterBookMetadata, validateContentBundlePieceIds } from './chapterBooks.js';

const PROFILE_COLLECTION = 'reader_profiles';
const SOCIAL_COLLECTION = 'piece_social';
const REACTION_COLLECTION = 'reader_piece_reactions';
const REVIEW_COLLECTION = 'piece_reviews';
const REVIEW_RATING_COLLECTION = 'reader_piece_review_ratings';
const COLLECTIONS_COLLECTION = 'content_collections';
const BUNDLES_COLLECTION = 'content_bundles';
const MAX_PROGRESS_ITEMS = 100;
const MAX_RECENT_ITEMS = 40;
const MAX_BOOKMARKS = 30;
const MAX_HIGHLIGHTS = 60;

export const READER_REACTIONS: ReaderReactionType[] = [
  'this_hurt',
  'felt_seen',
  'beautiful',
  'reread',
  'damn'
];

type RecentView = { articleId: string; viewedAt: string };
type ReaderProfile = {
  version: 1;
  userId: string;
  progress: Record<string, ReaderArticleProgress>;
  recent: RecentView[];
  interestScores: Record<string, number>;
  updatedAt: string;
};

type StoredReview = PieceReview & {
  userId: string;
  readerName?: string;
};

type SocialRecord = {
  articleId: string;
  reactionCounts?: Partial<Record<ReaderReactionType, number>>;
  verifiedReviewCount?: number;
  ratingTotal?: number;
  completedReadCount?: number;
  testimonials?: PieceReview[];
  updatedAt?: string;
};

function hashId(...parts: string[]): string {
  return crypto.createHash('sha256').update(parts.join('\u001f')).digest('hex');
}

function safeId(value: unknown): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(normalized)) {
    throw new Error('Invalid identifier.');
  }
  return normalized;
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, maxLength)
    : '';
}

function clampNumber(value: unknown, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return min;
  return Math.max(min, Math.min(max, parsed));
}

function normalizeCoverPosition(value: unknown): { x: number; y: number } | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const input = value as { x?: unknown; y?: unknown };
  const x = Number(input.x);
  const y = Number(input.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  return {
    x: Math.round(clampNumber(x, 0, 100) * 10) / 10,
    y: Math.round(clampNumber(y, 0, 100) * 10) / 10,
  };
}

function emptyReactionCounts(): Record<ReaderReactionType, number> {
  return {
    this_hurt: 0,
    felt_seen: 0,
    beautiful: 0,
    reread: 0,
    damn: 0
  };
}

function reviewResponse(review: StoredReview): PieceReview {
  return { id: review.id, articleId: review.articleId, rating: review.rating, review: review.review,
    status: review.status, featured: review.featured === true, verifiedReader: true,
    createdAt: review.createdAt, updatedAt: review.updatedAt };
}

function publicTestimonials(reviews: StoredReview[], articleId: string): PieceReview[] {
  return reviews
    .filter(review => review && review.articleId === articleId && review.status === 'approved' && review.verifiedReader === true
      && typeof review.id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(review.id)
      && Number.isInteger(review.rating) && review.rating >= 1 && review.rating <= 5
      && typeof review.review === 'string' && review.review.length >= 10 && review.review.length <= 2000
      && Number.isFinite(Date.parse(review.createdAt)) && Number.isFinite(Date.parse(review.updatedAt)))
    .sort((left, right) => Number(right.featured) - Number(left.featured) || Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .slice(0, 12)
    .map(reviewResponse);
}

function normalizeProfile(userId: string, value: unknown): ReaderProfile {
  const now = new Date().toISOString();
  if (!value || typeof value !== 'object') {
    return { version: 1, userId, progress: {}, recent: [], interestScores: {}, updatedAt: now };
  }
  const input = value as Partial<ReaderProfile>;
  return {
    version: 1,
    userId,
    progress: input.progress && typeof input.progress === 'object' ? input.progress : {},
    recent: Array.isArray(input.recent) ? input.recent.slice(0, MAX_RECENT_ITEMS) : [],
    interestScores: input.interestScores && typeof input.interestScores === 'object' ? input.interestScores : {},
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : now
  };
}

function normalizeBookmarks(value: unknown): ReaderBookmark[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: ReaderBookmark[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') continue;
    const input = candidate as Partial<ReaderBookmark>;
    const blockId = cleanText(input.blockId, 160);
    if (!/^reader-para-\d+$/.test(blockId) || seen.has(blockId)) continue;
    seen.add(blockId);
    result.push({
      id: typeof input.id === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(input.id)
        ? input.id
        : `mark_${hashId(blockId, String(input.createdAt || '')).slice(0, 20)}`,
      blockId,
      label: cleanText(input.label, 180) || 'Saved passage',
      createdAt: typeof input.createdAt === 'string' && Number.isFinite(Date.parse(input.createdAt))
        ? input.createdAt
        : new Date().toISOString()
    });
    if (result.length >= MAX_BOOKMARKS) break;
  }
  return result;
}

function normalizeHighlights(value: unknown): ReaderHighlight[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: ReaderHighlight[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') continue;
    const input = candidate as Partial<ReaderHighlight>;
    const blockId = cleanText(input.blockId, 160);
    const startOffset = Math.floor(clampNumber(input.startOffset, 0, 100_000));
    const endOffset = Math.floor(clampNumber(input.endOffset, 0, 100_000));
    const text = cleanText(input.text, 500);
    const key = `${blockId}:${startOffset}:${endOffset}`;
    if (
      !/^reader-para-\d+$/.test(blockId)
      || endOffset <= startOffset
      || endOffset - startOffset > 2_000
      || !text
      || seen.has(key)
    ) continue;
    seen.add(key);
    result.push({
      id: typeof input.id === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(input.id)
        ? input.id
        : `highlight_${hashId(key, String(input.createdAt || '')).slice(0, 20)}`,
      blockId,
      startOffset,
      endOffset,
      text,
      color: 'amber',
      createdAt: typeof input.createdAt === 'string' && Number.isFinite(Date.parse(input.createdAt))
        ? input.createdAt
        : new Date().toISOString()
    });
    if (result.length >= MAX_HIGHLIGHTS) break;
  }
  return result;
}

function capProgress(progress: Record<string, ReaderArticleProgress>): Record<string, ReaderArticleProgress> {
  return Object.fromEntries(Object.entries(progress)
    .sort(([, left], [, right]) => Date.parse(right.lastReadAt) - Date.parse(left.lastReadAt))
    .slice(0, MAX_PROGRESS_ITEMS));
}

function normalizeContentCollection(id: string, value: unknown): ContentCollection | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Partial<ContentCollection>;
  const name = cleanText(input.name, 120);
  if (!name) return null;
  const coverPosition = normalizeCoverPosition(input.coverPosition);
  return {
    id,
    name,
    slug: cleanText(input.slug, 140) || id,
    description: cleanText(input.description, 1_500),
    pieceIds: Array.isArray(input.pieceIds)
      ? [...new Set(input.pieceIds.map(item => cleanText(item, 128)).filter(Boolean))].slice(0, 100)
      : [],
    ...(cleanText(input.coverImage, 2_048) ? { coverImage: cleanText(input.coverImage, 2_048) } : {}),
    ...(coverPosition ? { coverPosition } : {}),
    order: Math.floor(clampNumber(input.order, 0, 10_000)),
    isPublished: input.isPublished === true,
    createdAt: typeof input.createdAt === 'string' ? input.createdAt : new Date().toISOString(),
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : new Date().toISOString()
  };
}

function normalizeBundle(id: string, value: unknown): ContentBundle | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Partial<ContentBundle>;
  const name = cleanText(input.name, 120);
  if (!name) return null;
  let metadata: ReturnType<typeof validateChapterBookMetadata>;
  try {
    metadata = validateChapterBookMetadata(input);
    // Books must not silently omit duplicate, malformed or truncated chapters.
    if (metadata.kind === 'book') validateContentBundlePieceIds(input.pieceIds);
  } catch {
    return null;
  }
  const coverPosition = normalizeCoverPosition(input.coverPosition);
  return {
    id,
    ...metadata,
    name,
    slug: cleanText(input.slug, 140) || id,
    description: cleanText(input.description, 1_500),
    pieceIds: Array.isArray(input.pieceIds)
      ? [...new Set(input.pieceIds.map(item => cleanText(item, 128)).filter(Boolean))].slice(0, 30)
      : [],
    priceKes: Math.round(clampNumber(input.priceKes, 1, 1_000_000)),
    ...(cleanText(input.coverImage, 2_048) ? { coverImage: cleanText(input.coverImage, 2_048) } : {}),
    ...(coverPosition ? { coverPosition } : {}),
    isPublished: input.isPublished === true,
    createdAt: typeof input.createdAt === 'string' ? input.createdAt : new Date().toISOString(),
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : new Date().toISOString()
  };
}

export class ChapterBookSaveConflictError extends Error {
  readonly statusCode = 409;
  readonly code = 'CHAPTER_BOOK_SAVE_CONFLICT';

  constructor() {
    super('This book changed since you opened it. Reload its latest chapters and price before saving again.');
  }
}

export const readerExperienceStore = {
  async getProfile(userId: string): Promise<ReaderProfile> {
    const profileId = hashId(safeId(userId));
    const snapshot = await getDb().collection(PROFILE_COLLECTION).doc(profileId).get();
    return normalizeProfile(userId, snapshot.exists ? snapshot.data() : null);
  },

  async saveProgress(input: {
    userId: string;
    articleId: string;
    percent?: number;
    blockId?: string;
    activeChapterId?: string;
    activeChapterTitle?: string;
    chapterPercent?: number;
    interests?: string[];
  }): Promise<ReaderArticleProgress> {
    const userId = safeId(input.userId);
    const articleId = safeId(input.articleId);
    const profileRef = getDb().collection(PROFILE_COLLECTION).doc(hashId(userId));
    const socialRef = getDb().collection(SOCIAL_COLLECTION).doc(articleId);
    const now = new Date().toISOString();
    return getDb().runTransaction(async transaction => {
      const profileSnapshot = await transaction.get(profileRef);
      const profile = normalizeProfile(userId, profileSnapshot.exists ? profileSnapshot.data() : null);
      const previous = profile.progress[articleId];
      const percent = Math.round(clampNumber(input.percent ?? previous?.percent ?? 0, 0, 100) * 10) / 10;
      const furthestPercent = Math.max(previous?.furthestPercent ?? previous?.percent ?? 0, percent);
      const becameComplete = furthestPercent >= 95 && !previous?.completedAt;
      const blockId = cleanText(input.blockId, 160) || previous?.blockId;
      const activeChapterId = cleanText(input.activeChapterId, 160) || previous?.activeChapterId;
      const activeChapterTitle = cleanText(input.activeChapterTitle, 180) || previous?.activeChapterTitle;
      const chapterPercent = input.chapterPercent !== undefined
        ? Math.round(clampNumber(input.chapterPercent, 0, 100) * 10) / 10
        : previous?.chapterPercent;
      const progress: ReaderArticleProgress = {
        articleId,
        percent,
        furthestPercent,
        ...(blockId ? { blockId } : {}),
        ...(activeChapterId ? { activeChapterId } : {}),
        ...(activeChapterTitle ? { activeChapterTitle } : {}),
        ...(chapterPercent !== undefined ? { chapterPercent } : {}),
        bookmarks: normalizeBookmarks(previous?.bookmarks),
        highlights: normalizeHighlights(previous?.highlights),
        startedAt: previous?.startedAt || now,
        lastReadAt: now,
        ...(previous?.completedAt || becameComplete ? { completedAt: previous?.completedAt || now } : {})
      };
      profile.progress[articleId] = progress;
      profile.progress = capProgress(profile.progress);
      profile.recent = [
        { articleId, viewedAt: now },
        ...profile.recent.filter(item => item.articleId !== articleId)
      ].slice(0, MAX_RECENT_ITEMS);
      if (!previous) {
        for (const rawInterest of input.interests || []) {
          const interest = cleanText(rawInterest, 80).toLocaleLowerCase('en');
          if (!interest) continue;
          profile.interestScores[interest] = Math.min(1_000, (Number(profile.interestScores[interest]) || 0) + 1);
        }
      }
      profile.updatedAt = now;
      transaction.set(profileRef, sanitizeForFirestore(profile), { merge: false });
      if (becameComplete) {
        transaction.set(socialRef, {
          articleId,
          completedReadCount: FieldValue.increment(1),
          updatedAt: now
        }, { merge: true });
      }
      return progress;
    });
  },

  async toggleBookmark(input: {
    userId: string;
    articleId: string;
    blockId: string;
    label?: string;
  }): Promise<{ bookmarked: boolean; progress: ReaderArticleProgress }> {
    const userId = safeId(input.userId);
    const articleId = safeId(input.articleId);
    const blockId = cleanText(input.blockId, 160);
    if (!/^reader-para-\d+$/.test(blockId)) throw new Error('Invalid reading position.');
    const profileRef = getDb().collection(PROFILE_COLLECTION).doc(hashId(userId));
    return getDb().runTransaction(async transaction => {
      const snapshot = await transaction.get(profileRef);
      const profile = normalizeProfile(userId, snapshot.exists ? snapshot.data() : null);
      const now = new Date().toISOString();
      const previous = profile.progress[articleId] || {
        articleId,
        percent: 0,
        bookmarks: [],
        startedAt: now,
        lastReadAt: now
      };
      const bookmarks = normalizeBookmarks(previous.bookmarks);
      const existing = bookmarks.find(item => item.blockId === blockId);
      const nextBookmarks = existing
        ? bookmarks.filter(item => item.blockId !== blockId)
        : [{
            id: `mark_${crypto.randomBytes(12).toString('base64url')}`,
            blockId,
            label: cleanText(input.label, 180) || 'Saved passage',
            createdAt: now
          }, ...bookmarks].slice(0, MAX_BOOKMARKS);
      const progress = { ...previous, bookmarks: nextBookmarks, lastReadAt: now };
      profile.progress[articleId] = progress;
      profile.progress = capProgress(profile.progress);
      profile.updatedAt = now;
      transaction.set(profileRef, sanitizeForFirestore(profile), { merge: false });
      return { bookmarked: !existing, progress };
    });
  },

  async addHighlight(input: {
    userId: string;
    articleId: string;
    blockId: string;
    startOffset: number;
    endOffset: number;
    text: string;
  }): Promise<{ created: boolean; progress: ReaderArticleProgress }> {
    const userId = safeId(input.userId);
    const articleId = safeId(input.articleId);
    const blockId = cleanText(input.blockId, 160);
    const startOffset = Math.floor(clampNumber(input.startOffset, 0, 100_000));
    const endOffset = Math.floor(clampNumber(input.endOffset, 0, 100_000));
    const text = cleanText(input.text, 500);
    if (!/^reader-para-\d+$/.test(blockId)) throw new Error('Invalid highlight position.');
    if (!text || endOffset <= startOffset || endOffset - startOffset > 2_000) {
      throw new Error('Select one valid passage to highlight.');
    }
    const profileRef = getDb().collection(PROFILE_COLLECTION).doc(hashId(userId));
    return getDb().runTransaction(async transaction => {
      const snapshot = await transaction.get(profileRef);
      const profile = normalizeProfile(userId, snapshot.exists ? snapshot.data() : null);
      const now = new Date().toISOString();
      const previous = profile.progress[articleId] || {
        articleId,
        percent: 0,
        bookmarks: [],
        highlights: [],
        startedAt: now,
        lastReadAt: now
      };
      const highlights = normalizeHighlights(previous.highlights);
      const existing = highlights.find(item =>
        item.blockId === blockId
        && item.startOffset === startOffset
        && item.endOffset === endOffset
      );
      if (existing) return { created: false, progress: { ...previous, highlights } };
      const nextHighlights = [{
        id: `highlight_${crypto.randomBytes(12).toString('base64url')}`,
        blockId,
        startOffset,
        endOffset,
        text,
        color: 'amber' as const,
        createdAt: now
      }, ...highlights].slice(0, MAX_HIGHLIGHTS);
      const progress = { ...previous, highlights: nextHighlights, lastReadAt: now };
      profile.progress[articleId] = progress;
      profile.progress = capProgress(profile.progress);
      profile.updatedAt = now;
      transaction.set(profileRef, sanitizeForFirestore(profile), { merge: false });
      return { created: true, progress };
    });
  },

  async removeHighlight(input: {
    userId: string;
    articleId: string;
    highlightId: string;
  }): Promise<{ removed: boolean; progress: ReaderArticleProgress }> {
    const userId = safeId(input.userId);
    const articleId = safeId(input.articleId);
    const highlightId = cleanText(input.highlightId, 100);
    if (!/^highlight_[A-Za-z0-9_-]{8,80}$/.test(highlightId)) throw new Error('Invalid highlight.');
    const profileRef = getDb().collection(PROFILE_COLLECTION).doc(hashId(userId));
    return getDb().runTransaction(async transaction => {
      const snapshot = await transaction.get(profileRef);
      const profile = normalizeProfile(userId, snapshot.exists ? snapshot.data() : null);
      const now = new Date().toISOString();
      const previous = profile.progress[articleId] || {
        articleId,
        percent: 0,
        bookmarks: [],
        highlights: [],
        startedAt: now,
        lastReadAt: now
      };
      const highlights = normalizeHighlights(previous.highlights);
      const nextHighlights = highlights.filter(item => item.id !== highlightId);
      const removed = nextHighlights.length !== highlights.length;
      const progress = { ...previous, highlights: nextHighlights, lastReadAt: now };
      profile.progress[articleId] = progress;
      profile.progress = capProgress(profile.progress);
      profile.updatedAt = now;
      transaction.set(profileRef, sanitizeForFirestore(profile), { merge: false });
      return { removed, progress };
    });
  },

  async setReaction(userIdInput: string, articleIdInput: string, reactionInput: unknown) {
    const userId = safeId(userIdInput);
    const articleId = safeId(articleIdInput);
    const reaction = READER_REACTIONS.includes(reactionInput as ReaderReactionType)
      ? reactionInput as ReaderReactionType
      : null;
    if (!reaction) throw new Error('Invalid reaction.');
    const reactionRef = getDb().collection(REACTION_COLLECTION).doc(hashId(userId, articleId));
    const socialRef = getDb().collection(SOCIAL_COLLECTION).doc(articleId);
    const now = new Date().toISOString();
    return getDb().runTransaction(async transaction => {
      const [reactionSnapshot, socialSnapshot] = await Promise.all([
        transaction.get(reactionRef),
        transaction.get(socialRef)
      ]);
      const existing = reactionSnapshot.exists
        ? reactionSnapshot.data() as { reaction?: ReaderReactionType }
        : null;
      const nextReaction = existing?.reaction === reaction ? null : reaction;
      const social = (socialSnapshot.exists ? socialSnapshot.data() : {}) as SocialRecord;
      const counts = { ...emptyReactionCounts(), ...(social.reactionCounts || {}) };
      if (existing?.reaction && READER_REACTIONS.includes(existing.reaction)) {
        counts[existing.reaction] = Math.max(0, (Number(counts[existing.reaction]) || 0) - 1);
      }
      if (nextReaction) counts[nextReaction] = (Number(counts[nextReaction]) || 0) + 1;
      if (nextReaction) {
        transaction.set(reactionRef, { articleId, reaction: nextReaction, updatedAt: now }, { merge: false });
      } else {
        transaction.delete(reactionRef);
      }
      transaction.set(socialRef, { articleId, reactionCounts: counts, updatedAt: now }, { merge: true });
      return { reactionCounts: counts, currentReaction: nextReaction || undefined };
    });
  },

  async getSocial(articleIdInput: string, userIdInput?: string) {
    const articleId = safeId(articleIdInput);
    const socialRef = getDb().collection(SOCIAL_COLLECTION).doc(articleId);
    const socialPromise = socialRef.get();
    const reactionPromise = userIdInput
      ? getDb().collection(REACTION_COLLECTION).doc(hashId(safeId(userIdInput), articleId)).get()
      : Promise.resolve(null);
    const approvedQuery = getDb().collection(REVIEW_COLLECTION).where('articleId', '==', articleId).where('status', '==', 'approved');
    const [socialSnapshot, reactionSnapshot, approvedReviews, featuredReviews] = await Promise.all([
      socialPromise,
      reactionPromise,
      approvedQuery.orderBy('updatedAt', 'desc').limit(12).get(),
      approvedQuery.where('featured', '==', true).orderBy('updatedAt', 'desc').limit(12).get()
    ]);
    const social = (socialSnapshot.exists ? socialSnapshot.data() : {}) as SocialRecord;
    const ratingTotal = Number(social.ratingTotal) || 0;
    const verifiedReviewCount = Math.max(0, Number(social.verifiedReviewCount) || 0);
    // Approval is read from the source records, not a stale embedded social
    // snapshot. Anonymous reads never backfill or mutate the database.
    const reviews = publicTestimonials(approvedReviews.docs.map(document => ({ ...document.data(), id: document.id }) as StoredReview), articleId);
    const testimonials = publicTestimonials(featuredReviews.docs.map(document => ({ ...document.data(), id: document.id }) as StoredReview), articleId);
    const currentReaction = reactionSnapshot?.exists
      ? reactionSnapshot.data()?.reaction as ReaderReactionType | undefined
      : undefined;
    return {
      reactionCounts: { ...emptyReactionCounts(), ...(social.reactionCounts || {}) },
      currentReaction,
      verifiedReviewCount,
      averageRating: verifiedReviewCount > 0 ? Math.round((ratingTotal / verifiedReviewCount) * 10) / 10 : 0,
      completedReadCount: Math.max(0, Number(social.completedReadCount) || 0),
      testimonials,
      reviews
    };
  },

  async saveReview(input: {
    userId: string;
    readerName?: string;
    articleId: string;
    rating: unknown;
    review: unknown;
    submissionId?: unknown;
  }): Promise<PieceReview> {
    const userId = safeId(input.userId);
    const articleId = safeId(input.articleId);
    if (typeof input.rating !== 'number' || !Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) throw new Error('Choose a rating from 1 to 5.');
    const rating = input.rating;
    const reviewText = cleanText(input.review, 2_000);
    if (reviewText.length < 10) throw new Error('Review must contain at least 10 characters.');
    if (input.submissionId !== undefined && (typeof input.submissionId !== 'string' || !/^[A-Za-z0-9_-]{16,80}$/.test(input.submissionId))) throw new Error('Invalid review submission identifier.');
    const identity = hashId(userId, articleId);
    // Legacy clients still get content-based retry protection. New clients use
    // a fresh intent ID for each deliberate response, including identical text.
    const intent = (input.submissionId as string | undefined) ?? `legacy:${hashId(String(rating), reviewText)}`;
    const profileRef = getDb().collection(PROFILE_COLLECTION).doc(hashId(userId));
    const reviewRef = getDb().collection(REVIEW_COLLECTION).doc(`review_${hashId(userId, articleId, intent)}`);
    const legacyRef = getDb().collection(REVIEW_COLLECTION).doc(identity);
    const ratingRef = getDb().collection(REVIEW_RATING_COLLECTION).doc(identity);
    const socialRef = getDb().collection(SOCIAL_COLLECTION).doc(articleId);
    const now = new Date().toISOString();
    return getDb().runTransaction(async transaction => {
      const [profileSnapshot, reviewSnapshot, legacySnapshot, ratingSnapshot] = await Promise.all([
        transaction.get(profileRef),
        transaction.get(reviewRef),
        transaction.get(legacyRef),
        transaction.get(ratingRef)
      ]);
      const profile = normalizeProfile(userId, profileSnapshot.exists ? profileSnapshot.data() : null);
      const articleProgress = profile.progress[articleId];
      if ((articleProgress?.furthestPercent ?? articleProgress?.percent ?? 0) < 80) {
        const error = new Error('Finish at least 80% of the piece before reviewing it.');
        (error as any).statusCode = 403;
        throw error;
      }
      const existing = reviewSnapshot.exists ? reviewSnapshot.data() as StoredReview : null;
      if (existing) {
        if (existing.userId !== userId || existing.articleId !== articleId || existing.rating !== rating || existing.review !== reviewText) {
          const error = new Error('This review submission was already used for a different response.');
          (error as any).statusCode = 409;
          throw error;
        }
        // Retrying after publication must never reset the writer's decision.
        return reviewResponse(existing);
      }
      const legacy = legacySnapshot.exists ? legacySnapshot.data() as StoredReview : null;
      const anchor = ratingSnapshot.exists ? ratingSnapshot.data() as { version?: unknown; userId?: unknown; articleId?: unknown; rating?: unknown; createdAt?: unknown } : null;
      if ((legacy && (legacy.userId !== userId || legacy.articleId !== articleId || !Number.isInteger(legacy.rating) || legacy.rating < 1 || legacy.rating > 5))
        || (anchor && (anchor.version !== 1 || anchor.userId !== userId || anchor.articleId !== articleId || typeof anchor.rating !== 'number' || !Number.isInteger(anchor.rating) || anchor.rating < 1 || anchor.rating > 5))) {
        const error = new Error('The previous rating could not be verified. Contact the writer before trying again.');
        (error as any).statusCode = 503;
        throw error;
      }
      const previousRating = anchor ? Number(anchor.rating) : legacy?.rating;
      const stored: StoredReview = {
        id: reviewRef.id,
        userId,
        ...(cleanText(input.readerName, 80) ? { readerName: cleanText(input.readerName, 80) } : {}),
        articleId,
        rating,
        review: reviewText,
        status: 'pending',
        featured: false,
        verifiedReader: true,
        createdAt: now,
        updatedAt: now
      };
      transaction.create(reviewRef, sanitizeForFirestore(stored));
      transaction.set(ratingRef, { version: 1, userId, articleId, rating,
        createdAt: typeof anchor?.createdAt === 'string' ? anchor.createdAt : legacy?.createdAt || now,
        updatedAt: now }, { merge: false });
      transaction.set(socialRef, {
        articleId,
        // One rating contribution per reader/piece, even with several written
        // responses. Adopt a legacy contribution without recounting history.
        verifiedReviewCount: FieldValue.increment(previousRating === undefined ? 1 : 0),
        ratingTotal: FieldValue.increment(rating - (previousRating || 0)),
        updatedAt: now
      }, { merge: true });
      return reviewResponse(stored);
    });
  },

  async listReviews(): Promise<StoredReview[]> {
    const snapshot = await getDb().collection(REVIEW_COLLECTION).orderBy('updatedAt', 'desc').limit(250).get();
    return snapshot.docs
      .map(document => document.data() as StoredReview)
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  },

  async moderateReview(reviewIdInput: string, input: { status?: unknown; featured?: unknown }): Promise<StoredReview> {
    const reviewId = safeId(reviewIdInput);
    const ref = getDb().collection(REVIEW_COLLECTION).doc(reviewId);
    return getDb().runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new Error('Review not found.');
      const existing = snapshot.data() as StoredReview;
      const status = input.status === 'approved' || input.status === 'hidden' || input.status === 'pending' ? input.status : existing.status;
      const featured = input.featured === true && status === 'approved';
      const updated = { ...existing, status, featured, updatedAt: new Date().toISOString() };
      transaction.set(ref, sanitizeForFirestore(updated), { merge: false });
      return updated;
    });
  },

  async listCollections(includeUnpublished = false): Promise<ContentCollection[]> {
    const snapshot = await getDb().collection(COLLECTIONS_COLLECTION).limit(100).get();
    return snapshot.docs
      .map(document => normalizeContentCollection(document.id, document.data()))
      .filter((value): value is ContentCollection => Boolean(value) && (includeUnpublished || value!.isPublished))
      .sort((left, right) => left.order - right.order || left.name.localeCompare(right.name));
  },

  async saveCollection(value: Partial<ContentCollection>): Promise<ContentCollection> {
    const now = new Date().toISOString();
    const id = value.id ? safeId(value.id) : `collection_${crypto.randomBytes(12).toString('base64url')}`;
    const existing = await getDb().collection(COLLECTIONS_COLLECTION).doc(id).get();
    const normalized = normalizeContentCollection(id, {
      ...value,
      createdAt: existing.exists ? existing.data()?.createdAt : now,
      updatedAt: now
    });
    if (!normalized) throw new Error('Collection name is required.');
    await getDb().collection(COLLECTIONS_COLLECTION).doc(id).set(sanitizeForFirestore(normalized), { merge: false });
    return normalized;
  },

  async deleteCollection(idInput: string): Promise<void> {
    await getDb().collection(COLLECTIONS_COLLECTION).doc(safeId(idInput)).delete();
  },

  async listBundles(includeUnpublished = false): Promise<ContentBundle[]> {
    const snapshot = await getDb().collection(BUNDLES_COLLECTION).limit(100).get();
    return snapshot.docs
      .map(document => normalizeBundle(document.id, document.data()))
      .filter((value): value is ContentBundle => Boolean(value) && (includeUnpublished || value!.isPublished))
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  },

  async getBundle(idInput: string, includeUnpublished = false): Promise<ContentBundle | null> {
    const id = safeId(idInput);
    const snapshot = await getDb().collection(BUNDLES_COLLECTION).doc(id).get();
    const bundle = snapshot.exists ? normalizeBundle(id, snapshot.data()) : null;
    return bundle && (includeUnpublished || bundle.isPublished) ? bundle : null;
  },

  async saveBundle(value: Partial<ContentBundle>): Promise<ContentBundle> {
    const id = value.id ? safeId(value.id) : `bundle_${crypto.randomBytes(12).toString('base64url')}`;
    const pieceIds = validateContentBundlePieceIds(value.pieceIds);
    if (!Number.isSafeInteger(value.priceKes) || value.priceKes! < 1 || value.priceKes! > 1_000_000) {
      throw new Error('Enter a valid whole-shilling bundle or book price between KSh 1 and KSh 1,000,000.');
    }
    const ref = getDb().collection(BUNDLES_COLLECTION).doc(id);
    return getDb().runTransaction(async transaction => {
      const existing = await transaction.get(ref);
      const previous = existing.exists ? existing.data() as Partial<ContentBundle> : undefined;
      const metadata = validateChapterBookMetadata(value, previous);
      if (existing.exists && (previous?.kind === 'book' || metadata.kind === 'book')) {
        if (typeof value.updatedAt !== 'string' || !value.updatedAt || value.updatedAt !== previous?.updatedAt) {
          throw new ChapterBookSaveConflictError();
        }
      }
      const previousTime = Date.parse(previous?.updatedAt || '');
      const now = new Date(Number.isFinite(previousTime) ? Math.max(Date.now(), previousTime + 1) : Date.now()).toISOString();
      const normalized = normalizeBundle(id, {
        ...value,
        ...metadata,
        pieceIds,
        createdAt: previous?.createdAt || now,
        updatedAt: now
      });
      if (!normalized) throw new Error('Bundle name is required.');
      transaction.set(ref, sanitizeForFirestore(normalized));
      return normalized;
    });
  },

  async deleteBundle(idInput: string): Promise<void> {
    await getDb().collection(BUNDLES_COLLECTION).doc(safeId(idInput)).delete();
  }
};
