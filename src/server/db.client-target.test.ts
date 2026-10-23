import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';

const sdk = vi.hoisted(() => ({
  apps: [] as Array<{ name: string; options: { projectId: string } }>,
  client: { settings: vi.fn() },
}));
vi.mock('firebase-admin/app', () => ({
  applicationDefault: vi.fn(() => ({})), cert: vi.fn(() => ({})),
  getApps: () => sdk.apps,
  initializeApp: (options: { projectId: string }, name: string) => {
    const app = { options, name };
    sdk.apps.push(app);
    return app;
  },
}));
vi.mock('firebase-admin/firestore', () => ({ getFirestore: vi.fn(() => sdk.client) }));

beforeEach(() => {
  vi.resetModules();
  sdk.apps = [];
  sdk.client = { settings: vi.fn() };
  vi.stubEnv('FIREBASE_PROJECT_ID', 'target-staging');
  vi.stubEnv('FIRESTORE_DATABASE_ID', 'staging-database');
  vi.stubEnv('FIREBASE_SERVICE_ACCOUNT_JSON', '');
  vi.stubEnv('VERCEL', '');
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('Firestore client target binding', () => {
  it('trusts only the target actually supplied to the initialized client', async () => {
    const { getDb, getFirestoreClientTarget } = await import('./db.js');
    expect(getFirestoreClientTarget({} as Firestore)).toBeNull();
    expect(getFirestoreClientTarget(sdk.client as unknown as Firestore)).toBeNull();
    const db = getDb();
    expect(getFirestoreClientTarget(db)).toEqual({ projectId: 'target-staging', firestoreDatabaseId: 'staging-database' });
    expect(sdk.client.settings).toHaveBeenCalledWith({ ignoreUndefinedProperties: true });
    const { getFirestore } = await import('firebase-admin/firestore');
    expect(getFirestore).toHaveBeenCalledWith(sdk.apps[0], 'staging-database');
  });

  it('cannot relabel an existing client by changing the environment or returned metadata', async () => {
    const { getDb, getFirestoreClientTarget } = await import('./db.js');
    const db = getDb();
    const metadata = getFirestoreClientTarget(db)!;
    metadata.projectId = 'modified-project';
    vi.stubEnv('FIREBASE_PROJECT_ID', 'another-project');
    vi.stubEnv('FIRESTORE_DATABASE_ID', 'another-database');
    expect(getDb()).toBe(db);
    expect(getFirestoreClientTarget(db)).toEqual({ projectId: 'target-staging', firestoreDatabaseId: 'staging-database' });
  });

  it('does not bind a client to an existing app with a conflicting project', async () => {
    sdk.apps.push({ name: 'ink-witness-server-firestore', options: { projectId: 'other-project' } });
    const { getDb, getFirestoreClientTarget } = await import('./db.js');
    expect(() => getDb()).toThrow('Firebase server app is already bound to a different project.');
    expect(getFirestoreClientTarget(sdk.client as unknown as Firestore)).toBeNull();
  });
});
