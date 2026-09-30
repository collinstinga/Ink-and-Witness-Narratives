import type { Firestore } from 'firebase-admin/firestore';
import type { UserRecord } from '../types.js';
import { getDb, sanitizeForFirestore } from './db.js';
import { getActiveReaderSessionPointerId } from './sessionSecurity.js';
import {
  PASSWORD_RESET_TOKEN_TTL_MS,
  PASSWORD_RESET_TOKEN_VERSION,
  createPasswordResetToken,
  getPasswordResetPointerId,
  hashPasswordResetToken,
  isPasswordResetUserId,
  normalizePasswordResetPointerRecord,
  normalizePasswordResetTokenRecord
} from './passwordResetSecurity.js';

const TOKEN_COLLECTION = 'password_reset_tokens';
const POINTER_COLLECTION = 'password_reset_pointers';
const ACTIVE_READER_SESSION_COLLECTION = 'active_reader_sessions';

type PasswordResetIssue = {
  token: string;
  expiresAt: number;
};

type PasswordResetConsumption = {
  user: UserRecord;
  resetAt: string;
};

function normalizeResettableUser(userId: string, value: unknown): UserRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const email = typeof record.email === 'string' ? record.email.trim().toLowerCase() : '';
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  const createdAt = typeof record.createdAt === 'string' ? record.createdAt : '';
  if (!email || !name || !createdAt || record.role !== 'client') return null;
  return {
    id: userId,
    email,
    name,
    role: 'client',
    passwordHash: typeof record.passwordHash === 'string' ? record.passwordHash : '',
    createdAt,
    ...(typeof record.updatedAt === 'string' ? { updatedAt: record.updatedAt } : {})
  };
}

export class PasswordResetStore {
  constructor(private readonly dbProvider: () => Firestore = getDb) {}

  async issue(userId: string, now = Date.now()): Promise<PasswordResetIssue> {
    if (!isPasswordResetUserId(userId) || !Number.isFinite(now)) {
      throw new Error('A valid reader account is required for password recovery.');
    }
    const pointerId = getPasswordResetPointerId(userId);
    if (!pointerId) throw new Error('A valid reader account is required for password recovery.');

    const token = createPasswordResetToken();
    const tokenHash = hashPasswordResetToken(token)!;
    const expiresAt = now + PASSWORD_RESET_TOKEN_TTL_MS;
    const db = this.dbProvider();
    const tokenRef = db.collection(TOKEN_COLLECTION).doc(tokenHash);
    const pointerRef = db.collection(POINTER_COLLECTION).doc(pointerId);

    await db.runTransaction(async transaction => {
      const pointerSnapshot = await transaction.get(pointerRef);
      const previous = pointerSnapshot.exists
        ? normalizePasswordResetPointerRecord(pointerSnapshot.data())
        : null;
      if (previous && previous.tokenHash !== tokenHash) {
        transaction.delete(db.collection(TOKEN_COLLECTION).doc(previous.tokenHash));
      }
      transaction.create(tokenRef, sanitizeForFirestore({
        version: PASSWORD_RESET_TOKEN_VERSION,
        purpose: 'reader-password-reset',
        userId,
        createdAt: now,
        expiresAt
      }));
      transaction.set(pointerRef, sanitizeForFirestore({
        version: PASSWORD_RESET_TOKEN_VERSION,
        userId,
        tokenHash,
        expiresAt
      }));
    });

    return { token, expiresAt };
  }

  async isActive(token: unknown, now = Date.now()): Promise<boolean> {
    const tokenHash = hashPasswordResetToken(token);
    if (!tokenHash || !Number.isFinite(now)) return false;
    const db = this.dbProvider();
    const tokenSnapshot = await db.collection(TOKEN_COLLECTION).doc(tokenHash).get();
    const record = tokenSnapshot.exists
      ? normalizePasswordResetTokenRecord(tokenSnapshot.data())
      : null;
    if (!record || record.expiresAt <= now) return false;
    const pointerId = getPasswordResetPointerId(record.userId);
    if (!pointerId) return false;
    const pointerSnapshot = await db.collection(POINTER_COLLECTION).doc(pointerId).get();
    const pointer = pointerSnapshot.exists
      ? normalizePasswordResetPointerRecord(pointerSnapshot.data())
      : null;
    return Boolean(pointer && pointer.tokenHash === tokenHash && pointer.expiresAt > now);
  }

