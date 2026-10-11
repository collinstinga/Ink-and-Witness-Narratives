import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Article, PieceComment } from '../types.js';

const firestore = vi.hoisted(() => {
  type Document = Record<string, any>;
  type DocumentRef = { kind: 'document'; collectionName: string; id: string };
  type QueryRef = {
    kind: 'query';
    collectionName: string;
    filters: Array<[string, unknown]>;
    orderBys: Array<[string, 'asc' | 'desc']>;
    limitValue?: number;
  };
  type Operation =
    | { kind: 'create' | 'set'; reference: DocumentRef; data: Document; merge?: boolean }
    | { kind: 'delete'; reference: DocumentRef };
  const documents = new Map<string, Document>();
  const keyFor = (collectionName: string, documentId: string) => `${collectionName}/${documentId}`;
  const state = {
    transactionError: null as Error | null,
    queryGate: null as Promise<void> | null,
    lastQueryLimit: null as number | null,
    queryCount: 0
  };
  let transactionQueue = Promise.resolve();

  const snapshotFor = (reference: DocumentRef) => {
    const value = documents.get(keyFor(reference.collectionName, reference.id));
    return {
      exists: Boolean(value),
      id: reference.id,
      data: () => value ? structuredClone(value) : undefined
    };
  };
  const querySnapshotFor = (reference: QueryRef) => {
    const prefix = `${reference.collectionName}/`;
    const matchingDocs = [...documents.entries()]
      .filter(([key, value]) => key.startsWith(prefix) && reference.filters.every(([field, expected]) => value[field] === expected))
      .map(([key, value]) => {
        const id = key.slice(prefix.length);
        return { id, exists: true, data: () => structuredClone(value) };
      })
      .sort((left, right) => {
        const leftValue = left.data();
        const rightValue = right.data();
        for (const [field, direction] of reference.orderBys) {
          const comparison = String(leftValue[field] || '').localeCompare(String(rightValue[field] || ''));
          if (comparison !== 0) return direction === 'desc' ? -comparison : comparison;
        }
        return left.id.localeCompare(right.id);
      });
    const docs = typeof reference.limitValue === 'number'
      ? matchingDocs.slice(0, reference.limitValue)
      : matchingDocs;
    return { docs, empty: docs.length === 0 };
  };
  const applyData = (previous: Document, data: Document) => Object.fromEntries(
    Object.entries(data).map(([field, value]) => {
      const operand = value && typeof value === 'object' && typeof value.operand === 'number'
        ? value.operand
        : undefined;
      return [field, operand === undefined ? structuredClone(value) : (Number(previous[field]) || 0) + operand];
    })
  );

  return {
    documents,
    keyFor,
    state,
    resetTransactionQueue() {
      transactionQueue = Promise.resolve();
    },
    collection(collectionName: string) {
      const makeQuery = (
        filters: Array<[string, unknown]>,
        orderBys: Array<[string, 'asc' | 'desc']> = [],
        limitValue?: number
      ): QueryRef & { where: Function; orderBy: Function; limit: Function; get: Function } => ({
        kind: 'query',
        collectionName,
        filters,
        orderBys,
        limitValue,
        where(field: string, _operator: string, expected: unknown) {
          return makeQuery([...filters, [field, expected]], orderBys, limitValue);
        },
        orderBy(field: string, direction: 'asc' | 'desc' = 'asc') {
          return makeQuery(filters, [...orderBys, [field, direction]], limitValue);
        },
        limit(value: number) {
          state.lastQueryLimit = value;
          return makeQuery(filters, orderBys, value);
        },
        get: async function () {
          state.queryCount += 1;
          const snapshot = querySnapshotFor(this);
          if (state.queryGate) await state.queryGate;
          return snapshot;
        }
      });
      return {
        doc: (id: string): DocumentRef => ({ kind: 'document', collectionName, id }),
        where: (field: string, _operator: string, expected: unknown) => makeQuery([[field, expected]]),
        orderBy: (field: string, direction: 'asc' | 'desc' = 'asc') => makeQuery([], [[field, direction]]),
        limit: (value: number) => makeQuery([], [], value),
        get: async () => querySnapshotFor(makeQuery([]))
      };
    },
    async runTransaction(callback: (transaction: any) => Promise<unknown>) {
      const run = transactionQueue.then(async () => {
        if (state.transactionError) throw state.transactionError;
        const operations: Operation[] = [];
        const result = await callback({
          get: async (reference: DocumentRef | QueryRef) => reference.kind === 'document'
            ? snapshotFor(reference)
            : querySnapshotFor(reference),
          create: (reference: DocumentRef, data: Document) => operations.push({ kind: 'create', reference, data }),
          set: (reference: DocumentRef, data: Document, options?: { merge?: boolean }) => operations.push({
            kind: 'set', reference, data, merge: options?.merge === true
          }),
          delete: (reference: DocumentRef) => operations.push({ kind: 'delete', reference })
        });
        for (const operation of operations) {
          const key = keyFor(operation.reference.collectionName, operation.reference.id);
          if (operation.kind === 'delete') {
            documents.delete(key);
            continue;
          }
          if (operation.kind === 'create' && documents.has(key)) throw new Error('already exists');
          const previous = documents.get(key) || {};
          const next = applyData(previous, operation.data);
          documents.set(key, operation.merge ? { ...previous, ...next } : next);
        }
        return result;
      });
      transactionQueue = run.then(() => undefined, () => undefined);
      return run;
    }
  };
});

