import type { DocumentReference, DocumentSnapshot } from 'firebase-admin/firestore';
import type { AffiliateAccount } from '../src/types.js';
import { getDb, sanitizeForFirestore } from '../src/server/db.js';
import {
  LITERARY_CIRCLE_SETTINGS_DOCUMENT_ID,
  createLiteraryCircleMembership,
  normalizeLiteraryCircleSettings
} from '../src/server/literaryCircle.js';
import {
  FOUNDING_AFFILIATE_COUNT,
  LITERARY_CIRCLE_MIGRATION_ID,
  affiliateCodeIndexId,
  affiliateEmailIndexId,
  assertLiveStateMatchesBackup,
  assertStagingTarget,
  canonicalJson,
  captureAffiliateDatasets,
  configuredFirebaseTarget,
  encodeFirestoreValue,
  mergeFoundingMembership,
  migrationMarkerDocumentId,
  planIndexReservation,
  sha256Hex,
  validateFoundingAffiliateDocuments,
  verifyAffiliateBackup,
  type BackupDatasetPayload,
  type BackupDocument,
  type VerifiedAffiliateBackup
} from './literary-circle-migration-lib.js';

type MigrationMode = 'dry-run' | 'apply';

interface CliOptions {
  mode: MigrationMode;
  environment?: string;
  expectedProject?: string;
  expectedAffiliates: number;
  backupPath?: string;
}

interface PlanCounts {
  membershipsCreate: number;
  membershipsUpdate: number;
  membershipsUnchanged: number;
  codeIndexesCreate: number;
  codeIndexesBackfill: number;
  codeIndexesUnchanged: number;
  emailIndexesCreate: number;
  emailIndexesBackfill: number;
  emailIndexesUnchanged: number;
  conflicts: number;
}

function argumentValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length);
}

function parseOptions(): CliOptions {
  const expectedAffiliates = Number(argumentValue('expected-affiliates'));
  if (expectedAffiliates !== FOUNDING_AFFILIATE_COUNT) {
    throw new Error(`This migration requires --expected-affiliates=${FOUNDING_AFFILIATE_COUNT}.`);
  }
  const mode: MigrationMode = process.argv.includes('--apply') ? 'apply' : 'dry-run';
  const backupPath = argumentValue('backup')?.trim();
  if (mode === 'apply' && !backupPath) {
    throw new Error('--apply requires --backup=<data/backups/.../manifest.json>.');
  }
  return {
    mode,
    environment: argumentValue('environment') || process.env.LITERARY_CIRCLE_ENV,
    expectedProject: argumentValue('expected-project'),
    expectedAffiliates,
    ...(backupPath ? { backupPath } : {})
  };
}

function payloadDocumentMap(payload: BackupDatasetPayload | undefined): Map<string, BackupDocument> {
  return new Map((payload?.documents || []).map(document => [document.id, document]));
}

function emptyPlan(): PlanCounts {
  return {
    membershipsCreate: 0,
    membershipsUpdate: 0,
    membershipsUnchanged: 0,
    codeIndexesCreate: 0,
    codeIndexesBackfill: 0,
    codeIndexesUnchanged: 0,
    emailIndexesCreate: 0,
    emailIndexesBackfill: 0,
    emailIndexesUnchanged: 0,
    conflicts: 0
  };
}

function incrementIndexPlan(plan: PlanCounts, kind: 'code' | 'email', action: string): void {
  if (action === 'conflict') {
    plan.conflicts += 1;
    return;
  }
  const key = `${kind}Indexes${action[0].toUpperCase()}${action.slice(1)}` as keyof PlanCounts;
  plan[key] += 1;
}

