import crypto from 'crypto';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import type { AffiliatePublicProfile } from '../types.js';
import {
  DEFAULT_AFFILIATE_NOTIFICATION_SETTINGS,
  validateAffiliateNotificationSettings,
} from './affiliateNotifications.js';
import {
  MAX_AFFILIATE_NOTIFICATION_PLAN_RECIPIENTS,
  planAffiliateNotifications,
  type AffiliateNotificationSource,
  type HeldAffiliateNotificationIntent,
} from './affiliateNotificationPlan.js';
import { verifiedManualAffiliateNotificationTierIds } from './affiliateNotificationTierFilter.js';
import { readVerifiedAffiliateNotificationMonthlyTiers } from './affiliateNotificationMonthlyTiers.js';
import type { VerifiedAffiliateNotificationMonthlyTiers } from './affiliateNotificationTierFilter.js';

export const AFFILIATE_NOTIFICATION_OUTBOX_COLLECTION = 'affiliate_notification_outbox';
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const INTENT_ID = /^ani1_[a-f0-9]{64}$/;

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).filter(key => object[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`;
}

function hash(value: unknown): string {
  return crypto.createHash('sha256').update(canonical(value)).digest('hex');
}

function isoTime(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value
    ? milliseconds : null;
}

function conflict(): never {
  throw new Error('Partner notification outbox conflict; existing records were preserved.');
}

interface SourceRecord {
  schemaVersion: 1;
  kind: 'source';
  id: string;
  source: AffiliateNotificationSource;
  sourceSha256: string;
  audienceSha256: string;
  intentEvidence: Array<{ id: string; sha256: string }>;
  createdAt: string;
  deliveryMode: 'preview_only';
}

type IntentRecord = HeldAffiliateNotificationIntent & { kind: 'intent'; createdAt: string };

export interface HeldNotificationStorageResult {
  status: 'disabled' | 'ineligible' | 'created' | 'existing';
  intentCount: number;
}

/**
 * Internal storage boundary, deliberately disconnected from routes and source
 * hooks. Caller supplies its reviewed Firestore client and explicitly opts into
 * held storage. No getDb(), provider, worker, or email delivery is available here.
 */
export async function storeHeldAffiliateNotifications(input: {
  db: Firestore;
  mode?: 'disabled' | 'held';
  source: AffiliateNotificationSource;
  affiliateIds: string[];
  now: string;
  /** Trusted server-side source adapter; runs before any outbox write. */
  verifySource?: (transaction: Transaction) => Promise<boolean>;
}): Promise<HeldNotificationStorageResult> {
  if (input.mode === undefined || input.mode === 'disabled') return { status: 'disabled', intentCount: 0 };
  if (input.mode !== 'held' || !Array.isArray(input.affiliateIds)
    || input.affiliateIds.length > MAX_AFFILIATE_NOTIFICATION_PLAN_RECIPIENTS
    || Array.from(input.affiliateIds).some(id => typeof id !== 'string' || !SAFE_ID.test(id))
    || new Set(input.affiliateIds).size !== input.affiliateIds.length) {
    throw new Error('Invalid partner notification storage input.');
  }
  const source = { ...input.source };
  const now = input.now;
  const db = input.db;
  const verifySource = input.verifySource;
  // Validate source/time before a Firestore transaction can be reached.
  const emptyPlan = planAffiliateNotifications({
    source, settings: DEFAULT_AFFILIATE_NOTIFICATION_SETTINGS,
    affiliates: [], now,
  });
  const audience = [...input.affiliateIds].sort();
  const sourceSha256 = hash(source);
  const audienceSha256 = hash(audience);
  const collection = db.collection(AFFILIATE_NOTIFICATION_OUTBOX_COLLECTION);
  const sourceRef = collection.doc(emptyPlan.eventId);

  try {
    return await db.runTransaction(async transaction => {
      if (verifySource && !await verifySource(transaction)) {
        return { status: 'ineligible' as const, intentCount: 0 };
      }
      const sourceSnapshot = await transaction.get(sourceRef);
      if (sourceSnapshot.exists) {
        const existing = sourceSnapshot.data() as SourceRecord;
        const createdMs = isoTime(existing?.createdAt);
        if (!existing || existing.schemaVersion !== 1 || existing.kind !== 'source'
          || Object.keys(existing).some(key => !['schemaVersion', 'kind', 'id', 'source', 'sourceSha256', 'audienceSha256', 'intentEvidence', 'createdAt', 'deliveryMode'].includes(key))
          || existing.id !== emptyPlan.eventId || existing.deliveryMode !== 'preview_only'
          || existing.sourceSha256 !== sourceSha256 || hash(existing.source) !== sourceSha256
          || existing.audienceSha256 !== audienceSha256
          || createdMs === null || createdMs < Date.parse(source.occurredAt) || createdMs > Date.parse(now)
          || !Array.isArray(existing.intentEvidence) || !existing.intentEvidence.length
          || existing.intentEvidence.length > MAX_AFFILIATE_NOTIFICATION_PLAN_RECIPIENTS
          || existing.intentEvidence.some(item => !item || Object.keys(item).some(key => !['id', 'sha256'].includes(key))
            || !INTENT_ID.test(item.id) || !/^[a-f0-9]{64}$/.test(item.sha256))
          || new Set(existing.intentEvidence.map(item => item.id)).size !== existing.intentEvidence.length) conflict();
        const snapshots = await transaction.getAll(...existing.intentEvidence.map(item => collection.doc(item.id)));
        const byId = new Map(snapshots.map(snapshot => [snapshot.id, snapshot]));
        const recipients = new Set<string>();
        for (const evidence of existing.intentEvidence) {
          const snapshot = byId.get(evidence.id);
          const record = snapshot?.data() as IntentRecord | undefined;
          if (!snapshot?.exists || !record || record.kind !== 'intent' || record.schemaVersion !== 1
            || Object.keys(record).some(key => !['schemaVersion', 'id', 'eventId', 'eventType', 'affiliateId', 'settingsRevision', 'state', 'dueAt', 'tierEvidenceSha256', 'kind', 'createdAt'].includes(key))
            || record.tierEvidenceSha256 !== undefined && (typeof record.tierEvidenceSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(record.tierEvidenceSha256))
            || record.id !== evidence.id || record.eventId !== existing.id || record.state !== 'held'
            || record.eventType !== source.eventType || !Number.isSafeInteger(record.settingsRevision) || record.settingsRevision < 0
            || record.createdAt !== existing.createdAt
            || isoTime(record.dueAt) === null || Date.parse(record.dueAt) < Date.parse(source.occurredAt)
            || !audience.includes(record.affiliateId) || recipients.has(record.affiliateId)
            || record.id !== `ani1_${hash([existing.id, record.affiliateId])}`
            || (source.targetAffiliateId !== undefined && record.affiliateId !== source.targetAffiliateId)
            || hash(record) !== evidence.sha256) conflict();
          recipients.add(record.affiliateId);
        }
        return { status: 'existing' as const, intentCount: existing.intentEvidence.length };
      }

      const settingsRef = db.collection('site_configs').doc('affiliate_notifications');
      const affiliateRefs = audience.map(id => db.collection('affiliates').doc(id));
      const snapshots = await transaction.getAll(settingsRef, ...affiliateRefs);
      const byPath = new Map(snapshots.map(snapshot => [snapshot.ref.path, snapshot]));
      const settingsSnapshot = byPath.get(settingsRef.path);
      if (!settingsSnapshot) conflict();
      const settings = settingsSnapshot.exists
        ? validateAffiliateNotificationSettings(settingsSnapshot.data())
        : DEFAULT_AFFILIATE_NOTIFICATION_SETTINGS;
      const affiliates: AffiliatePublicProfile[] = [];
      for (const ref of affiliateRefs) {
        const snapshot = byPath.get(ref.path);
        if (!snapshot) conflict();
        if (snapshot.exists) affiliates.push({ ...snapshot.data(), id: ref.id } as AffiliatePublicProfile);
      }
      const template = settings.templates.find(item => item.eventType === source.eventType)!;
      let verifiedManualTierIds: Record<string, string> | undefined;
      let verifiedMonthlyTiers: VerifiedAffiliateNotificationMonthlyTiers | undefined;
      if (template.eligibility.tierIds.length && !(source.eventType === 'tier_upgrade' && source.targetTierId)) {
        const circleSnapshot = await transaction.get(db.collection('site_configs').doc('affiliate_literary_circle'));
        verifiedManualTierIds = verifiedManualAffiliateNotificationTierIds(affiliates, circleSnapshot.exists ? circleSnapshot.data() : undefined, now);
        verifiedMonthlyTiers = await readVerifiedAffiliateNotificationMonthlyTiers({
          db, transaction, affiliates, settings: circleSnapshot.exists ? circleSnapshot.data() : undefined, now,
        });
      }
      const plan = planAffiliateNotifications({ source, settings, affiliates, now, verifiedManualTierIds, verifiedMonthlyTiers });
      if (!plan.intents.length) return { status: 'ineligible' as const, intentCount: 0 };
      const records: IntentRecord[] = plan.intents.map(intent => ({ ...intent, kind: 'intent', createdAt: now }));
      const intentSnapshots = await transaction.getAll(...records.map(record => collection.doc(record.id)));
      if (intentSnapshots.length !== records.length || intentSnapshots.some(snapshot => snapshot.exists)) conflict();
      const record: SourceRecord = {
        schemaVersion: 1, kind: 'source', id: plan.eventId,
        source, sourceSha256, audienceSha256,
        intentEvidence: records.map(intent => ({ id: intent.id, sha256: hash(intent) })),
        createdAt: now, deliveryMode: 'preview_only',
      };
      transaction.create(sourceRef, record);
      for (const intent of records) transaction.create(collection.doc(intent.id), intent);
      return { status: 'created' as const, intentCount: records.length };
    });
  } catch {
    // Provider errors can contain credentials, document paths or source details.
    // Do not log them or offer an overwrite/repair fallback.
    throw new Error('Partner notification outbox write or verification failed; no repair was attempted.');
  }
}
