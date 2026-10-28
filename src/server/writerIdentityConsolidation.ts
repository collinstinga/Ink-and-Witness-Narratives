import crypto from 'crypto';
import type { Firestore, Transaction, DocumentSnapshot, QuerySnapshot } from 'firebase-admin/firestore';
import type { UserRecord } from '../types.js';
import { getDb, getFirestoreClientTarget } from './db.js';
import { verifyPassword } from './auth.js';

export const WRITER_CONSOLIDATION_OWNER = 'collinstinga@gmail.com';
export const WRITER_CONSOLIDATION_ORIGIN = 'https://www.inkandwitness-narratives.co.ke';
export const WRITER_CONSOLIDATION_TOKEN_PATTERN = /^wcr1_[A-Za-z0-9_-]{43}$/;
export const WRITER_CONSOLIDATION_TOKEN_TTL_MS = 3_600_000;
// Read-only production aggregate confirmed 21 records. Retain a strict bounded
// overflow sentinel rather than truncating the existing owner's cohort.
export const WRITER_CONSOLIDATION_MAX_MEMBERS = 32;
const DAY = 86_400_000;
const HASH = /^[a-f0-9]{64}$/;
const USER_ID = /^user_[A-Za-z0-9_-]{8,120}$/;
const PLANS = 'user_identity_consolidations';
const REVIEWS = 'user_identity_repair_reviews';
const TOKENS = 'writer_identity_reset_tokens';
const PRODUCTION = 'ink-and-witness-narratives';
const STAGING = 'ink-witness-staging-20261024';
type RecordValue = Record<string, any>;
type Actor = { id: string; email: string; role: string };
type ReadOptions = { transaction?: Transaction; env?: NodeJS.ProcessEnv };
type CohortRow = { id: string; data: Record<string, unknown> };

