import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { getFirestoreClientTarget } from '../src/server/db.js';
import {
  createLiteraryCircleMembership,
  DEFAULT_LITERARY_CIRCLE_SETTINGS,
  normalizeLiteraryCircleSettings,
} from '../src/server/literaryCircle.js';
import {
  AFFILIATE_BACKUP_DATASETS, AFFILIATE_BACKUP_SCHEMA_VERSION,
  buildDatasetPayload, canonicalJson, isAffiliateAttributedTransaction,
  literaryCircleResourceAssetIds, mergeFoundingMembership, planIndexReservation,
  prettyStableJson, sha256Hex, summarizeDatasetDocuments, validateFoundingAffiliateDocuments,
  type BackupDatasetPayload, type BackupDocument, type FirebaseTarget, type VerifiedAffiliateBackup,
} from './literary-circle-migration-lib.js';
import { foundingCohortDigest, RELEASE_BACKUP_MAX_AGE_MS } from './literary-circle-release-plan-lib.js';

export const PRODUCTION_CORE_PROJECT_ID = 'ink-and-witness-narratives';
export const PRODUCTION_CORE_OWNER = 'collinstinga@gmail.com';
export const PRODUCTION_CORE_COHORT_SHA256 = 'd1c67263f094f594e6d8b92b8a2c391a8cf789fd9d2cda3ddedb72360db35555';
export const PRODUCTION_CORE_MARKER_ID = 'literary-circle-production-core-v1';
export const PRODUCTION_CORE_DATASET_LIMIT = 1_000;
export const PRODUCTION_CORE_TOTAL_READ_LIMIT = 5_000;
const HASH = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const record = (value: unknown): value is Record<string, any> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 1_500 && !/[\/\x00-\x1f]/.test(value);
function iso(value: unknown): number {
  const result = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(result) && new Date(result).toISOString() === value ? result : NaN;
}

/** Only these fixed, non-provider messages leave this operator library. */
export class LiteraryCircleProductionCoreError extends Error {
  constructor(readonly code: string) {
    super(`Production core activation refused (${code}). No repair or automatic retry is authorized.`);
    this.name = 'LiteraryCircleProductionCoreError';
  }
}
function refuse(code: string): never { throw new LiteraryCircleProductionCoreError(code); }

/** The operator independently obtains CI/deployment/account evidence. These
 * pins enforce consistency, not an assertion that a local JSON file proves it. */
export interface ProductionCoreProof {
  sourceCommit: string;
  ciSourceCommit: string;
  ciConclusion: 'success';
  productionBuildSourceCommit: string;
  productionBuildState: 'READY';
  productionBuildTarget: 'production';
  productionDeploymentId: string;
  verifiedOwnerEmail: string;
}
export interface ProductionCoreActivationInput {
  db: Firestore;
  backup: VerifiedAffiliateBackup;
  expectedTarget: FirebaseTarget;
  sourceCommit: string;
  expectedBackupSha256: string;
  expectedCohortSha256: string;
  actor: string;
  applyCore: boolean;
  proof: ProductionCoreProof;
  /** Internal deterministic testing only; the operator CLI exposes no clock. */
  now?: string;
}
export interface ProductionCoreActivationResult {
  status: 'applied' | 'already_applied';
  markerId: string;
  affiliateCount: number;
  approvedCount: number;
  membershipChanges: number;
  reservationsCreated: number;
  auditCount: number;
}