vi.mock('./db.js', () => ({
  getDb: vi.fn(() => ({
    collection: firestore.collection,
    runTransaction: firestore.runTransaction
  })),
  getFirestoreDoc: vi.fn(async (collectionName: string, documentId: string) => {
    const value = firestore.documents.get(firestore.keyFor(collectionName, documentId));
    return value ? structuredClone(value) : null;
  }),
  getAllFirestoreDocs: vi.fn(async (collectionName: string) => {
    const prefix = `${collectionName}/`;
    return [...firestore.documents.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([, value]) => structuredClone(value));
  }),
  setFirestoreDoc: vi.fn(async (collectionName: string, documentId: string, data: Record<string, unknown>) => {
    const key = firestore.keyFor(collectionName, documentId);
    firestore.documents.set(key, { ...(firestore.documents.get(key) || {}), ...structuredClone(data) });
  }),
  deleteFirestoreDoc: vi.fn(async (collectionName: string, documentId: string) => {
    firestore.documents.delete(firestore.keyFor(collectionName, documentId));
  }),
  sanitizeForFirestore: (value: unknown) => value
}));

vi.mock('./affiliateStore.js', () => ({
  affiliateStore: {
    init: vi.fn(async () => undefined),
    recordAffiliateSale: vi.fn()
  }
}));

const article: Article = {
  id: 'comment-piece',
  title: 'Comment Piece',
  subtitle: '',
  slug: 'comment-piece',
  excerpt: '',
  content: 'A published piece.',
  category: 'Essays',
  status: 'published',
  isPaid: false,
  priceKes: 0,
  readTimeMinutes: 2,
  publishedAt: '2026-10-01',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  downloadsCount: 0,
  previewParagraphs: [],
  tags: []
};

const remoteComment = (id: string, content: string): PieceComment => ({
  id,
  articleId: article.id,
  articleTitle: article.title,
  readerName: 'Reader',
  readerHash: 'account_reader_1',
  content,
  createdAt: '2026-10-08T10:00:00.000Z',
  status: 'approved'
});

