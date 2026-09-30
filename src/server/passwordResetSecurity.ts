import crypto from 'crypto';

export const PASSWORD_RESET_TOKEN_VERSION = 1 as const;
export const PASSWORD_RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
export const PASSWORD_RESET_TOKEN_PATTERN = /^pr1_[A-Za-z0-9_-]{43}$/;
export const PASSWORD_RESET_TOKEN_HASH_PATTERN = /^[a-f0-9]{64}$/;
const USER_ID_PATTERN = /^user_[A-Za-z0-9_-]{8,120}$/;

export interface PasswordResetTokenRecord {
  version: 1;
  purpose: 'reader-password-reset';
  userId: string;
  createdAt: number;
  expiresAt: number;
}

export interface PasswordResetPointerRecord {
  version: 1;
  userId: string;
  tokenHash: string;
  expiresAt: number;
}

export function isPasswordResetUserId(value: unknown): value is string {
  return typeof value === 'string' && USER_ID_PATTERN.test(value);
}

export function createPasswordResetToken(): string {
  return `pr1_${crypto.randomBytes(32).toString('base64url')}`;
}

export function hashPasswordResetToken(value: unknown): string | null {
  if (typeof value !== 'string' || !PASSWORD_RESET_TOKEN_PATTERN.test(value)) return null;
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

export function getPasswordResetPointerId(userId: unknown): string | null {
  if (!isPasswordResetUserId(userId)) return null;
  return crypto.createHash('sha256')
    .update(`reader-password-reset:v1:${userId}`, 'utf8')
    .digest('hex');
}

export function normalizePasswordResetTokenRecord(value: unknown): PasswordResetTokenRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  // Reset capabilities are bearer secrets. A stored record must never contain
  // the raw token (or an equivalent secret field), even if extra fields would
  // otherwise be ignored by the normalizer.
  if ('token' in record || 'secret' in record) return null;
  const createdAt = Number(record.createdAt);
  const expiresAt = Number(record.expiresAt);
  if (record.version !== PASSWORD_RESET_TOKEN_VERSION || record.purpose !== 'reader-password-reset') return null;
  if (!isPasswordResetUserId(record.userId)) return null;
  if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt) || expiresAt <= createdAt) return null;
  if (expiresAt - createdAt > PASSWORD_RESET_TOKEN_TTL_MS) return null;
  return {
    version: PASSWORD_RESET_TOKEN_VERSION,
    purpose: 'reader-password-reset',
    userId: record.userId,
    createdAt,
    expiresAt
  };
}

export function normalizePasswordResetPointerRecord(value: unknown): PasswordResetPointerRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const expiresAt = Number(record.expiresAt);
  if (record.version !== PASSWORD_RESET_TOKEN_VERSION) return null;
  if (!isPasswordResetUserId(record.userId)) return null;
  if (typeof record.tokenHash !== 'string' || !PASSWORD_RESET_TOKEN_HASH_PATTERN.test(record.tokenHash)) return null;
  if (!Number.isFinite(expiresAt)) return null;
  return {
    version: PASSWORD_RESET_TOKEN_VERSION,
    userId: record.userId,
    tokenHash: record.tokenHash,
    expiresAt
  };
}
