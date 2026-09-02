import crypto from 'crypto';
import argon2 from 'argon2';
import { User, UserRecord, AuthSession, UserRole } from '../types.js';

/**
 * Hash password using Argon2id with unique per-password salt and secure parameters
 */
export async function hashPassword(password: string): Promise<string> {
  if (!password || typeof password !== 'string') {
    throw new Error('Password must be a non-empty string');
  }
  return await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536, // 64 MB
    timeCost: 3,
    parallelism: 1,
    salt: crypto.randomBytes(16)
  });
}

/**
 * Verify plaintext password against Argon2id hash
 */
export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  if (!hash || !plain) return false;
  try {
    return await argon2.verify(hash, plain);
  } catch (err) {
    console.error('[Auth] Password verification error:', err);
    return false;
  }
}

/**
 * Validate password strength
 * Requires at least 8 characters, at least one letter and at least one number or special character
 */
export function validatePasswordStrength(password: string): { valid: boolean; error?: string } {
  if (!password || typeof password !== 'string') {
    return { valid: false, error: 'Password is required.' };
  }
  if (password.length < 8) {
    return { valid: false, error: 'Password must be at least 8 characters long.' };
  }
  if (!/[a-zA-Z]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one letter.' };
  }
  if (!/[0-9!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one number or special character.' };
  }
  return { valid: true };
}

/**
 * Generate a cryptographically secure random session ID (opaque token)
 */
export function generateSessionId(): string {
  return 'sess_' + crypto.randomBytes(32).toString('hex');
}

/**
 * Generate cryptographically secure random identifier or token
 */
export function generateSecureToken(prefix = 'ink'): string {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(16).toString('hex')}`;
}
