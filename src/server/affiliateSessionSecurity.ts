import crypto from 'crypto';
import type { AffiliateAccount, AffiliateSession } from '../types.js';

export const AFFILIATE_SESSION_STORAGE_VERSION = 2 as const;
export const AFFILIATE_SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const SIGNED_AFFILIATE_SESSION_TOKEN_PATTERN = /^aff_sess_v2_([a-f0-9]{64})_([a-f0-9]{64})$/;
export const AFFILIATE_SESSION_DOCUMENT_ID_PATTERN = /^v2_[a-f0-9]{64}$/;
export const AFFILIATE_SESSION_VERSION_PATTERN = /^[a-f0-9]{64}$/;

const DEVELOPMENT_AFFILIATE_SESSION_SIGNING_SECRET = crypto.randomBytes(32).toString('hex');

function resolveAffiliateSessionSigningSecret(
  value: unknown = process.env.AFFILIATE_SESSION_SIGNING_SECRET || process.env.SESSION_SIGNING_SECRET
): string | null {
  const configured = typeof value === 'string' ? value.trim() : '';
  if (configured.length >= 32) return configured;
  return process.env.VERCEL ? null : DEVELOPMENT_AFFILIATE_SESSION_SIGNING_SECRET;
}

function signAffiliateSessionNonce(nonce: string, signingSecret: string): string {
  return crypto
    .createHmac('sha256', signingSecret)
    .update(`affiliate-session:v2:${nonce}`, 'utf8')
    .digest('hex');
}

export function createSignedAffiliateSessionToken(signingSecret?: string): string {
  const secret = resolveAffiliateSessionSigningSecret(signingSecret);
  if (!secret) {
    throw new Error('An affiliate session signing secret of at least 32 characters is required in production.');
  }
  const nonce = crypto.randomBytes(32).toString('hex');
  return `aff_sess_v2_${nonce}_${signAffiliateSessionNonce(nonce, secret)}`;
}

export function isValidSignedAffiliateSessionToken(value: unknown, signingSecret?: string): value is string {
  if (typeof value !== 'string') return false;
  const match = SIGNED_AFFILIATE_SESSION_TOKEN_PATTERN.exec(value);
  if (!match) return false;
  const secret = resolveAffiliateSessionSigningSecret(signingSecret);
  if (!secret) return false;

  const expected = Buffer.from(signAffiliateSessionNonce(match[1], secret), 'hex');
  const supplied = Buffer.from(match[2], 'hex');
  return expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied);
}

export function getAffiliateSessionDocumentId(value: unknown): string | null {
  if (typeof value !== 'string' || !SIGNED_AFFILIATE_SESSION_TOKEN_PATTERN.test(value)) return null;
  const digest = crypto.createHash('sha256').update(value, 'utf8').digest('hex');
  return `v2_${digest}`;
}

export function isAffiliateSessionDocumentId(value: unknown): value is string {
  return typeof value === 'string' && AFFILIATE_SESSION_DOCUMENT_ID_PATTERN.test(value);
}

export function createAffiliateSessionVersion(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function isAffiliateSessionVersion(value: unknown): value is string {
  return typeof value === 'string' && AFFILIATE_SESSION_VERSION_PATTERN.test(value);
}

/**
 * Existing affiliate records predate sessionVersion. Bind their first v2
 * sessions deterministically to the current credential without a bulk database
 * migration. Any credential or status transition writes a fresh random version.
 */
export function resolveAffiliateSessionVersion(
  affiliate: Pick<AffiliateAccount, 'id' | 'passwordHash' | 'sessionVersion'>,
  signingSecret?: string
): string | null {
  if (isAffiliateSessionVersion(affiliate.sessionVersion)) return affiliate.sessionVersion;
  const affiliateId = typeof affiliate.id === 'string' ? affiliate.id.trim() : '';
  const passwordHash = typeof affiliate.passwordHash === 'string' ? affiliate.passwordHash.trim() : '';
  const secret = resolveAffiliateSessionSigningSecret(signingSecret);
  if (!affiliateId || !passwordHash || !secret) return null;

  return crypto
    .createHmac('sha256', secret)
    .update(`affiliate-session-version:v1:${affiliateId}\u0000${passwordHash}`, 'utf8')
    .digest('hex');
}

export function normalizeAffiliateSessionRecord(value: unknown): AffiliateSession | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.storageVersion !== AFFILIATE_SESSION_STORAGE_VERSION) return null;
  if ('token' in record || 'sessionId' in record) return null;

  const affiliateId = typeof record.affiliateId === 'string' ? record.affiliateId.trim() : '';
  const createdAt = Number(record.createdAt);
  const expiresAt = Number(record.expiresAt);
  if (!affiliateId || affiliateId.length > 200 || !isAffiliateSessionVersion(record.sessionVersion)) return null;
  if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt) || expiresAt <= createdAt) return null;

  return {
    storageVersion: AFFILIATE_SESSION_STORAGE_VERSION,
    affiliateId,
    sessionVersion: record.sessionVersion,
    createdAt,
    expiresAt
  };
}
