import { beforeAll, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => {
  type StoredDocument = Record<string, unknown>;
  type BatchOperation = {
    collectionName: string;
    documentId: string;
    data: StoredDocument;
    merge: boolean;
  };

  const documents = new Map<string, StoredDocument>();
  const keyFor = (collectionName: string, documentId: string) => `${collectionName}/${documentId}`;
  const state: {
    commitError: Error | null;
    commitGate: Promise<void> | null;
  } = {
    commitError: null,
    commitGate: null
  };

  const batchCommit = vi.fn(async (operations: BatchOperation[]) => {
    if (state.commitGate) await state.commitGate;
    if (state.commitError) throw state.commitError;
    for (const operation of operations) {
      const key = keyFor(operation.collectionName, operation.documentId);
      const previous = documents.get(key) || {};
      documents.set(key, structuredClone(
        operation.merge ? { ...previous, ...operation.data } : operation.data
      ));
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
    setFirestoreDoc: vi.fn(async (collectionName: string, documentId: string, data: StoredDocument) => {
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

describe('homepage configuration persistence', () => {
  beforeAll(() => {
    process.env.VERCEL = '1';
    process.env.INITIAL_ADMIN_EMAIL = '';
    process.env.INITIAL_ADMIN_PASSWORD = '';
    process.env.ADMIN_EMAIL = '';
    process.env.ADMIN_PASSWORD = '';

    const initialHomepage = {
      welcomeBackground: {
        imageUrl: '/initial-background.jpg',
        fit: 'cover',
        positionX: 50,
        positionY: 50,
        zoom: 100,
        overlayStrength: 25
      },
      mostSellingPieceIds: ['piece-a', 'piece-b', 'piece-c'],
      pieceOfTheWeekId: 'piece-a',
      mostSellingMode: 'manual'
    };
    firestore.documents.set(
      firestore.keyFor('site_configs', 'homepage'),
      structuredClone(initialHomepage)
    );
    firestore.documents.set(
      firestore.keyFor('site_configs', 'homepage_config'),
      structuredClone(initialHomepage)
    );
  });

  it('acknowledges only committed saves and reloads the same selections from the canonical document', async () => {
    const { store } = await import('./store.js');
    await store.init();

    expect(store.getHomepageConfig().config).toMatchObject({
      pieceOfTheWeekId: 'piece-a',
      mostSellingPieceIds: ['piece-a', 'piece-b', 'piece-c']
    });

    firestore.state.commitError = new Error('Firestore unavailable');
    await expect(store.saveHomepageConfig({ pieceOfTheWeekId: 'not-committed' }))
      .rejects.toThrow('Firestore unavailable');
    expect(store.getHomepageConfig().config.pieceOfTheWeekId).toBe('piece-a');
    firestore.state.commitError = null;

    let releaseCommit!: () => void;
    firestore.state.commitGate = new Promise<void>(resolve => {
      releaseCommit = resolve;
    });
    let saveResolved = false;
    const savePromise = store.saveHomepageConfig({
      pieceOfTheWeekId: 'piece-c',
      mostSellingPieceIds: ['piece-c', 'piece-a', 'piece-b'],
      mostSellingMode: 'manual'
    }).then(result => {
      saveResolved = true;
      return result;
    });

    await vi.waitFor(() => expect(firestore.batchCommit).toHaveBeenCalledTimes(2));
    expect(saveResolved).toBe(false);
    releaseCommit();
    const saved = await savePromise;
    firestore.state.commitGate = null;

    expect(saved.config).toMatchObject({
      pieceOfTheWeekId: 'piece-c',
      mostSellingPieceIds: ['piece-c', 'piece-a', 'piece-b'],
      mostSellingMode: 'manual'
    });
    expect(firestore.documents.get(firestore.keyFor('site_configs', 'homepage')))
      .toMatchObject(saved.config);
    expect(firestore.documents.get(firestore.keyFor('site_configs', 'homepage_config')))
      .toMatchObject(saved.config);

    vi.resetModules();
    const { store: reloadedStore } = await import('./store.js');
    await reloadedStore.init();

    expect(reloadedStore.getHomepageConfig().config).toMatchObject({
      pieceOfTheWeekId: 'piece-c',
      mostSellingPieceIds: ['piece-c', 'piece-a', 'piece-b'],
      mostSellingMode: 'manual'
    });
  }, 60_000);
});