function stateDigest(payloads: ReadonlyMap<string, BackupDatasetPayload>): string {
  // The separate production marker is intentionally not a schema-8 dataset.
  return sha256Hex(canonicalJson(AFFILIATE_BACKUP_DATASETS.map(({ key }) => payloads.get(key))));
}
function assertBackup(input: ProductionCoreActivationInput, nowMs: number): void {
  const { backup, expectedTarget: target } = input;
  const manifest = backup?.manifest;
  if (!manifest || manifest.schemaVersion !== AFFILIATE_BACKUP_SCHEMA_VERSION
    || manifest.projectId !== target.projectId || manifest.databaseId !== target.databaseId
    || typeof input.expectedBackupSha256 !== 'string' || !HASH.test(input.expectedBackupSha256) || manifest.contentSha256 !== input.expectedBackupSha256
    || !Number.isFinite(iso(manifest.createdAt)) || iso(manifest.createdAt) > nowMs
    || nowMs - iso(manifest.createdAt) > RELEASE_BACKUP_MAX_AGE_MS
    || !(backup.payloads instanceof Map) || backup.payloads.size !== AFFILIATE_BACKUP_DATASETS.length
    || !Array.isArray(manifest.datasets) || manifest.datasets.length !== AFFILIATE_BACKUP_DATASETS.length) refuse('BACKUP');
  const { contentSha256: _hash, ...unsigned } = manifest;
  if (sha256Hex(canonicalJson(unsigned)) !== manifest.contentSha256) refuse('BACKUP_INTEGRITY');
  let total = 0;
  for (const definition of AFFILIATE_BACKUP_DATASETS) {
    const payload = backup.payloads.get(definition.key);
    const entries = manifest.datasets.filter(entry => entry.key === definition.key);
    const entry = entries[0];
    if (entries.length !== 1 || !payload || payload.schemaVersion !== AFFILIATE_BACKUP_SCHEMA_VERSION
      || payload.key !== definition.key || payload.collection !== definition.collection || payload.scope !== definition.scope
      || !Array.isArray(payload.documents) || payload.documents.length > PRODUCTION_CORE_DATASET_LIMIT
      || entry.collection !== definition.collection || entry.scope !== definition.scope || entry.fileName !== definition.fileName
      || entry.sha256 !== sha256Hex(prettyStableJson(payload))) refuse('BACKUP_INTEGRITY');
    const ids = new Set<string>();
    for (const document of payload.documents) {
      if (!validId(document?.id) || !record(document.data) || ids.has(document.id)) refuse('BACKUP_INTEGRITY');
      ids.add(document.id);
    }
    const summary = summarizeDatasetDocuments(payload.documents, definition);
    if (summary.count !== entry.count || canonicalJson(summary.sums) !== canonicalJson(entry.sums)) refuse('BACKUP_INTEGRITY');
    total += payload.documents.length;
  }
  if (total > PRODUCTION_CORE_TOTAL_READ_LIMIT) refuse('READ_LIMIT');
  const resources = literaryCircleResourceAssetIds(backup.payloads.get('affiliate_site_configs'));
  if (canonicalJson(resources) !== canonicalJson(backup.payloads.get('literary_circle_resource_assets')!.documents.map(item => item.id).sort())) refuse('ASSET_CLOSURE');
  validateFoundingAffiliateDocuments(backup.payloads.get('affiliates')!.documents, 9);
  if (input.expectedCohortSha256 !== PRODUCTION_CORE_COHORT_SHA256
    || foundingCohortDigest(backup) !== PRODUCTION_CORE_COHORT_SHA256) refuse('COHORT');
}
function assertAuthority(input: ProductionCoreActivationInput): void {
  const { expectedTarget: target, proof } = input;
  // The owner-OAuth maintenance client is constructed directly by the Google
  // SDK, not getDb(). Its concrete public binding is still authoritative; an
  // environment label is never a substitute for either SDK binding.
  const recorded = getFirestoreClientTarget(input.db);
  const actual = recorded ?? { projectId: input.db.projectId, firestoreDatabaseId: input.db.databaseId };
  if (target?.projectId !== PRODUCTION_CORE_PROJECT_ID || target?.databaseId !== '(default)'
    || actual?.projectId !== target.projectId || actual?.firestoreDatabaseId !== target.databaseId
    || process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST || process.env.FIREBASE_DATABASE_EMULATOR_HOST) refuse('TARGET');
  if (input.applyCore !== true || input.actor !== PRODUCTION_CORE_OWNER
    || !proof || proof.verifiedOwnerEmail !== PRODUCTION_CORE_OWNER) refuse('OWNER_APPROVAL');
  if (typeof input.sourceCommit !== 'string' || !COMMIT.test(input.sourceCommit) || proof.sourceCommit !== input.sourceCommit
    || proof.ciSourceCommit !== input.sourceCommit || proof.ciConclusion !== 'success'
    || proof.productionBuildSourceCommit !== input.sourceCommit || proof.productionBuildState !== 'READY'
    || proof.productionBuildTarget !== 'production' || typeof proof.productionDeploymentId !== 'string'
    || !/^dpl_[A-Za-z0-9]{8,100}$/.test(proof.productionDeploymentId)) refuse('RELEASE_PROOF');
}

