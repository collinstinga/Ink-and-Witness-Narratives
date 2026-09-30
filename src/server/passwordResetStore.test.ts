import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getActiveReaderSessionPointerId } from './sessionSecurity.js';
import {
  PASSWORD_RESET_TOKEN_TTL_MS,
  getPasswordResetPointerId,
  hashPasswordResetToken
} from './passwordResetSecurity.js';
import { PasswordResetStore } from './passwordResetStore.js';

type StoredDocument = Record<string, unknown>;
type FakeDocumentReference = {
  collectionName: string;
  id: string;
  path: string;
  get: () => Promise<FakeDocumentSnapshot>;
};
type FakeDocumentSnapshot = {
  exists: boolean;
  data: () => StoredDocument | undefined;
};

function createFakeFirestore() {
  const documents = new Map<string, StoredDocument>();
  const keyFor = (collectionName: string, id: string) => `${collectionName}/${id}`;
  const clone = <T>(value: T): T => structuredClone(value);
  const snapshot = (ref: FakeDocumentReference): FakeDocumentSnapshot => {
    const value = documents.get(ref.path);
    return {
      exists: value !== undefined,
      data: () => value === undefined ? undefined : clone(value)
    };
  };
  const reference = (collectionName: string, id: string): FakeDocumentReference => {
    const ref = {
      collectionName,
      id,
      path: keyFor(collectionName, id)
    } as FakeDocumentReference;
    ref.get = vi.fn(async () => snapshot(ref));
    return ref;
  };

  const db = {
    collection: vi.fn((collectionName: string) => ({
      doc: vi.fn((id: string) => reference(collectionName, id))
    })),
    runTransaction: vi.fn(async (callback: (transaction: {
      get: (ref: FakeDocumentReference) => Promise<FakeDocumentSnapshot>;
      create: (ref: FakeDocumentReference, data: StoredDocument) => void;
      set: (ref: FakeDocumentReference, data: StoredDocument) => void;
      update: (ref: FakeDocumentReference, data: StoredDocument) => void;
      delete: (ref: FakeDocumentReference) => void;
    }) => Promise<unknown>) => {
      const operations: Array<() => void> = [];
      const transaction = {
        get: vi.fn(async (ref: FakeDocumentReference) => snapshot(ref)),
        create: vi.fn((ref: FakeDocumentReference, data: StoredDocument) => {
          operations.push(() => {
            if (documents.has(ref.path)) throw new Error(`Document already exists: ${ref.path}`);
            documents.set(ref.path, clone(data));
          });
        }),
        set: vi.fn((ref: FakeDocumentReference, data: StoredDocument) => {
          operations.push(() => documents.set(ref.path, clone(data)));
        }),
        update: vi.fn((ref: FakeDocumentReference, data: StoredDocument) => {
          operations.push(() => {
            const existing = documents.get(ref.path);
            if (!existing) throw new Error(`Document does not exist: ${ref.path}`);
            documents.set(ref.path, { ...clone(existing), ...clone(data) });
          });
        }),
        delete: vi.fn((ref: FakeDocumentReference) => {
          operations.push(() => documents.delete(ref.path));
        })
      };
      const result = await callback(transaction);
      operations.forEach(operation => operation());
      return result;
    })
  };

  return { db, documents, keyFor };
}

const READER_ID = 'user_reader123';
const NOW = Date.parse('2026-09-30T09:00:00.000Z');
const OLD_PASSWORD_HASH = '$argon2id$old-password-hash';
const NEW_PASSWORD_HASH = '$argon2id$new-password-hash';

function readerRecord(passwordHash = OLD_PASSWORD_HASH): StoredDocument {
  return {
    id: READER_ID,
    email: 'reader@example.test',
    name: 'Reader One',
    role: 'client',
    passwordHash,
    createdAt: '2026-01-01T00:00:00.000Z'
  };
}

