import { describe, expect, it } from 'vitest';
import {
  PASSWORD_RESET_TOKEN_PATTERN,
  PASSWORD_RESET_TOKEN_TTL_MS,
  createPasswordResetToken,
  getPasswordResetPointerId,
  hashPasswordResetToken,
  normalizePasswordResetPointerRecord,
  normalizePasswordResetTokenRecord
} from './passwordResetSecurity.js';

describe('password reset security', () => {
  it('creates high-entropy opaque tokens and stores only deterministic hashes', () => {
    const first = createPasswordResetToken();
    const second = createPasswordResetToken();

    expect(first).toMatch(PASSWORD_RESET_TOKEN_PATTERN);
    expect(second).toMatch(PASSWORD_RESET_TOKEN_PATTERN);
    expect(second).not.toBe(first);
    expect(hashPasswordResetToken(first)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashPasswordResetToken(first)).not.toContain(first);
  });

  it('rejects malformed tokens and unsafe reader identifiers', () => {
    expect(hashPasswordResetToken('pr1_short')).toBeNull();
    expect(hashPasswordResetToken('')).toBeNull();
    expect(getPasswordResetPointerId('../users/admin')).toBeNull();
    expect(getPasswordResetPointerId('user_12345678')).toMatch(/^[a-f0-9]{64}$/);
  });

  it('normalizes only bounded reader reset records', () => {
    const createdAt = 1_000;
    const record = {
      version: 1,
      purpose: 'reader-password-reset',
      userId: 'user_12345678',
      createdAt,
      expiresAt: createdAt + PASSWORD_RESET_TOKEN_TTL_MS
    };
    expect(normalizePasswordResetTokenRecord(record)).toEqual(record);
    expect(normalizePasswordResetTokenRecord({
      ...record,
      expiresAt: createdAt + PASSWORD_RESET_TOKEN_TTL_MS + 1
    })).toBeNull();
    expect(normalizePasswordResetTokenRecord({ ...record, token: 'raw-secret' })).toBeNull();
    expect(normalizePasswordResetTokenRecord({ ...record, secret: 'raw-secret' })).toBeNull();
  });

  it('rejects malformed active-token pointers', () => {
    const pointer = {
      version: 1,
      userId: 'user_12345678',
      tokenHash: 'a'.repeat(64),
      expiresAt: Date.now() + 60_000
    };
    expect(normalizePasswordResetPointerRecord(pointer)).toEqual(pointer);
    expect(normalizePasswordResetPointerRecord({ ...pointer, tokenHash: 'raw-token' })).toBeNull();
  });
});