function buildDryRunPlan(options: {
  affiliates: ReturnType<typeof validateFoundingAffiliateDocuments>;
  payloads: ReadonlyMap<string, BackupDatasetPayload>;
  seededAt: string;
  settings: ReturnType<typeof normalizeLiteraryCircleSettings>;
}): PlanCounts {
  const plan = emptyPlan();
  const codeIndexes = payloadDocumentMap(options.payloads.get('affiliate_codes'));
  const emailIndexes = payloadDocumentMap(options.payloads.get('affiliate_emails'));
  for (const item of options.affiliates) {
    const seeded = createLiteraryCircleMembership({
      now: options.seededAt,
      settings: options.settings,
      foundingMember: true,
      audience: 'existing_upgrade',
      actor: LITERARY_CIRCLE_MIGRATION_ID
    });
    const existingMembership = item.affiliate.literaryCircle;
    const merged = mergeFoundingMembership(existingMembership, seeded, options.seededAt);
    if (!existingMembership) plan.membershipsCreate += 1;
    else if (canonicalJson(encodeFirestoreValue(existingMembership)) !== canonicalJson(encodeFirestoreValue(merged))) {
      plan.membershipsUpdate += 1;
    } else plan.membershipsUnchanged += 1;

    const reservedAt = item.affiliate.createdAt || options.seededAt;
    const codePlan = planIndexReservation({
      existing: codeIndexes.get(item.codeIndexId)?.data,
      affiliateId: item.documentId,
      expectedFields: {
        affiliateId: item.documentId,
        affiliateCode: item.codeIndexId,
        reservedAt
      }
    });
    incrementIndexPlan(plan, 'code', codePlan.action);

    const emailPlan = planIndexReservation({
      existing: emailIndexes.get(item.emailIndexId)?.data,
      affiliateId: item.documentId,
      expectedFields: {
        affiliateId: item.documentId,
        emailHash: item.emailIndexId,
        reservedAt
      }
    });
    incrementIndexPlan(plan, 'email', emailPlan.action);
  }
  return plan;
}

function snapshotMap(snapshots: readonly DocumentSnapshot[]): Map<string, DocumentSnapshot> {
  return new Map(snapshots.map(snapshot => [snapshot.ref.path, snapshot]));
}