describe('PasswordResetStore', () => {
  let fake: ReturnType<typeof createFakeFirestore>;
  let store: PasswordResetStore;

  beforeEach(() => {
    fake = createFakeFirestore();
    store = new PasswordResetStore(() => fake.db as never);
    fake.documents.set(fake.keyFor('users', READER_ID), readerRecord());
  });

  it('stores only a token hash and never persists the bearer reset token', async () => {
    const issued = await store.issue(READER_ID, NOW);
    const tokenHash = hashPasswordResetToken(issued.token)!;
    const pointerId = getPasswordResetPointerId(READER_ID)!;

    expect(fake.documents.get(fake.keyFor('password_reset_tokens', tokenHash))).toMatchObject({
      version: 1,
      purpose: 'reader-password-reset',
      userId: READER_ID,
      createdAt: NOW,
      expiresAt: NOW + PASSWORD_RESET_TOKEN_TTL_MS
    });
    expect(fake.documents.get(fake.keyFor('password_reset_pointers', pointerId))).toMatchObject({
      tokenHash,
      userId: READER_ID
    });
    expect(fake.documents.has(fake.keyFor('password_reset_tokens', issued.token))).toBe(false);
    expect(JSON.stringify(Array.from(fake.documents.entries()))).not.toContain(issued.token);
    await expect(store.isActive(issued.token, NOW)).resolves.toBe(true);
  });

  it('consumes a reset exactly once, updates the password, and revokes the active reader session', async () => {
    const activePointerId = getActiveReaderSessionPointerId(READER_ID)!;
    fake.documents.set(fake.keyFor('active_reader_sessions', activePointerId), {
      userId: READER_ID,
      sessionDocumentId: `v2_${'a'.repeat(64)}`
    });
    const issued = await store.issue(READER_ID, NOW);
    const tokenHash = hashPasswordResetToken(issued.token)!;
    const pointerId = getPasswordResetPointerId(READER_ID)!;

    const first = await store.consume(issued.token, NEW_PASSWORD_HASH, NOW + 1_000);

    expect(first).toMatchObject({
      user: {
        id: READER_ID,
        passwordHash: NEW_PASSWORD_HASH,
        updatedAt: new Date(NOW + 1_000).toISOString()
      },
      resetAt: new Date(NOW + 1_000).toISOString()
    });
    expect(fake.documents.get(fake.keyFor('users', READER_ID))).toMatchObject({
      passwordHash: NEW_PASSWORD_HASH,
      updatedAt: new Date(NOW + 1_000).toISOString()
    });
    expect(fake.documents.has(fake.keyFor('password_reset_tokens', tokenHash))).toBe(false);
    expect(fake.documents.has(fake.keyFor('password_reset_pointers', pointerId))).toBe(false);
    expect(fake.documents.has(fake.keyFor('active_reader_sessions', activePointerId))).toBe(false);

    await expect(store.consume(issued.token, '$argon2id$another-password', NOW + 2_000))
      .resolves.toBeNull();
    expect(fake.documents.get(fake.keyFor('users', READER_ID))?.passwordHash)
      .toBe(NEW_PASSWORD_HASH);
  });

  it('expires reset capabilities without changing the password or revoking a valid session', async () => {
    const activePointerId = getActiveReaderSessionPointerId(READER_ID)!;
    fake.documents.set(fake.keyFor('active_reader_sessions', activePointerId), {
      userId: READER_ID,
      sessionDocumentId: `v2_${'b'.repeat(64)}`
    });
    const issued = await store.issue(READER_ID, NOW);

    await expect(store.isActive(issued.token, NOW + PASSWORD_RESET_TOKEN_TTL_MS))
      .resolves.toBe(false);
    await expect(store.consume(
      issued.token,
      NEW_PASSWORD_HASH,
      NOW + PASSWORD_RESET_TOKEN_TTL_MS
    )).resolves.toBeNull();

    expect(fake.documents.get(fake.keyFor('users', READER_ID))?.passwordHash)
      .toBe(OLD_PASSWORD_HASH);
    expect(fake.documents.has(fake.keyFor('active_reader_sessions', activePointerId))).toBe(true);
    expect(fake.documents.has(fake.keyFor(
      'password_reset_tokens',
      hashPasswordResetToken(issued.token)!
    ))).toBe(false);
    expect(fake.documents.has(fake.keyFor(
      'password_reset_pointers',
      getPasswordResetPointerId(READER_ID)!
    ))).toBe(false);
  });

  it('replaces an older reset capability so only the newest link remains active', async () => {
    const first = await store.issue(READER_ID, NOW);
    const firstHash = hashPasswordResetToken(first.token)!;
    const second = await store.issue(READER_ID, NOW + 1_000);
    const secondHash = hashPasswordResetToken(second.token)!;
    const pointerId = getPasswordResetPointerId(READER_ID)!;

    expect(second.token).not.toBe(first.token);
    expect(fake.documents.has(fake.keyFor('password_reset_tokens', firstHash))).toBe(false);
    expect(fake.documents.has(fake.keyFor('password_reset_tokens', secondHash))).toBe(true);
    expect(fake.documents.get(fake.keyFor('password_reset_pointers', pointerId)))
      .toMatchObject({ tokenHash: secondHash });
    await expect(store.isActive(first.token, NOW + 2_000)).resolves.toBe(false);
    await expect(store.isActive(second.token, NOW + 2_000)).resolves.toBe(true);
    await expect(store.consume(first.token, NEW_PASSWORD_HASH, NOW + 2_000)).resolves.toBeNull();
    expect(fake.documents.get(fake.keyFor('users', READER_ID))?.passwordHash)
      .toBe(OLD_PASSWORD_HASH);
  });
});
