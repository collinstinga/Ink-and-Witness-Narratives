import { beforeEach, describe, expect, it, vi } from 'vitest';

type StoredDocument = Record<string, any>;
type Increment = { __operation: 'increment'; amount: number };
type FakeRef = { collectionName: string; id: string; key: string };

const firestore = vi.hoisted(() => {
  const documents = new Map<string, StoredDocument>();

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
    max = Number.POSITIVE_INFINITY
  ): any => ({
    where(field: string, operator: string, expected: unknown) {
      if (operator !== '==') throw new Error(`Unsupported fake query operator: ${operator}`);
      return queryFor(
        collectionName,
        [...predicates, value => value[field] === expected],
        max
      );
    },
    limit(limit: number) {
      return queryFor(collectionName, predicates, limit);
    },
    async get() {
      const docs = Array.from(documents.entries())
        .filter(([key]) => key.startsWith(`${collectionName}/`))
        .map(([key, value]) => ({
          id: key.slice(collectionName.length + 1),
          value
        }))
        .filter(({ value }) => predicates.every(predicate => predicate(value)))
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
        delete: (ref: FakeRef) => staged.delete(ref.key)
      };
      const result = await callback(transaction);
      documents.clear();
      for (const [key, value] of staged.entries()) documents.set(key, value);
      return result;
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

  it('persists writer collections and bundles without changing piece records', async () => {
    const hiddenCollection = await readerExperienceStore.saveCollection({
      name: 'Private Draft',
      description: 'Still being curated',
      pieceIds: ['piece-1', 'piece-1', 'piece-2'],
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
      { id: publishedCollection.id, name: 'For Quiet Evenings', isPublished: true }
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
      isPublished: true
    });
    await expect(readerExperienceStore.getBundle(bundle.id)).resolves.toMatchObject({
      name: 'The Healing Pair',
      pieceIds: ['piece-1', 'piece-2'],
      priceKes: 450,
      isPublished: true
    });

    expect(Array.from(firestore.documents.keys()).some(key => key.startsWith('articles/'))).toBe(false);
    await readerExperienceStore.deleteCollection(publishedCollection.id);
    await readerExperienceStore.deleteBundle(bundle.id);
    await expect(readerExperienceStore.listCollections(true)).resolves.toEqual([]);
    await expect(readerExperienceStore.listBundles(true)).resolves.toEqual([]);
  });
});
