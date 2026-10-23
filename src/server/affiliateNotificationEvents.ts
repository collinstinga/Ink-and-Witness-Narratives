import crypto from 'crypto';
import type { Firestore, DocumentReference } from 'firebase-admin/firestore';
import type { AffiliateNotificationSource } from './affiliateNotificationPlan.js';
import { getFirestoreClientTarget } from './db.js';

type SourceKind = 'activation' | 'new_commission';
type PreparationStatus = 'disabled' | 'blocked' | 'ineligible' | 'created' | 'existing' | 'failed';
interface PreparationResult { status: PreparationStatus; intentCount: number }
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const SAFE_PROJECT = /^[a-z][a-z0-9-]{4,29}[a-z0-9]$/;
const KNOWN_PRODUCTION = ['ink-and-witness-narratives', 'divine-experience-pq6d2'];
export const MAX_AFFILIATE_NOTIFICATION_RECOVERY_IDS = 25;

function gate(db: Firestore, env: NodeJS.ProcessEnv): 'held' | 'disabled' | 'blocked' {
  const mode = (env.AFFILIATE_NOTIFICATION_EVENT_MODE || 'off').trim().toLowerCase();
  if (mode === 'off') return 'disabled';
  if (mode !== 'held') return 'blocked';
  const project = (env.FIREBASE_PROJECT_ID || '').trim();
  const allowed = (env.LITERARY_CIRCLE_STAGING_PROJECT_IDS || '').split(',').map(value => value.trim()).filter(Boolean);
  const denied = new Set([...KNOWN_PRODUCTION, ...(env.LITERARY_CIRCLE_PRODUCTION_PROJECT_IDS || '').split(',').map(value => value.trim())]);
  const vercelEnv = (env.VERCEL_ENV || '').trim().toLowerCase();
  const database = (env.FIRESTORE_DATABASE_ID || '(default)').trim();
  const actualTarget = getFirestoreClientTarget(db);
  if (vercelEnv === 'production' || (!vercelEnv && (env.NODE_ENV || '').trim().toLowerCase() === 'production')
    || !SAFE_PROJECT.test(project) || !allowed.includes(project)
    || allowed.some(id => !SAFE_PROJECT.test(id) || denied.has(id))
    || denied.has(project) || actualTarget?.projectId !== project || actualTarget?.firestoreDatabaseId !== database
    || env.FIRESTORE_EMULATOR_HOST || env.FIREBASE_DATABASE_EMULATOR_HOST || env.FIREBASE_AUTH_EMULATOR_HOST) return 'blocked';
  return 'held';
}

function fingerprint(value: unknown): string {
  // Firestore records contain JSON-compatible business fields; use sorted keys
  // so independent snapshot projections compare the same document contents.
  const canonical = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(canonical);
    if (!item || typeof item !== 'object') return item;
    return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => [key, canonical(nested)]));
  };
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function canonicalTime(value: unknown, now: number): string | null {
  const milliseconds = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(milliseconds) && milliseconds > 0 && milliseconds <= now
    ? new Date(milliseconds).toISOString() : null;
}

function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1_000_000;
}

