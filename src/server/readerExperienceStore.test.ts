import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

type StoredDocument = Record<string, any>;
type Increment = { __operation: 'increment'; amount: number };
type FakeRef = { collectionName: string; id: string; key: string };

const firestore = vi.hoisted(() => {
  const documents = new Map<string, StoredDocument>();
  let transactionQueue = Promise.resolve();

  const clone = <T>(value: T): T => value === undefined ? value : structuredClone(value);
  const isIncrement = (value: unknown): value is Increment => Boolean(
    value
    && typeof value === 'object'
    && (value as Increment).__operation === 'increment'
    && Number.isFinite((value as Increment).amount)
  );
  const snapshot = (ref: FakeRef) => ({
    exists: documents.has(ref.key),
    id: ref.id,
    data: () => clone(documents.get(ref.key))
  });
  const applySet = (
    target: Map<string, StoredDocument>,
    ref: FakeRef,
    data: StoredDocument,
    merge = false
  ) => {
    const current = merge ? clone(target.get(ref.key) || {}) : {};
    const next: StoredDocument = { ...current };
    for (const [key, value] of Object.entries(data)) {
      next[key] = isIncrement(value)
        ? (Number(current[key]) || 0) + value.amount
        : clone(value);
    }
    target.set(ref.key, next);
  };
  const refFor = (collectionName: string, id: string): FakeRef => ({
    collectionName,
    id,
    key: `${collectionName}/${id}`
  });
  const queryFor = (
    collectionName: string,
    predicates: Array<(value: StoredDocument) => boolean> = [],
    max = Number.POSITIVE_INFINITY,
    orders: Array<[string, 'asc' | 'desc']> = []
  ): any => ({
    where(field: string, operator: string, expected: unknown) {
      if (operator !== '==') throw new Error(`Unsupported fake query operator: ${operator}`);
      return queryFor(
        collectionName,
        [...predicates, value => value[field] === expected],
        max,
        orders
      );
    },
    limit(limit: number) {
      return queryFor(collectionName, predicates, limit, orders);
    },
    orderBy(field: string, direction: 'asc' | 'desc' = 'asc') {
      return queryFor(collectionName, predicates, max, [...orders, [field, direction]]);
    },
    async get() {
      const docs = Array.from(documents.entries())
        .filter(([key]) => key.startsWith(`${collectionName}/`))
        .map(([key, value]) => ({
          id: key.slice(collectionName.length + 1),
          value
        }))
        .filter(({ value }) => predicates.every(predicate => predicate(value)))
        .sort((left, right) => {
          for (const [field, direction] of orders) {
            const comparison = String(left.value[field] ?? '').localeCompare(String(right.value[field] ?? ''));
            if (comparison) return direction === 'desc' ? -comparison : comparison;
          }
          return left.id.localeCompare(right.id);
        })
        .slice(0, max)
        .map(({ id, value }) => ({ id, data: () => clone(value) }));
      return { docs, empty: docs.length === 0 };
    }
  });
  const collection = (collectionName: string): any => ({
    ...queryFor(collectionName),
    doc(id: string) {
      const ref = refFor(collectionName, id);
      return {
        ...ref,
        get: async () => snapshot(ref),
        set: async (data: StoredDocument, options?: { merge?: boolean }) => {
          applySet(documents, ref, data, Boolean(options?.merge));
        },
        delete: async () => {
          documents.delete(ref.key);
        }
      };
    }
  });
  const db = {
    collection,
    async runTransaction(callback: (transaction: any) => Promise<unknown>) {
      const run = transactionQueue.then(async () => {
      const staged = new Map<string, StoredDocument>(
        Array.from(documents.entries()).map(([key, value]) => [key, clone(value)])
      );
      const transaction = {
        get: async (ref: FakeRef) => ({
          exists: staged.has(ref.key),
          id: ref.id,
          data: () => clone(staged.get(ref.key))
        }),
        set: (
          ref: FakeRef,
          data: StoredDocument,
          options?: { merge?: boolean }
        ) => applySet(staged, ref, data, Boolean(options?.merge)),
        create: (ref: FakeRef, data: StoredDocument) => {
          if (staged.has(ref.key)) throw new Error('ALREADY_EXISTS');
          applySet(staged, ref, data);
        },
        delete: (ref: FakeRef) => staged.delete(ref.key)
      };
      const result = await callback(transaction);
      documents.clear();
      for (const [key, value] of staged.entries()) documents.set(key, value);
      return result;
      });
      transactionQueue = run.then(() => undefined, () => undefined);
      return run;
    }
  };

  return { documents, db };
});

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    increment: (amount: number): Increment => ({ __operation: 'increment', amount })
  }
}));