async function applyMigration(options: {
  affiliateDocuments: ReturnType<typeof validateFoundingAffiliateDocuments>;
  settings: ReturnType<typeof normalizeLiteraryCircleSettings>;
  verifiedBackup: VerifiedAffiliateBackup;
  appliedAt: string;
}): Promise<PlanCounts & { markerWritten: boolean; alreadyComplete: boolean }> {
  const db = getDb();
  const markerRef = db.collection('migration_markers').doc(migrationMarkerDocumentId());
  const affiliateRefs = options.affiliateDocuments.map(item => db.collection('affiliates').doc(item.documentId));
  const codeRefs = options.affiliateDocuments.map(item => db.collection('affiliate_codes').doc(item.codeIndexId));
  const emailRefs = options.affiliateDocuments.map(item => db.collection('affiliate_emails').doc(item.emailIndexId));

  return db.runTransaction(async transaction => {
    const allReferences: DocumentReference[] = [markerRef, ...affiliateRefs, ...codeRefs, ...emailRefs];
    const snapshots = await transaction.getAll(...allReferences);
    const byPath = snapshotMap(snapshots);
    const markerSnapshot = byPath.get(markerRef.path);
    const marker = markerSnapshot?.exists ? markerSnapshot.data() as Record<string, unknown> : undefined;
    const plan = emptyPlan();
    const writes: Array<() => void> = [];

    for (const [index, expected] of options.affiliateDocuments.entries()) {
      const affiliateSnapshot = byPath.get(affiliateRefs[index].path);
      if (!affiliateSnapshot?.exists) throw new Error('A founding affiliate disappeared during migration.');
      const affiliate = affiliateSnapshot.data() as AffiliateAccount;
      if (
        (affiliate.id && affiliate.id !== expected.documentId)
        || affiliateCodeIndexId(affiliate.affiliateCode || '') !== expected.codeIndexId
        || affiliateEmailIndexId(affiliate.email || '') !== expected.emailIndexId
      ) {
        throw new Error('A founding affiliate identity changed during migration; no writes were applied.');
      }

      const seeded = createLiteraryCircleMembership({
        now: options.appliedAt,
        settings: options.settings,
        foundingMember: true,
        audience: 'existing_upgrade',
        actor: LITERARY_CIRCLE_MIGRATION_ID
      });
      const merged = mergeFoundingMembership(affiliate.literaryCircle, seeded, options.appliedAt);
      if (!affiliate.literaryCircle) plan.membershipsCreate += 1;
      else if (canonicalJson(encodeFirestoreValue(affiliate.literaryCircle)) !== canonicalJson(encodeFirestoreValue(merged))) {
        plan.membershipsUpdate += 1;
      } else plan.membershipsUnchanged += 1;
      if (!affiliate.literaryCircle || canonicalJson(encodeFirestoreValue(affiliate.literaryCircle)) !== canonicalJson(encodeFirestoreValue(merged))) {
        writes.push(() => transaction.set(affiliateRefs[index], sanitizeForFirestore({ literaryCircle: merged }), { merge: true }));
      }

      const reservedAt = affiliate.createdAt || options.appliedAt;
      const codeSnapshot = byPath.get(codeRefs[index].path);
      const codePlan = planIndexReservation({
        existing: codeSnapshot?.exists ? codeSnapshot.data() as Record<string, unknown> : undefined,
        affiliateId: expected.documentId,
        expectedFields: { affiliateId: expected.documentId, affiliateCode: expected.codeIndexId, reservedAt }
      });
      incrementIndexPlan(plan, 'code', codePlan.action);
      if (codePlan.action === 'conflict') throw new Error('Affiliate referral-code index ownership conflict; no writes were applied.');
      if (codePlan.action === 'create' || codePlan.action === 'backfill') {
        writes.push(() => transaction.set(codeRefs[index], sanitizeForFirestore(codePlan.patch), { merge: true }));
      }

      const emailSnapshot = byPath.get(emailRefs[index].path);
      const emailPlan = planIndexReservation({
        existing: emailSnapshot?.exists ? emailSnapshot.data() as Record<string, unknown> : undefined,
        affiliateId: expected.documentId,
        expectedFields: { affiliateId: expected.documentId, emailHash: expected.emailIndexId, reservedAt }
      });
      incrementIndexPlan(plan, 'email', emailPlan.action);
      if (emailPlan.action === 'conflict') throw new Error('Affiliate email index ownership conflict; no writes were applied.');
      if (emailPlan.action === 'create' || emailPlan.action === 'backfill') {
        writes.push(() => transaction.set(emailRefs[index], sanitizeForFirestore(emailPlan.patch), { merge: true }));
      }
    }

    const completedAffiliateIds = options.affiliateDocuments.map(item => item.documentId).sort();
    const markerAlreadyComplete = marker?.status === 'complete'
      && marker.backupManifestSha256 === options.verifiedBackup.manifest.contentSha256
      && marker.expectedAffiliateCount === options.affiliateDocuments.length
      && canonicalJson(marker.completedAffiliateIds) === canonicalJson(completedAffiliateIds);
    const alreadyComplete = writes.length === 0 && markerAlreadyComplete;
    if (!alreadyComplete) {
      const priorAttempts = typeof marker?.attemptCount === 'number' ? marker.attemptCount : 0;
      writes.push(() => transaction.set(markerRef, sanitizeForFirestore({
        schemaVersion: 1,
        migrationId: LITERARY_CIRCLE_MIGRATION_ID,
        status: 'complete',
        expectedAffiliateCount: options.affiliateDocuments.length,
        completedAffiliateIds,
        completedCount: completedAffiliateIds.length,
        backupId: options.verifiedBackup.manifest.backupId,
        backupManifestSha256: options.verifiedBackup.manifest.contentSha256,
        startedAt: typeof marker?.startedAt === 'string' ? marker.startedAt : options.appliedAt,
        completedAt: options.appliedAt,
        lastAppliedAt: options.appliedAt,
        attemptCount: priorAttempts + 1
      }), { merge: true }));
    }
    for (const write of writes) write();
    return { ...plan, markerWritten: !alreadyComplete, alreadyComplete };
  });
}

