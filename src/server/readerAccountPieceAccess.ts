import crypto from 'crypto';
import type { Firestore } from 'firebase-admin/firestore';
import type { Express, Request, RequestHandler, Response } from 'express';
import type { ReaderAccountPieceAccessGrant } from '../types.js';
import { assertActiveReaderAccount, assertReaderAccountAdmin, ReaderAccountAdminError } from './readerAccountAdmin.js';

export const READER_PIECE_ACCESS_COLLECTION = 'reader_piece_access';
export const READER_PIECE_ACCESS_AUDIT_COLLECTION = 'reader_piece_access_audit';
export const MAX_READER_PIECE_ACCESS_GRANTS = 500;
const USER_ID = /^user_[A-Za-z0-9_-]{8,120}$/;
const ARTICLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
type Actor = { id: string; role: string; email?: string };
type StoredGrant = ReaderAccountPieceAccessGrant & { schemaVersion: 1; userId: string; createdBy: string; accessSource: 'MANUAL_GRANT' };
const object = (value: unknown): value is Record<string, any> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const pieceId = (value: unknown): value is string => typeof value === 'string' && ARTICLE_ID.test(value) && value !== 'all';
const unavailable = () => new ReaderAccountAdminError(503, 'Account piece access could not be confirmed. Refresh the reader account before retrying.');
export function readerAccountPieceAccessId(userId: string, articleId: string): string {
  if (!USER_ID.test(userId) || !pieceId(articleId)) throw new ReaderAccountAdminError(400, 'Choose a valid reader account and one published piece.');
  return `rpa1_${crypto.createHash('sha256').update(`reader-piece-access:v1:${userId}\u001f${articleId}`).digest('hex')}`;
}
function normalizedGrant(documentId: string, userId: string, value: unknown): StoredGrant {
  if (!object(value) || Object.keys(value).sort().join(',') !== 'accessSource,articleId,createdAt,createdBy,schemaVersion,userId'
    || value.schemaVersion !== 1 || value.userId !== userId || !pieceId(value.articleId)
    || value.accessSource !== 'MANUAL_GRANT' || typeof value.createdBy !== 'string' || !USER_ID.test(value.createdBy)
    || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))
    || new Date(value.createdAt).toISOString() !== value.createdAt
    || readerAccountPieceAccessId(userId, value.articleId) !== documentId) throw unavailable();
  return value as StoredGrant;
}
const dto = (grant: StoredGrant): ReaderAccountPieceAccessGrant => ({ articleId: grant.articleId, createdAt: grant.createdAt });

/** Create once, atomically with its audit. It never changes paid or phone grants. */
export async function grantReaderAccountPieceAccess(db: Firestore, actor: Actor, userId: string, input: unknown): Promise<{
  grant: ReaderAccountPieceAccessGrant; changed: boolean;
}> {
  if (!object(input) || Object.keys(input).join(',') !== 'articleId' || !pieceId(input.articleId) || !USER_ID.test(userId)) {
    throw new ReaderAccountAdminError(400, 'Choose a valid reader account and one published piece. No phone number or activation token is needed.');
  }
  const articleId = input.articleId;
  const documentId = readerAccountPieceAccessId(userId, articleId);
  try {
    return await db.runTransaction(async transaction => {
      await assertReaderAccountAdmin(db, actor, transaction);
      await assertActiveReaderAccount(db, userId, transaction);
      const article = await transaction.get(db.collection('articles').doc(articleId));
      const value = article.exists ? article.data() : null;
      if (!value || value.status !== 'published' || (value.id !== undefined && value.id !== articleId)) {
        throw new ReaderAccountAdminError(404, 'The selected piece is not currently published. Refresh the catalogue and choose a published piece.');
      }
      const reference = db.collection(READER_PIECE_ACCESS_COLLECTION).doc(documentId);
      const existing = await transaction.get(reference);
      if (existing.exists) return { grant: dto(normalizedGrant(documentId, userId, existing.data())), changed: false };
      const grant: StoredGrant = { schemaVersion: 1, userId, articleId, accessSource: 'MANUAL_GRANT',
        createdAt: new Date().toISOString(), createdBy: actor.id };
      transaction.create(reference, grant);
      transaction.create(db.collection(READER_PIECE_ACCESS_AUDIT_COLLECTION).doc(`rpaa_${crypto.randomBytes(20).toString('hex')}`), {
        schemaVersion: 1, action: 'reader_account_piece_granted', actorUserId: actor.id, readerUserId: userId,
        articleId, grantDocumentId: documentId, createdAt: grant.createdAt,
      });
      return { grant: dto(grant), changed: true };
    });
  } catch (error) { if (error instanceof ReaderAccountAdminError) throw error; throw unavailable(); }
}

/** Internal entitlement lookup only: callers MUST authenticate/validate the reader
 * session first and independently enforce publication visibility. No positive cache. */
export async function hasReaderAccountPieceAccess(db: Firestore, userId: string, articleId: string): Promise<boolean> {
  // Legacy identifiers are ineligible for NEW account grants but retain their
  // established paid/manual access paths. Never throw before those fallbacks.
  if (typeof userId !== 'string' || !USER_ID.test(userId) || !pieceId(articleId)) return false;
  try {
    const id = readerAccountPieceAccessId(userId, articleId);
    const document = await db.collection(READER_PIECE_ACCESS_COLLECTION).doc(id).get();
    if (!document.exists) return false;
    normalizedGrant(id, userId, document.data()); return true;
  } catch (error) { if (error instanceof ReaderAccountAdminError) throw error; throw unavailable(); }
}

/** Bounded, exact-account query. Callers enforce authenticated account status and
 * public article visibility; this never supplies paid ownership or book credit. */
export async function listReaderAccountPieceAccess(db: Firestore, userId: string): Promise<ReaderAccountPieceAccessGrant[]> {
  if (typeof userId !== 'string' || !USER_ID.test(userId)) return [];
  try {
    const documents = await db.collection(READER_PIECE_ACCESS_COLLECTION).where('userId', '==', userId)
      .limit(MAX_READER_PIECE_ACCESS_GRANTS + 1).get();
    if (documents.docs.length > MAX_READER_PIECE_ACCESS_GRANTS) throw unavailable();
    return documents.docs.map(document => dto(normalizedGrant(document.id, userId, document.data())))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.articleId.localeCompare(right.articleId));
  } catch (error) { if (error instanceof ReaderAccountAdminError) throw error; throw unavailable(); }
}

export function registerReaderAccountPieceAccessRoutes(app: Pick<Express, 'post'>, options: {
  getDb: () => Firestore; requireAdminAuth: RequestHandler; writeGuard: RequestHandler;
}): void {
  const privateResponse: RequestHandler = (_req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('CDN-Cache-Control', 'no-store');
    res.setHeader('Vercel-CDN-Cache-Control', 'no-store'); next();
  };
  app.post('/api/admin/readers/:id/piece-access', privateResponse, options.requireAdminAuth, options.writeGuard, async (req: Request, res: Response) => {
    try {
      if (Object.keys(req.query).length) throw new ReaderAccountAdminError(400, 'This action does not accept query parameters.');
      return res.json({ success: true, ...await grantReaderAccountPieceAccess(options.getDb(), (req as any).user, String(req.params.id), req.body) });
    } catch (error) {
      return res.status(error instanceof ReaderAccountAdminError ? error.statusCode : 503)
        .json({ success: false, error: error instanceof ReaderAccountAdminError ? error.message : unavailable().message });
    }
  });
}