  async discard(token: unknown): Promise<void> {
    const tokenHash = hashPasswordResetToken(token);
    if (!tokenHash) return;
    const db = this.dbProvider();
    const tokenRef = db.collection(TOKEN_COLLECTION).doc(tokenHash);
    await db.runTransaction(async transaction => {
      const tokenSnapshot = await transaction.get(tokenRef);
      const record = tokenSnapshot.exists
        ? normalizePasswordResetTokenRecord(tokenSnapshot.data())
        : null;
      if (!record) {
        transaction.delete(tokenRef);
        return;
      }
      const pointerId = getPasswordResetPointerId(record.userId);
      if (!pointerId) {
        transaction.delete(tokenRef);
        return;
      }
      const pointerRef = db.collection(POINTER_COLLECTION).doc(pointerId);
      const pointerSnapshot = await transaction.get(pointerRef);
      const pointer = pointerSnapshot.exists
        ? normalizePasswordResetPointerRecord(pointerSnapshot.data())
        : null;
      transaction.delete(tokenRef);
      if (pointer?.tokenHash === tokenHash) transaction.delete(pointerRef);
    });
  }

  async consume(token: unknown, passwordHash: string, now = Date.now()): Promise<PasswordResetConsumption | null> {
    const tokenHash = hashPasswordResetToken(token);
    if (!tokenHash || !/^\$argon2id\$/.test(passwordHash) || !Number.isFinite(now)) return null;
    const db = this.dbProvider();
    const tokenRef = db.collection(TOKEN_COLLECTION).doc(tokenHash);

    return db.runTransaction(async transaction => {
      const tokenSnapshot = await transaction.get(tokenRef);
      const record = tokenSnapshot.exists
        ? normalizePasswordResetTokenRecord(tokenSnapshot.data())
        : null;
      if (!record) return null;

      const pointerId = getPasswordResetPointerId(record.userId);
      const activeSessionPointerId = getActiveReaderSessionPointerId(record.userId);
      if (!pointerId || !activeSessionPointerId) {
        transaction.delete(tokenRef);
        return null;
      }

      const pointerRef = db.collection(POINTER_COLLECTION).doc(pointerId);
      const userRef = db.collection('users').doc(record.userId);
      const [pointerSnapshot, userSnapshot] = await Promise.all([
        transaction.get(pointerRef),
        transaction.get(userRef)
      ]);
      const pointer = pointerSnapshot.exists
        ? normalizePasswordResetPointerRecord(pointerSnapshot.data())
        : null;
      const user = userSnapshot.exists
        ? normalizeResettableUser(record.userId, userSnapshot.data())
        : null;

      if (record.expiresAt <= now || !pointer || pointer.tokenHash !== tokenHash || pointer.expiresAt <= now || !user) {
        transaction.delete(tokenRef);
        if (pointer?.tokenHash === tokenHash) transaction.delete(pointerRef);
        return null;
      }

      const resetAt = new Date(now).toISOString();
      const updatedUser: UserRecord = {
        ...user,
        passwordHash,
        updatedAt: resetAt
      };
      transaction.update(userRef, sanitizeForFirestore({
        passwordHash,
        updatedAt: resetAt
      }));
      transaction.delete(tokenRef);
      transaction.delete(pointerRef);
      transaction.delete(db.collection(ACTIVE_READER_SESSION_COLLECTION).doc(activeSessionPointerId));
      return { user: updatedUser, resetAt };
    });
  }
}

export const passwordResetStore = new PasswordResetStore();
