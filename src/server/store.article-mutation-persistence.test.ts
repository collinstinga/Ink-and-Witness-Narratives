import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Article } from '../types.js';

const firestore = vi.hoisted(() => {
  type Document = Record<string, unknown>;
  type SetOperation = {
    type: 'set';
    collectionName: string;
    documentId: string;
    data: Document;
    merge: boolean;
  };
  type DeleteOperation = {
    type: 'delete';
    collectionName: string;
    documentId: string;
  };
  type Operation = SetOperation | DeleteOperation;

  const documents = new Map<string, Document>();
  const keyFor = (collectionName: string, documentId: string) => `${collectionName}/${documentId}`;
  const state: { commitError: Error | null } = { commitError: null };
  const batchCommit = vi.fn(async (operations: Operation[]) => {
    if (state.commitError) throw state.commitError;
    for (const operation of operations) {
      const key = keyFor(operation.collectionName, operation.documentId);
      if (operation.type === 'delete') {
        documents.delete(key);
        continue;
      }
      const previous = documents.get(key) || {};
      documents.set(key, structuredClone(operation.merge ? { ...previous, ...operation.data } : operation.data));
    }
  });

  return {
    documents,
    keyFor,
    state,
    batchCommit,
    getFirestoreDoc: vi.fn(async (collectionName: string, documentId: string) => {
      const value = documents.get(keyFor(collectionName, documentId));
      return value ? structuredClone(value) : null;
    }),
    getAllFirestoreDocs: vi.fn(async (collectionName: string) => {
      const prefix = `${collectionName}/`;
      return Array.from(documents.entries())
        .filter(([key]) => key.startsWith(prefix))
        .map(([, value]) => structuredClone(value));
    }),
    setFirestoreDoc: vi.fn(async (collectionName: string, documentId: string, data: Document) => {
      const key = keyFor(collectionName, documentId);
      documents.set(key, structuredClone({ ...(documents.get(key) || {}), ...data }));
    }),
    deleteFirestoreDoc: vi.fn(async (collectionName: string, documentId: string) => {
      documents.delete(keyFor(collectionName, documentId));
    })
  };
});

vi.mock('./db.js', () => ({
  getDb: vi.fn(() => ({
    collection: vi.fn((collectionName: string) => ({
      doc: vi.fn((documentId: string) => ({ collectionName, id: documentId }))
    })),
    batch: vi.fn(() => {
      const operations: Array<
        | {
            type: 'set';
            collectionName: string;
            documentId: string;
            data: Record<string, unknown>;
            merge: boolean;
          }
        | {
            type: 'delete';
            collectionName: string;
            documentId: string;
          }
      > = [];
      return {
        set: vi.fn((reference: { collectionName: string; id: string }, data: Record<string, unknown>, options?: { merge?: boolean }) => {
          operations.push({
            type: 'set',
            collectionName: reference.collectionName,
            documentId: reference.id,
            data: structuredClone(data),
            merge: options?.merge === true
          });
        }),
        delete: vi.fn((reference: { collectionName: string; id: string }) => {
          operations.push({
            type: 'delete',
            collectionName: reference.collectionName,
            documentId: reference.id
          });
        }),
        commit: vi.fn(() => firestore.batchCommit(operations))
      };
    })
  })),
  getFirestoreDoc: firestore.getFirestoreDoc,
  getAllFirestoreDocs: firestore.getAllFirestoreDocs,
  setFirestoreDoc: firestore.setFirestoreDoc,
  deleteFirestoreDoc: firestore.deleteFirestoreDoc,
  sanitizeForFirestore: (value: unknown) => value
}));

vi.mock('./affiliateStore.js', () => ({
  affiliateStore: {
    init: vi.fn(async () => undefined),
    recordAffiliateSale: vi.fn()
  }
}));

const originalArticle: Article = {
  id: 'article-mutation-test',
  title: 'Current title',
  subtitle: '',
  slug: 'article-mutation-test',
  excerpt: 'Current excerpt',
  content: 'Current content',
  category: 'Essays',
  status: 'published',
  isPaid: true,
  priceKes: 1050,
  prices: { KES: 1050 },
  readTimeMinutes: 3,
  publishedAt: '2026-09-01',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  downloadsCount: 0,
  previewParagraphs: [],
  tags: []
};