export interface WriterIdentityRepairReview {
  schemaVersion: 1;
  kind: 'writer-identity-consolidation-review';
  projectId: string;
  databaseId: '(default)';
  emailSha256: string;
  memberUserIds: string[];
  cohortSha256: string;
  backupManifestSha256: string;
  dependencyProof: {
    schemaVersion: 1; checkedAt: string; datasetsSha256: string;
  } & ({ result: 'no-owned-records' } | { result: 'canonical-owned-records-only'; preservedOwnerUserId: string });
  createdAt: string;
  expiresAt: string;
}
export type WriterIdentityConsolidationStatus = {
  status: 'unavailable' | 'review_required' | 'ready' | 'pending' | 'active';
  memberCount: number;
  canIssue: boolean;
  expiresAt?: number;
};
export type WriterIdentityResolution = { kind: 'none' } | { kind: 'invalid' } | {
  kind: 'active'; user: UserRecord; identityGeneration: string; memberUserIds: string[]; activatedAt: string;
};
export class WriterIdentityConsolidationError extends Error {
  readonly statusCode: number;
  constructor(readonly code: 'blocked' | 'conflict' | 'unavailable') {
    super('Writer identity recovery could not be confirmed. No identity was selected automatically.');
    this.name = 'WriterIdentityConsolidationError';
    this.statusCode = code === 'conflict' ? 409 : code === 'blocked' ? 403 : 503;
  }
}
const blocked = (): never => { throw new WriterIdentityConsolidationError('blocked'); };
const object = (value: unknown): value is RecordValue => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const exact = (value: RecordValue, keys: string[]) => Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const normalizedEmail = (value: unknown) => typeof value === 'string' ? value.trim().toLowerCase() : '';
const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const iso = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as RecordValue)[key])}`).join(',')}}`;
}
export function writerIdentityConsolidationId(email: string): string {
  return `uic1_${hash(normalizedEmail(email))}`;
}
export function writerIdentityCohortSha256(rows: CohortRow[]): string {
  return hash(canonical([...rows].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
}
export function hashWriterConsolidationToken(token: unknown): string | null {
  return typeof token === 'string' && WRITER_CONSOLIDATION_TOKEN_PATTERN.test(token) ? hash(token) : null;
}
function target(db: Firestore, env: NodeJS.ProcessEnv): string {
  const actual = getFirestoreClientTarget(db);
  if (!actual || actual.firestoreDatabaseId !== '(default)' || env.FIRESTORE_DATABASE_ID !== '(default)'
    || env.FIREBASE_PROJECT_ID !== actual.projectId || env.FIRESTORE_EMULATOR_HOST || env.FIREBASE_AUTH_EMULATOR_HOST
    || env.FIREBASE_DATABASE_EMULATOR_HOST) blocked();
  if (actual.projectId === PRODUCTION && env.VERCEL_ENV === 'production') return actual.projectId;
  if (actual.projectId === STAGING && env.VERCEL_ENV === 'preview'
    && env.MPESA_NETWORK_MODE === 'disabled' && env.NEWSLETTER_ENABLED === 'false'
    && env.AFFILIATE_NOTIFICATION_EVENT_MODE === 'off' && env.AFFILIATE_NOTIFICATION_DELIVERY_MODE === 'off') return actual.projectId;
  return blocked();
}
function validUser(id: string, value: unknown): value is UserRecord {
  return object(value) && USER_ID.test(id) && value.id === id && typeof value.email === 'string'
    && normalizedEmail(value.email) === value.email && typeof value.name === 'string' && Boolean(value.name.trim())
    && ['admin', 'client'].includes(value.role) && typeof value.passwordHash === 'string' && /^\$argon2id\$/.test(value.passwordHash)
    && typeof value.createdAt === 'string' && Boolean(value.createdAt);
}
async function read(db: Firestore, ref: any, transaction?: Transaction): Promise<any> {
  return transaction ? transaction.get(ref) : ref.get();
}
async function cohort(db: Firestore, transaction?: Transaction): Promise<CohortRow[]> {
  const snapshot = await read(db, db.collection('users').where('email', '==', WRITER_CONSOLIDATION_OWNER)
    .limit(WRITER_CONSOLIDATION_MAX_MEMBERS + 1), transaction) as QuerySnapshot;
  const rows = snapshot.docs.map(doc => ({ id: doc.id, data: doc.data() }));
  if (rows.length < 2 || rows.length > WRITER_CONSOLIDATION_MAX_MEMBERS
    || rows.some(row => !validUser(row.id, row.data) || row.data.role !== 'admin'
      || row.data.email !== WRITER_CONSOLIDATION_OWNER)) blocked();
  return rows.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
function validMembers(value: unknown): value is string[] {
  return Array.isArray(value) && value.length >= 2 && value.length <= WRITER_CONSOLIDATION_MAX_MEMBERS
    && value.every(id => typeof id === 'string' && USER_ID.test(id))
    && new Set(value).size === value.length && [...value].sort().join(',') === value.join(',');
}
function validReview(value: unknown, projectId: string, rows: CohortRow[], canonicalUserId: string, now: number): value is WriterIdentityRepairReview {
  if (!object(value) || !exact(value, ['schemaVersion', 'kind', 'projectId', 'databaseId', 'emailSha256', 'memberUserIds',
    'cohortSha256', 'backupManifestSha256', 'dependencyProof', 'createdAt', 'expiresAt']) || value.schemaVersion !== 1
    || value.kind !== 'writer-identity-consolidation-review' || value.projectId !== projectId || value.databaseId !== '(default)'
    || value.emailSha256 !== hash(WRITER_CONSOLIDATION_OWNER) || !validMembers(value.memberUserIds)
    || value.memberUserIds.join(',') !== rows.map(row => row.id).join(',')
    || value.cohortSha256 !== writerIdentityCohortSha256(rows) || !HASH.test(value.backupManifestSha256)
    || !iso(value.createdAt) || !iso(value.expiresAt) || Date.parse(value.createdAt) > now
    || Date.parse(value.expiresAt) <= now || Date.parse(value.expiresAt) - Date.parse(value.createdAt) > DAY
    || !object(value.dependencyProof)) return false;
  const proof = value.dependencyProof;
  const ownership = proof.result === 'no-owned-records'
    ? exact(proof, ['schemaVersion', 'result', 'checkedAt', 'datasetsSha256'])
    : proof.result === 'canonical-owned-records-only'
      && exact(proof, ['schemaVersion', 'result', 'preservedOwnerUserId', 'checkedAt', 'datasetsSha256'])
      && proof.preservedOwnerUserId === canonicalUserId && value.memberUserIds.includes(canonicalUserId);
  return proof.schemaVersion === 1 && ownership && HASH.test(proof.datasetsSha256)
    && iso(proof.checkedAt) && Date.parse(proof.checkedAt) <= Date.parse(value.createdAt)
    && now - Date.parse(proof.checkedAt) <= DAY;
}
function validPlan(value: unknown): value is RecordValue {
  if (!object(value) || !exact(value, ['schemaVersion', 'kind', 'state', 'emailSha256', 'canonicalUserId', 'memberUserIds',
    'cohortSha256', 'reviewSha256', 'revision', 'createdAt', 'expiresAt', ...(value.state === 'active'
      ? ['activatedAt', 'identityGeneration', 'activeCohortSha256'] : ['tokenHash'])])) return false;
  return value.schemaVersion === 1 && value.kind === 'writer-identity-consolidation' && ['pending', 'active'].includes(value.state)
    && value.emailSha256 === hash(WRITER_CONSOLIDATION_OWNER) && validMembers(value.memberUserIds)
    && value.memberUserIds.includes(value.canonicalUserId) && HASH.test(value.cohortSha256) && HASH.test(value.reviewSha256)
    && Number.isSafeInteger(value.revision) && value.revision >= 1 && Number.isSafeInteger(value.createdAt)
    && Number.isSafeInteger(value.expiresAt) && value.expiresAt > value.createdAt
    && value.expiresAt - value.createdAt <= WRITER_CONSOLIDATION_TOKEN_TTL_MS
    && (value.state === 'pending' ? HASH.test(value.tokenHash) : iso(value.activatedAt)
      && /^[A-Za-z0-9_-]{43}$/.test(value.identityGeneration) && HASH.test(value.activeCohortSha256));
}

/** Fixed server-side ownership checks; no caller can substitute a positive proof.
 * Hash-only reaction records require a bounded scan. Any overflow fails closed. */
export async function checkWriterIdentityDependencies(db: Firestore, memberUserIds: string[], canonicalUserId: string,
  transaction?: Transaction): Promise<boolean> {
  const aliases = memberUserIds.filter(id => id !== canonicalUserId);
  const chunks: string[][] = [];
  for (let start = 0; start < aliases.length; start += 10) chunks.push(aliases.slice(start, start + 10));
  const checks: Array<() => Promise<boolean>> = [];
  const fields: Array<[string, string]> = [
    ['reader_licenses', 'userId'], ['reader_subscriptions', 'userId'], ['subscription_activations', 'userId'],
    ['manual_access', 'boundUserId'], ['manual_access', 'claimedUserId'], ['manual_access_phone_reservations', 'boundUserId'],
    ['manual_access_entitlements', 'userId'], ['reader_profiles', 'userId'], ['piece_reviews', 'userId'],
    ['transactions', 'userId'], ['transactions', 'buyer.userId'], ['mpesa_callback_intents', 'userId'], ['mpesa_payment_intents', 'userId'],
  ];
  for (const ids of chunks) {
    for (const [collection, field] of fields) {
      checks.push(async () => {
        const found = await read(db, db.collection(collection).where(field, 'in', ids).limit(1), transaction) as QuerySnapshot;
        return found.docs.length === 0;
      });
    }
    checks.push(async () => {
      const found = await read(db, db.collection('comments').where('readerHash', 'in', ids.map(id => `account_${hash(id).slice(0, 40)}`)).limit(1), transaction) as QuerySnapshot;
      return found.docs.length === 0;
    });
  }
  const references = aliases.flatMap(id => [db.collection('reader_profiles').doc(hash(id)),
    db.collection('reader_subscriptions').doc(`sub_${hash(id)}`)]);
  if (references.length) checks.push(async () => {
    const documents = transaction ? await transaction.getAll(...references) : await db.getAll(...references);
    return documents.length === references.length && documents.every(document => !document.exists);
  });
  checks.push(async () => {
    const reactions = await read(db, db.collection('reader_piece_reactions').limit(1001), transaction) as QuerySnapshot;
    if (reactions.docs.length > 1000) return false;
    for (const document of reactions.docs) {
      const value = document.data();
      if (typeof value.articleId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.articleId)
        || !HASH.test(document.id)) return false;
      if (aliases.some(id => hash([id, value.articleId].join('\u001f')) === document.id)) return false;
    }
    return true;
  });
  // Keep all reads before writes, but avoid hundreds of serial RPCs for the
  // preserved cohort. Never start unbounded requests, retry failures or return
  // while another worker is still reading. A failed/uncertain read is a veto.
  let next = 0; let allowed = true;
  async function worker(): Promise<void> {
    while (allowed && next < checks.length) {
      const check = checks[next++];
      try { if (!await check()) allowed = false; } catch { allowed = false; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, checks.length) }, () => worker()));
  return allowed;
}

export async function resolveWriterIdentityByEmail(db: Firestore, email: string, options: ReadOptions = {}): Promise<WriterIdentityResolution> {
  try {
    if (normalizedEmail(email) !== WRITER_CONSOLIDATION_OWNER) return { kind: 'none' };
    target(db, options.env || process.env);
    const id = writerIdentityConsolidationId(email);
    const snapshot = await read(db, db.collection(PLANS).doc(id), options.transaction) as DocumentSnapshot;
    if (!snapshot.exists) {
      return { kind: await hasActivationRemnant(db, id, options.transaction) ? 'invalid' : 'none' };
    }
    const plan = snapshot.data();
    if (!validPlan(plan)) return { kind: 'invalid' };
    if (plan.state === 'pending') {
      return { kind: await hasActivationRemnant(db, id, options.transaction) ? 'invalid' : 'none' };
    }
    const reservation = await read(db, db.collection('user_email_reservations').doc(`uer1_${hash(WRITER_CONSOLIDATION_OWNER)}`), options.transaction) as DocumentSnapshot;
    const rows = await cohort(db, options.transaction);
    // Intentional tamper fence: subsequent profile/credential changes require
    // a reviewed plan revision; silently refreshing this digest is forbidden.
    if (!reservation.exists || reservation.data()?.userId !== plan.canonicalUserId
      || plan.memberUserIds.join(',') !== rows.map(row => row.id).join(',')
      || plan.activeCohortSha256 !== writerIdentityCohortSha256(rows)) return { kind: 'invalid' };
    const receipt = (await read(db, db.collection('user_identity_repair_audit').doc(`${id}_${plan.revision}`), options.transaction) as DocumentSnapshot).data();
    if (!object(receipt) || !exact(receipt, ['schemaVersion', 'kind', 'planId', 'revision', 'canonicalUserId',
      'memberUserIdsSha256', 'beforeCohortSha256', 'afterCohortSha256', 'identityGeneration', 'activatedAt'])
      || receipt.schemaVersion !== 1 || receipt.kind !== 'writer-identity-consolidation-completed' || receipt.planId !== id
      || receipt.revision !== plan.revision || receipt.canonicalUserId !== plan.canonicalUserId
      || receipt.memberUserIdsSha256 !== hash(canonical(plan.memberUserIds)) || receipt.beforeCohortSha256 !== plan.cohortSha256
      || receipt.afterCohortSha256 !== plan.activeCohortSha256 || receipt.identityGeneration !== plan.identityGeneration
      || receipt.activatedAt !== plan.activatedAt) return { kind: 'invalid' };
    const user = rows.find(row => row.id === plan.canonicalUserId)!.data as unknown as UserRecord;
    return { kind: 'active', user, identityGeneration: plan.identityGeneration,
      memberUserIds: [...plan.memberUserIds], activatedAt: plan.activatedAt };
  } catch { return { kind: 'invalid' }; }
}
async function hasActivationRemnant(db: Firestore, id: string, transaction?: Transaction): Promise<boolean> {
  const [reservation, receipts] = await Promise.all([
    read(db, db.collection('user_email_reservations').doc(`uer1_${hash(WRITER_CONSOLIDATION_OWNER)}`), transaction) as Promise<DocumentSnapshot>,
    read(db, db.collection('user_identity_repair_audit').where('planId', '==', id).limit(1), transaction) as Promise<QuerySnapshot>,
  ]);
  return reservation.exists || receipts.docs.length > 0;
}
export async function writerConsolidationSessionAllowed(db: Firestore, session: {
  userId: string; email: string; writerIdentityGeneration?: unknown;
}, options: ReadOptions = {}): Promise<boolean> {
  const ownerEmail = normalizedEmail(session.email) === WRITER_CONSOLIDATION_OWNER;
  const env = options.env || process.env;
  try { target(db, env); }
  catch {
    const actual = getFirestoreClientTarget(db);
    // Never use a historical email to fail open on a broken production binding.
    if (env.VERCEL_ENV === 'production' || [PRODUCTION, STAGING].includes(env.FIREBASE_PROJECT_ID || '')
      || actual && [PRODUCTION, STAGING].includes(actual.projectId)) return false;
    return !ownerEmail && session.writerIdentityGeneration === undefined;
  }
  try {
    // Historical session snapshots can carry a previous email. Cohort USER ID,
    // not that snapshot's email, determines whether activation revoked it.
    const snapshot = await read(db, db.collection(PLANS).doc(writerIdentityConsolidationId(WRITER_CONSOLIDATION_OWNER)), options.transaction) as DocumentSnapshot;
    const plan = snapshot.data();
    const member = Array.isArray(plan?.memberUserIds) && plan.memberUserIds.includes(session.userId);
    if (!snapshot.exists || validPlan(plan) && plan.state === 'pending') {
      if (!await hasActivationRemnant(db, writerIdentityConsolidationId(WRITER_CONSOLIDATION_OWNER), options.transaction)) {
        return session.writerIdentityGeneration === undefined;
      }
      // An orphan reservation/receipt must not turn a completed repair back
      // into pre-activation login after its plan is lost or downgraded.
      if (ownerEmail || member || session.writerIdentityGeneration !== undefined) return false;
      const current = await read(db, db.collection('users').doc(session.userId), options.transaction) as DocumentSnapshot;
      return current.exists && normalizedEmail(current.data()?.email) !== WRITER_CONSOLIDATION_OWNER;
    }
    let currentOwner = ownerEmail || member;
    if (!currentOwner) {
      const current = await read(db, db.collection('users').doc(session.userId), options.transaction) as DocumentSnapshot;
      if (!current.exists) return false;
      currentOwner = normalizedEmail(current.data()?.email) === WRITER_CONSOLIDATION_OWNER;
    }
    if (!validPlan(plan)) return !currentOwner && session.writerIdentityGeneration === undefined;
    if (!currentOwner) return session.writerIdentityGeneration === undefined;
    const resolved = await resolveWriterIdentityByEmail(db, WRITER_CONSOLIDATION_OWNER, options);
    return resolved.kind === 'active' && ownerEmail && session.userId === resolved.user.id
      && session.writerIdentityGeneration === resolved.identityGeneration;
  } catch { return false; }
}
export async function resolveWriterIdentityForSessionCreation(db: Firestore, verifiedUser: UserRecord,
  transaction: Transaction, env: NodeJS.ProcessEnv = process.env): Promise<{ user: UserRecord; writerIdentityGeneration?: string } | null> {
  try {
    const resolved = await resolveWriterIdentityByEmail(db, verifiedUser.email, { transaction, env });
    if (resolved.kind === 'invalid') return null;
    if (resolved.kind === 'active') return resolved.user.id === verifiedUser.id && resolved.user.passwordHash === verifiedUser.passwordHash
      ? { user: resolved.user, writerIdentityGeneration: resolved.identityGeneration } : null;
    // Before activation, preserve the existing authenticated account selection;
    // only CAS the credential just verified. Pending metadata grants no authority.
    const doc = await transaction.get(db.collection('users').doc(verifiedUser.id)); const value = doc.data();
    return validUser(doc.id, value) && doc.id === verifiedUser.id && value.passwordHash === verifiedUser.passwordHash
      && value.email === normalizedEmail(verifiedUser.email) && value.role === verifiedUser.role ? { user: value } : null;
  } catch { return null; }
}

export class WriterIdentityConsolidationStore {
  constructor(private readonly dbProvider: () => Firestore = getDb,
    private readonly envProvider: () => NodeJS.ProcessEnv = () => process.env) {}

  private async reviewed(db: Firestore, actor: Actor, transaction: Transaction, now: number) {
    const projectId = target(db, this.envProvider());
    if (actor.role !== 'admin' || normalizedEmail(actor.email) !== WRITER_CONSOLIDATION_OWNER || !USER_ID.test(actor.id)) blocked();
    const rows = await cohort(db, transaction);
    if (!rows.some(row => row.id === actor.id)) blocked();
    const id = writerIdentityConsolidationId(actor.email);
    const [review, reservation, plan, receipts] = await Promise.all([
      transaction.get(db.collection(REVIEWS).doc(id)),
      transaction.get(db.collection('user_email_reservations').doc(`uer1_${hash(WRITER_CONSOLIDATION_OWNER)}`)),
      transaction.get(db.collection(PLANS).doc(id)),
      transaction.get(db.collection('user_identity_repair_audit').where('planId', '==', id).limit(1)),
    ]);
    const reviewValue = review.data();
    // A reviewed unique existing owner preserves its purchase/access identity.
    // Otherwise the actual authenticated actor chooses their own ID. Neither
    // route input, query order nor privilege ranking can choose another ID.
    const preserved = reviewValue?.dependencyProof?.result === 'canonical-owned-records-only'
      ? reviewValue.dependencyProof.preservedOwnerUserId : undefined;
    const canonicalUserId = typeof preserved === 'string' && rows.some(row => row.id === preserved) ? preserved : actor.id;
    return { rows, id, review: reviewValue, reservation, plan: plan.data(), projectId, now, canonicalUserId,
      activationReceiptExists: receipts.docs.length > 0 };
  }

  async status(actor: Actor): Promise<WriterIdentityConsolidationStatus> {
    try {
      const db = this.dbProvider(); const now = Date.now();
      return await db.runTransaction(async transaction => {
        const state = await this.reviewed(db, actor, transaction, now);
        const count = state.rows.length;
        if (state.plan && !validPlan(state.plan)) return { status: 'unavailable', memberCount: count, canIssue: false };
        if (state.plan?.state === 'active') {
          const resolved = await resolveWriterIdentityByEmail(db, actor.email, { transaction, env: this.envProvider() });
          return { status: resolved.kind === 'active' ? 'active' : 'unavailable', memberCount: count, canIssue: false };
        }
        if (state.activationReceiptExists) return { status: 'unavailable', memberCount: count, canIssue: false };
        if (state.plan?.state === 'pending' && state.plan.expiresAt > now) {
          return { status: 'pending', memberCount: count, canIssue: false, expiresAt: state.plan.expiresAt };
        }
        if (state.reservation.exists || !validReview(state.review, state.projectId, state.rows, state.canonicalUserId, now)
          || !await checkWriterIdentityDependencies(db, state.rows.map(row => row.id), state.canonicalUserId, transaction)) {
          return { status: 'review_required', memberCount: count, canIssue: false };
        }
        return { status: 'ready', memberCount: count, canIssue: true };
      });
    } catch { return { status: 'unavailable', memberCount: 0, canIssue: false }; }
  }

  async issue(actor: Actor): Promise<{ token: string; expiresAt: number }> {
    try {
      const db = this.dbProvider(); const now = Date.now();
      const token = `wcr1_${crypto.randomBytes(32).toString('base64url')}`;
      const tokenHash = hashWriterConsolidationToken(token)!;
      const expiresAt = now + WRITER_CONSOLIDATION_TOKEN_TTL_MS;
      await db.runTransaction(async transaction => {
        const state = await this.reviewed(db, actor, transaction, now);
        if (state.activationReceiptExists && state.plan?.state !== 'active') blocked();
        if (state.plan && validPlan(state.plan) && (state.plan.state === 'active' || state.plan.expiresAt > now)) {
          throw new WriterIdentityConsolidationError('conflict');
        }
        if (state.reservation.exists || state.plan && !validPlan(state.plan)
          || !validReview(state.review, state.projectId, state.rows, state.canonicalUserId, now)
          || !await checkWriterIdentityDependencies(db, state.rows.map(row => row.id), state.canonicalUserId, transaction)) blocked();
        const revision = (state.plan?.revision || 0) + 1;
        const plan = { schemaVersion: 1, kind: 'writer-identity-consolidation', state: 'pending', emailSha256: hash(WRITER_CONSOLIDATION_OWNER),
          canonicalUserId: state.canonicalUserId, memberUserIds: state.rows.map(row => row.id), cohortSha256: writerIdentityCohortSha256(state.rows),
          reviewSha256: hash(canonical(state.review)), revision, createdAt: now, expiresAt, tokenHash };
        if (state.plan?.tokenHash) transaction.delete(db.collection(TOKENS).doc(state.plan.tokenHash));
        transaction.set(db.collection(PLANS).doc(state.id), plan);
        transaction.create(db.collection(TOKENS).doc(tokenHash), { schemaVersion: 1, purpose: 'writer-identity-consolidation',
          planId: state.id, revision, canonicalUserId: state.canonicalUserId, cohortSha256: plan.cohortSha256, createdAt: now, expiresAt });
      });
      return { token, expiresAt };
    } catch (error) {
      if (error instanceof WriterIdentityConsolidationError) throw error;
      throw new WriterIdentityConsolidationError('unavailable');
    }
  }

  private async pending(db: Firestore, tokenHash: string, transaction: Transaction, now: number) {
    const projectId = target(db, this.envProvider());
    const token = (await transaction.get(db.collection(TOKENS).doc(tokenHash))).data();
    const id = writerIdentityConsolidationId(WRITER_CONSOLIDATION_OWNER);
    if (!object(token) || !exact(token, ['schemaVersion', 'purpose', 'planId', 'revision', 'canonicalUserId', 'cohortSha256', 'createdAt', 'expiresAt'])
      || token.schemaVersion !== 1 || token.purpose !== 'writer-identity-consolidation' || token.planId !== id) return null;
    const [planSnapshot, reviewSnapshot, reservation, receipts] = await Promise.all([
      transaction.get(db.collection(PLANS).doc(id)), transaction.get(db.collection(REVIEWS).doc(id)),
      transaction.get(db.collection('user_email_reservations').doc(`uer1_${hash(WRITER_CONSOLIDATION_OWNER)}`)),
      transaction.get(db.collection('user_identity_repair_audit').where('planId', '==', id).limit(1)),
    ]);
    const plan = planSnapshot.data(); const rows = await cohort(db, transaction); const review = reviewSnapshot.data();
    if (!validPlan(plan) || plan.state !== 'pending' || plan.tokenHash !== tokenHash || plan.createdAt > now || plan.expiresAt <= now
      || token.revision !== plan.revision || token.canonicalUserId !== plan.canonicalUserId || token.cohortSha256 !== plan.cohortSha256
      || token.createdAt !== plan.createdAt || token.expiresAt !== plan.expiresAt || reservation.exists || receipts.docs.length > 0
      || !validReview(review, projectId, rows, plan.canonicalUserId, now) || hash(canonical(review)) !== plan.reviewSha256
      || plan.memberUserIds.join(',') !== rows.map(row => row.id).join(',')
      || !rows.some(row => row.id === plan.canonicalUserId)
      || writerIdentityCohortSha256(rows) !== plan.cohortSha256
      || !await checkWriterIdentityDependencies(db, plan.memberUserIds, plan.canonicalUserId, transaction)) return null;
    return { id, plan, rows };
  }

  async isActive(token: unknown): Promise<boolean> {
    const tokenHash = hashWriterConsolidationToken(token); if (!tokenHash) return false;
    try { const db = this.dbProvider(); return Boolean(await db.runTransaction(transaction => this.pending(db, tokenHash, transaction, Date.now()))); }
    catch { return false; }
  }

  async consume(token: unknown, newArgonHash: string, newPassword: string): Promise<{ user: UserRecord; resetAt: string; identityGeneration: string } | null> {
    const tokenHash = hashWriterConsolidationToken(token);
    if (!tokenHash || typeof newArgonHash !== 'string' || newArgonHash.length > 1024 || !/^\$argon2id\$/.test(newArgonHash)
      || typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 256) return null;
    try {
      const db = this.dbProvider(); const now = Date.now(); const resetAt = new Date(now).toISOString();
      const identityGeneration = crypto.randomBytes(32).toString('base64url');
      // Expensive Argon2 checks run outside the committing transaction. Its
      // second exact-cohort/review/token comparison is the credential CAS.
      const verified = await db.runTransaction(transaction => this.pending(db, tokenHash, transaction, now));
      if (!verified || !await verifyPassword(newArgonHash, newPassword)) return null;
      for (const row of verified.rows) if (await verifyPassword(String(row.data.passwordHash), newPassword)) return null;
      return await db.runTransaction(async transaction => {
        const pending = await this.pending(db, tokenHash, transaction, Date.now());
        if (!pending || pending.plan.cohortSha256 !== verified.plan.cohortSha256 || pending.plan.revision !== verified.plan.revision
          || pending.plan.reviewSha256 !== verified.plan.reviewSha256) return null;
        const { id, plan, rows } = pending;
        const user = { ...rows.find(row => row.id === plan.canonicalUserId)!.data,
          passwordHash: newArgonHash, updatedAt: resetAt } as unknown as UserRecord;
        if (rows.some(row => (row.data as any).passwordHash === newArgonHash)) return null;
        const { tokenHash: _consumed, ...base } = plan;
        const activeRows = rows.map(row => row.id === user.id ? { id: row.id, data: user as unknown as Record<string, unknown> } : row);
        const afterCohortSha256 = writerIdentityCohortSha256(activeRows);
        const auditRef = db.collection('user_identity_repair_audit').doc(`${id}_${plan.revision}`);
        if ((await transaction.get(auditRef)).exists) return null;
        transaction.update(db.collection('users').doc(user.id), { passwordHash: newArgonHash, updatedAt: resetAt });
        transaction.create(db.collection('user_email_reservations').doc(`uer1_${hash(WRITER_CONSOLIDATION_OWNER)}`), { userId: user.id, createdAt: resetAt });
        transaction.set(db.collection(PLANS).doc(id), { ...base, state: 'active', activatedAt: resetAt, identityGeneration,
          activeCohortSha256: afterCohortSha256 });
        transaction.create(auditRef, { schemaVersion: 1, kind: 'writer-identity-consolidation-completed', planId: id,
          revision: plan.revision, canonicalUserId: user.id, memberUserIdsSha256: hash(canonical(plan.memberUserIds)),
          beforeCohortSha256: plan.cohortSha256, afterCohortSha256, identityGeneration, activatedAt: resetAt });
        transaction.delete(db.collection(TOKENS).doc(tokenHash));
        return { user, resetAt, identityGeneration };
      });
    } catch { return null; }
  }
}
