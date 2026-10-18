import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => ({
  documents: new Map<string, any>(),
  getDb: vi.fn(),
  getDoc: vi.fn(),
  runTransaction: vi.fn(),
}));

vi.mock('./db.js', () => ({
  getDb: firestore.getDb,
  getFirestoreDoc: firestore.getDoc,
  sanitizeForFirestore: (value: unknown) => JSON.parse(JSON.stringify(value)),
}));

import type { LiteraryCirclePromotionalResource, LiteraryCircleResourceLibrary } from '../types.js';
import {
  DEFAULT_LITERARY_CIRCLE_RESOURCE_LIBRARY,
  getLiteraryCircleResourceLibraryFresh,
  LiteraryCircleResourcesConflictError,
  projectLiteraryCircleResourcesForAffiliate,
  removeLiteraryCircleResourceImage,
  saveLiteraryCircleResourceLibrary,
  validateLiteraryCircleResourceLibrary,
} from './literaryCircleResources.js';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function resource(overrides: Partial<LiteraryCirclePromotionalResource> = {}): LiteraryCirclePromotionalResource {
  return {
    id: 'resource-one',
    kind: 'campaign_kit',
    title: 'October campaign',
    description: 'A writer-approved campaign resource.',
    body: 'Approved caption text.',
    destination: { kind: 'piece', id: 'piece-one' },
    campaignCode: 'OCTOBER',
    isPublished: false,
    order: 0,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function library(overrides: Partial<LiteraryCircleResourceLibrary> = {}): LiteraryCircleResourceLibrary {
  return {
    ...DEFAULT_LITERARY_CIRCLE_RESOURCE_LIBRARY,
    revision: 0,
    enabled: true,
    items: [resource()],
    ...overrides,
  };
}

describe('Literary Circle promotional resource store', () => {
  beforeEach(() => {
    firestore.documents.clear();
    firestore.getDoc.mockReset();
    firestore.runTransaction.mockReset();
    firestore.getDoc.mockImplementation(async (collection: string, id: string) => (
      clone(firestore.documents.get(`${collection}/${id}`) ?? null)
    ));

    const db = {
      collection: (collection: string) => ({
        doc: (id: string) => ({ collection, id }),
      }),
      runTransaction: firestore.runTransaction,
    };
    firestore.getDb.mockReturnValue(db);
    firestore.runTransaction.mockImplementation(async (operation: (transaction: any) => Promise<any>) => {
      const writes: Array<{ type: 'set' | 'delete'; reference: any; value?: any; merge?: boolean }> = [];
      let writeStarted = false;
      const transaction = {
        get: async (reference: { collection: string; id: string }) => {
          if (writeStarted) throw new Error('Firestore transaction attempted a read after a write.');
          const value = firestore.documents.get(`${reference.collection}/${reference.id}`);
          return { exists: value !== undefined, data: () => clone(value) };
        },
        set: (reference: any, value: any, options?: { merge?: boolean }) => {
          writeStarted = true;
          writes.push({ type: 'set', reference, value: clone(value), merge: options?.merge === true });
        },
        delete: (reference: any) => {
          writeStarted = true;
          writes.push({ type: 'delete', reference });
        },
      };
      const result = await operation(transaction);
      for (const write of writes) {
        const key = `${write.reference.collection}/${write.reference.id}`;
        if (write.type === 'delete') firestore.documents.delete(key);
        else firestore.documents.set(
          key,
          write.merge ? { ...(firestore.documents.get(key) || {}), ...write.value } : write.value,
        );
      }
      return clone(result);
    });
  });

  it('fails closed when the resource document does not exist', async () => {
    const fresh = await getLiteraryCircleResourceLibraryFresh();
    expect(fresh.enabled).toBe(false);
    expect(fresh.items).toEqual([]);
  });

  it('rejects unknown fields, unsafe destinations, and artwork without meaningful alt text', () => {
    expect(() => validateLiteraryCircleResourceLibrary({
      ...library(),
      unexpected: true,
    })).toThrow(/unsupported/i);
    expect(() => validateLiteraryCircleResourceLibrary(library({
      items: [resource({ destination: { kind: 'piece', id: '../secret' } })],
    }))).toThrow(/destination/i);
    expect(() => validateLiteraryCircleResourceLibrary(library({
      items: [resource({ assetId: 'asset-one', assetAlt: 'image' })],
    }))).toThrow(/meaningful alternative text/i);
  });

  it('projects only published, current resources in writer order', () => {
    const projected = projectLiteraryCircleResourcesForAffiliate(library({
      items: [
        resource({ id: 'second', isPublished: true, order: 2 }),
        resource({ id: 'first', isPublished: true, order: 1 }),
        resource({ id: 'draft', order: 0 }),
        resource({ id: 'future', isPublished: true, order: 0, publishedAt: '2026-11-01T00:00:00.000Z' }),
        resource({ id: 'expired', isPublished: true, order: 0, expiresAt: '2026-10-01T00:00:00.000Z' }),
      ],
    }), '2026-10-18T00:00:00.000Z');

    expect(projected.items.map(item => item.id)).toEqual(['first', 'second']);
  });

  it('saves metadata and a redacted audit atomically, then rejects a stale revision', async () => {
    const saved = await saveLiteraryCircleResourceLibrary(library(), 'Writer', 0);

    expect(saved.library.revision).toBe(1);
    expect(firestore.documents.get('site_configs/literary_circle_resources').revision).toBe(1);
    const audit = [...firestore.documents.entries()].find(([key]) => key.startsWith('affiliate_audit/'))?.[1];
    expect(audit?.targetType).toBe('resource');
    expect(JSON.stringify(audit)).not.toContain('Approved caption text.');
    expect(audit?.newValue?.items?.[0]?.bodyDigest).toMatchObject({
      length: 'Approved caption text.'.length,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });

    const copyChanged = await saveLiteraryCircleResourceLibrary({
      ...saved.library,
      items: saved.library.items.map(item => ({ ...item, body: 'A different approved caption.' })),
    }, 'Writer', 1);
    expect(copyChanged.audit.previousValue?.items?.[0]?.bodyDigest?.sha256)
      .not.toBe(copyChanged.audit.newValue?.items?.[0]?.bodyDigest?.sha256);
    expect(JSON.stringify(copyChanged.audit)).not.toContain('A different approved caption.');

    await expect(saveLiteraryCircleResourceLibrary(library({ revision: 0 }), 'Stale writer', 0))
      .rejects.toBeInstanceOf(LiteraryCircleResourcesConflictError);
  });

  it('promotes an existing private resource asset only on explicit publication', async () => {
    const draft = library({
      revision: 4,
      items: [resource({ assetId: 'asset-one', assetAlt: 'Indigo cover with a silver doorway' })],
    });
    firestore.documents.set('site_configs/literary_circle_resources', clone(draft));
    firestore.documents.set('uploaded_assets/asset-one', {
      id: 'asset-one',
      target: 'affiliate_resource',
      resourceId: 'resource-one',
      accessScope: 'literary_circle_private',
      dataUrl: 'data:image/png;base64,AAAA',
    });

    const published = await saveLiteraryCircleResourceLibrary({
      ...draft,
      items: draft.items.map(item => ({ ...item, isPublished: true })),
    }, 'Writer', 4);

    expect(published.library.revision).toBe(5);
    expect(firestore.documents.get('uploaded_assets/asset-one')).toMatchObject({
      accessScope: 'public',
      shareable: true,
      url: '/api/assets/asset-one',
    });
  });

  it('deletes an unshared private image in the same transaction that removes its association', async () => {
    const withImage = library({
      revision: 2,
      items: [resource({ assetId: 'asset-one', assetAlt: 'Indigo cover with a silver doorway' })],
    });
    firestore.documents.set('site_configs/literary_circle_resources', clone(withImage));
    firestore.documents.set('uploaded_assets/asset-one', {
      id: 'asset-one',
      target: 'affiliate_resource',
      resourceId: 'resource-one',
      accessScope: 'literary_circle_private',
    });

    const removed = await removeLiteraryCircleResourceImage({
      resourceId: 'resource-one',
      expectedRevision: 2,
      actor: 'Writer',
    });

    expect(removed.library.items[0].assetId).toBeUndefined();
    expect(removed.library.revision).toBe(3);
    expect(firestore.documents.has('uploaded_assets/asset-one')).toBe(false);
    expect(removed.audit?.action).toBe('literary_circle_resource_image_removed');
  });
});
