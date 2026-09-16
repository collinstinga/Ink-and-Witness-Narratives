import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
    transactionTail: Promise<void>;
  } = {
    commitError: null,
    commitGate: null,
    transactionTail: Promise.resolve()
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
  getDb: vi.fn(() => {
    const collection = vi.fn((collectionName: string) => ({
      doc: vi.fn((documentId: string) => ({ collectionName, id: documentId }))
    }));
    return {
      collection,
      runTransaction: vi.fn(async (callback: (transaction: {
        get: (reference: { collectionName: string; id: string }) => Promise<{
          id: string;
          exists: boolean;
          data: () => Record<string, unknown> | undefined;
        }>;
        set: (
          reference: { collectionName: string; id: string },
          data: Record<string, unknown>,
          options?: { merge?: boolean }
        ) => void;
      }) => Promise<unknown>) => {
        // Serialize the fake transactions to model Firestore retry semantics: a
        // concurrent writer observes the first committed document before it reruns.
        const previous = firestore.state.transactionTail;
        let release!: () => void;
        firestore.state.transactionTail = new Promise<void>(resolve => {
          release = resolve;
        });
        await previous;
        const operations: Array<{
          collectionName: string;
          documentId: string;
          data: Record<string, unknown>;
          merge: boolean;
        }> = [];
        try {
          const result = await callback({
            get: async reference => {
              const value = firestore.documents.get(
                firestore.keyFor(reference.collectionName, reference.id)
              );
              return {
                id: reference.id,
                exists: value !== undefined,
                data: () => value === undefined ? undefined : structuredClone(value)
              };
            },
            set: (reference, data, options) => {
              operations.push({
                collectionName: reference.collectionName,
                documentId: reference.id,
                data: structuredClone(data),
                merge: options?.merge === true
              });
            }
          });
          await firestore.batchCommit(operations);
          return result;
        } finally {
          release();
        }
      }),
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
    };
  }),
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
  });

  beforeEach(() => {
    vi.resetModules();
    firestore.documents.clear();
    firestore.batchCommit.mockClear();
    firestore.state.commitError = null;
    firestore.state.commitGate = null;
    firestore.state.transactionTail = Promise.resolve();
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
    const initialVersion = store.getHomepageConfig().config.updatedAt ?? null;

    expect(store.getHomepageConfig().config).toMatchObject({
      pieceOfTheWeekId: 'piece-a',
      mostSellingPieceIds: ['piece-a', 'piece-b', 'piece-c']
    });

    firestore.state.commitError = new Error('Firestore unavailable');
    await expect(store.saveHomepageConfig({ pieceOfTheWeekId: 'not-committed' }, initialVersion))
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
    }, initialVersion).then(result => {
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
    expect(saved.config.updatedAt).toEqual(expect.any(String));
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

  it('rejects a stale full-snapshot save without changing durable or cached state, then permits a fresh retry', async () => {
    const { store } = await import('./store.js');
    await store.init();
    const staleSnapshot = structuredClone(store.getHomepageConfig().config);
    const staleVersion = staleSnapshot.updatedAt ?? null;
    const winner = await store.saveHomepageConfig({ heroBadge: 'Fresh edit' }, staleVersion);
    const canonicalKey = firestore.keyFor('site_configs', 'homepage');
    const legacyKey = firestore.keyFor('site_configs', 'homepage_config');
    const canonicalAfterWinner = structuredClone(firestore.documents.get(canonicalKey));
    const legacyAfterWinner = structuredClone(firestore.documents.get(legacyKey));
    const commitsAfterWinner = firestore.batchCommit.mock.calls.length;

    await expect(store.saveHomepageConfig({
      ...staleSnapshot,
      pieceOfTheWeekId: 'piece-b'
    }, staleVersion)).rejects.toMatchObject({
      code: 'HOMEPAGE_SAVE_CONFLICT',
      statusCode: 409
    });
    expect(firestore.batchCommit).toHaveBeenCalledTimes(commitsAfterWinner);
    expect(firestore.documents.get(canonicalKey)).toEqual(canonicalAfterWinner);
    expect(firestore.documents.get(legacyKey)).toEqual(legacyAfterWinner);
    expect(store.getHomepageConfig().config).toEqual(winner.config);

    vi.resetModules();
    const { store: reloadedStore } = await import('./store.js');
    await reloadedStore.init();
    const fresh = reloadedStore.getHomepageConfig().config;
    expect(fresh).toMatchObject(winner.config);
    const retried = await reloadedStore.saveHomepageConfig({ pieceOfTheWeekId: 'piece-b' }, fresh.updatedAt!);
    expect(retried.config).toMatchObject({ heroBadge: 'Fresh edit', pieceOfTheWeekId: 'piece-b' });
    expect(retried.config.updatedAt).not.toBe(fresh.updatedAt);
    expect(firestore.documents.get(canonicalKey)).toMatchObject(retried.config);
    expect(firestore.documents.get(legacyKey)).toMatchObject(retried.config);
  }, 60_000);

  it('merges disjoint partial saves with successive expected versions', async () => {
    const { store } = await import('./store.js');
    await store.init();
    const initialVersion = store.getHomepageConfig().config.updatedAt ?? null;
    const selectionSave = await store.saveHomepageConfig({
      pieceOfTheWeekId: 'piece-b',
      mostSellingPieceIds: ['piece-b', 'piece-c', 'piece-a'],
      mostSellingMode: 'manual'
    }, initialVersion);
    const copySave = await store.saveHomepageConfig(
      { heroBadge: 'Reader favourite' },
      selectionSave.config.updatedAt!
    );

    expect(selectionSave.config.pieceOfTheWeekId).toBe('piece-b');
    expect(copySave.config).toMatchObject({
      pieceOfTheWeekId: 'piece-b',
      mostSellingPieceIds: ['piece-b', 'piece-c', 'piece-a'],
      mostSellingMode: 'manual',
      heroBadge: 'Reader favourite'
    });
    expect(selectionSave.config.updatedAt).toEqual(expect.any(String));
    expect(copySave.config.updatedAt).toEqual(expect.any(String));
    expect(copySave.config.updatedAt).not.toBe(selectionSave.config.updatedAt);
    expect(firestore.documents.get(firestore.keyFor('site_configs', 'homepage')))
      .toMatchObject(copySave.config);
    expect(firestore.documents.get(firestore.keyFor('site_configs', 'homepage_config')))
      .toMatchObject(copySave.config);
  }, 60_000);

  it('refreshes the admin version from Firestore and preserves remote curation during background changes', async () => {
    const { store } = await import('./store.js');
    await store.init();
    const canonicalKey = firestore.keyFor('site_configs', 'homepage');
    const legacyKey = firestore.keyFor('site_configs', 'homepage_config');
    const remoteVersion = '2026-09-16T03:00:00.000Z';
    const remote = {
      ...firestore.documents.get(canonicalKey),
      pieceOfTheWeekId: 'piece-b',
      mostSellingPieceIds: ['piece-b', 'piece-c', 'piece-a'],
      updatedAt: remoteVersion
    };
    firestore.documents.set(canonicalKey, structuredClone(remote));
    firestore.documents.set(legacyKey, structuredClone(remote));

    expect((await store.getFreshHomepageConfig()).config).toMatchObject({
      pieceOfTheWeekId: 'piece-b',
      updatedAt: remoteVersion
    });

    await store.updateWelcomeBackground('https://images.example.test/welcome.jpg');
    const afterUpload = firestore.documents.get(canonicalKey);
    expect(afterUpload).toMatchObject({
      pieceOfTheWeekId: 'piece-b',
      mostSellingPieceIds: ['piece-b', 'piece-c', 'piece-a'],
      welcomeBackground: { imageUrl: 'https://images.example.test/welcome.jpg' }
    });
    expect(afterUpload?.updatedAt).not.toBe(remoteVersion);
    expect(firestore.documents.get(legacyKey)).toEqual(afterUpload);

    await store.removeWelcomeBackground();
    const afterRemove = firestore.documents.get(canonicalKey);
    expect(afterRemove).toMatchObject({
      pieceOfTheWeekId: 'piece-b',
      mostSellingPieceIds: ['piece-b', 'piece-c', 'piece-a'],
      welcomeBackground: { savedPermanently: false }
    });
    expect((afterRemove?.welcomeBackground as Record<string, unknown>)).not.toHaveProperty('imageUrl');
    expect(afterRemove?.updatedAt).not.toBe(afterUpload?.updatedAt);
    expect(firestore.documents.get(legacyKey)).toEqual(afterRemove);
  }, 60_000);

  it('uses the persisted public curation even on a warm instance and resolves a newly published pick', async () => {
    const { store } = await import('./store.js');
    await store.init();
    const canonicalKey = firestore.keyFor('site_configs', 'homepage');
    firestore.documents.set(canonicalKey, {
      ...firestore.documents.get(canonicalKey),
      heroHeadline: 'Published headline',
      pieceOfTheWeekId: 'new-piece',
      updatedAt: '2026-09-01T00:00:00.000Z'
    });
    firestore.documents.set(firestore.keyFor('articles', 'new-piece'), {
      id: 'new-piece',
      slug: 'new-piece',
      title: 'Freshly published piece',
      status: 'published',
      createdAt: '2026-09-16T00:00:00.000Z'
    });

    const publicHomepage = await store.getFreshHomepageConfig();
    expect(publicHomepage.config.heroHeadline).toBe('Published headline');
    expect(publicHomepage.pieceOfTheWeek?.id).toBe('new-piece');
    expect(firestore.getFirestoreDoc).toHaveBeenCalledWith('site_configs', 'homepage');
    expect(firestore.getFirestoreDoc).toHaveBeenCalledWith('articles', 'new-piece');
  }, 60_000);

  it('does not resurrect a removed background from a warm instance or author fallback', async () => {
    const { store } = await import('./store.js');
    await store.init();
    expect(store.getHomepageConfig().config.welcomeBackground.imageUrl).toBe('/initial-background.jpg');
    const canonicalKey = firestore.keyFor('site_configs', 'homepage');
    firestore.documents.set(canonicalKey, {
      ...firestore.documents.get(canonicalKey),
      welcomeBackground: { fit: 'cover', savedPermanently: false },
      updatedAt: '2026-09-16T19:00:00.000Z'
    });
    const fresh = await store.getFreshHomepageConfig();
    expect(fresh.config.welcomeBackground.imageUrl).toBeUndefined();
    expect(fresh.config.welcomeBackground.savedPermanently).toBe(false);
  }, 60_000);
});
