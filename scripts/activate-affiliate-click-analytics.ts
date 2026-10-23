import path from 'path';
import { pathToFileURL } from 'url';
import type {
  DocumentReference,
  DocumentSnapshot,
  Firestore,
  Transaction,
} from 'firebase-admin/firestore';
import { getDb } from '../src/server/db.js';
import {
  captureAffiliateDatasets,
  configuredFirebaseTarget,
  migrationMarkerDocumentId,
  verifyAffiliateBackup,
  type BackupDatasetPayload,
  type BackupDocument,
  type FirebaseTarget,
  type VerifiedAffiliateBackup,
} from './literary-circle-migration-lib.js';
import {
  AFFILIATE_CLICK_ACTIVATION_MARKER_COLLECTION,
  AFFILIATE_CLICK_ACTIVATION_MARKER_DOCUMENT_ID,
  AffiliateClickActivationSafeError,
  assertAffiliateClickActivationMarkerAbsentForApply,
  assertAffiliateClickActivationProofBackedUp,
  assertAffiliateClickActivationRuntime,
  assertAffiliateClickActivationStagingTarget,
  assertAuthoritativeFirestoreClock,
  assertExactAffiliateClickActivationLiveState,
  assertFoundingAffiliateMigrationReconciled,
  assertFreshAffiliateClickActivationBackup,
  assertImmutableAffiliateClickActivationMarker,
  assertRecentAffiliateClickActivationProofEvent,
  buildAffiliateClickActivationMarker,
  buildRedactedAffiliateClickActivationReport,
  parseAffiliateClickActivationArgs,
  safeAffiliateClickActivationFailure,
  type AffiliateClickActivationCliOptions,
  type AffiliateClickActivationClockEvidence,
  type AffiliateClickActivationFoundingEvidence,
  type AffiliateClickActivationLiveStateEvidence,
  type AffiliateClickActivationProofEvidence,
  type AffiliateClickActivationRedactedReport,
} from './affiliate-click-activation-lib.js';

interface ActivationDependencies {
  env: NodeJS.ProcessEnv;
  now: () => Date;
  configuredTarget: () => FirebaseTarget;
  getFirestore: () => Firestore;
  verifyBackup: typeof verifyAffiliateBackup;
  captureDatasets: (db: Firestore) => Promise<Map<string, BackupDatasetPayload>>;
}

const defaultDependencies: ActivationDependencies = {
  env: process.env,
  now: () => new Date(),
  configuredTarget: () => configuredFirebaseTarget(),
  getFirestore: () => getDb(),
  verifyBackup: verifyAffiliateBackup,
  captureDatasets: db => captureAffiliateDatasets(db),
};

interface GateReferences {
  marker: DocumentReference;
  proof: DocumentReference;
  migration: DocumentReference;
  affiliates: DocumentReference[];
}

interface GateSnapshots {
  marker: DocumentSnapshot;
  proof: DocumentSnapshot;
  migration: DocumentSnapshot;
  affiliates: DocumentSnapshot[];
}

interface ValidatedGate {
  marker: ReturnType<typeof buildAffiliateClickActivationMarker>;
  clock: AffiliateClickActivationClockEvidence;
  proof: AffiliateClickActivationProofEvidence;
  founding: AffiliateClickActivationFoundingEvidence;
}

function preserveSafeError(
  error: unknown,
  kind: ConstructorParameters<typeof AffiliateClickActivationSafeError>[0],
  code: string,
  message: string,
): never {
  if (error instanceof AffiliateClickActivationSafeError) throw error;
  throw new AffiliateClickActivationSafeError(kind, code, message);
}

function safely<T>(
  kind: ConstructorParameters<typeof AffiliateClickActivationSafeError>[0],
  code: string,
  message: string,
  operation: () => T,
): T {
  try {
    return operation();
  } catch (error) {
    return preserveSafeError(error, kind, code, message);
  }
}

async function safelyAsync<T>(
  kind: ConstructorParameters<typeof AffiliateClickActivationSafeError>[0],
  code: string,
  message: string,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    return preserveSafeError(error, kind, code, message);
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  return code === 6 || code === '6' || code === 'already-exists' || code === 'ALREADY_EXISTS';
}

function requiredPayload(
  payloads: ReadonlyMap<string, BackupDatasetPayload>,
  key: string,
): BackupDatasetPayload {
  const payload = payloads.get(key);
  if (!payload) {
    throw new AffiliateClickActivationSafeError(
      'backup',
      'required_dataset_missing',
      'A required verified staging dataset is unavailable.',
    );
  }
  return payload;
}