async function readSnapshot(input: ProductionCoreActivationInput, transaction: Transaction): Promise<Map<string, BackupDatasetPayload>> {
  const result = new Map<string, BackupDatasetPayload>();
  let reads = 1; // Separate production marker, read by caller.
  for (const definition of AFFILIATE_BACKUP_DATASETS) {
    let documents: BackupDocument[];
    if (definition.scope === 'explicit_documents') {
      const ids = definition.key === 'literary_circle_resource_assets'
        ? literaryCircleResourceAssetIds(result.get('affiliate_site_configs')) : [...(definition.documentIds || [])];
      if (ids.length > PRODUCTION_CORE_DATASET_LIMIT || ids.some(id => !validId(id))) refuse('READ_LIMIT');
      reads += ids.length;
      if (reads > PRODUCTION_CORE_TOTAL_READ_LIMIT) refuse('READ_LIMIT');
      const refs = ids.map(id => input.db.collection(definition.collection).doc(id));
      const snapshots = refs.length ? await transaction.getAll(...refs) : [];
      const byPath = new Map(snapshots.map(snapshot => [snapshot.ref.path, snapshot]));
      if (byPath.size !== refs.length) refuse('INCOMPLETE_READ');
      documents = [];
      for (const ref of refs) {
        const snapshot = byPath.get(ref.path);
        if (!snapshot) refuse('INCOMPLETE_READ');
        if (snapshot.exists) documents.push({ id: ref.id, data: snapshot.data()! });
        else if (definition.key === 'literary_circle_resource_assets') refuse('ASSET_CLOSURE');
      }
    } else {
      const remaining = PRODUCTION_CORE_TOTAL_READ_LIMIT - reads;
      if (remaining <= 0) refuse('READ_LIMIT');
      const queryLimit = Math.min(PRODUCTION_CORE_DATASET_LIMIT + 1, remaining);
      const snapshot = await transaction.get(input.db.collection(definition.collection).limit(queryLimit));
      // A full capped page cannot prove completeness. Even if the last page
      // might be exact, refuse instead of accepting a truncated state snapshot.
      if (!Array.isArray(snapshot.docs) || snapshot.docs.length >= queryLimit
        || snapshot.size !== snapshot.docs.length) refuse('READ_LIMIT');
      reads += Math.max(1, snapshot.docs.length);
      if (reads > PRODUCTION_CORE_TOTAL_READ_LIMIT) refuse('READ_LIMIT');
      documents = snapshot.docs.map(document => ({ id: document.id, data: document.data() }));
      if (documents.some(document => !validId(document.id) || !record(document.data))
        || new Set(documents.map(document => document.id)).size !== documents.length) refuse('INCOMPLETE_READ');
      if (definition.scope === 'affiliate_attributed_only') documents = documents.filter(document => isAffiliateAttributedTransaction(document.data));
    }
    result.set(definition.key, buildDatasetPayload(definition, documents));
  }
  return result;
}

