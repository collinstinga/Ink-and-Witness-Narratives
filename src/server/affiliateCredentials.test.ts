import crypto from 'crypto';
import { describe, expect, it } from 'vitest';
import {
  generateAffiliateTemporaryPassword,
  hashAffiliatePassword,
  isCurrentAffiliatePasswordHash,
  rehashVerifiedAffiliatePassword,
  validateAffiliatePasswordStrength,
  verifyAffiliatePassword
} from './affiliateCredentials.js';

const makePbkdf2Hash = (password: string): string => {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.pbkdf2Sync(password, salt, 100_000, 32, 'sha512').toString('hex');
  return `pbkdf2:${salt}:${derivedKey}`;
};

const makeLegacySha256Hash = (password: string): string => crypto
  .createHash('sha256')
  .update(password + 'ink_witness_affiliate_salt_2026')
  .digest('hex');

describe('affiliate credential helpers', () => {
  it('uses the main password policy and rejects the compromised historical default', () => {
    expect(validateAffiliatePasswordStrength('short1')).toMatchObject({ valid: false });
    expect(validateAffiliatePasswordStrength('onlyletters')).toMatchObject({ valid: false });
    expect(validateAffiliatePasswordStrength('StrongPass1')).toEqual({ valid: true });
    expect(validateAffiliatePasswordStrength('affiliate123')).toMatchObject({ valid: false });
    expect(validateAffiliatePasswordStrength(`A1${'x'.repeat(255)}`)).toMatchObject({ valid: false });
  });

  it('creates and verifies current Argon2id hashes without requesting a rehash', async () => {
    const password = 'A-Strong-Password-2026';
    const encodedHash = await hashAffiliatePassword(password);

    expect(encodedHash).toMatch(/^\$argon2id\$/);
    expect(isCurrentAffiliatePasswordHash(encodedHash)).toBe(true);
    expect(isCurrentAffiliatePasswordHash('$argon2id$malformed')).toBe(false);
    await expect(verifyAffiliatePassword(password, encodedHash)).resolves.toEqual({
      valid: true,
      needsRehash: false
    });
    await expect(verifyAffiliatePassword('Wrong-Password-2026', encodedHash)).resolves.toEqual({
      valid: false,
      needsRehash: false
    });
  });

  it('accepts a strictly formatted PBKDF2 hash and marks it for rehashing', async () => {
    const password = 'Existing-Pbkdf2-Password-9';
    const encodedHash = makePbkdf2Hash(password);

    await expect(verifyAffiliatePassword(password, encodedHash)).resolves.toEqual({
      valid: true,
      needsRehash: true
    });
    await expect(verifyAffiliatePassword('Wrong-Password-9', encodedHash)).resolves.toEqual({
      valid: false,
      needsRehash: false
    });
  });

  it('rehashes a verified weak legacy password without weakening new-password policy', async () => {
    const legacyPassword = 'old123';
    const encodedHash = makePbkdf2Hash(legacyPassword);

    await expect(verifyAffiliatePassword(legacyPassword, encodedHash)).resolves.toEqual({
      valid: true,
      needsRehash: true
    });
    expect(validateAffiliatePasswordStrength(legacyPassword)).toMatchObject({ valid: false });

    const upgradedHash = await rehashVerifiedAffiliatePassword(legacyPassword);
    expect(isCurrentAffiliatePasswordHash(upgradedHash)).toBe(true);
    await expect(verifyAffiliatePassword(legacyPassword, upgradedHash)).resolves.toEqual({
      valid: true,
      needsRehash: false
    });
  });

  it('accepts an exact legacy SHA-256 hash and marks it for rehashing', async () => {
    const password = 'Existing-Legacy-Password-9';
    const encodedHash = makeLegacySha256Hash(password);

    await expect(verifyAffiliatePassword(password, encodedHash)).resolves.toEqual({
      valid: true,
      needsRehash: true
    });
    await expect(verifyAffiliatePassword('Wrong-Legacy-Password-9', encodedHash)).resolves.toEqual({
      valid: false,
      needsRehash: false
    });
  });

  it('fails closed for malformed and unknown hash formats', async () => {
    const malformedHashes = [
      '',
      'pbkdf2:not-hex:not-hex',
      `pbkdf2:${'a'.repeat(31)}:${'b'.repeat(64)}`,
      'a'.repeat(63),
      'g'.repeat(64),
      '$argon2i$v=19$m=65536,t=3,p=1$c2FsdA$aGFzaA',
      '$2b$12$unsupported-bcrypt-hash'
    ];

    for (const encodedHash of malformedHashes) {
      await expect(verifyAffiliatePassword('Strong-Password-9', encodedHash)).resolves.toEqual({
        valid: false,
        needsRehash: false
      });
    }
  });

  it('will not authenticate the compromised historical default even when its hash matches', async () => {
    const compromisedHash = makePbkdf2Hash('affiliate123');

    await expect(verifyAffiliatePassword('affiliate123', compromisedHash)).resolves.toEqual({
      valid: false,
      needsRehash: false
    });
    await expect(hashAffiliatePassword('affiliate123')).rejects.toThrow(/no longer permitted/i);
  });

  it('generates strong, distinct temporary passwords with cryptographic entropy', () => {
    const first = generateAffiliateTemporaryPassword();
    const second = generateAffiliateTemporaryPassword();

    expect(first).not.toBe(second);
    expect(first.length).toBeGreaterThanOrEqual(32);
    expect(validateAffiliatePasswordStrength(first)).toEqual({ valid: true });
    expect(validateAffiliatePasswordStrength(second)).toEqual({ valid: true });
  });
});