describe('article catalog mutations', () => {
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
    firestore.state.commitError = null;
    firestore.batchCommit.mockClear();
    firestore.documents.set(
      firestore.keyFor('articles', originalArticle.id),
      structuredClone(originalArticle) as unknown as Record<string, unknown>
    );
  });

  it('restores archived articles with the catalog marker atomically and preserves cache on commit failure', async () => {
    const { store } = await import('./store.js');
    await store.init();
    const firstRestore: Article = {
      ...originalArticle,
      title: 'First archived title',
      content: 'First archived content',
      updatedAt: '2026-09-02T00:00:00.000Z'
    };

    firestore.batchCommit.mockClear();
    await expect(store.restoreFromBackupArchive({ articles: [firstRestore] }))
      .resolves.toMatchObject({ success: true, piecesCount: 1 });

    expect(firestore.batchCommit).toHaveBeenCalledTimes(1);
    expect(firestore.batchCommit.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({
        type: 'set',
        collectionName: 'articles',
        documentId: firstRestore.id,
        data: expect.objectContaining({
          id: firstRestore.id,
          title: firstRestore.title,
          content: firstRestore.content
        }),
        merge: true
      }),
      expect.objectContaining({
        type: 'set',
        collectionName: 'site_configs',
        documentId: 'article_catalog',
        data: expect.objectContaining({
          version: expect.any(String),
          updatedAt: expect.any(String)
        }),
        merge: true
      })
    ]);
    expect(store.getArticleById(firstRestore.id, true)).toMatchObject(firstRestore);

    const committedArticle = structuredClone(
      firestore.documents.get(firestore.keyFor('articles', firstRestore.id))
    );
    const committedCatalog = structuredClone(
      firestore.documents.get(firestore.keyFor('site_configs', 'article_catalog'))
    );
    const failedRestore: Article = {
      ...firstRestore,
      title: 'Uncommitted archived title',
      content: 'Uncommitted archived content',
      updatedAt: '2026-09-03T00:00:00.000Z'
    };
    firestore.batchCommit.mockClear();
    firestore.state.commitError = new Error('Firestore unavailable');

    await expect(store.restoreFromBackupArchive({ articles: [failedRestore] }))
      .rejects.toThrow('Firestore unavailable');

    expect(firestore.batchCommit).toHaveBeenCalledTimes(1);
    expect(firestore.batchCommit.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({
        type: 'set',
        collectionName: 'articles',
        documentId: failedRestore.id,
        data: expect.objectContaining({ title: failedRestore.title }),
        merge: true
      }),
      expect.objectContaining({
        type: 'set',
        collectionName: 'site_configs',
        documentId: 'article_catalog',
        merge: true
      })
    ]);
    expect(store.getArticleById(firstRestore.id, true)).toMatchObject(firstRestore);
    expect(firestore.documents.get(firestore.keyFor('articles', firstRestore.id)))
      .toEqual(committedArticle);
    expect(firestore.documents.get(firestore.keyFor('site_configs', 'article_catalog')))
      .toEqual(committedCatalog);
  }, 60_000);

  it('leaves cache and Firestore unchanged when any production mutation commit fails', async () => {
    const { store } = await import('./store.js');
    await store.init();
    const revision = store.saveArticleRevision(originalArticle.id, {
      title: 'Restored title',
      excerpt: 'Restored excerpt',
      content: 'Restored content',
      category: 'Reflections'
    });
    firestore.batchCommit.mockClear();
    firestore.state.commitError = new Error('Firestore unavailable');

    await expect(store.restoreArticleRevision(originalArticle.id, revision.id))
      .rejects.toThrow('Firestore unavailable');
    expect(store.getArticleById(originalArticle.id, true)).toMatchObject(originalArticle);
    expect(store.getArticleRevisions(originalArticle.id)).toHaveLength(1);

    await expect(store.togglePublish(originalArticle.id)).rejects.toThrow('Firestore unavailable');
    expect(store.getArticleById(originalArticle.id, true)?.status).toBe('published');

    await expect(store.deleteArticle(originalArticle.id)).rejects.toThrow('Firestore unavailable');
    expect(store.getArticleById(originalArticle.id, true)).toBeDefined();

    expect(firestore.batchCommit).toHaveBeenCalledTimes(3);
    expect(firestore.documents.get(firestore.keyFor('articles', originalArticle.id)))
      .toMatchObject(originalArticle as unknown as Record<string, unknown>);
    expect(firestore.documents.has(firestore.keyFor('site_configs', 'article_catalog'))).toBe(false);
  }, 60_000);

  it('invalidates a second instance after restore, publish toggle, and delete commits', async () => {
    const { store: writer } = await import('./store.js');
    await writer.init();
    const revision = writer.saveArticleRevision(originalArticle.id, {
      title: 'Restored title',
      excerpt: 'Restored excerpt',
      content: 'Restored content',
      category: 'Reflections'
    });

    vi.resetModules();
    const { store: reader } = await import('./store.js');
    await reader.init();

    await expect(writer.restoreArticleRevision(originalArticle.id, revision.id))
      .resolves.toMatchObject({ title: 'Restored title', content: 'Restored content' });
    const restoreVersion = firestore.documents.get(
      firestore.keyFor('site_configs', 'article_catalog')
    )?.version;
    expect(restoreVersion).toEqual(expect.any(String));
    expect(reader.getArticleById(originalArticle.id, true)?.content).toBe('Current content');
    expect((await reader.getFreshArticles(true, true))[0]?.content).toBe('Restored content');

    await expect(writer.togglePublish(originalArticle.id))
      .resolves.toMatchObject({ status: 'draft' });
    const toggleVersion = firestore.documents.get(
      firestore.keyFor('site_configs', 'article_catalog')
    )?.version;
    expect(toggleVersion).toEqual(expect.any(String));
    expect(toggleVersion).not.toBe(restoreVersion);
    expect(reader.getArticleById(originalArticle.id, true)?.status).toBe('published');
    expect((await reader.getFreshArticles(true, true))[0]?.status).toBe('draft');

    await expect(writer.deleteArticle(originalArticle.id)).resolves.toBe(true);
    const deleteVersion = firestore.documents.get(
      firestore.keyFor('site_configs', 'article_catalog')
    )?.version;
    expect(deleteVersion).toEqual(expect.any(String));
    expect(deleteVersion).not.toBe(toggleVersion);
    expect(reader.getArticleById(originalArticle.id, true)).toBeDefined();
    expect(await reader.getFreshArticles(true, true)).toEqual([]);
    expect(firestore.documents.has(firestore.keyFor('articles', originalArticle.id))).toBe(false);
  }, 60_000);

  it('persists taxonomy changes without overwriting newer article fields and publishes a metadata marker', async () => {
    firestore.documents.set(firestore.keyFor('categories', 'category-essays'), {
      id: 'category-essays',
      name: 'Essays',
      slug: 'essays',
      order: 1,
      isEnabled: true
    });
    const { store } = await import('./store.js');
    await store.init();

    // Model an out-of-band/newer content save that this warm instance has not
    // observed. The taxonomy mutation must merge only taxonomy fields.
    firestore.documents.set(firestore.keyFor('articles', originalArticle.id), {
      ...structuredClone(originalArticle),
      title: 'Newer remote title',
      content: 'Newer remote content',
      priceKes: 500,
      prices: { KES: 500 }
    } as unknown as Record<string, unknown>);
    firestore.batchCommit.mockClear();

    await expect(store.saveCategory({
      id: 'category-essays',
      name: 'Memoir'
    })).resolves.toMatchObject({ name: 'Memoir', slug: 'memoir' });

    const persisted = firestore.documents.get(firestore.keyFor('articles', originalArticle.id));
    expect(persisted).toMatchObject({
      title: 'Newer remote title',
      content: 'Newer remote content',
      priceKes: 500,
      prices: { KES: 500 },
      category: 'Memoir'
    });
    expect(firestore.documents.get(firestore.keyFor('site_configs', 'public_metadata')))
      .toMatchObject({ version: expect.any(String), updatedAt: expect.any(String) });
    expect(firestore.batchCommit.mock.calls[0]?.[0]).toContainEqual(expect.objectContaining({
      type: 'set',
      collectionName: 'articles',
      documentId: originalArticle.id,
      data: {
        category: 'Memoir',
        categories: undefined,
        updatedAt: expect.any(String)
      },
      merge: true
    }));
  }, 60_000);
});
