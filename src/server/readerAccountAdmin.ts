import crypto from 'crypto';
import { FieldPath, type Firestore, type Transaction } from 'firebase-admin/firestore';
import type { Express, Request, RequestHandler, Response } from 'express';
import type { AuthSession, ReaderAccountAdminItem, ReaderAccountAdminPage, UserRecord } from '../types.js';

export const READER_ACCOUNT_SECURITY_COLLECTION = 'reader_account_security';
export const READER_ACCOUNT_AUDIT_COLLECTION = 'reader_account_admin_audit';
const USER_ID = /^user_[A-Za-z0-9_-]{8,120}$/;
const GENERATION = /^[a-f0-9]{64}$/;
const UNSAFE_TEXT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
type Actor = { id: string; role: string; email?: string };
type Security = { schemaVersion: 1; userId: string; status: 'active' | 'suspended'; revision: number;
  sessionGeneration: string; updatedAt: string; updatedBy: string; reason: string };
export class ReaderAccountAdminError extends Error {
  constructor(readonly statusCode: number, message: string) { super(message); this.name = 'ReaderAccountAdminError'; }
}
const unavailable = (): never => { throw new ReaderAccountAdminError(503, 'Reader account status could not be confirmed. Refresh before retrying.'); };
const object = (value: unknown): value is Record<string, any> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const canonicalDate = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const clean = (value: unknown, maximum: number) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maximum) : '';
/** Match existing login normalization without rewriting historical records. */
function canonicalEmail(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 1024) return null;
  const email = value.trim().toLowerCase();
  return email && email.length <= 254 ? email : null;
}
export function readerAccountSecurityId(userId: string): string {
  if (!USER_ID.test(userId)) throw new ReaderAccountAdminError(400, 'Invalid reader account.');
  return crypto.createHash('sha256').update(`reader-account-security:v1:${userId}`).digest('hex');
}
function normalizeSecurity(userId: string, value: unknown): Security | null {
  if (value === undefined || value === null) return null;
  if (!object(value) || value.schemaVersion !== 1 || value.userId !== userId
    || !['active', 'suspended'].includes(value.status) || !Number.isSafeInteger(value.revision) || value.revision < 1
    || typeof value.sessionGeneration !== 'string' || !GENERATION.test(value.sessionGeneration)
    || !canonicalDate(value.updatedAt) || !USER_ID.test(value.updatedBy)
    || typeof value.reason !== 'string' || value.reason.length > 300 || UNSAFE_TEXT.test(value.reason)) return unavailable();
  return value as Security;
}
function assertReader(id: string, value: unknown): asserts value is UserRecord {
  if (!object(value) || (value.id !== undefined && value.id !== id) || value.role !== 'client' || !USER_ID.test(id)) {
    throw new ReaderAccountAdminError(404, 'Reader account was not found. Writer accounts cannot be changed here.');
  }
}
async function assertAdmin(db: Firestore, actor: Actor, transaction?: Transaction): Promise<void> {
  if (!actor || actor.role !== 'admin' || !USER_ID.test(actor.id)) throw new ReaderAccountAdminError(403, 'Writer authentication is required.');
  const ref = db.collection('users').doc(actor.id);
  const snapshot = transaction ? await transaction.get(ref) : await ref.get();
  const current = snapshot.exists ? snapshot.data() : null;
  if (!current || (current.id !== undefined && current.id !== actor.id) || current.role !== 'admin'
    || (actor.email !== undefined && (!canonicalEmail(actor.email)
      || canonicalEmail(current.email) !== canonicalEmail(actor.email)))) throw new ReaderAccountAdminError(403, 'Writer authentication is required.');
}
function item(id: string, value: Record<string, any>, security: Security | null): ReaderAccountAdminItem {
  return { id, name: clean(value.name, 160) || 'Name not recorded', email: clean(value.email, 254),
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : '', status: security?.status || 'active',
    revision: security?.revision || 0,
    ...(security ? { statusUpdatedAt: security.updatedAt, suspensionReason: security.reason } : {}) };
}
function cursorId(cursor: unknown): string | undefined {
  if (cursor === undefined || cursor === '') return undefined;
  if (typeof cursor !== 'string' || cursor.length > 2100 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new ReaderAccountAdminError(400, 'Invalid reader page cursor.');
  const id = Buffer.from(cursor, 'base64url').toString('utf8');
  if (!id || id.includes('/') || Buffer.byteLength(id) > 1500 || Buffer.from(id).toString('base64url') !== cursor) throw new ReaderAccountAdminError(400, 'Invalid reader page cursor.');
  return id;
}
/** Bounded page + server aggregation, never hydrates the complete users collection. */
export async function listReaderAccounts(db: Firestore, actor: Actor, input: { cursor?: unknown; pageSize?: unknown; email?: unknown } = {}): Promise<ReaderAccountAdminPage> {
  const lastId = cursorId(input.cursor);
  const pageSize = input.pageSize === undefined ? 25 : typeof input.pageSize === 'string' && /^\d{1,2}$/.test(input.pageSize) ? Number(input.pageSize) : input.pageSize;
  if (!Number.isSafeInteger(pageSize) || Number(pageSize) < 1 || Number(pageSize) > 50) throw new ReaderAccountAdminError(400, 'Choose a page size from 1 to 50.');
  if (input.email !== undefined && typeof input.email !== 'string') throw new ReaderAccountAdminError(400, 'Enter an exact email address.');
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new ReaderAccountAdminError(400, 'Enter an exact email address.');
  await assertAdmin(db, actor);
  const readers = db.collection('users').where('role', '==', 'client');
  const matching = email ? readers.where('email', '==', email) : readers;
  let page = matching.orderBy(FieldPath.documentId()).limit(Number(pageSize) + 1);
  if (lastId) page = page.startAfter(lastId);
  const [total, matches, snapshot] = await Promise.all([readers.count().get(), email ? matching.count().get() : Promise.resolve(null), page.get()]);
  const docs = snapshot.docs.slice(0, Number(pageSize));
  const validIds = docs.filter(doc => USER_ID.test(doc.id)).map(doc => doc.id);
  const securityDocs = validIds.length ? await db.getAll(...validIds.map(id => db.collection(READER_ACCOUNT_SECURITY_COLLECTION).doc(readerAccountSecurityId(id)))) : [];
  const securityById = new Map(validIds.map((id, index) => [id, securityDocs[index]]));
  const result = docs.map(doc => {
    const value = doc.data();
    const security = securityById.get(doc.id);
    try { assertReader(doc.id, value); return item(doc.id, value, normalizeSecurity(doc.id, security?.exists ? security.data() : null)); }
    catch { return { ...item(doc.id, value, null), status: 'unavailable' as const }; }
  });
  return { totalReaderAccounts: total.data().count, matchingReaderAccounts: matches ? matches.data().count : total.data().count,
    readers: result, pageSize: Number(pageSize), ...(snapshot.docs.length > Number(pageSize) && docs.length
      ? { nextCursor: Buffer.from(docs[docs.length - 1].id).toString('base64url') } : {}) };
}
export async function setReaderAccountStatus(db: Firestore, actor: Actor, userId: string, input: unknown): Promise<{ reader: ReaderAccountAdminItem; changed: boolean }> {
  readerAccountSecurityId(userId);
  if (!object(input) || Object.keys(input).some(key => !['status', 'expectedRevision', 'reason'].includes(key))
    || !['active', 'suspended'].includes(input.status) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0
    || (input.reason !== undefined && (typeof input.reason !== 'string' || input.reason.length > 300 || UNSAFE_TEXT.test(input.reason)))) {
    throw new ReaderAccountAdminError(400, 'Provide an account status, current revision and an optional reason of up to 300 characters.');
  }
  const status: 'active' | 'suspended' = input.status;
  const reason = (input.reason || '').trim();
  return db.runTransaction(async transaction => {
    await assertAdmin(db, actor, transaction);
    const userRef = db.collection('users').doc(userId);
    const securityRef = db.collection(READER_ACCOUNT_SECURITY_COLLECTION).doc(readerAccountSecurityId(userId));
    const userSnapshot = await transaction.get(userRef);
    const value = userSnapshot.exists ? userSnapshot.data() : null;
    assertReader(userId, value);
    const previousSnapshot = await transaction.get(securityRef);
    const previous = normalizeSecurity(userId, previousSnapshot.exists ? previousSnapshot.data() : null);
    if ((previous?.revision || 0) !== input.expectedRevision) throw new ReaderAccountAdminError(409, 'Reader account changed. Refresh before saving again.');
    if ((previous?.status || 'active') === status) return { reader: item(userId, value, previous), changed: false };
    if (previous?.revision === Number.MAX_SAFE_INTEGER) return unavailable();
    const now = new Date().toISOString();
    const next: Security = { schemaVersion: 1, userId, status, revision: (previous?.revision || 0) + 1,
      sessionGeneration: crypto.randomBytes(32).toString('hex'), updatedAt: now, updatedBy: actor.id, reason };
    const auditRef = db.collection(READER_ACCOUNT_AUDIT_COLLECTION).doc(`rsa_${crypto.randomBytes(20).toString('hex')}`);
    // Account credentials, profile, licences, payments and purchases are deliberately untouched.
    transaction.set(securityRef, next);
    transaction.create(auditRef, { schemaVersion: 1, actorUserId: actor.id, readerUserId: userId, action: 'reader_account_status_changed',
      previousStatus: previous?.status || 'active', status, revision: next.revision, reason, createdAt: now });
    return { reader: item(userId, value, next), changed: true };
  });
}
/** Call inside the SAME transaction as reader session creation, before writes. */
export async function getReaderAccountSessionGeneration(db: Firestore, user: UserRecord, transaction: Transaction): Promise<string | undefined> {
  if (user.role !== 'client') return undefined;
  const securityId = readerAccountSecurityId(user.id);
  const userSnapshot = await transaction.get(db.collection('users').doc(user.id));
  const current = userSnapshot.exists ? userSnapshot.data() : null;
  assertReader(user.id, current);
  if (current.passwordHash !== user.passwordHash || !canonicalEmail(user.email)
    || canonicalEmail(current.email) !== canonicalEmail(user.email)) throw new ReaderAccountAdminError(401, 'Sign-in changed. Please sign in again.');
  const securitySnapshot = await transaction.get(db.collection(READER_ACCOUNT_SECURITY_COLLECTION).doc(securityId));
  const security = normalizeSecurity(user.id, securitySnapshot.exists ? securitySnapshot.data() : null);
  if (security?.status === 'suspended') throw new ReaderAccountAdminError(403, 'This reader account is suspended. Contact the writer for help.');
  return security?.sessionGeneration;
}
/** Fresh check on EVERY request, including warm session-cache hits. No positive cache. */
export async function readerAccountSessionAllowed(db: Firestore, session: AuthSession): Promise<boolean> {
  if (session.role !== 'client') return true;
  if (!USER_ID.test(session.userId)) return false;
  const [user, securityDoc] = await db.getAll(db.collection('users').doc(session.userId),
    db.collection(READER_ACCOUNT_SECURITY_COLLECTION).doc(readerAccountSecurityId(session.userId)));
  const current = user.exists ? user.data() : null;
  if (!current || (current.id !== undefined && current.id !== session.userId) || current.role !== 'client'
    || !canonicalEmail(session.email) || canonicalEmail(current.email) !== canonicalEmail(session.email)) return false;
  const security = normalizeSecurity(session.userId, securityDoc.exists ? securityDoc.data() : null);
  return security ? security.status === 'active' && security.sessionGeneration === session.readerAccountGeneration
    : session.readerAccountGeneration === undefined;
}
export function registerReaderAccountAdminRoutes(app: Pick<Express, 'get' | 'patch'>, options: {
  getDb: () => Firestore; requireAdminAuth: RequestHandler; writeGuard: RequestHandler;
}): void {
  const privateResponse: RequestHandler = (_req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('CDN-Cache-Control', 'no-store');
    res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
    next();
  };
  const replyError = (res: Response, error: unknown) => res.status(error instanceof ReaderAccountAdminError ? error.statusCode : 503)
    .json({ success: false, error: error instanceof ReaderAccountAdminError ? error.message : 'Reader account operation could not be confirmed. Refresh before retrying.' });
  app.get('/api/admin/readers', privateResponse, options.requireAdminAuth, async (req: Request, res: Response) => {
    try {
      if (Object.keys(req.query).some(key => !['cursor', 'pageSize', 'email'].includes(key))) throw new ReaderAccountAdminError(400, 'Unsupported reader directory filter.');
      return res.json({ success: true, directory: await listReaderAccounts(options.getDb(), (req as any).user, req.query) });
    } catch (error) { return replyError(res, error); }
  });
  app.patch('/api/admin/readers/:id/status', privateResponse, options.requireAdminAuth, options.writeGuard, async (req: Request, res: Response) => {
    try { return res.json({ success: true, ...await setReaderAccountStatus(options.getDb(), (req as any).user, String(req.params.id), req.body) }); }
    catch (error) { return replyError(res, error); }
  });
}