async function verifyAppliedState(affiliateDocuments: ReturnType<typeof validateFoundingAffiliateDocuments>): Promise<void> {
  const db = getDb();
  const references: DocumentReference[] = [];
  for (const item of affiliateDocuments) {
    references.push(
      db.collection('affiliates').doc(item.documentId),
      db.collection('affiliate_codes').doc(item.codeIndexId),
      db.collection('affiliate_emails').doc(item.emailIndexId)
    );
  }
  const snapshots = await db.getAll(...references);
  const byPath = snapshotMap(snapshots);
  for (const item of affiliateDocuments) {
    const affiliate = byPath.get(db.collection('affiliates').doc(item.documentId).path)?.data() as AffiliateAccount | undefined;
    const codeOwner = byPath.get(db.collection('affiliate_codes').doc(item.codeIndexId).path)?.data()?.affiliateId;
    const emailOwner = byPath.get(db.collection('affiliate_emails').doc(item.emailIndexId).path)?.data()?.affiliateId;
    if (!affiliate?.literaryCircle?.foundingMember || codeOwner !== item.documentId || emailOwner !== item.documentId) {
      throw new Error('Post-migration verification failed.');
    }
  }
}

async function main(): Promise<void> {
  const cli = parseOptions();
  const target = configuredFirebaseTarget();
  assertStagingTarget({ environment: cli.environment, expectedProject: cli.expectedProject, target });

  const livePayloads = await captureAffiliateDatasets();
  const affiliatePayload = livePayloads.get('affiliates');
  if (!affiliatePayload) throw new Error('Affiliate dataset is unavailable.');
  const affiliateDocuments = validateFoundingAffiliateDocuments(affiliatePayload.documents, cli.expectedAffiliates);

  let verifiedBackup: VerifiedAffiliateBackup | undefined;
  if (cli.backupPath) {
    verifiedBackup = verifyAffiliateBackup(cli.backupPath, { target, expectedAffiliates: cli.expectedAffiliates });
    assertLiveStateMatchesBackup(verifiedBackup, livePayloads);
  }
  if (cli.mode === 'apply' && !verifiedBackup) throw new Error('A verified backup is required for apply.');

  const settingsSnapshot = await getDb()
    .collection('site_configs')
    .doc(LITERARY_CIRCLE_SETTINGS_DOCUMENT_ID)
    .get();
  const settings = normalizeLiteraryCircleSettings(settingsSnapshot.exists ? settingsSnapshot.data() : undefined);
  const migrationTime = new Date().toISOString();
  const plan = buildDryRunPlan({ affiliates: affiliateDocuments, payloads: livePayloads, seededAt: migrationTime, settings });
  const markerSnapshot = await getDb().collection('migration_markers').doc(migrationMarkerDocumentId()).get();

  const baseReport = {
    migrationId: LITERARY_CIRCLE_MIGRATION_ID,
    mode: cli.mode,
    affiliateCount: affiliateDocuments.length,
    backupVerified: Boolean(verifiedBackup),
    backupManifestSha256: verifiedBackup?.manifest.contentSha256,
    markerStatus: markerSnapshot.exists ? markerSnapshot.data()?.status || 'present' : 'absent',
    plan
  };
  if (cli.mode === 'dry-run') {
    console.log(JSON.stringify(baseReport, null, 2));
    if (plan.conflicts) throw new Error('Dry-run found affiliate index ownership conflicts.');
    return;
  }
  if (plan.conflicts) throw new Error('Apply refused because index ownership conflicts exist.');

  const result = await applyMigration({
    affiliateDocuments,
    settings,
    verifiedBackup: verifiedBackup as VerifiedAffiliateBackup,
    appliedAt: migrationTime
  });
  await verifyAppliedState(affiliateDocuments);
  const postMigrationPayloads = await captureAffiliateDatasets();
  assertLiveStateMatchesBackup(verifiedBackup as VerifiedAffiliateBackup, postMigrationPayloads);
  console.log(JSON.stringify({
    ...baseReport,
    status: result.alreadyComplete ? 'already_complete' : 'complete',
    markerWritten: result.markerWritten,
    preservedBackupStateVerified: true,
    applied: result,
    affiliateIdentitySetSha256: sha256Hex(canonicalJson(affiliateDocuments.map(item => item.documentId).sort()))
  }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Literary Circle migration failed.');
  process.exitCode = 1;
});
