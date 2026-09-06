import { describe, expect, it } from 'vitest';
import {
  AUTH_SESSION_STORAGE_VERSION,
  LEGACY_AUTH_SESSION_MIGRATION_DEADLINE_MS,
  createSignedAuthSessionToken,
  getAuthSessionTokenKind,
  getAuthSessionDocumentId,
  isAuthSessionDocumentId,
  isLegacyAuthSessionMigrationAllowed,
  isValidLegacySessionToken,
  isValidSignedSessionToken,
  normalizeAuthSessionRecord,
  normalizeLegacyAuthSessionRecord
} from './sessionSecurity.js';

describe('primary session storage security', () => {
  const signingSecret = 'test-signing-secret-that-is-at-least-thirty-two-characters';
  const token = `sess_${'a'.repeat(64)}`;
  const record = {
    userId: 'user_1',
    role: 'admin',
    email: 'Admin@Example.test ',
    name: ' Test Admin ',
    createdAt: 1_000,
    expiresAt: 2_000
  };

  it('authenticates newly issued tokens before any persistence lookup', () => {
    const signedToken = createSignedAuthSessionToken(signingSecret);
    const tampered = `${signedToken.slice(0, -1)}${signedToken.endsWith('0') ? '1' : '0'}`;

    expect(isValidSignedSessionToken(signedToken, signingSecret)).toBe(true);
    expect(getAuthSessionTokenKind(signedToken, signingSecret)).toBe('v2');
    expect(isValidSignedSessionToken(tampered, signingSecret)).toBe(false);
    expect(getAuthSessionTokenKind(tampered, signingSecret)).toBeNull();
    expect(isValidLegacySessionToken(token)).toBe(true);
    expect(isValidLegacySessionToken(`sess_${'A'.repeat(64)}`)).toBe(false);
    expect(getAuthSessionTokenKind('../sessions/admin', signingSecret)).toBeNull();
  });

  it('derives a stable document identifier without retaining the bearer token', () => {
    const documentId = getAuthSessionDocumentId(token);

    expect(documentId).toMatch(/^v2_[a-f0-9]{64}$/);
    expect(documentId).not.toContain(token);
    expect(documentId).toBe(getAuthSessionDocumentId(token));
    expect(isAuthSessionDocumentId(documentId)).toBe(true);
    expect(getAuthSessionDocumentId('invalid')).toBeNull();
  });

  it('normalizes stored records into a token-free v2 shape', () => {
    expect(normalizeAuthSessionRecord({ ...record, storageVersion: 2 })).toEqual({
      storageVersion: AUTH_SESSION_STORAGE_VERSION,
      userId: 'user_1',
      role: 'admin',
      email: 'admin@example.test',
      name: 'Test Admin',
      createdAt: 1_000,
      expiresAt: 2_000
    });
  });

  it('accepts a legacy record only when its embedded token exactly matches', () => {
    expect(normalizeLegacyAuthSessionRecord({ ...record, sessionId: token }, token)).not.toBeNull();
    expect(normalizeLegacyAuthSessionRecord({ ...record, sessionId: `sess_${'b'.repeat(64)}` }, token)).toBeNull();
    expect(normalizeLegacyAuthSessionRecord(record, token)).toBeNull();
  });

  it('closes the legacy lookup window after every previously issued session has expired', () => {
    expect(isLegacyAuthSessionMigrationAllowed(LEGACY_AUTH_SESSION_MIGRATION_DEADLINE_MS - 1)).toBe(true);
    expect(isLegacyAuthSessionMigrationAllowed(LEGACY_AUTH_SESSION_MIGRATION_DEADLINE_MS)).toBe(false);
  });

  it('rejects malformed or nonsensical session records', () => {
    expect(normalizeAuthSessionRecord({ ...record, storageVersion: 2, role: 'owner' })).toBeNull();
    expect(normalizeAuthSessionRecord({ ...record, storageVersion: 2, expiresAt: 999 })).toBeNull();
    expect(normalizeAuthSessionRecord({ ...record, storageVersion: 2, userId: '' })).toBeNull();
    expect(normalizeAuthSessionRecord({ ...record, storageVersion: 2, sessionId: token })).toBeNull();
  });
});