vi.mock('./db.js', () => ({
  getDb: () => firestore.db,
  sanitizeForFirestore: (value: unknown) => value
}));

import { readerExperienceStore } from './readerExperienceStore.js';

describe('reader experience persistence', () => {
  beforeEach(() => {
    firestore.documents.clear();
  });

  it('preserves ordered chapter records and book settings across saves without touching articles or licences', async () => {
    firestore.documents.set('articles/chapter-1', { content: 'Original chapter', priceKes: 100 });
    firestore.documents.set('reader_licenses/old-purchase', { articleId: 'chapter-1', userId: 'reader-1' });
    const originals = structuredClone([...firestore.documents.entries()]);
    const book = await readerExperienceStore.saveBundle({
      name: 'The Complete Book', kind: 'book', pieceIds: ['chapter-2', 'chapter-1'],
      priceKes: 150, showChaptersSeparately: false, existingOwnerPricing: 'remaining_chapters', isPublished: false
    });
    await expect(readerExperienceStore.getBundle(book.id)).resolves.toBeNull();
    await expect(readerExperienceStore.getBundle(book.id, true)).resolves.toMatchObject({
      kind: 'book', pieceIds: ['chapter-2', 'chapter-1'], showChaptersSeparately: false, existingOwnerPricing: 'remaining_chapters'
    });
    const revised = await readerExperienceStore.saveBundle({
      id: book.id, name: 'Revised Book', pieceIds: book.pieceIds, priceKes: 175, isPublished: true, updatedAt: book.updatedAt
    });
    expect(revised).toMatchObject({ kind: 'book', showChaptersSeparately: false, existingOwnerPricing: 'remaining_chapters', priceKes: 175 });
    for (const [key, value] of originals) expect(firestore.documents.get(key)).toEqual(value);
  });

  it('rejects stale or unversioned book edits and preserves the newer price and chapter order atomically', async () => {
    const book = await readerExperienceStore.saveBundle({
      name: 'Book', kind: 'book', pieceIds: ['chapter-1', 'chapter-2'], priceKes: 100, isPublished: true
    });
    const revised = await readerExperienceStore.saveBundle({ ...book, pieceIds: ['chapter-2', 'chapter-1'], priceKes: 200 });
    expect(revised.updatedAt).not.toBe(book.updatedAt);
    await expect(readerExperienceStore.saveBundle({ ...book, priceKes: 50 })).rejects.toMatchObject({ code: 'CHAPTER_BOOK_SAVE_CONFLICT', statusCode: 409 });
    await expect(readerExperienceStore.saveBundle({ id: book.id, name: 'Old client', pieceIds: book.pieceIds, priceKes: 50 })).rejects.toMatchObject({ code: 'CHAPTER_BOOK_SAVE_CONFLICT' });
    await expect(readerExperienceStore.getBundle(book.id)).resolves.toMatchObject({ priceKes: 200, pieceIds: ['chapter-2', 'chapter-1'] });
  });

  it('fails closed on corrupt stored book members or modes rather than silently shortening or demoting a book', async () => {
    const base = { name: 'Corrupt Book', kind: 'book', priceKes: 100, isPublished: true };
    firestore.documents.set('content_bundles/duplicate', { ...base, pieceIds: ['chapter-1', 'chapter-1'] });
    firestore.documents.set('content_bundles/invalid-mode', { ...base, kind: 'mystery', pieceIds: ['chapter-1', 'chapter-2'] });
    await expect(readerExperienceStore.getBundle('duplicate')).resolves.toBeNull();
    await expect(readerExperienceStore.getBundle('invalid-mode')).resolves.toBeNull();
    await expect(readerExperienceStore.listBundles()).resolves.toEqual([]);
  });

  it('rejects invalid chapter writes and prices before persisting anything', async () => {
    for (const extra of [
      { pieceIds: ['chapter-1', 'chapter-1'] }, { kind: 'invalid' }, { priceKes: 0 }, { priceKes: 1.5 },
      { showChaptersSeparately: 'false' }, { existingOwnerPricing: 'make_everything_free' }
    ]) {
      await expect(readerExperienceStore.saveBundle({
        name: 'Invalid Book', kind: 'book', pieceIds: ['chapter-1', 'chapter-2'], priceKes: 100, ...extra
      } as any)).rejects.toThrow();
    }
    expect(firestore.documents.size).toBe(0);
  });

  it('saves cross-session progress and counts completion only once', async () => {
    await readerExperienceStore.saveProgress({
      userId: 'reader-1',
      articleId: 'piece-1',
      percent: 48.26,
      blockId: 'reader-para-12',
      activeChapterId: 'chapter-2',
      activeChapterTitle: 'The Return',
      chapterPercent: 31.26,
      interests: ['Healing', 'Grief']
    });

    await expect(readerExperienceStore.getProfile('reader-1')).resolves.toMatchObject({
      userId: 'reader-1',
      progress: {
        'piece-1': {
          percent: 48.3,
          blockId: 'reader-para-12',
          activeChapterId: 'chapter-2',
          activeChapterTitle: 'The Return',
          chapterPercent: 31.3
        }
      },
      recent: [{ articleId: 'piece-1' }],
      interestScores: { healing: 1, grief: 1 }
    });

    const completed = await readerExperienceStore.saveProgress({
      userId: 'reader-1',
      articleId: 'piece-1',
      percent: 95
    });
    const repeated = await readerExperienceStore.saveProgress({
      userId: 'reader-1',
      articleId: 'piece-1',
      percent: 20
    });

    expect(completed.completedAt).toBeTruthy();
    expect(repeated.completedAt).toBe(completed.completedAt);
    expect(repeated).toMatchObject({
      blockId: 'reader-para-12',
      activeChapterId: 'chapter-2',
      activeChapterTitle: 'The Return',
      furthestPercent: 95
    });
    expect(firestore.documents.get('piece_social/piece-1')).toMatchObject({
      articleId: 'piece-1',
      completedReadCount: 1
    });
  });

  it('toggles a bounded reading-position bookmark without disturbing progress', async () => {
    await readerExperienceStore.saveProgress({
      userId: 'reader-1',
      articleId: 'piece-1',
      percent: 25,
      blockId: 'reader-para-4'
    });

    const saved = await readerExperienceStore.toggleBookmark({
      userId: 'reader-1',
      articleId: 'piece-1',
      blockId: 'reader-para-4',
      label: 'A line worth returning to'
    });
    expect(saved).toMatchObject({
      bookmarked: true,
      progress: {
        percent: 25,
        bookmarks: [{
          blockId: 'reader-para-4',
          label: 'A line worth returning to'
        }]
      }
    });

    const removed = await readerExperienceStore.toggleBookmark({
      userId: 'reader-1',
      articleId: 'piece-1',
      blockId: 'reader-para-4'
    });
    expect(removed.bookmarked).toBe(false);
    expect(removed.progress.bookmarks).toEqual([]);
    await expect(readerExperienceStore.toggleBookmark({
      userId: 'reader-1',
      articleId: 'piece-1',
      blockId: 'unsafe-position'
    })).rejects.toThrow('Invalid reading position');
  });

  it('persists bounded, piece-specific highlights and removes them by account-owned id', async () => {
    await readerExperienceStore.saveProgress({
      userId: 'reader-1',
      articleId: 'piece-1',
      percent: 32,
      blockId: 'reader-para-7'
    });

    const saved = await readerExperienceStore.addHighlight({
      userId: 'reader-1',
      articleId: 'piece-1',
      blockId: 'reader-para-7',
      startOffset: 4,
      endOffset: 21,
      text: 'a line worth saving'
    });
    expect(saved).toMatchObject({
      created: true,
      progress: {
        percent: 32,
        highlights: [{
          blockId: 'reader-para-7',
          startOffset: 4,
          endOffset: 21,
          text: 'a line worth saving',
          color: 'amber'
        }]
      }
    });

    const duplicate = await readerExperienceStore.addHighlight({
      userId: 'reader-1',
      articleId: 'piece-1',
      blockId: 'reader-para-7',
      startOffset: 4,
      endOffset: 21,
      text: 'a line worth saving'
    });
    expect(duplicate.created).toBe(false);
    expect(duplicate.progress.highlights).toHaveLength(1);

    const highlightId = saved.progress.highlights?.[0]?.id;
    expect(highlightId).toBeTruthy();
    const removed = await readerExperienceStore.removeHighlight({
      userId: 'reader-1',
      articleId: 'piece-1',
      highlightId: highlightId!
    });
    expect(removed.removed).toBe(true);
    expect(removed.progress.highlights).toEqual([]);

    await expect(readerExperienceStore.addHighlight({
      userId: 'reader-1',
      articleId: 'piece-1',
      blockId: 'outside-reader',
      startOffset: 0,
      endOffset: 2,
      text: 'no'
    })).rejects.toThrow('Invalid highlight position');
  });

  it('keeps reader identities private while reactions remain idempotent per reader and piece', async () => {
    await readerExperienceStore.setReaction('reader-1', 'piece-1', 'beautiful');
    await readerExperienceStore.setReaction('reader-2', 'piece-1', 'beautiful');
    await readerExperienceStore.setReaction('reader-1', 'piece-1', 'damn');

    const anonymous = await readerExperienceStore.getSocial('piece-1');
    expect(anonymous).toMatchObject({
      reactionCounts: { beautiful: 1, damn: 1 },
      testimonials: []
    });
    expect(anonymous.currentReaction).toBeUndefined();
    expect(JSON.stringify(anonymous)).not.toContain('reader-1');
    expect(JSON.stringify(anonymous)).not.toContain('reader-2');

    const personalized = await readerExperienceStore.getSocial('piece-1', 'reader-1');
    expect(personalized.currentReaction).toBe('damn');

    const toggledOff = await readerExperienceStore.setReaction('reader-1', 'piece-1', 'damn');
    expect(toggledOff).toMatchObject({
      currentReaction: undefined,
      reactionCounts: { beautiful: 1, damn: 0 }
    });
  });

  it('requires substantial reading before review and exposes only writer-approved anonymous proof', async () => {
    await readerExperienceStore.saveProgress({
      userId: 'reader-private',
      articleId: 'piece-1',
      percent: 79.9
    });
    await expect(readerExperienceStore.saveReview({
      userId: 'reader-private',
      readerName: 'Private Reader Name',
      articleId: 'piece-1',
      rating: 5,
      review: 'This should not be accepted yet.'
    })).rejects.toMatchObject({ statusCode: 403 });

    await readerExperienceStore.saveProgress({
      userId: 'reader-private',
      articleId: 'piece-1',
      percent: 80
    });
    await readerExperienceStore.saveProgress({
      userId: 'reader-private',
      articleId: 'piece-1',
      percent: 20
    });
    const submitted = await readerExperienceStore.saveReview({
      userId: 'reader-private',
      readerName: 'Private Reader Name',
      articleId: 'piece-1',
      rating: 5,
      review: 'A thoughtful and beautifully written piece.'
    });
    expect(submitted).not.toHaveProperty('userId');
    expect(submitted).not.toHaveProperty('readerName');
    expect((await readerExperienceStore.getSocial('piece-1')).testimonials).toEqual([]);

    const privateReview = (await readerExperienceStore.listReviews())[0];
    expect(privateReview).toMatchObject({
      userId: 'reader-private',
      readerName: 'Private Reader Name',
      status: 'pending'
    });
    await readerExperienceStore.moderateReview(privateReview.id, {
      status: 'approved',
      featured: true
    });

    const social = await readerExperienceStore.getSocial('piece-1');
    expect(social).toMatchObject({
      verifiedReviewCount: 1,
      averageRating: 5,
      testimonials: [{
        articleId: 'piece-1',
        rating: 5,
        status: 'approved',
        featured: true,
        verifiedReader: true
      }]
    });
    expect(JSON.stringify(social)).not.toContain('reader-private');
    expect(JSON.stringify(social)).not.toContain('Private Reader Name');
  });

  it('appends several responses while counting only one rating per reader and preserves approved retries', async () => {
    await readerExperienceStore.saveProgress({ userId: 'reader-multiple', articleId: 'piece-1', percent: 90 });
    const input = { userId: 'reader-multiple', articleId: 'piece-1', rating: 5, review: 'A thoughtful response worth sharing.' };
    const [first, second] = await Promise.all([
      readerExperienceStore.saveReview({ ...input, submissionId: 'submission-first-12345' }),
      readerExperienceStore.saveReview({ ...input, rating: 4, submissionId: 'submission-second-12345' }),
    ]);
    expect(first.id).not.toBe(second.id);
    expect((await readerExperienceStore.listReviews())).toHaveLength(2);
    expect(await readerExperienceStore.getSocial('piece-1')).toMatchObject({ verifiedReviewCount: 1, averageRating: 4, reviews: [], testimonials: [] });
    await readerExperienceStore.moderateReview(first.id, { status: 'approved', featured: true });
    const beforeRetry = structuredClone([...firestore.documents.entries()]);
    expect(await readerExperienceStore.saveReview({ ...input, submissionId: 'submission-first-12345' })).toMatchObject({ id: first.id, status: 'approved', featured: true });
    expect([...firestore.documents.entries()]).toEqual(beforeRetry);
    await expect(readerExperienceStore.saveReview({ ...input, review: 'Changed text for an existing intent.', submissionId: 'submission-first-12345' })).rejects.toMatchObject({ statusCode: 409 });
    expect((await readerExperienceStore.listReviews()).find(review => review.id === second.id)?.status).toBe('pending');
  });

  it('adopts a legacy rating without overwriting its approved review or recounting historical votes', async () => {
    const userId = 'reader-legacy', articleId = 'piece-1';
    const id = createHash('sha256').update([userId, articleId].join('\u001f')).digest('hex');
    const legacy = { id, userId, readerName: 'Private legacy name', articleId, rating: 5, review: 'A legacy approved response.', status: 'approved', featured: true,
      verifiedReader: true, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' };
    firestore.documents.set(`piece_reviews/${id}`, structuredClone(legacy));
    firestore.documents.set(`piece_social/${articleId}`, { verifiedReviewCount: 7, ratingTotal: 35 });
    await readerExperienceStore.saveProgress({ userId, articleId, percent: 80 });
    const response = await readerExperienceStore.saveReview({ userId, articleId, rating: 3, review: 'A later independent review response.', submissionId: 'submission-legacy-12345' });
    expect(response.status).toBe('pending');
    expect(firestore.documents.get(`piece_reviews/${id}`)).toEqual(legacy);
    expect(firestore.documents.get(`piece_social/${articleId}`)).toMatchObject({ verifiedReviewCount: 7, ratingTotal: 33 });
    expect((await readerExperienceStore.getSocial(articleId)).testimonials).toEqual([expect.objectContaining({ id, status: 'approved' })]);
  });

  it('deduplicates concurrent delivery of one review intent without sharing that intent across readers or pieces', async () => {
    for (const userId of ['reader-one', 'reader-two']) {
      for (const articleId of ['piece-one', 'piece-two']) {
        await readerExperienceStore.saveProgress({ userId, articleId, percent: 90 });
      }
    }
    const input = { userId: 'reader-one', articleId: 'piece-one', rating: 5,
      review: 'A deliberately repeated response.', submissionId: 'shared-intent-id-12345' };
    const duplicates = await Promise.all(Array.from({ length: 3 }, () => readerExperienceStore.saveReview(input)));
    expect(new Set(duplicates.map(review => review.id)).size).toBe(1);
    expect((await readerExperienceStore.listReviews())).toHaveLength(1);
    expect(await readerExperienceStore.getSocial('piece-one')).toMatchObject({ verifiedReviewCount: 1, averageRating: 5 });

    const otherReader = await readerExperienceStore.saveReview({ ...input, userId: 'reader-two', rating: 3 });
    const otherPiece = await readerExperienceStore.saveReview({ ...input, articleId: 'piece-two', rating: 4 });
    expect(new Set([duplicates[0].id, otherReader.id, otherPiece.id]).size).toBe(3);
    expect(await readerExperienceStore.getSocial('piece-one')).toMatchObject({ verifiedReviewCount: 2, averageRating: 4 });
    expect(await readerExperienceStore.getSocial('piece-two')).toMatchObject({ verifiedReviewCount: 1, averageRating: 4 });
    expect((await readerExperienceStore.listReviews()).every(review => review.status === 'pending' && !review.featured)).toBe(true);
  });

  it('loads only current approved public responses without identities, stale cache contents or anonymous writes', async () => {
    const base = { id: 'approved-review', userId: 'private-reader', readerName: 'Private identity', email: 'private@example.invalid', articleId: 'piece-1', rating: 5,
      review: 'A response approved for publication.', status: 'approved', featured: false, verifiedReader: true, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' };
    firestore.documents.set('piece_reviews/approved-review', base);
    firestore.documents.set('piece_reviews/pending-review', { ...base, id: 'pending-review', review: 'Private pending response must not leak.', status: 'pending' });
    firestore.documents.set('piece_social/piece-1', { testimonials: [{ ...base, id: 'stale', review: 'Stale cached response must not leak.' }] });
    const beforeRead = structuredClone([...firestore.documents.entries()]);
    const social = await readerExperienceStore.getSocial('piece-1');
    expect(social.reviews).toEqual([expect.objectContaining({ id: base.id })]);
    expect(social.testimonials).toEqual([]);
    expect(JSON.stringify(social)).not.toMatch(/private-reader|Private identity|private@example|Private pending|Stale cached/);
    expect([...firestore.documents.entries()]).toEqual(beforeRead);
    await readerExperienceStore.moderateReview(base.id, { status: 'hidden' });
    expect((await readerExperienceStore.getSocial('piece-1')).reviews).toEqual([]);
  });

  it('bounds public review queries independently so older featured testimonials remain visible', async () => {
    for (let index = 0; index < 16; index++) {
      const id = `approved-${index}`;
      firestore.documents.set(`piece_reviews/${id}`, { id, userId: 'private', articleId: 'piece-1', rating: 5,
        review: 'An approved and verified response.', status: 'approved', featured: index === 0, verifiedReader: true,
        createdAt: '2026-10-01T00:00:00.000Z', updatedAt: `2026-10-${String(index + 1).padStart(2, '0')}T00:00:00.000Z` });
    }
    const social = await readerExperienceStore.getSocial('piece-1');
    expect(social.reviews).toHaveLength(12);
    expect(social.testimonials).toEqual([expect.objectContaining({ id: 'approved-0', featured: true })]);
  });

  it('persists writer collections and bundles without changing piece records', async () => {
    const hiddenCollection = await readerExperienceStore.saveCollection({
      name: 'Private Draft',
      description: 'Still being curated',
      pieceIds: ['piece-1', 'piece-1', 'piece-2'],
      coverImage: '/uploads/collection.jpg',
      coverPosition: { x: 20, y: 75 },
      order: 2,
      isPublished: false
    });
    expect(hiddenCollection.pieceIds).toEqual(['piece-1', 'piece-2']);
    await expect(readerExperienceStore.listCollections()).resolves.toEqual([]);

    const publishedCollection = await readerExperienceStore.saveCollection({
      ...hiddenCollection,
      name: 'For Quiet Evenings',
      isPublished: true
    });
    await expect(readerExperienceStore.listCollections()).resolves.toMatchObject([
      {
        id: publishedCollection.id,
        name: 'For Quiet Evenings',
        isPublished: true,
        coverPosition: { x: 20, y: 75 }
      }
    ]);

    await expect(readerExperienceStore.saveBundle({
      name: 'Invalid Bundle',
      pieceIds: ['piece-1'],
      priceKes: 500,
      isPublished: true
    })).rejects.toThrow('at least two pieces');

    const bundle = await readerExperienceStore.saveBundle({
      name: 'The Healing Pair',
      pieceIds: ['piece-1', 'piece-2'],
      priceKes: 450,
      coverImage: '/uploads/bundle.jpg',
      coverPosition: { x: 88.8, y: 5.2 },
      isPublished: true
    });
    await expect(readerExperienceStore.getBundle(bundle.id)).resolves.toMatchObject({
      name: 'The Healing Pair',
      pieceIds: ['piece-1', 'piece-2'],
      priceKes: 450,
      coverPosition: { x: 88.8, y: 5.2 },
      isPublished: true
    });

    expect(Array.from(firestore.documents.keys()).some(key => key.startsWith('articles/'))).toBe(false);
    await readerExperienceStore.deleteCollection(publishedCollection.id);
    await readerExperienceStore.deleteBundle(bundle.id);
    await expect(readerExperienceStore.listCollections(true)).resolves.toEqual([]);
    await expect(readerExperienceStore.listBundles(true)).resolves.toEqual([]);
  });
});