describe('durable reader comments', () => {
  beforeAll(() => {
    process.env.VERCEL = '1';
    process.env.INITIAL_ADMIN_EMAIL = '';
    process.env.INITIAL_ADMIN_PASSWORD = '';
    process.env.ADMIN_EMAIL = '';
    process.env.ADMIN_PASSWORD = '';
  });

  beforeEach(() => {
    vi.resetModules();
    firestore.documents.clear();
    firestore.state.transactionError = null;
    firestore.state.queryGate = null;
    firestore.state.lastQueryLimit = null;
    firestore.state.queryCount = 0;
    firestore.resetTransactionQueue();
    firestore.documents.set(firestore.keyFor('articles', article.id), structuredClone(article) as any);
  });

  it('refreshes from Firestore so another server instance comment appears in the Writer Portal', async () => {
    const first = remoteComment('comm_remote_1', 'First comment');
    firestore.documents.set(firestore.keyFor('comments', first.id), structuredClone(first) as any);
    const { store } = await import('./store.js');
    await store.init();

    const second = remoteComment('comm_remote_2', 'Second instance comment');
    firestore.documents.set(firestore.keyFor('comments', second.id), structuredClone(second) as any);

    await expect(store.getFreshComments(undefined, true)).resolves.toEqual([
      expect.objectContaining({ id: first.id }),
      expect.objectContaining({ id: second.id })
    ]);
  }, 60_000);

  it('acknowledges a comment only after its Firestore transaction commits', async () => {
    const { store } = await import('./store.js');
    await store.init();
    firestore.state.transactionError = new Error('Firestore unavailable');

    await expect(store.addComment(article.id, 'Do not acknowledge me', 'Reader', undefined, 'account_reader_1'))
      .rejects.toThrow('Firestore unavailable');
    expect(store.getComments(article.id, true)).toEqual([]);
    expect([...firestore.documents.keys()].some(key => key.startsWith('comments/'))).toBe(false);
  }, 60_000);

  it('persists a posted comment for a fresh server instance', async () => {
    const { store } = await import('./store.js');
    await store.init();
    const saved = await store.addComment(article.id, 'Persist me', 'Reader', undefined, 'account_reader_1');

    expect(firestore.documents.get(firestore.keyFor('comments', saved.id))).toMatchObject({
      id: saved.id,
      content: 'Persist me'
    });

    vi.resetModules();
    const { store: nextInstance } = await import('./store.js');
    await nextInstance.init();
    expect(await nextInstance.getFreshComments(article.id, true)).toEqual([
      expect.objectContaining({ id: saved.id, content: 'Persist me' })
    ]);
  }, 60_000);

  it('atomically deduplicates simultaneous matching comments and increments the count once', async () => {
    const { store } = await import('./store.js');
    await store.init();

    const [first, second] = await Promise.all([
      store.addComment(article.id, 'Only once', 'Reader', undefined, 'account_reader_1'),
      store.addComment(article.id, 'Only once', 'Reader', undefined, 'account_reader_1')
    ]);

    expect(second.id).toBe(first.id);
    expect([...firestore.documents.keys()].filter(key => key.startsWith('comments/'))).toHaveLength(1);
    expect(firestore.documents.get(firestore.keyFor('articles', article.id))?.commentsCount).toBe(1);
    expect(store.getComments(article.id, true)).toHaveLength(1);
    const lock = [...firestore.documents.entries()].find(([key]) => key.startsWith('comment_submission_locks/'))?.[1];
    expect(lock?.expiresAt).toBeInstanceOf(Date);
  }, 60_000);

  it('does not let an older in-flight refresh erase a newly committed comment', async () => {
    const { store } = await import('./store.js');
    await store.init();
    let releaseQuery!: () => void;
    firestore.state.queryGate = new Promise<void>(resolve => { releaseQuery = resolve; });

    const staleRefresh = store.getFreshComments(article.id, true, { maxResults: 100 });
    await Promise.resolve();
    const saved = await store.addComment(article.id, 'Committed while refreshing', 'Reader', undefined, 'account_reader_1');
    releaseQuery();
    await staleRefresh;

    expect(store.getComments(article.id, true)).toEqual([
      expect.objectContaining({ id: saved.id, content: 'Committed while refreshing' })
    ]);
  }, 60_000);

  it('bounds Firestore refresh result size', async () => {
    for (let index = 0; index < 4; index += 1) {
      const comment = remoteComment(`comm_remote_${index}`, `Comment ${index}`);
      firestore.documents.set(firestore.keyFor('comments', comment.id), structuredClone(comment) as any);
    }
    const { store } = await import('./store.js');
    await store.init();

    const comments = await store.getFreshComments(article.id, true, { maxResults: 2 });

    expect(firestore.state.lastQueryLimit).toBe(2);
    expect(comments).toHaveLength(2);
  }, 60_000);

  it('returns the newest approved comments without hidden comments consuming the limit', async () => {
    const entries: PieceComment[] = [
      { ...remoteComment('comm_old', 'Old approved'), createdAt: '2026-10-08T08:00:00.000Z' },
      { ...remoteComment('comm_hidden', 'Newest hidden'), createdAt: '2026-10-08T12:00:00.000Z', status: 'hidden' },
      { ...remoteComment('comm_new', 'New approved'), createdAt: '2026-10-08T11:00:00.000Z' }
    ];
    for (const comment of entries) {
      firestore.documents.set(firestore.keyFor('comments', comment.id), structuredClone(comment) as any);
    }
    const { store } = await import('./store.js');
    await store.init();

    const comments = await store.getFreshComments(article.id, false, { maxResults: 2 });

    expect(comments.map(comment => comment.id)).toEqual(['comm_new', 'comm_old']);
  }, 60_000);

  it('allows concurrent refreshes for different pieces to populate independently', async () => {
    const otherArticle = { ...article, id: 'comment-piece-two', slug: 'comment-piece-two', title: 'Second Piece' };
    firestore.documents.set(firestore.keyFor('articles', otherArticle.id), structuredClone(otherArticle) as any);
    const first = remoteComment('comm_first_piece', 'First piece');
    const second = { ...remoteComment('comm_second_piece', 'Second piece'), articleId: otherArticle.id, articleTitle: otherArticle.title };
    firestore.documents.set(firestore.keyFor('comments', first.id), structuredClone(first) as any);
    firestore.documents.set(firestore.keyFor('comments', second.id), structuredClone(second) as any);
    const { store } = await import('./store.js');
    await store.init();

    const [firstResult, secondResult] = await Promise.all([
      store.getFreshComments(article.id, true),
      store.getFreshComments(otherArticle.id, true)
    ]);

    expect(firstResult).toEqual([expect.objectContaining({ id: first.id })]);
    expect(secondResult).toEqual([expect.objectContaining({ id: second.id })]);
  }, 60_000);

  it('does not mark a skipped stale refresh fresh and coalesces a valid refresh', async () => {
    const { store } = await import('./store.js');
    await store.init();
    let releaseQuery!: () => void;
    firestore.state.queryGate = new Promise<void>(resolve => { releaseQuery = resolve; });

    const staleRefresh = store.getFreshComments(article.id, false, { maxAgeMs: 15_000, maxResults: 100 });
    await Promise.resolve();
    await store.addComment(article.id, 'Mutation wins', 'Reader', undefined, 'account_reader_1');
    releaseQuery();
    await staleRefresh;
    const queriesAfterStaleRefresh = firestore.state.queryCount;
    firestore.state.queryGate = null;

    const [first, second] = await Promise.all([
      store.getFreshComments(article.id, false, { maxAgeMs: 15_000, maxResults: 100 }),
      store.getFreshComments(article.id, false, { maxAgeMs: 15_000, maxResults: 100 })
    ]);

    expect(firestore.state.queryCount).toBe(queriesAfterStaleRefresh + 1);
    expect(first).toEqual(second);
    await store.getFreshComments(article.id, false, { maxAgeMs: 15_000, maxResults: 100 });
    expect(firestore.state.queryCount).toBe(queriesAfterStaleRefresh + 1);
  }, 60_000);

  it('applies moderation count deltas without deriving totals from the bounded cache', async () => {
    const articleWithHistoricalCount = { ...article, commentsCount: 500 };
    firestore.documents.set(
      firestore.keyFor('articles', article.id),
      structuredClone(articleWithHistoricalCount) as any
    );
    const approved = remoteComment('comm_moderate', 'Moderate me');
    firestore.documents.set(firestore.keyFor('comments', approved.id), structuredClone(approved) as any);
    const { store } = await import('./store.js');
    await store.init();

    await store.updateCommentStatus(approved.id, 'hidden');

    expect(store.getArticleById(article.id, true)?.commentsCount).toBe(499);
    expect(firestore.documents.get(firestore.keyFor('articles', article.id))?.commentsCount).toBe(499);
  }, 60_000);

  it('does not recreate an article document when moderating an orphaned comment', async () => {
    const approved = remoteComment('comm_orphan_moderate', 'Orphaned moderation');
    firestore.documents.set(firestore.keyFor('comments', approved.id), structuredClone(approved) as any);
    const { store } = await import('./store.js');
    await store.init();
    firestore.documents.delete(firestore.keyFor('articles', article.id));

    await expect(store.updateCommentStatus(approved.id, 'hidden')).resolves.toMatchObject({
      id: approved.id,
      status: 'hidden'
    });

    expect(firestore.documents.has(firestore.keyFor('articles', article.id))).toBe(false);
  }, 60_000);

  it('does not recreate an article document when deleting an orphaned comment', async () => {
    const approved = remoteComment('comm_orphan_delete', 'Orphaned deletion');
    firestore.documents.set(firestore.keyFor('comments', approved.id), structuredClone(approved) as any);
    const { store } = await import('./store.js');
    await store.init();
    firestore.documents.delete(firestore.keyFor('articles', article.id));

    await expect(store.deleteComment(approved.id)).resolves.toBe(true);

    expect(firestore.documents.has(firestore.keyFor('articles', article.id))).toBe(false);
    expect(firestore.documents.has(firestore.keyFor('comments', approved.id))).toBe(false);
  }, 60_000);

  it('never drives a persisted article comment count below zero', async () => {
    const approved = remoteComment('comm_zero_count', 'Count floor');
    firestore.documents.set(firestore.keyFor('comments', approved.id), structuredClone(approved) as any);
    firestore.documents.set(firestore.keyFor('articles', article.id), {
      ...structuredClone(article),
      commentsCount: 0
    } as any);
    const { store } = await import('./store.js');
    await store.init();

    await store.updateCommentStatus(approved.id, 'hidden');
    expect(firestore.documents.get(firestore.keyFor('articles', article.id))?.commentsCount).toBe(0);
  }, 60_000);
});