function affiliateIdentities(documents: readonly BackupDocument[]): Array<{ id: string; code: unknown }> {
  return documents.map(document => ({ id: document.id, code: document.data.affiliateCode }));
}

function gateReferences(
  db: Firestore,
  cli: AffiliateClickActivationCliOptions,
  affiliateDocuments: readonly BackupDocument[],
): GateReferences {
  return {
    marker: db
      .collection(AFFILIATE_CLICK_ACTIVATION_MARKER_COLLECTION)
      .doc(AFFILIATE_CLICK_ACTIVATION_MARKER_DOCUMENT_ID),
    proof: db.collection('affiliate_clicks').doc(cli.proofEventId),
    migration: db.collection('migration_markers').doc(migrationMarkerDocumentId()),
    affiliates: affiliateDocuments.map(document => db.collection('affiliates').doc(document.id)),
  };
}

function snapshotsByPath(snapshots: readonly DocumentSnapshot[]): Map<string, DocumentSnapshot> {
  return new Map(snapshots.map(snapshot => [snapshot.ref.path, snapshot]));
}

function mapGateSnapshots(
  references: GateReferences,
  snapshots: readonly DocumentSnapshot[],
): GateSnapshots {
  const byPath = snapshotsByPath(snapshots);
  const marker = byPath.get(references.marker.path);
  const proof = byPath.get(references.proof.path);
  const migration = byPath.get(references.migration.path);
  const affiliates = references.affiliates.map(reference => byPath.get(reference.path));
  if (!marker || !proof || !migration || affiliates.some(snapshot => !snapshot)) {
    throw new AffiliateClickActivationSafeError(
      'firestore',
      'incomplete_firestore_snapshot',
      'The staging activation snapshot was incomplete.',
    );
  }
  return {
    marker,
    proof,
    migration,
    affiliates: affiliates as DocumentSnapshot[],
  };
}

async function readGateSnapshots(
  db: Firestore,
  references: GateReferences,
): Promise<GateSnapshots> {
  const snapshots = await db.getAll(
    references.marker,
    references.proof,
    references.migration,
    ...references.affiliates,
  );
  return mapGateSnapshots(references, snapshots);
}

async function readGateSnapshotsInTransaction(
  transaction: Transaction,
  references: GateReferences,
): Promise<GateSnapshots> {
  const snapshots = await transaction.getAll(
    references.marker,
    references.proof,
    references.migration,
    ...references.affiliates,
  );
  return mapGateSnapshots(references, snapshots);
}

function snapshotDocuments(snapshots: readonly DocumentSnapshot[]): BackupDocument[] {
  return snapshots.map(snapshot => {
    if (!snapshot.exists) {
      throw new AffiliateClickActivationSafeError(
        'backup',
        'founding_affiliate_disappeared',
        'A founding affiliate disappeared during the activation check.',
      );
    }
    return { id: snapshot.id, data: snapshot.data() as Record<string, unknown> };
  });
}

function validateGate(input: {
  cli: AffiliateClickActivationCliOptions;
  snapshots: GateSnapshots;
  backup: VerifiedAffiliateBackup;
  backupAffiliates: readonly BackupDocument[];
  keyFingerprint: string;
  localNow: Date;
}): ValidatedGate {
  assertAffiliateClickActivationMarkerAbsentForApply(input.snapshots.marker.exists);
  const clock = assertAuthoritativeFirestoreClock({
    firestoreSnapshot: input.snapshots.marker,
    localNow: input.localNow,
  });
  assertFreshAffiliateClickActivationBackup({
    manifest: input.backup.manifest,
    authoritativeSnapshot: input.snapshots.marker,
    expectedProject: input.cli.expectedProject,
    expectedDatabase: input.cli.expectedDatabase,
    expectedAffiliates: input.cli.expectedAffiliates,
  });

  const liveAffiliates = snapshotDocuments(input.snapshots.affiliates);
  const founding = assertFoundingAffiliateMigrationReconciled({
    migrationMarker: input.snapshots.migration.exists
      ? input.snapshots.migration.data()
      : undefined,
    backupAffiliates: input.backupAffiliates,
    liveAffiliates,
  });

  if (!input.snapshots.proof.exists) {
    throw new AffiliateClickActivationSafeError(
      'precondition',
      'missing_proof_event',
      'The controlled durable-click proof event does not exist.',
    );
  }
  const proofValue = input.snapshots.proof.data();
  const proof = assertRecentAffiliateClickActivationProofEvent({
    value: proofValue,
    documentId: input.snapshots.proof.id,
    expectedKeyFingerprint: input.keyFingerprint,
    expectedAffiliateIdentities: affiliateIdentities(liveAffiliates),
    firestoreSnapshot: input.snapshots.proof,
    createTime: input.snapshots.proof.createTime,
    updateTime: input.snapshots.proof.updateTime,
  });
  assertAffiliateClickActivationProofBackedUp({
    backupClickDocuments: requiredPayload(input.backup.payloads, 'affiliate_clicks').documents,
    documentId: input.snapshots.proof.id,
    value: proofValue,
  });

  return {
    marker: buildAffiliateClickActivationMarker({
      authoritativeSnapshot: input.snapshots.marker,
      leadMinutes: input.cli.leadMinutes,
      keyFingerprint: input.keyFingerprint,
    }),
    clock,
    proof,
    founding,
  };
}

