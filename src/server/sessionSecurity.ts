import crypto from 'crypto';
import type { AuthSession, UserRole } from '../types.js';

export const AUTH_SESSION_STORAGE_VERSION = 2 as const;
export const LEGACY_SESSION_TOKEN_PATTERN = /^sess_[a-f0-9]{64}$/;
export const SIGNED_SESSION_TOKEN_PATTERN = /^sess_v2_([a-f0-9]{64})_([a-f0-9]{64})$/;
export const SESSION_DOCUMENT_ID_PATTERN = /^v2_[a-f0-9]{64}$/;
// Legacy sessions live for at most seven days. This narrow compatibility window
// avoids leaving a permanent second Firestore read path for attacker-made tokens.
export const LEGACY_AUTH_SESSION_MIGRATION_DEADLINE_MS = Date.parse('2026-09-15T00:00:00.000Z');

const DEVELOPMENT_SESSION_SIGNING_SECRET = crypto.randomBytes(32).toString('hex');

function resolveSessionSigningSecret(value: unknown = process.env.SESSION_SIGNING_SECRET): string | null {
  const configured = typeof value === 'string' ? value.trim() : '';
  if (configured.length >= 32) return configured;
  return process.env.VERCEL ? null : DEVELOPMENT_SESSION_SIGNING_SECRET;
}

function signSessionNonce(nonce: string, signingSecret: string): string {
  return crypto.createHmac('sha256', signingSecret).update(`sess_v2_${nonce}`, 'utf8').digest('hex');
}

export function createSignedAuthSessionToken(signingSecret?: string): string {
  const secret = resolveSessionSigningSecret(signingSecret);
  if (!secret) throw new Error('SESSION_SIGNING_SECRET must contain at least 32 characters in production.');
  const nonce = crypto.randomBytes(32).toString('hex');
  return `sess_v2_${nonce}_${signSessionNonce(nonce, secret)}`;
}

export function isValidLegacySessionToken(value: unknown): value is string {
  return typeof value === 'string' && LEGACY_SESSION_TOKEN_PATTERN.test(value);
}

export function isValidSignedSessionToken(value: unknown, signingSecret?: string): value is string {
  if (typeof value !== 'string') return false;
  const match = SIGNED_SESSION_TOKEN_PATTERN.exec(value);
  if (!match) return false;
  const secret = resolveSessionSigningSecret(signingSecret);
  if (!secret) return false;

  const expected = Buffer.from(signSessionNonce(match[1], secret), 'hex');
  const supplied = Buffer.from(match[2], 'hex');
  return expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied);
}

export function getAuthSessionTokenKind(
  value: unknown,
  signingSecret?: string
): 'v2' | 'legacy' | null {
  if (isValidSignedSessionToken(value, signingSecret)) return 'v2';
  if (isValidLegacySessionToken(value)) return 'legacy';
  return null;
}

export function getAuthSessionDocumentId(value: unknown): string | null {
  if (typeof value !== 'string' ||
      (!SIGNED_SESSION_TOKEN_PATTERN.test(value) && !LEGACY_SESSION_TOKEN_PATTERN.test(value))) return null;
  const digest = crypto.createHash('sha256').update(value, 'utf8').digest('hex');
  return `v2_${digest}`;
}

export function isAuthSessionDocumentId(value: unknown): value is string {
  return typeof value === 'string' && SESSION_DOCUMENT_ID_PATTERN.test(value);
}

export function isLegacyAuthSessionMigrationAllowed(now = Date.now()): boolean {
  return Number.isFinite(now) && now < LEGACY_AUTH_SESSION_MIGRATION_DEADLINE_MS;
}

function isUserRole(value: unknown): value is UserRole {
  return value === 'client' || value === 'admin';
}

/**
 * Converts a v2 record into the only shape retained by the application.
 * Reusable bearer tokens are deliberately rejected.
 */
export function normalizeAuthSessionRecord(value: unknown): AuthSession | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.storageVersion !== AUTH_SESSION_STORAGE_VERSION) return null;
  if ('sessionId' in record || 'token' in record) return null;
  return normalizeSessionFields(record);
}

function normalizeSessionFields(record: Record<string, unknown>): AuthSession | null {
  const userId = typeof record.userId === 'string' ? record.userId.trim() : '';
  const email = typeof record.email === 'string' ? record.email.trim().toLowerCase() : '';
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  const createdAt = Number(record.createdAt);
  const expiresAt = Number(record.expiresAt);

  if (!userId || !email || !name || !isUserRole(record.role)) return null;
  if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt) || expiresAt <= createdAt) return null;

  return {
    storageVersion: AUTH_SESSION_STORAGE_VERSION,
    userId,
    role: record.role,
    email,
    name,
    createdAt,
    expiresAt
  };
}

/**
 * Legacy records are accepted only when both the document ID and stored token
 * exactly match a currently valid cookie token. This constrains the compatibility
 * path to the document and token shape created by this application.
 */
export function normalizeLegacyAuthSessionRecord(value: unknown, token: unknown): AuthSession | null {
  if (!isValidLegacySessionToken(token) || !value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.sessionId !== token) return null;
  return normalizeSessionFields(record);
}
