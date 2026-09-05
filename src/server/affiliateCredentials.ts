import crypto from 'crypto';
import {
  hashPassword,
  validatePasswordStrength,
  verifyPassword
} from './auth.js';

const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_KEY_BYTES = 32;
const MAX_AFFILIATE_PASSWORD_LENGTH = 256;
const LEGACY_AFFILIATE_SALT = 'ink_witness_affiliate_salt_2026';
const COMPROMISED_HISTORICAL_PASSWORD = 'affiliate123';

const ARGON2ID_HASH_PATTERN = /^\$argon2id\$v=\d+\$m=\d+,p=\d+,t=\d+\$[A-Za-z0-9+/]+={0,2}\$[A-Za-z0-9+/]+={0,2}$/;
const PBKDF2_HASH_PATTERN = /^pbkdf2:([a-f0-9]{32}):([a-f0-9]{64})$/;
const LEGACY_SHA256_HASH_PATTERN = /^[a-f0-9]{64}$/;

export interface AffiliatePasswordVerification {
  valid: boolean;
  needsRehash: boolean;
}

export interface AffiliatePasswordValidation {
  valid: boolean;
  error?: string;
}

export function isCompromisedAffiliatePassword(password: unknown): boolean {
  return typeof password === 'string' && password === COMPROMISED_HISTORICAL_PASSWORD;
}

export function isCurrentAffiliatePasswordHash(encodedHash: unknown): encodedHash is string {
  return typeof encodedHash === 'string' && ARGON2ID_HASH_PATTERN.test(encodedHash);
}

export function validateAffiliatePasswordStrength(password: unknown): AffiliatePasswordValidation {
  if (typeof password !== 'string') {
    return { valid: false, error: 'Password is required.' };
  }

  if (password.length > MAX_AFFILIATE_PASSWORD_LENGTH) {
    return { valid: false, error: 'Password must be 256 characters or fewer.' };
  }

  const strength = validatePasswordStrength(password);
  if (!strength.valid) {
    return strength;
  }

  if (isCompromisedAffiliatePassword(password)) {
    return {
      valid: false,
      error: 'This password is no longer permitted. Please choose a different password.'
    };
  }

  return { valid: true };
}

export async function hashAffiliatePassword(password: string): Promise<string> {
  const strength = validateAffiliatePasswordStrength(password);
  if (!strength.valid) {
    throw new Error(strength.error || 'Password does not meet security requirements.');
  }

  return hashPassword(password);
}

export async function rehashVerifiedAffiliatePassword(password: unknown): Promise<string> {
  if (
    typeof password !== 'string' ||
    password.length === 0 ||
    password.length > MAX_AFFILIATE_PASSWORD_LENGTH ||
    isCompromisedAffiliatePassword(password)
  ) {
    throw new Error('Verified legacy credential cannot be migrated.');
  }

  // This path is used only after a legacy hash has already verified. Requiring
  // the new-password policy here would lock out legitimate older 6-character
  // or letters-only passwords before the affiliate can change them.
  return hashPassword(password);
}

export async function verifyAffiliatePassword(
  password: unknown,
  encodedHash: unknown
): Promise<AffiliatePasswordVerification> {
  const invalid: AffiliatePasswordVerification = { valid: false, needsRehash: false };

  if (
    typeof password !== 'string' ||
    password.length === 0 ||
    typeof encodedHash !== 'string' ||
    encodedHash.length === 0 ||
    isCompromisedAffiliatePassword(password)
  ) {
    return invalid;
  }

  if (isCurrentAffiliatePasswordHash(encodedHash)) {
    const valid = await verifyPassword(encodedHash, password);
    return { valid, needsRehash: false };
  }

  const pbkdf2Match = PBKDF2_HASH_PATTERN.exec(encodedHash);
  if (pbkdf2Match) {
    const [, salt, expectedKeyHex] = pbkdf2Match;
    const actualKey = crypto.pbkdf2Sync(
      password,
      salt,
      PBKDF2_ITERATIONS,
      PBKDF2_KEY_BYTES,
      'sha512'
    );
    const expectedKey = Buffer.from(expectedKeyHex, 'hex');
    const valid = crypto.timingSafeEqual(actualKey, expectedKey);
    return { valid, needsRehash: valid };
  }

  if (LEGACY_SHA256_HASH_PATTERN.test(encodedHash)) {
    const actualHash = crypto
      .createHash('sha256')
      .update(password + LEGACY_AFFILIATE_SALT)
      .digest();
    const expectedHash = Buffer.from(encodedHash, 'hex');
    const valid = crypto.timingSafeEqual(actualHash, expectedHash);
    return { valid, needsRehash: valid };
  }

  return invalid;
}

export function generateAffiliateTemporaryPassword(): string {
  // The fixed prefix guarantees the main policy's letter/special-character
  // requirements; the random portion contributes 192 bits of entropy.
  return `IW!${crypto.randomBytes(24).toString('base64url')}`;
}