function targetEvidence(cli: AffiliateClickActivationCliOptions, dependencies: ActivationDependencies) {
  const env = dependencies.env;
  const target = safely(
    'target',
    'target_resolution_failed',
    'The configured Firebase target could not be resolved safely.',
    dependencies.configuredTarget,
  );
  const rawServiceAccount = env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const evidence = assertAffiliateClickActivationStagingTarget({
    options: cli,
    resolvedProjectId: target.projectId,
    resolvedDatabaseId: target.databaseId,
    stagingProjectAllowlist: env.LITERARY_CIRCLE_STAGING_PROJECT_IDS,
    productionProjectIds: env.LITERARY_CIRCLE_PRODUCTION_PROJECT_IDS,
    serviceAccount: rawServiceAccount,
    credentialSource: typeof rawServiceAccount === 'string' && rawServiceAccount.trim()
      ? 'FIREBASE_SERVICE_ACCOUNT_JSON'
      : undefined,
    nodeEnv: env.NODE_ENV,
    vercelEnv: env.VERCEL_ENV,
    firestoreEmulatorHost: env.FIRESTORE_EMULATOR_HOST,
    firebaseDatabaseEmulatorHost: env.FIREBASE_DATABASE_EMULATOR_HOST,
    firebaseAuthEmulatorHost: env.FIREBASE_AUTH_EMULATOR_HOST,
  });
  return { target, evidence };
}

async function captureAndVerifyLiveState(
  dependencies: ActivationDependencies,
  db: Firestore,
  backup: VerifiedAffiliateBackup,
): Promise<{
  payloads: Map<string, BackupDatasetPayload>;
  evidence: AffiliateClickActivationLiveStateEvidence;
}> {
  const payloads = await safelyAsync(
    'firestore',
    'live_state_read_failed',
    'The staging affiliate state could not be read safely.',
    () => dependencies.captureDatasets(db),
  );
  const evidence = assertExactAffiliateClickActivationLiveState({
    verifiedBackup: backup,
    livePayloads: payloads,
  });
  return { payloads, evidence };
}

