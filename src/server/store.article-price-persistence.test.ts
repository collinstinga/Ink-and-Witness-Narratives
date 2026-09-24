import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Article } from '../types.js';

const firestore = vi.hoisted(() => {
  type Document = Record<string, unknown>;
  type Operation = { collectionName: string; documentId: string; data: Document; merge: boolean };
  const documents = new Map<string, Document>();
  const keyFor = (collectionName: string, documentId: string) => `${collectionName}/${documentId}`;
  const state: {
    commitError: Error | null;
    commitGate: Promise<void> | null;
    writeError: Error | null;
    writeGate: Promise<void> | null;
  } = {
    commitError: null,
    commitGate: null,
    writeError: null,
    writeGate: null
  };
  const batchCommit = vi.fn(async (operations: Operation[]) => {
    if (state.commitGate) await state.commitGate;
    if (state.commitError) throw state.commitError;
    for (const operation of operations) {
      const key = keyFor(operation.collectionName, operation.documentId);
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
      if (state.writeGate) await state.writeGate;
      if (state.writeError) throw state.writeError;
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
      const operations: Array<{
        collectionName: string;
        documentId: string;
        data: Record<string, unknown>;
        merge: boolean;
      }> = [];
      return {
        set: vi.fn((reference: { collectionName: string; id: string }, data: Record<string, unknown>, options?: { merge?: boolean }) => {
          operations.push({
            collectionName: reference.collectionName,
            documentId: reference.id,
            data: structuredClone(data),
            merge: options?.merge === true
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
  id: 'pricing-persistence-test',
  title: 'A Durable Price',
  subtitle: '',
  slug: 'a-durable-price',
  excerpt: '',
  content: 'A full published piece.',
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

describe('article price persistence', () => {
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
    firestore.state.commitGate = null;
    firestore.state.writeError = null;
    firestore.state.writeGate = null;
    firestore.batchCommit.mockClear();
    firestore.setFirestoreDoc.mockClear();
    firestore.documents.set(
      firestore.keyFor('articles', originalArticle.id),
      structuredClone(originalArticle) as unknown as Record<string, unknown>
    );
  });

  it('rejects a failed cloud commit without changing the cached or durable price', async () => {
    const { store } = await import('./store.js');
    await store.init();
    firestore.batchCommit.mockClear();
    firestore.state.commitError = new Error('Firestore unavailable');

    await expect(store.saveArticle({ ...originalArticle, priceKes: 1500, prices: { KES: 1500 } }))
      .rejects.toThrow('Firestore unavailable');

    expect(firestore.batchCommit).toHaveBeenCalledTimes(1);
    expect(store.getArticleById(originalArticle.id, true)?.priceKes).toBe(1050);
    expect(firestore.documents.get(firestore.keyFor('articles', originalArticle.id))?.priceKes).toBe(1050);
    expect(firestore.documents.has(firestore.keyFor('site_configs', 'article_catalog'))).toBe(false);
  }, 60_000);

  it('normalizes malformed paid prices to the trusted fallback without making the pieces free', async () => {
    firestore.documents.clear();
    const missingPrice = {
      ...originalArticle,
      id: 'paid-missing-price',
      slug: 'paid-missing-price',
      prices: { USD: 8 }
    } as unknown as Record<string, unknown>;
    delete missingPrice.priceKes;
    const malformedArticles = [
      missingPrice,
      {
        ...originalArticle,
        id: 'paid-zero-price',
        slug: 'paid-zero-price',
        priceKes: 0,
        prices: { KES: 0 }
      },
      {
        ...originalArticle,
        id: 'paid-nan-price',
        slug: 'paid-nan-price',
        priceKes: Number.NaN,
        prices: { KES: Number.NaN }
      }
    ];
    for (const article of malformedArticles) {
      firestore.documents.set(
        firestore.keyFor('articles', String(article.id)),
        structuredClone(article) as Record<string, unknown>
      );
    }
    firestore.documents.set(firestore.keyFor('site_configs', 'mpesa_settings'), {
      defaultPriceKes: 725
    });

    const { store } = await import('./store.js');
    await store.init();

    for (const article of malformedArticles) {
      expect(store.getArticleById(String(article.id), false)).toMatchObject({
        isPaid: true,
        priceKes: 725,
        prices: { KES: 725 }
      });
    }
  }, 60_000);

  it('deduplicates concurrent catalog refreshes and reuses the refreshed TTL window', async () => {
    const { store } = await import('./store.js');
    await store.init();

    firestore.documents.set(firestore.keyFor('site_configs', 'article_catalog'), {
      version: 'remote-price-update'
    });
    firestore.documents.set(firestore.keyFor('articles', originalArticle.id), {
      ...originalArticle,
      priceKes: 1475,
      prices: { KES: 1475 }
    });
    firestore.getFirestoreDoc.mockClear();
    firestore.getAllFirestoreDocs.mockClear();

    const realNow = Date.now();
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(realNow + 15_001);
    try {
      const results = await Promise.all(
        Array.from({ length: 8 }, () => store.getFreshArticles(false))
      );
      expect(results).toHaveLength(8);
      expect(results.every(articles => articles[0]?.priceKes === 1475)).toBe(true);
      expect(firestore.getFirestoreDoc).toHaveBeenCalledTimes(1);
      expect(firestore.getFirestoreDoc).toHaveBeenCalledWith('site_configs', 'article_catalog');
      expect(firestore.getAllFirestoreDocs).toHaveBeenCalledTimes(1);
      expect(firestore.getAllFirestoreDocs).toHaveBeenCalledWith('articles');

      await store.getFreshArticles(false);
      await store.getFreshArticles(false);
      expect(firestore.getFirestoreDoc).toHaveBeenCalledTimes(1);
      expect(firestore.getAllFirestoreDocs).toHaveBeenCalledTimes(1);
    } finally {
      nowSpy.mockRestore();
    }
  }, 60_000);

  it('acknowledges only a committed price and reloads it on a new server instance', async () => {
    const { store } = await import('./store.js');
    await store.init();
    firestore.batchCommit.mockClear();

    let releaseCommit!: () => void;
    firestore.state.commitGate = new Promise<void>(resolve => { releaseCommit = resolve; });
    let saveResolved = false;
    const savePromise = store.saveArticle({ ...originalArticle, priceKes: 1500, prices: { KES: 1500 } })
      .then(result => { saveResolved = true; return result; });

    await vi.waitFor(() => expect(firestore.batchCommit).toHaveBeenCalledTimes(1));
    expect(saveResolved).toBe(false);
    expect(store.getArticleById(originalArticle.id, true)?.priceKes).toBe(1050);
    expect(firestore.documents.get(firestore.keyFor('articles', originalArticle.id))?.priceKes).toBe(1050);

    releaseCommit();
    const saved = await savePromise;
    firestore.state.commitGate = null;
    expect(saved.priceKes).toBe(1500);
    expect(saved.prices?.KES).toBe(1500);
    expect(store.getArticleById(originalArticle.id, true)?.priceKes).toBe(1500);
    expect(firestore.documents.get(firestore.keyFor('articles', originalArticle.id))?.priceKes).toBe(1500);
    expect(firestore.documents.get(firestore.keyFor('site_configs', 'article_catalog'))?.version)
      .toEqual(expect.any(String));

    vi.resetModules();
    const { store: nextInstance } = await import('./store.js');
    await nextInstance.init();
    expect(nextInstance.getArticleById(originalArticle.id, false)?.priceKes).toBe(1500);
  }, 60_000);

  it('does not overwrite a newer cloud price from a stale warm instance', async () => {
    const { store } = await import('./store.js');
    await store.init();
    firestore.setFirestoreDoc.mockClear();

    const remoteArticle = {
      ...originalArticle,
      priceKes: 1750,
      prices: { KES: 1750 },
      updatedAt: '2026-09-22T12:00:00.000Z'
    };
    firestore.documents.set(
      firestore.keyFor('articles', originalArticle.id),
      structuredClone(remoteArticle) as unknown as Record<string, unknown>
    );
    firestore.documents.set(firestore.keyFor('site_configs', 'article_catalog'), {
      version: 'newer-instance-save'
    });

    const result = await store.savePermanently('pricing-regression-test');

    expect(result.success).toBe(true);
    expect(store.getArticleById(originalArticle.id, true)?.priceKes).toBe(1750);
    expect(firestore.documents.get(firestore.keyFor('articles', originalArticle.id))?.priceKes).toBe(1750);
    expect(firestore.setFirestoreDoc.mock.calls.some(([collectionName]) => collectionName === 'articles'))
      .toBe(false);
  }, 60_000);

  it('rejects a failed cloud verification without bulk-writing a warm production snapshot', async () => {
    const { store } = await import('./store.js');
    await store.init();
    firestore.setFirestoreDoc.mockClear();
    firestore.getAllFirestoreDocs.mockRejectedValueOnce(new Error('Firestore verification failed'));

    await expect(store.savePermanently('cloud-verification-failure-test'))
      .rejects.toThrow('Firestore verification failed');
    expect(firestore.setFirestoreDoc).not.toHaveBeenCalled();
  }, 60_000);
});