/** Return only missing leaves, never overwrite an explicitly stored value. */
function missingLeaves(existing: unknown, desired: unknown): unknown {
  if (existing === undefined) return desired;
  if (record(desired)) {
    if (!record(existing)) refuse('MEMBERSHIP_CONFLICT');
    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(desired)) {
      const nested = missingLeaves(existing[key], value);
      if (nested !== undefined) patch[key] = nested;
    }
    return Object.keys(patch).length ? patch : undefined;
  }
  if (canonicalJson(existing) !== canonicalJson(desired)) refuse('MEMBERSHIP_CONFLICT');
  return undefined;
}
function mergePatch(existing: Record<string, any>, patch: Record<string, any>): Record<string, any> {
  const next = { ...existing };
  for (const [key, value] of Object.entries(patch)) next[key] = record(value) && record(existing[key]) ? mergePatch(existing[key], value) : value;
  return next;
}
function replaceDataset(payloads: Map<string, BackupDatasetPayload>, key: string, documents: BackupDocument[]): void {
  payloads.set(key, buildDatasetPayload(AFFILIATE_BACKUP_DATASETS.find(definition => definition.key === key)!, documents));
}

/** Deliberately distinct from staging migration and the always-blocked review
 * planner. One guarded transaction; no provider, notifications, cache, sales,
 * customer, commission, payout, consent or policy-activation operation. */