export async function executeAffiliateClickActivation(
  argv: readonly string[],
  dependencyOverrides: Partial<ActivationDependencies> = {},
): Promise<AffiliateClickActivationRedactedReport> {
  const dependencies: ActivationDependencies = { ...defaultDependencies, ...dependencyOverrides };
  const cli = parseAffiliateClickActivationArgs(argv);
  const { target: firebaseTarget, evidence: target } = targetEvidence(cli, dependencies);
  const runtime = assertAffiliateClickActivationRuntime({
    ledgerMode: dependencies.env.AFFILIATE_CLICK_LEDGER_MODE,
    analyticsSecret: dependencies.env.AFFILIATE_CLICK_ANALYTICS_SECRET,
    expectedKeyFingerprint: cli.expectedKeyFingerprint,
  });

  const backup = safely(
    'backup',
    'backup_verification_failed',
    'The staging backup could not be verified safely.',
    () => dependencies.verifyBackup(cli.backupPath, {
      target: firebaseTarget,
      expectedAffiliates: cli.expectedAffiliates,
    }),
  );
  const backupAffiliates = requiredPayload(backup.payloads, 'affiliates').documents;
  const db = safely(
    'firestore',
    'firestore_initialization_failed',
    'The staging Firestore client could not be initialized safely.',
    dependencies.getFirestore,
  );
  const references = gateReferences(db, cli, backupAffiliates);

  const initialSnapshots = await safelyAsync(
    'firestore',
    'activation_snapshot_read_failed',
    'The staging activation snapshot could not be read safely.',
    () => readGateSnapshots(db, references),
  );
  const initialGate = validateGate({
    cli,
    snapshots: initialSnapshots,
    backup,
    backupAffiliates,
    keyFingerprint: runtime.keyFingerprint,
    localNow: dependencies.now(),
  });
  // Keep the full equality scan immediately adjacent to the dry-run result or
  // create-only transaction. Apply repeats it after the irreversible write.
  const initialLive = await captureAndVerifyLiveState(dependencies, db, backup);

  if (cli.mode === 'dry-run') {
    return buildRedactedAffiliateClickActivationReport({
      mode: cli.mode,
      status: 'ready',
      target,
      backup: assertFreshAffiliateClickActivationBackup({
        manifest: backup.manifest,
        authoritativeSnapshot: initialSnapshots.marker,
        expectedProject: cli.expectedProject,
        expectedDatabase: cli.expectedDatabase,
        expectedAffiliates: cli.expectedAffiliates,
      }),
      liveState: initialLive.evidence,
      keyFingerprint: runtime.keyFingerprint,
      deploymentEvidence: cli.deploymentEvidence,
      proof: initialGate.proof,
      clock: initialGate.clock,
      founding: initialGate.founding,
      marker: initialGate.marker,
    });
  }

  let transactionGate: ValidatedGate;
  try {
    transactionGate = await db.runTransaction(async transaction => {
      const snapshots = await readGateSnapshotsInTransaction(transaction, references);
      const validated = validateGate({
        cli,
        snapshots,
        backup,
        backupAffiliates,
        keyFingerprint: runtime.keyFingerprint,
        localNow: dependencies.now(),
      });
      transaction.create(references.marker, validated.marker);
      return validated;
    });
  } catch (error) {
    if (error instanceof AffiliateClickActivationSafeError) throw error;
    if (isAlreadyExistsError(error)) {
      throw new AffiliateClickActivationSafeError(
        'conflict',
        'activation_marker_exists',
        'A durable-click activation marker already exists; apply was refused.',
      );
    }
    throw new AffiliateClickActivationSafeError(
      'firestore',
      'activation_transaction_failed',
      'The create-only staging activation transaction failed safely.',
    );
  }

  const postSnapshot = await safelyAsync(
    'firestore',
    'marker_post_read_failed',
    'The created activation marker could not be read back safely.',
    () => references.marker.get(),
  );
  if (!postSnapshot.exists) {
    throw new AffiliateClickActivationSafeError(
      'firestore',
      'marker_post_verification_failed',
      'The activation marker was not present during post-verification.',
    );
  }
  const markerEvidence = assertImmutableAffiliateClickActivationMarker({
    value: postSnapshot.data(),
    createTime: postSnapshot.createTime,
    updateTime: postSnapshot.updateTime,
    expected: transactionGate.marker,
  });
  const postLive = await captureAndVerifyLiveState(dependencies, db, backup);
  const backupEvidence = assertFreshAffiliateClickActivationBackup({
    manifest: backup.manifest,
    authoritativeSnapshot: postSnapshot,
    expectedProject: cli.expectedProject,
    expectedDatabase: cli.expectedDatabase,
    expectedAffiliates: cli.expectedAffiliates,
  });

  return buildRedactedAffiliateClickActivationReport({
    mode: cli.mode,
    status: 'created',
    target,
    backup: backupEvidence,
    liveState: postLive.evidence,
    keyFingerprint: runtime.keyFingerprint,
    deploymentEvidence: cli.deploymentEvidence,
    proof: transactionGate.proof,
    clock: transactionGate.clock,
    founding: transactionGate.founding,
    marker: transactionGate.marker,
    markerEvidence,
  });
}

export async function runAffiliateClickActivationCli(argv = process.argv.slice(2)): Promise<number> {
  try {
    const report = await executeAffiliateClickActivation(argv);
    console.log(JSON.stringify(report, null, 2));
    return 0;
  } catch (error) {
    const failure = safeAffiliateClickActivationFailure(error);
    console.error(JSON.stringify(failure, null, 2));
    return failure.exitCode;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  runAffiliateClickActivationCli().then(exitCode => {
    process.exitCode = exitCode;
  });
}
