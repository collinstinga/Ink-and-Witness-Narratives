import { describe, expect, it } from 'vitest';
import {
  AFFILIATE_SESSION_DOCUMENT_ID_PATTERN,
  AFFILIATE_SESSION_STORAGE_VERSION,
  SIGNED_AFFILIATE_SESSION_TOKEN_PATTERN,
  createAffiliateSessionVersion,
  createSignedAffiliateSessionToken,
  getAffiliateSessionDocumentId,
  isValidSignedAffiliateSessionToken,
  normalizeAffiliateSessionRecord,
  resolveAffiliateSessionVersion
} from './affiliateSessionSecurity.js';

const SIGNING_SECRET = 'affiliate-session-test-secret-with-more-than-thirty-two-characters';

describe('affiliate session security primitives', () => {
  it('creates a signed high-entropy bearer and a stable one-way document id', () => {
    const token = createSignedAffiliateSessionToken(SIGNING_SECRET);
    const documentId = getAffiliateSessionDocumentId(token);

    expect(token).toMatch(SIGNED_AFFILIATE_SESSION_TOKEN_PATTERN);
    expect(isValidSignedAffiliateSessionToken(token, SIGNING_SECRET)).toBe(true);
    expect(documentId).toMatch(AFFILIATE_SESSION_DOCUMENT_ID_PATTERN);
    expect(documentId).not.toContain(token);
    expect(getAffiliateSessionDocumentId(token)).toBe(documentId);
  });

  it('rejects malformed, tampered, and differently signed tokens', () => {
    const token = createSignedAffiliateSessionToken(SIGNING_SECRET);
    const last = token.at(-1);
    const tampered = `${token.slice(0, -1)}${last === 'a' ? 'b' : 'a'}`;

    expect(isValidSignedAffiliateSessionToken('aff_sess_v2_invalid', SIGNING_SECRET)).toBe(false);
    expect(isValidSignedAffiliateSessionToken(tampered, SIGNING_SECRET)).toBe(false);
    expect(isValidSignedAffiliateSessionToken(token, `${SIGNING_SECRET}-different`)).toBe(false);
  });

  it('normalizes only v2 records that contain no reusable bearer', () => {
    const sessionVersion = createAffiliateSessionVersion();
    const record = {
      storageVersion: AFFILIATE_SESSION_STORAGE_VERSION,
      affiliateId: 'aff_123_test',
      sessionVersion,
      createdAt: 100,
      expiresAt: 200
    };

    expect(normalizeAffiliateSessionRecord(record)).toEqual(record);
    expect(normalizeAffiliateSessionRecord({ ...record, token: 'secret' })).toBeNull();
    expect(normalizeAffiliateSessionRecord({ ...record, sessionId: 'secret' })).toBeNull();
    expect(normalizeAffiliateSessionRecord({ ...record, sessionVersion: 'invalid' })).toBeNull();
    expect(normalizeAffiliateSessionRecord({ ...record, expiresAt: 100 })).toBeNull();
  });

  it('binds pre-version records to their current credential and honors explicit rotations', () => {
    const legacy = {
      id: 'aff_legacy',
      passwordHash: '$argon2id$legacy-hash'
    };
    const first = resolveAffiliateSessionVersion(legacy, SIGNING_SECRET);
    const repeated = resolveAffiliateSessionVersion(legacy, SIGNING_SECRET);
    const changedCredential = resolveAffiliateSessionVersion(
      { ...legacy, passwordHash: '$argon2id$changed-hash' },
      SIGNING_SECRET
    );
    const explicit = createAffiliateSessionVersion();

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(repeated).toBe(first);
    expect(changedCredential).not.toBe(first);
    expect(resolveAffiliateSessionVersion({ ...legacy, sessionVersion: explicit }, SIGNING_SECRET)).toBe(explicit);
  });
});