export async function activateLiteraryCircleProductionCore(input: ProductionCoreActivationInput): Promise<ProductionCoreActivationResult> {
  try {
    assertAuthority(input);
    const now = input.now ?? new Date().toISOString();
    const nowMs = iso(now);
    if (!Number.isFinite(nowMs)) refuse('CLOCK');
    assertBackup(input, nowMs);
    const assertStillFresh = () => {
      const current = input.now === undefined ? Date.now() : nowMs;
      const captured = iso(input.backup.manifest.createdAt);
      if (captured > current || current - captured > RELEASE_BACKUP_MAX_AGE_MS) refuse('BACKUP_EXPIRED');
    };
    const markerRef = input.db.collection('migration_markers').doc(PRODUCTION_CORE_MARKER_ID);
    return await input.db.runTransaction(async transaction => {
      // Snapshot queries include inserts/removals, not just previously known IDs.
      const markerSnapshot = await transaction.get(markerRef);
      const payloads = await readSnapshot(input, transaction);
      assertStillFresh();
      const beforeSha256 = stateDigest(payloads);
      if (markerSnapshot.exists) {
        const marker = markerSnapshot.data()!;
        const allowed = ['schemaVersion', 'kind', 'status', 'projectId', 'databaseId', 'sourceCommit', 'foundingCohortSha256',
          'backupManifestSha256', 'actor', 'appliedAt', 'beforeStateSha256', 'afterStateSha256', 'proofSha256', 'counts'];
        const counts = marker.counts;
        if (Object.keys(marker).length !== allowed.length || Object.keys(marker).some(key => !allowed.includes(key)) || marker.schemaVersion !== 1
          || marker.kind !== PRODUCTION_CORE_MARKER_ID || marker.status !== 'complete'
          || marker.projectId !== input.expectedTarget.projectId || marker.databaseId !== '(default)'
          || marker.sourceCommit !== input.sourceCommit || marker.foundingCohortSha256 !== PRODUCTION_CORE_COHORT_SHA256
          || marker.actor !== PRODUCTION_CORE_OWNER || !Number.isFinite(iso(marker.appliedAt)) || iso(marker.appliedAt) > nowMs
          || typeof marker.backupManifestSha256 !== 'string' || !HASH.test(marker.backupManifestSha256)
          || typeof marker.beforeStateSha256 !== 'string' || !HASH.test(marker.beforeStateSha256)
          || marker.proofSha256 !== sha256Hex(canonicalJson(input.proof))
          || marker.afterStateSha256 !== beforeSha256 || !record(counts) || Object.keys(counts).length !== 5
          || counts.affiliateCount !== 9 || counts.auditCount !== 10
          || !Number.isSafeInteger(counts.approvedCount) || counts.approvedCount < 0 || counts.approvedCount > 9
          || !Number.isSafeInteger(counts.membershipChanges) || counts.membershipChanges < 0 || counts.membershipChanges > 9
          || !Number.isSafeInteger(counts.reservationsCreated) || counts.reservationsCreated < 0 || counts.reservationsCreated > 18) refuse('MARKER_DRIFT');
        // A repeat can use either the original pinned pre-apply backup or a
        // fresh exact post-apply backup. Neither permits repairing later drift.
        if (marker.backupManifestSha256 !== input.expectedBackupSha256
          && stateDigest(input.backup.payloads) !== beforeSha256) refuse('BACKUP_DRIFT');
        if (marker.backupManifestSha256 === input.expectedBackupSha256
          && stateDigest(input.backup.payloads) !== marker.beforeStateSha256) refuse('BACKUP_DRIFT');
        return { status: 'already_applied', markerId: PRODUCTION_CORE_MARKER_ID, affiliateCount: 9,
          approvedCount: 0, membershipChanges: 0, reservationsCreated: 0, auditCount: 0 };
      }
      if (beforeSha256 !== stateDigest(input.backup.payloads)) refuse('LIVE_DRIFT');
      const accounts = validateFoundingAffiliateDocuments(payloads.get('affiliates')!.documents, 9);
      const configDocuments = payloads.get('affiliate_site_configs')!.documents;
      const oldConfig = configDocuments.find(document => document.id === 'affiliate_literary_circle')?.data;
      if (oldConfig && (oldConfig.schemaVersion !== 1 || typeof oldConfig.enabled !== 'boolean'
        || !record(oldConfig.commissionPolicy) || !['draft', 'active'].includes(oldConfig.commissionPolicy.status))) refuse('POLICY_CONFLICT');
      const newConfig = oldConfig ? { ...oldConfig, enabled: true }
        : { ...structuredClone(DEFAULT_LITERARY_CIRCLE_SETTINGS), enabled: true, updatedAt: now, updatedBy: input.actor };
      const settings = normalizeLiteraryCircleSettings(newConfig);
      const auditDocuments = [...payloads.get('affiliate_audit')!.documents];
      const audits = new Map(auditDocuments.map(document => [document.id, document]));
      const codeDocuments = [...payloads.get('affiliate_codes')!.documents];
      const emailDocuments = [...payloads.get('affiliate_emails')!.documents];
      const writes: Array<() => void> = [];
      const nextAccounts: BackupDocument[] = [];
      let approvedCount = 0, membershipChanges = 0, reservationsCreated = 0;
      const audit = (suffix: string, targetType: string, targetId: string, changes: Record<string, unknown>) => {
        const id = `aud_lc_core_${sha256Hex(`${input.sourceCommit}\0${input.expectedBackupSha256}\0${suffix}`).slice(0, 48)}`;
        if (audits.has(id)) refuse('AUDIT_COLLISION');
        const data = { id, timestamp: now, actor: input.actor, action: 'literary_circle_production_core_activated',
          targetType, targetId, summary: 'Owner-authorized founding Literary Circle core activation; financial history and consent preserved.', newValue: changes };
        const document = { id, data };
        audits.set(id, document); auditDocuments.push(document);
        writes.push(() => transaction.create(input.db.collection('affiliate_audit').doc(id), data));
      };
      for (const item of accounts) {
        const account = item.affiliate as unknown as Record<string, any>;
        const desired = mergeFoundingMembership(account.literaryCircle,
          createLiteraryCircleMembership({ now, settings, foundingMember: true, audience: 'existing_upgrade', actor: input.actor }), now);
        const membership = missingLeaves(account.literaryCircle, desired);
        const patch: Record<string, any> = {};
        if (membership !== undefined) { patch.literaryCircle = membership; membershipChanges++; }
        let approved = false;
        if (account.status === 'active') {
          if (account.approvedAt !== undefined && !Number.isFinite(iso(account.approvedAt))
            || account.approvedBy !== undefined && (typeof account.approvedBy !== 'string' || !account.approvedBy.trim())) refuse('APPROVAL_CONFLICT');
          if (account.approvedAt === undefined) patch.approvedAt = now;
          if (account.approvedBy === undefined) patch.approvedBy = input.actor;
          approved = patch.approvedAt !== undefined || patch.approvedBy !== undefined;
          if (approved) approvedCount++;
        }
        if (Object.keys(patch).length) writes.push(() => transaction.set(input.db.collection('affiliates').doc(item.documentId), patch, { merge: true }));
        nextAccounts.push({ id: item.documentId, data: mergePatch(account, patch) });
        let reservationChanges = 0;
        for (const [key, documents, id, fields] of [
          ['affiliate_codes', codeDocuments, item.codeIndexId, { affiliateCode: item.codeIndexId }],
          ['affiliate_emails', emailDocuments, item.emailIndexId, { emailHash: item.emailIndexId }],
        ] as const) {
          const existing = documents.find(document => document.id === id);
          const plan = planIndexReservation({ existing: existing?.data, affiliateId: item.documentId,
            expectedFields: { affiliateId: item.documentId, ...fields, reservedAt: account.createdAt || now } });
          if (plan.action === 'conflict') refuse('RESERVATION_COLLISION');
          if (plan.action !== 'unchanged') {
            if (!validId(id)) refuse('RESERVATION_COLLISION');
            writes.push(() => transaction.set(input.db.collection(key).doc(id), plan.patch, { merge: true }));
            if (existing) existing.data = { ...existing.data, ...plan.patch };
            else documents.push({ id, data: plan.patch });
            reservationsCreated++; reservationChanges++;
          }
        }
        audit(`account:${item.documentId}`, 'affiliate', item.documentId, {
          membershipDefaultsAdded: membership !== undefined, ownerApprovalRecorded: approved,
          accountStatusPreserved: account.status, reservationChanges, foundingRecognition: true,
        });
      }
      const configChanged = !oldConfig || oldConfig.enabled !== true;
      if (configChanged) writes.push(() => oldConfig
        ? transaction.set(input.db.collection('site_configs').doc('affiliate_literary_circle'), { enabled: true }, { merge: true })
        : transaction.create(input.db.collection('site_configs').doc('affiliate_literary_circle'), newConfig));
      audit('programme', 'settings', 'affiliate_literary_circle', { programmeEnabled: true, configurationCreated: !oldConfig,
        commissionPolicyPreserved: Boolean(oldConfig), newPolicyStatus: oldConfig ? 'unchanged' : 'draft', notificationsActivated: false });
      replaceDataset(payloads, 'affiliates', nextAccounts);
      replaceDataset(payloads, 'affiliate_codes', codeDocuments);
      replaceDataset(payloads, 'affiliate_emails', emailDocuments);
      replaceDataset(payloads, 'affiliate_audit', auditDocuments);
      replaceDataset(payloads, 'affiliate_site_configs', [
        ...configDocuments.filter(document => document.id !== 'affiliate_literary_circle'), { id: 'affiliate_literary_circle', data: newConfig },
      ]);
      const counts = { affiliateCount: 9, approvedCount, membershipChanges, reservationsCreated, auditCount: 10 };
      const marker = { schemaVersion: 1, kind: PRODUCTION_CORE_MARKER_ID, status: 'complete',
        projectId: input.expectedTarget.projectId, databaseId: '(default)', sourceCommit: input.sourceCommit,
        foundingCohortSha256: PRODUCTION_CORE_COHORT_SHA256, backupManifestSha256: input.expectedBackupSha256,
        actor: input.actor, appliedAt: now, beforeStateSha256: beforeSha256, afterStateSha256: stateDigest(payloads),
        proofSha256: sha256Hex(canonicalJson(input.proof)), counts };
      // Every read, validation and planned collision check finishes before the
      // first queued write. A provider commit failure rolls back all of them.
      assertStillFresh();
      for (const write of writes) write();
      transaction.create(markerRef, marker);
      return { status: 'applied', markerId: PRODUCTION_CORE_MARKER_ID, ...counts };
    }, { maxAttempts: 3 });
  } catch (error) {
    if (error instanceof LiteraryCircleProductionCoreError) throw error;
    // No identifiers, raw SDK errors, profile/credential values or causes.
    throw new LiteraryCircleProductionCoreError('UNAVAILABLE');
  }
}