/** Internal post-commit adapter. Defaults off and can prepare held records only in staging. */
export async function prepareCommittedAffiliateNotification(input: {
  db: Firestore;
  kind: SourceKind;
  sourceId: string;
  now?: string;
}, env: NodeJS.ProcessEnv = process.env): Promise<PreparationResult> {
  const result = (status: PreparationStatus): PreparationResult => ({ status, intentCount: 0 });
  try {
    const db = input.db;
    const kind = input.kind;
    const sourceId = input.sourceId;
    const suppliedNow = input.now;
    const mode = gate(db, env);
    if (mode !== 'held') return result(mode);
    if (!['activation', 'new_commission'].includes(kind)
      || typeof sourceId !== 'string' || !SAFE_ID.test(sourceId)) return result('ineligible');
    const now = suppliedNow || new Date().toISOString();
    const nowMs = Date.parse(now);
    if (!Number.isFinite(nowMs) || new Date(nowMs).toISOString() !== now) return result('ineligible');
    const primaryRef = db.collection(kind === 'activation' ? 'affiliates' : 'affiliate_commissions').doc(sourceId);
    const [primarySnapshot] = await db.getAll(primaryRef);
    if (!primarySnapshot?.exists) return result('ineligible');
    const primary = primarySnapshot.data()!;
    const refs: DocumentReference[] = [primaryRef];
    const expected = [fingerprint(primary)];
    let source: AffiliateNotificationSource;
    if (kind === 'activation') {
      const approvedAt = canonicalTime(primary.approvedAt, nowMs);
      if (primary.status !== 'active' || !approvedAt || typeof primary.approvedBy !== 'string'
        || !primary.approvedBy.trim()) return result('ineligible');
      source = { eventType: 'activation', sourceId: primaryRef.id, sourceVersion: Date.parse(approvedAt), occurredAt: approvedAt, targetAffiliateId: primaryRef.id };
    } else {
      const occurredAt = canonicalTime(primary.createdAt, nowMs);
      if (!['PENDING', 'APPROVED', 'PAID'].includes(primary.status)
        || primary.fraudFlag?.flagged || !occurredAt
        || typeof primary.affiliateId !== 'string' || !SAFE_ID.test(primary.affiliateId)
        || typeof primary.checkoutRequestId !== 'string' || !SAFE_ID.test(primary.checkoutRequestId)
        || typeof primary.articleId !== 'string' || !primary.articleId.trim() || primary.articleId.length > 256
        || !positive(primary.commissionAmountKes) || !positive(primary.saleAmountKes)
        || primary.commissionAmountKes > primary.saleAmountKes) return result('ineligible');
      const paymentRef = db.collection('transactions').doc(primary.checkoutRequestId);
      const [paymentSnapshot] = await db.getAll(paymentRef);
      if (!paymentSnapshot?.exists) return result('ineligible');
      const payment = paymentSnapshot.data()!;
      const receipt = payment.mpesaReceiptNumber || payment.bankReference || `CHECKOUT-${payment.checkoutRequestId || payment.id}`;
      if (!['CONFIRMED', 'SUCCESS', 'PAID'].includes(payment.status) || payment.type !== 'PURCHASE'
        || !['mpesa', 'bank'].includes(payment.paymentMethod)
        || payment.checkoutRequestId !== primary.checkoutRequestId
        || typeof payment.id !== 'string' || payment.id !== primary.transactionId
        || payment.articleId !== primary.articleId || payment.amount !== primary.saleAmountKes
        || typeof primary.affiliateCode !== 'string' || !primary.affiliateCode.trim()
        || typeof payment.affiliateCode !== 'string'
        || payment.affiliateCode.trim().toUpperCase() !== primary.affiliateCode.trim().toUpperCase()
        || typeof receipt !== 'string' || !receipt.trim() || receipt.length > 256
        || receipt !== primary.receiptNumber) return result('ineligible');
      refs.push(paymentRef);
      expected.push(fingerprint(payment));
      source = { eventType: 'new_commission', sourceId: primaryRef.id, sourceVersion: 1, occurredAt, targetAffiliateId: primary.affiliateId };
    }
    const { storeHeldAffiliateNotifications } = await import('./affiliateNotificationOutbox.js');
    return await storeHeldAffiliateNotifications({
      db, mode: 'held', source, affiliateIds: [source.targetAffiliateId!], now,
      verifySource: async transaction => {
        const snapshots = await transaction.getAll(...refs);
        const byPath = new Map(snapshots.map(snapshot => [snapshot.ref.path, snapshot]));
        return refs.every((ref, index) => {
          const snapshot = byPath.get(ref.path);
          return snapshot?.exists && fingerprint(snapshot.data()) === expected[index];
        });
      },
    });
  } catch {
    // Approval/payment commits must stay successful if notification preparation
    // fails. A bounded replay of the committed source can recover it later.
    console.warn('[Partner Notifications] Preparation failed; committed source remains available for recovery.');
    return result('failed');
  }
}

/** Explicit bounded recovery: no collection scan, cursor, cron, or email dispatch. */
export async function recoverCommittedAffiliateNotifications(input: {
  db: Firestore; kind: SourceKind; sourceIds: string[]; now?: string;
}, env: NodeJS.ProcessEnv = process.env): Promise<{ attempted: number; counts: Partial<Record<PreparationStatus, number>> }> {
  const db = input.db;
  const kind = input.kind;
  const now = input.now;
  const mode = gate(db, env);
  if (mode !== 'held') return { attempted: 0, counts: { [mode]: 1 } };
  if (!Array.isArray(input.sourceIds) || input.sourceIds.length > MAX_AFFILIATE_NOTIFICATION_RECOVERY_IDS
    || input.sourceIds.some(id => typeof id !== 'string' || !SAFE_ID.test(id))
    || new Set(input.sourceIds).size !== input.sourceIds.length) {
    throw new Error('Invalid partner notification recovery batch.');
  }
  const sourceIds = [...input.sourceIds];
  const counts: Partial<Record<PreparationStatus, number>> = {};
  for (const sourceId of sourceIds) {
    const prepared = await prepareCommittedAffiliateNotification({ db, kind, sourceId, now }, env);
    counts[prepared.status] = (counts[prepared.status] || 0) + 1;
  }
  return { attempted: sourceIds.length, counts };
}
