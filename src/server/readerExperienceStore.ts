import crypto from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import {
  ContentBundle,
  ContentCollection,
  PieceReview,
  ReaderArticleProgress,
  ReaderBookmark,
  ReaderReactionType
} from '../types.js';
import { getDb, sanitizeForFirestore } from './db.js';

const PROFILE_COLLECTION = 'reader_profiles';
const SOCIAL_COLLECTION = 'piece_social';
const REACTION_COLLECTION = 'reader_piece_reactions';
const REVIEW_COLLECTION = 'piece_reviews';
const COLLECTIONS_COLLECTION = 'content_collections';
const BUNDLES_COLLECTION = 'content_bundles';
const MAX_PROGRESS_ITEMS = 100;
const MAX_RECENT_ITEMS = 40;
const MAX_BOOKMARKS = 30;

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

function emptyReactionCounts(): Record<ReaderReactionType, number> {
  return {
    this_hurt: 0,
    felt_seen: 0,
    beautiful: 0,
    reread: 0,
    damn: 0
  };
}

function publicTestimonials(reviews: StoredReview[]): PieceReview[] {
  return reviews
    .filter(review => review.status === 'approved')
    .sort((left, right) => Number(right.featured) - Number(left.featured) || Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .slice(0, 12)
    .map(review => ({
      id: review.id,
      articleId: review.articleId,
      rating: review.rating,
      review: review.review,
      status: review.status,
      featured: review.featured,
      verifiedReader: true,
      createdAt: review.createdAt,
      updatedAt: review.updatedAt
    }));
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
  return {
    id,
    name,
    slug: cleanText(input.slug, 140) || id,
    description: cleanText(input.description, 1_500),
    pieceIds: Array.isArray(input.pieceIds)
      ? [...new Set(input.pieceIds.map(item => cleanText(item, 128)).filter(Boolean))].slice(0, 100)
      : [],
    ...(cleanText(input.coverImage, 2_048) ? { coverImage: cleanText(input.coverImage, 2_048) } : {}),
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
  return {
    id,
    name,
    slug: cleanText(input.slug, 140) || id,
    description: cleanText(input.description, 1_500),
    pieceIds: Array.isArray(input.pieceIds)
      ? [...new Set(input.pieceIds.map(item => cleanText(item, 128)).filter(Boolean))].slice(0, 30)
      : [],
    priceKes: Math.round(clampNumber(input.priceKes, 1, 1_000_000)),
    ...(cleanText(input.coverImage, 2_048) ? { coverImage: cleanText(input.coverImage, 2_048) } : {}),
    isPublished: input.isPublished === true,
    createdAt: typeof input.createdAt === 'string' ? input.createdAt : new Date().toISOString(),
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : new Date().toISOString()
  };
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
        bookmarks: previous?.bookmarks || [],
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
    const [socialSnapshot, reactionSnapshot] = await Promise.all([
      socialPromise,
      reactionPromise
    ]);
    const social = (socialSnapshot.exists ? socialSnapshot.data() : {}) as SocialRecord;
    const ratingTotal = Number(social.ratingTotal) || 0;
    const verifiedReviewCount = Math.max(0, Number(social.verifiedReviewCount) || 0);
    let testimonials = Array.isArray(social.testimonials) ? social.testimonials.slice(0, 12) : null;
    if (!testimonials) {
      const legacyReviews = await getDb().collection(REVIEW_COLLECTION)
        .where('articleId', '==', articleId)
        .limit(100)
        .get();
      testimonials = publicTestimonials(legacyReviews.docs.map(document => document.data() as StoredReview));
      await socialRef.set({ articleId, testimonials, updatedAt: new Date().toISOString() }, { merge: true });
    }
    const currentReaction = reactionSnapshot?.exists
      ? reactionSnapshot.data()?.reaction as ReaderReactionType | undefined
      : undefined;
    return {
      reactionCounts: { ...emptyReactionCounts(), ...(social.reactionCounts || {}) },
      currentReaction,
      verifiedReviewCount,
      averageRating: verifiedReviewCount > 0 ? Math.round((ratingTotal / verifiedReviewCount) * 10) / 10 : 0,
      completedReadCount: Math.max(0, Number(social.completedReadCount) || 0),
      testimonials
    };
  },

  async saveReview(input: {
    userId: string;
    readerName?: string;
    articleId: string;
    rating: unknown;
    review: unknown;
  }): Promise<PieceReview> {
    const userId = safeId(input.userId);
    const articleId = safeId(input.articleId);
    const rating = Math.round(clampNumber(input.rating, 1, 5));
    const reviewText = cleanText(input.review, 2_000);
    if (reviewText.length < 10) throw new Error('Review must contain at least 10 characters.');
    const profileRef = getDb().collection(PROFILE_COLLECTION).doc(hashId(userId));
    const reviewRef = getDb().collection(REVIEW_COLLECTION).doc(hashId(userId, articleId));
    const socialRef = getDb().collection(SOCIAL_COLLECTION).doc(articleId);
    const now = new Date().toISOString();
    return getDb().runTransaction(async transaction => {
      const [profileSnapshot, reviewSnapshot] = await Promise.all([
        transaction.get(profileRef),
        transaction.get(reviewRef)
      ]);
      const profile = normalizeProfile(userId, profileSnapshot.exists ? profileSnapshot.data() : null);
      const articleProgress = profile.progress[articleId];
      if ((articleProgress?.furthestPercent ?? articleProgress?.percent ?? 0) < 80) {
        const error = new Error('Finish at least 80% of the piece before reviewing it.');
        (error as any).statusCode = 403;
        throw error;
      }
      const existing = reviewSnapshot.exists ? reviewSnapshot.data() as StoredReview : null;
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
        createdAt: existing?.createdAt || now,
        updatedAt: now
      };
      transaction.set(reviewRef, sanitizeForFirestore(stored), { merge: false });
      transaction.set(socialRef, {
        articleId,
        verifiedReviewCount: FieldValue.increment(existing ? 0 : 1),
        ratingTotal: FieldValue.increment(rating - (existing?.rating || 0)),
        updatedAt: now
      }, { merge: true });
      const { userId: _privateUserId, readerName: _privateReaderName, ...safeReview } = stored;
      return safeReview;
    });
  },

  async listReviews(): Promise<StoredReview[]> {
    const snapshot = await getDb().collection(REVIEW_COLLECTION).limit(250).get();
    return snapshot.docs
      .map(document => document.data() as StoredReview)
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  },

  async moderateReview(reviewIdInput: string, input: { status?: unknown; featured?: unknown }): Promise<StoredReview> {
    const reviewId = safeId(reviewIdInput);
    const ref = getDb().collection(REVIEW_COLLECTION).doc(reviewId);
    const snapshot = await ref.get();
    if (!snapshot.exists) throw new Error('Review not found.');
    const existing = snapshot.data() as StoredReview;
    const status = input.status === 'approved' || input.status === 'hidden' || input.status === 'pending'
      ? input.status
      : existing.status;
    const featured = input.featured === true && status === 'approved';
    const updated = { ...existing, status, featured, updatedAt: new Date().toISOString() };
    await ref.set(sanitizeForFirestore(updated), { merge: false });
    const reviewSnapshot = await getDb().collection(REVIEW_COLLECTION)
      .where('articleId', '==', existing.articleId)
      .limit(100)
      .get();
    const testimonials = publicTestimonials(reviewSnapshot.docs.map(document => document.data() as StoredReview));
    await getDb().collection(SOCIAL_COLLECTION).doc(existing.articleId).set({
      articleId: existing.articleId,
      testimonials,
      updatedAt: updated.updatedAt
    }, { merge: true });
    return updated;
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
    const now = new Date().toISOString();
    const id = value.id ? safeId(value.id) : `bundle_${crypto.randomBytes(12).toString('base64url')}`;
    const existing = await getDb().collection(BUNDLES_COLLECTION).doc(id).get();
    const normalized = normalizeBundle(id, {
      ...value,
      createdAt: existing.exists ? existing.data()?.createdAt : now,
      updatedAt: now
    });
    if (!normalized) throw new Error('Bundle name is required.');
    if (normalized.pieceIds.length < 2) throw new Error('A bundle must contain at least two pieces.');
    await getDb().collection(BUNDLES_COLLECTION).doc(id).set(sanitizeForFirestore(normalized), { merge: false });
    return normalized;
  },

  async deleteBundle(idInput: string): Promise<void> {
    await getDb().collection(BUNDLES_COLLECTION).doc(safeId(idInput)).delete();
  }
};
