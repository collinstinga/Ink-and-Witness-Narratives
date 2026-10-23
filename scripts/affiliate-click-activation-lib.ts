import crypto from 'crypto';
import {
  deriveAffiliateClickAnalyticsKeyFingerprint,
  firestoreSnapshotReadTimeMillis,
  normalizeAffiliateClickAnalyticsActivationV1,
  normalizeDurableAffiliateClickEventV2,
  type AffiliateClickAnalyticsActivationV1,
} from '../src/server/affiliateClickLedger.js';
import {
  AFFILIATE_BACKUP_DATASETS,
  AFFILIATE_BACKUP_SCHEMA_VERSION,
  FOUNDING_AFFILIATE_COUNT,
  KNOWN_PRODUCTION_FIREBASE_PROJECT_IDS,
  LITERARY_CIRCLE_MIGRATION_ID,
  type AffiliateBackupManifest,
  type BackupDatasetPayload,
  type BackupDocument,
  type VerifiedAffiliateBackup,
} from './literary-circle-migration-lib.js';

export const AFFILIATE_CLICK_ACTIVATION_MARKER_COLLECTION = 'site_configs';
export const AFFILIATE_CLICK_ACTIVATION_MARKER_DOCUMENT_ID = 'affiliate_click_analytics';
export const AFFILIATE_CLICK_ACTIVATION_MIN_LEAD_MINUTES = 30;
export const AFFILIATE_CLICK_ACTIVATION_MAX_LEAD_MINUTES = 24 * 60;
export const AFFILIATE_CLICK_ACTIVATION_MAX_CLOCK_DRIFT_MS = 30_000;
export const AFFILIATE_CLICK_ACTIVATION_MAX_BACKUP_AGE_MS = 60 * 60 * 1_000;
export const AFFILIATE_CLICK_ACTIVATION_MAX_PROOF_EVENT_AGE_MS = 15 * 60 * 1_000;

const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;
const KEY_FINGERPRINT_PATTERN = /^ack1_[A-Za-z0-9_-]{43}$/;
const SAFE_BACKUP_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{5,127}$/;
const SAFE_PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{4,29}[a-z0-9]$/;
const SAFE_DATABASE_ID_PATTERN = /^(?:\(default\)|[A-Za-z0-9][A-Za-z0-9._-]{0,62})$/;
const SAFE_DEPLOYMENT_EVIDENCE_PATTERN = /^dpl_[A-Za-z0-9]{6,128}$/;
const SAFE_DOCUMENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_AFFILIATE_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{0,63}$/;
const CLICK_DOCUMENT_ID_PATTERN = /^aclk2_[a-f0-9]{64}$/;
const ACKNOWLEDGE_CREATE_ONLY_FLAG = '--acknowledge-create-only';
const ACKNOWLEDGE_NO_ROLLBACK_FLAG = '--acknowledge-no-rollback';
const ACKNOWLEDGE_TRAFFIC_QUIESCED_FLAG = '--acknowledge-staging-traffic-quiesced';

export const AFFILIATE_CLICK_ACTIVATION_EXIT_CODES = {
  usage: 2,
  target: 3,
  backup: 4,
  precondition: 5,
  conflict: 6,
  firestore: 7,
} as const;

export type AffiliateClickActivationExitKind = keyof typeof AFFILIATE_CLICK_ACTIVATION_EXIT_CODES;
export type AffiliateClickActivationMode = 'dry-run' | 'apply';

export class AffiliateClickActivationSafeError extends Error {
  readonly kind: AffiliateClickActivationExitKind;
  readonly exitCode: number;
  readonly safeCode: string;

  constructor(kind: AffiliateClickActivationExitKind, safeCode: string, safeMessage: string) {
    super(safeMessage);
    this.name = 'AffiliateClickActivationSafeError';
    this.kind = kind;
    this.exitCode = AFFILIATE_CLICK_ACTIVATION_EXIT_CODES[kind];
    this.safeCode = safeCode;
  }
}

function fail(
  kind: AffiliateClickActivationExitKind,
  safeCode: string,
  safeMessage: string,
): never {
  throw new AffiliateClickActivationSafeError(kind, safeCode, safeMessage);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map(key => [key, canonicalJsonValue(value[key])]),
  );
}

export function activationCanonicalJson(value: unknown): string {
  return JSON.stringify(canonicalJsonValue(value));
}

function evidenceHash(label: string, value: unknown): string {
  return crypto
    .createHash('sha256')
    .update(`ink-witness:${label}:v1\u0000${activationCanonicalJson(value)}`, 'utf8')
    .digest('hex');
}

function canonicalIso(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || Math.abs(milliseconds) > 8.64e15) return null;
  try {
    const canonical = new Date(milliseconds).toISOString();
    return value === canonical ? canonical : null;
  } catch {
    return null;
  }
}

function requireNonEmptyArgument(value: string | undefined, code: string, message: string): string {
  const normalized = value?.trim() || '';
  if (!normalized) fail('usage', code, message);
  return normalized;
}

export interface AffiliateClickActivationCliOptions {
  mode: AffiliateClickActivationMode;
  environment: 'staging';
  expectedProject: string;
  expectedDatabase: string;
  expectedAffiliates: typeof FOUNDING_AFFILIATE_COUNT;
  backupPath: string;
  expectedKeyFingerprint: string;
  deploymentEvidence: string;
  proofEventId: string;
  leadMinutes: number;
  acknowledgeCreateOnly: boolean;
  acknowledgeNoRollback: boolean;
  acknowledgeTrafficQuiesced: boolean;
}

const VALUE_ARGUMENTS = new Set([
  'environment',
  'expected-project',
  'expected-database',
  'expected-affiliates',
  'backup',
  'expected-key-fingerprint',
  'deployment-evidence',
  'proof-event-id',
  'lead-minutes',
]);

const BOOLEAN_ARGUMENTS = new Set([
  'apply',
  ACKNOWLEDGE_CREATE_ONLY_FLAG.slice(2),
  ACKNOWLEDGE_NO_ROLLBACK_FLAG.slice(2),
  ACKNOWLEDGE_TRAFFIC_QUIESCED_FLAG.slice(2),
]);

/** Parse only the documented `--name=value` arguments and exact boolean flags. */
export function parseAffiliateClickActivationArgs(
  argv: readonly string[],
): AffiliateClickActivationCliOptions {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (const argument of argv) {
    if (!argument.startsWith('--') || argument === '--') {
      fail('usage', 'unknown_argument', 'Activation arguments must use documented long-form flags.');
    }
    const equalsAt = argument.indexOf('=');
    if (equalsAt >= 0) {
      const name = argument.slice(2, equalsAt);
      const value = argument.slice(equalsAt + 1);
      if (!VALUE_ARGUMENTS.has(name) || values.has(name) || flags.has(name)) {
        fail('usage', 'unknown_or_duplicate_argument', 'An activation argument is unknown or duplicated.');
      }
      values.set(name, value);
      continue;
    }
    const name = argument.slice(2);
    if (!BOOLEAN_ARGUMENTS.has(name) || flags.has(name) || values.has(name)) {
      fail('usage', 'unknown_or_duplicate_argument', 'An activation argument is unknown or duplicated.');
    }
    flags.add(name);
  }

  const environment = requireNonEmptyArgument(
    values.get('environment'),
    'missing_environment',
    'The exact staging environment is required.',
  );
  if (environment !== 'staging') {
    fail('target', 'environment_not_staging', 'Activation is restricted to the staging environment.');
  }
  const expectedProject = requireNonEmptyArgument(
    values.get('expected-project'),
    'missing_expected_project',
    'The exact expected staging project is required.',
  );
  if (!SAFE_PROJECT_ID_PATTERN.test(expectedProject)) {
    fail('usage', 'invalid_expected_project', 'The expected staging project identifier is invalid.');
  }
  const expectedDatabase = requireNonEmptyArgument(
    values.get('expected-database'),
    'missing_expected_database',
    'The exact expected Firestore database is required.',
  );
  if (!SAFE_DATABASE_ID_PATTERN.test(expectedDatabase)) {
    fail('usage', 'invalid_expected_database', 'The expected Firestore database identifier is invalid.');
  }
  const expectedAffiliates = Number(values.get('expected-affiliates'));
  if (!Number.isSafeInteger(expectedAffiliates) || expectedAffiliates !== FOUNDING_AFFILIATE_COUNT) {
    fail('usage', 'invalid_expected_affiliates', 'Activation requires the exact founding affiliate count.');
  }
  const backupPath = requireNonEmptyArgument(
    values.get('backup'),
    'missing_backup',
    'A verified staging backup manifest is required.',
  );
  if (backupPath.includes('\u0000')) {
    fail('usage', 'invalid_backup_path', 'The backup manifest path is invalid.');
  }
  const expectedKeyFingerprint = requireNonEmptyArgument(
    values.get('expected-key-fingerprint'),
    'missing_expected_key_fingerprint',
    'The expected click-key fingerprint is required.',
  );
  if (!KEY_FINGERPRINT_PATTERN.test(expectedKeyFingerprint)) {
    fail('usage', 'invalid_expected_key_fingerprint', 'The expected click-key fingerprint is invalid.');
  }
  const deploymentEvidence = requireNonEmptyArgument(
    values.get('deployment-evidence'),
    'missing_deployment_evidence',
    'Immutable required-mode deployment evidence is required.',
  );
  if (!SAFE_DEPLOYMENT_EVIDENCE_PATTERN.test(deploymentEvidence)) {
    fail('usage', 'invalid_deployment_evidence', 'The deployment evidence reference is invalid.');
  }
  const proofEventId = requireNonEmptyArgument(
    values.get('proof-event-id'),
    'missing_proof_event_id',
    'A recent controlled durable-click proof event is required.',
  );
  if (!CLICK_DOCUMENT_ID_PATTERN.test(proofEventId)) {
    fail('usage', 'invalid_proof_event_id', 'The durable-click proof event identifier is invalid.');
  }
  const leadRaw = values.get('lead-minutes');
  if (!leadRaw || !/^[0-9]+$/.test(leadRaw)) {
    fail('usage', 'invalid_lead_minutes', 'Activation lead minutes must be an integer.');
  }
  const leadMinutes = Number(leadRaw);
  if (
    !Number.isSafeInteger(leadMinutes)
    || leadMinutes < AFFILIATE_CLICK_ACTIVATION_MIN_LEAD_MINUTES
    || leadMinutes > AFFILIATE_CLICK_ACTIVATION_MAX_LEAD_MINUTES
  ) {
    fail('usage', 'lead_minutes_out_of_range', 'Activation lead minutes are outside the safe range.');
  }

  const mode: AffiliateClickActivationMode = flags.has('apply') ? 'apply' : 'dry-run';
  const acknowledgeCreateOnly = flags.has(ACKNOWLEDGE_CREATE_ONLY_FLAG.slice(2));
  const acknowledgeNoRollback = flags.has(ACKNOWLEDGE_NO_ROLLBACK_FLAG.slice(2));
  const acknowledgeTrafficQuiesced = flags.has(ACKNOWLEDGE_TRAFFIC_QUIESCED_FLAG.slice(2));
  if (
    mode === 'apply'
    && (!acknowledgeCreateOnly || !acknowledgeNoRollback || !acknowledgeTrafficQuiesced)
  ) {
    fail('precondition', 'missing_apply_acknowledgement', 'Apply requires every irreversible-boundary acknowledgement.');
  }

  return {
    mode,
    environment: 'staging',
    expectedProject,
    expectedDatabase,
    expectedAffiliates: FOUNDING_AFFILIATE_COUNT,
    backupPath,
    expectedKeyFingerprint,
    deploymentEvidence,
    proofEventId,
    leadMinutes,
    acknowledgeCreateOnly,
    acknowledgeNoRollback,
    acknowledgeTrafficQuiesced,
  };
}

function normalizeStringList(value: unknown): string[] {
  const items = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];
  return items
    .map(item => typeof item === 'string' ? item.trim() : '')
    .filter(Boolean);
}

function parseServiceAccountIdentity(value: unknown): {
  projectId: string;
  clientEmail: string;
} | null {
  let parsed = value;
  if (typeof parsed === 'string') {
    if (!parsed.trim()) return null;
    try {
      parsed = JSON.parse(parsed);
    } catch {
      fail('target', 'invalid_service_account', 'The staging service-account credential is invalid.');
    }
  }
  if (!isRecord(parsed) || parsed.type !== 'service_account') return null;
  const projectId = typeof parsed.project_id === 'string' ? parsed.project_id.trim() : '';
  const clientEmail = typeof parsed.client_email === 'string' ? parsed.client_email.trim().toLowerCase() : '';
  const privateKey = typeof parsed.private_key === 'string' ? parsed.private_key.trim() : '';
  if (
    !SAFE_PROJECT_ID_PATTERN.test(projectId)
    || !clientEmail
    || clientEmail.length > 320
    || !clientEmail.includes('@')
    || !privateKey.startsWith('-----BEGIN PRIVATE KEY-----')
    || !privateKey.endsWith('-----END PRIVATE KEY-----')
  ) return null;
  return { projectId, clientEmail };
}

export interface AffiliateClickActivationTargetInput {
  options: Pick<
    AffiliateClickActivationCliOptions,
    'environment' | 'expectedProject' | 'expectedDatabase'
  >;
  resolvedProjectId: unknown;
  resolvedDatabaseId: unknown;
  stagingProjectAllowlist: unknown;
  productionProjectIds?: unknown;
  serviceAccount: unknown;
  credentialSource: unknown;
  nodeEnv?: unknown;
  vercelEnv?: unknown;
  firestoreEmulatorHost?: unknown;
  firebaseDatabaseEmulatorHost?: unknown;
  firebaseAuthEmulatorHost?: unknown;
}

export interface AffiliateClickActivationTargetEvidence {
  projectId: string;
  databaseId: string;
  stagingAllowlistSha256: string;
  serviceAccountProjectSha256: string;
  serviceAccountIdentitySha256: string;
  credentialSource: 'FIREBASE_SERVICE_ACCOUNT_JSON';
}

/** Fail closed unless every independently supplied target signal names staging. */
export function assertAffiliateClickActivationStagingTarget(
  input: AffiliateClickActivationTargetInput,
): AffiliateClickActivationTargetEvidence {
  if (input.options.environment !== 'staging') {
    fail('target', 'environment_not_staging', 'Activation is restricted to the staging environment.');
  }
  const resolvedProjectId = typeof input.resolvedProjectId === 'string'
    ? input.resolvedProjectId.trim()
    : '';
  const resolvedDatabaseId = typeof input.resolvedDatabaseId === 'string'
    ? input.resolvedDatabaseId.trim()
    : '';
  if (
    resolvedProjectId !== input.options.expectedProject
    || resolvedDatabaseId !== input.options.expectedDatabase
  ) {
    fail('target', 'resolved_target_mismatch', 'The resolved Firebase target does not match the expected staging target.');
  }
  if (
    String(input.nodeEnv || '').trim().toLowerCase() === 'production'
    || String(input.vercelEnv || '').trim().toLowerCase() === 'production'
  ) {
    fail('target', 'production_process_environment', 'Activation cannot run in a production process environment.');
  }
  if (
    String(input.firestoreEmulatorHost || '').trim()
    || String(input.firebaseDatabaseEmulatorHost || '').trim()
    || String(input.firebaseAuthEmulatorHost || '').trim()
  ) {
    fail('target', 'emulator_detected', 'Activation cannot run while a Firebase emulator is configured.');
  }

  const allowlist = [...new Set(normalizeStringList(input.stagingProjectAllowlist))].sort();
  if (!allowlist.length || allowlist.some(projectId => !SAFE_PROJECT_ID_PATTERN.test(projectId))) {
    fail('target', 'invalid_staging_allowlist', 'A valid explicit staging project allowlist is required.');
  }
  const productionProjects = new Set([
    ...KNOWN_PRODUCTION_FIREBASE_PROJECT_IDS,
    ...normalizeStringList(input.productionProjectIds),
  ]);
  if (allowlist.some(projectId => productionProjects.has(projectId))) {
    fail('target', 'staging_allowlist_contains_production', 'The staging allowlist overlaps a production project deny-list.');
  }
  if (!allowlist.includes(resolvedProjectId) || productionProjects.has(resolvedProjectId)) {
    fail('target', 'project_not_allowed_for_staging', 'The resolved project is not an allowed staging target.');
  }

  if (input.credentialSource !== 'FIREBASE_SERVICE_ACCOUNT_JSON') {
    fail('target', 'invalid_credential_source', 'Activation requires the explicit Firebase service-account environment credential.');
  }
  const serviceAccountIdentity = parseServiceAccountIdentity(input.serviceAccount);
  if (!serviceAccountIdentity || serviceAccountIdentity.projectId !== resolvedProjectId) {
    fail('target', 'service_account_project_mismatch', 'The service-account project does not match the staging target.');
  }
  return {
    projectId: resolvedProjectId,
    databaseId: resolvedDatabaseId,
    stagingAllowlistSha256: evidenceHash('staging-project-allowlist', allowlist),
    serviceAccountProjectSha256: evidenceHash('service-account-project', serviceAccountIdentity.projectId),
    serviceAccountIdentitySha256: evidenceHash('service-account-identity', {
      projectId: serviceAccountIdentity.projectId,
      clientEmail: serviceAccountIdentity.clientEmail,
    }),
    credentialSource: 'FIREBASE_SERVICE_ACCOUNT_JSON',
  };
}

export function assertAffiliateClickActivationRuntime(input: {
  ledgerMode: unknown;
  analyticsSecret: unknown;
  expectedKeyFingerprint: unknown;
}): { keyFingerprint: string } {
  if (input.ledgerMode !== 'required') {
    fail('precondition', 'ledger_mode_not_required', 'The durable click ledger must be in required mode.');
  }
  const secret = typeof input.analyticsSecret === 'string' ? input.analyticsSecret.trim() : '';
  if (secret.length < 32) {
    fail('precondition', 'missing_click_secret', 'A protected dedicated click analytics secret is required.');
  }
  const expected = typeof input.expectedKeyFingerprint === 'string'
    ? input.expectedKeyFingerprint.trim()
    : '';
  const actual = deriveAffiliateClickAnalyticsKeyFingerprint(secret);
  if (!actual || !KEY_FINGERPRINT_PATTERN.test(expected) || actual !== expected) {
    fail('precondition', 'click_key_fingerprint_mismatch', 'The deployed click-key fingerprint does not match the expected fingerprint.');
  }
  return { keyFingerprint: actual };
}

interface TimestampParts {
  seconds: number;
  nanoseconds: number;
}

/** Accept only Firestore Timestamp-shaped metadata, never Date/string substitutes. */
function firestoreTimestampParts(value: unknown): TimestampParts | null {
  if (!value || typeof value !== 'object' || value instanceof Date || Array.isArray(value)) return null;
  const record = value as {
    seconds?: unknown;
    nanoseconds?: unknown;
    toMillis?: () => unknown;
  };
  const seconds = Number(record.seconds);
  const nanoseconds = Number(record.nanoseconds ?? 0);
  if (
    Number.isSafeInteger(seconds)
    && Number.isSafeInteger(nanoseconds)
    && nanoseconds >= 0
    && nanoseconds < 1_000_000_000
  ) {
    const milliseconds = seconds * 1_000 + Math.floor(nanoseconds / 1_000_000);
    if (
      Number.isSafeInteger(milliseconds)
      && Math.abs(milliseconds) <= 8.64e15
    ) return { seconds, nanoseconds };
    return null;
  }
  try {
    if (typeof record.toMillis === 'function') {
      const milliseconds = Number(record.toMillis());
      if (
        Number.isSafeInteger(milliseconds)
        && Math.abs(milliseconds) <= 8.64e15
      ) {
        const wholeSeconds = Math.floor(milliseconds / 1_000);
        return {
          seconds: wholeSeconds,
          nanoseconds: Math.floor((milliseconds - wholeSeconds * 1_000) * 1_000_000),
        };
      }
    }
  } catch {
    return null;
  }
  return null;
}

function firestoreTimestampMilliseconds(value: unknown): number | null {
  const parts = firestoreTimestampParts(value);
  if (!parts) return null;
  const milliseconds = parts.seconds * 1_000 + Math.floor(parts.nanoseconds / 1_000_000);
  return Number.isSafeInteger(milliseconds) && Math.abs(milliseconds) <= 8.64e15
    ? milliseconds
    : null;
}

function firestoreTimestampIso(value: unknown): string | null {
  const milliseconds = firestoreTimestampMilliseconds(value);
  if (milliseconds === null) return null;
  try {
    return new Date(milliseconds).toISOString();
  } catch {
    return null;
  }
}

function firestoreSnapshotTimeMillis(snapshot: unknown): number | null {
  const milliseconds = firestoreSnapshotReadTimeMillis(snapshot);
  return milliseconds !== null
    && Number.isSafeInteger(milliseconds)
    && Math.abs(milliseconds) <= 8.64e15
    ? milliseconds
    : null;
}

function firestoreSnapshotTimeIso(snapshot: unknown): string | null {
  const milliseconds = firestoreSnapshotTimeMillis(snapshot);
  if (milliseconds === null) return null;
  try {
    return new Date(milliseconds).toISOString();
  } catch {
    return null;
  }
}

export interface AffiliateClickActivationClockEvidence {
  authoritativeReadTime: string;
  localTime: string;
  absoluteDriftMs: number;
}

export function assertAuthoritativeFirestoreClock(input: {
  firestoreSnapshot: unknown;
  localNow: unknown;
}): AffiliateClickActivationClockEvidence {
  const firestoreMs = firestoreSnapshotTimeMillis(input.firestoreSnapshot);
  const localMs = input.localNow instanceof Date
    ? input.localNow.getTime()
    : typeof input.localNow === 'number'
      ? input.localNow
      : Number.NaN;
  if (firestoreMs === null || !Number.isFinite(localMs)) {
    fail('precondition', 'invalid_authoritative_time', 'A valid authoritative Firestore read time and local clock are required.');
  }
  const absoluteDriftMs = Math.abs(firestoreMs - localMs);
  if (absoluteDriftMs > AFFILIATE_CLICK_ACTIVATION_MAX_CLOCK_DRIFT_MS) {
    fail('precondition', 'local_clock_drift', 'The local clock differs too far from authoritative Firestore time.');
  }
  return {
    authoritativeReadTime: new Date(firestoreMs).toISOString(),
    localTime: new Date(localMs).toISOString(),
    absoluteDriftMs,
  };
}

export interface AffiliateClickActivationBackupEvidence {
  schemaVersion: typeof AFFILIATE_BACKUP_SCHEMA_VERSION;
  backupId: string;
  createdAt: string;
  contentSha256: string;
  affiliateCount: typeof FOUNDING_AFFILIATE_COUNT;
  ageMs: number;
  evidenceSha256: string;
}

export function assertFreshAffiliateClickActivationBackup(input: {
  manifest: unknown;
  authoritativeSnapshot: unknown;
  expectedProject: string;
  expectedDatabase: string;
  expectedAffiliates?: number;
}): AffiliateClickActivationBackupEvidence {
  if (!isRecord(input.manifest)) {
    fail('backup', 'invalid_backup_manifest', 'The verified backup manifest is invalid.');
  }
  const manifest = input.manifest as unknown as AffiliateBackupManifest;
  if (manifest.schemaVersion !== AFFILIATE_BACKUP_SCHEMA_VERSION) {
    fail('backup', 'unsupported_backup_schema', 'Activation requires a verified current-schema backup.');
  }
  if (
    manifest.projectId !== input.expectedProject
    || manifest.databaseId !== input.expectedDatabase
  ) {
    fail('backup', 'backup_target_mismatch', 'The verified backup target does not match the staging target.');
  }
  const createdAt = canonicalIso(manifest.createdAt);
  const nowMs = firestoreSnapshotTimeMillis(input.authoritativeSnapshot);
  if (!createdAt || nowMs === null) {
    fail('backup', 'invalid_backup_time', 'The verified backup timestamp is invalid.');
  }
  const ageMs = nowMs - Date.parse(createdAt);
  if (ageMs < -AFFILIATE_CLICK_ACTIVATION_MAX_CLOCK_DRIFT_MS || ageMs > AFFILIATE_CLICK_ACTIVATION_MAX_BACKUP_AGE_MS) {
    fail('backup', 'stale_backup', 'The verified staging backup is not within the permitted freshness window.');
  }
  if (
    typeof manifest.backupId !== 'string'
    || !SAFE_BACKUP_ID_PATTERN.test(manifest.backupId)
    || !SHA256_HEX_PATTERN.test(manifest.contentSha256)
    || !Array.isArray(manifest.datasets)
  ) {
    fail('backup', 'invalid_backup_manifest', 'The verified backup manifest is invalid.');
  }
  const affiliateEntries = manifest.datasets.filter(dataset => dataset?.key === 'affiliates');
  const expectedAffiliates = input.expectedAffiliates ?? FOUNDING_AFFILIATE_COUNT;
  if (
    expectedAffiliates !== FOUNDING_AFFILIATE_COUNT
    || affiliateEntries.length !== 1
    || affiliateEntries[0].count !== FOUNDING_AFFILIATE_COUNT
  ) {
    fail('backup', 'backup_affiliate_count_mismatch', 'The verified backup does not contain the exact founding affiliate count.');
  }
  return {
    schemaVersion: AFFILIATE_BACKUP_SCHEMA_VERSION,
    backupId: manifest.backupId,
    createdAt,
    contentSha256: manifest.contentSha256,
    affiliateCount: FOUNDING_AFFILIATE_COUNT,
    ageMs: Math.max(0, ageMs),
    evidenceSha256: evidenceHash('activation-backup-manifest', {
      schemaVersion: manifest.schemaVersion,
      backupId: manifest.backupId,
      createdAt,
      projectId: manifest.projectId,
      databaseId: manifest.databaseId,
      contentSha256: manifest.contentSha256,
      affiliateCount: FOUNDING_AFFILIATE_COUNT,
    }),
  };
}

export interface AffiliateClickActivationLiveStateEvidence {
  datasetCount: number;
  documentCount: number;
  evidenceSha256: string;
}

/**
 * Activation runs after the founding migration, so unlike the migration's
 * compatibility comparison it permits no live drift from the fresh backup.
 */
export function assertExactAffiliateClickActivationLiveState(input: {
  verifiedBackup: VerifiedAffiliateBackup;
  livePayloads: ReadonlyMap<string, BackupDatasetPayload>;
  /** Only the marker independently verified after this command's create may differ. */
  expectedCreatedMarker?: AffiliateClickAnalyticsActivationV1;
}): AffiliateClickActivationLiveStateEvidence {
  const summaries: Array<{ key: string; documentsSha256: string; count: number }> = [];
  let documentCount = 0;
  for (const definition of AFFILIATE_BACKUP_DATASETS) {
    const backupPayload = input.verifiedBackup.payloads.get(definition.key);
    const livePayload = input.livePayloads.get(definition.key);
    if (!backupPayload || !livePayload) {
      fail('backup', 'live_dataset_missing', 'The live-state comparison is missing a required dataset.');
    }
    let expectedPayload = backupPayload;
    if (definition.key === 'affiliate_click_activation_marker' && input.expectedCreatedMarker) {
      if (backupPayload.documents.length) {
        fail('backup', 'activation_marker_backed_up', 'A backed-up activation marker cannot be replaced.');
      }
      expectedPayload = {
        ...backupPayload,
        documents: [{ id: AFFILIATE_CLICK_ACTIVATION_MARKER_DOCUMENT_ID,
          data: assertExactAffiliateClickActivationMarker(input.expectedCreatedMarker) as unknown as Record<string, unknown> }],
      };
    }
    if (activationCanonicalJson(livePayload) !== activationCanonicalJson(expectedPayload)) {
      fail('backup', 'live_state_drift', 'The staging affiliate state differs from the fresh verified backup.');
    }
    const count = expectedPayload.documents.length;
    documentCount += count;
    summaries.push({
      key: definition.key,
      count,
      documentsSha256: evidenceHash(`activation-live-dataset:${definition.key}`, expectedPayload.documents),
    });
  }
  if (
    input.verifiedBackup.payloads.size !== AFFILIATE_BACKUP_DATASETS.length
    || input.livePayloads.size !== AFFILIATE_BACKUP_DATASETS.length
  ) {
    fail('backup', 'unexpected_live_dataset', 'The live-state comparison contains an unexpected dataset.');
  }
  return {
    datasetCount: summaries.length,
    documentCount,
    evidenceSha256: evidenceHash('activation-live-state', summaries),
  };
}

function documentMap(documents: readonly BackupDocument[]): Map<string, BackupDocument> {
  const result = new Map<string, BackupDocument>();
  for (const document of documents) {
    if (!document || !SAFE_DOCUMENT_ID_PATTERN.test(document.id) || result.has(document.id) || !isRecord(document.data)) {
      fail('backup', 'invalid_affiliate_identity_set', 'The founding affiliate identity set is invalid.');
    }
    result.set(document.id, document);
  }
  return result;
}

function normalizedAffiliateIdentity(document: BackupDocument): {
  id: string;
  code: string;
  email: string;
} {
  const storedId = typeof document.data.id === 'string' ? document.data.id : document.id;
  const code = typeof document.data.affiliateCode === 'string'
    ? document.data.affiliateCode.trim().toUpperCase()
    : '';
  const email = typeof document.data.email === 'string'
    ? document.data.email.trim().toLowerCase()
    : '';
  if (
    storedId !== document.id
    || !SAFE_AFFILIATE_CODE_PATTERN.test(code)
    || !email
    || email.length > 320
    || !email.includes('@')
  ) {
    fail('backup', 'invalid_affiliate_identity', 'A founding affiliate identity is invalid.');
  }
  return { id: document.id, code, email };
}

function assertFoundingMembership(document: BackupDocument): void {
  const membership = isRecord(document.data.literaryCircle) ? document.data.literaryCircle : null;
  const complimentaryAccess = membership && isRecord(membership.complimentaryAccess)
    ? membership.complimentaryAccess
    : null;
  if (
    !membership
    || membership.schemaVersion !== 1
    || membership.foundingMember !== true
    || !canonicalIso(membership.memberSince)
    || !canonicalIso(membership.foundingRecognizedAt)
    || !complimentaryAccess
    || complimentaryAccess.scope !== 'all_published'
    || !['active', 'suspended', 'revoked'].includes(String(complimentaryAccess.status || ''))
    || !canonicalIso(complimentaryAccess.updatedAt)
  ) {
    fail('backup', 'founding_membership_not_reconciled', 'Every founding affiliate must have a reconciled Literary Circle membership.');
  }
}

const FOUNDING_MARKER_KEYS = new Set([
  'schemaVersion',
  'migrationId',
  'status',
  'expectedAffiliateCount',
  'completedAffiliateIds',
  'completedCount',
  'backupId',
  'backupManifestSha256',
  'startedAt',
  'completedAt',
  'lastAppliedAt',
  'attemptCount',
]);

export interface AffiliateClickActivationFoundingEvidence {
  affiliateCount: typeof FOUNDING_AFFILIATE_COUNT;
  identitySetSha256: string;
  migrationEvidenceSha256: string;
}

export function assertFoundingAffiliateMigrationReconciled(input: {
  migrationMarker: unknown;
  backupAffiliates: readonly BackupDocument[];
  liveAffiliates: readonly BackupDocument[];
}): AffiliateClickActivationFoundingEvidence {
  if (
    input.backupAffiliates.length !== FOUNDING_AFFILIATE_COUNT
    || input.liveAffiliates.length !== FOUNDING_AFFILIATE_COUNT
  ) {
    fail('backup', 'founding_affiliate_count_mismatch', 'The founding affiliate count is not reconciled.');
  }
  const backup = documentMap(input.backupAffiliates);
  const live = documentMap(input.liveAffiliates);
  const affiliateIds = [...backup.keys()].sort();
  if (activationCanonicalJson(affiliateIds) !== activationCanonicalJson([...live.keys()].sort())) {
    fail('backup', 'founding_identity_set_mismatch', 'The live founding affiliate identities differ from the backup.');
  }

  const codes = new Set<string>();
  const emails = new Set<string>();
  for (const id of affiliateIds) {
    const backupDocument = backup.get(id) as BackupDocument;
    const liveDocument = live.get(id) as BackupDocument;
    const backupIdentity = normalizedAffiliateIdentity(backupDocument);
    const liveIdentity = normalizedAffiliateIdentity(liveDocument);
    if (
      backupIdentity.code !== liveIdentity.code
      || backupIdentity.email !== liveIdentity.email
      || codes.has(liveIdentity.code)
      || emails.has(liveIdentity.email)
    ) {
      fail('backup', 'founding_identity_conflict', 'Founding affiliate identity ownership is not reconciled.');
    }
    codes.add(liveIdentity.code);
    emails.add(liveIdentity.email);
    assertFoundingMembership(liveDocument);
  }

  if (!isRecord(input.migrationMarker)) {
    fail('backup', 'missing_founding_migration_marker', 'The completed founding-affiliate migration marker is required.');
  }
  const marker = input.migrationMarker;
  if (Object.keys(marker).some(key => !FOUNDING_MARKER_KEYS.has(key))) {
    fail('backup', 'invalid_founding_migration_marker', 'The founding-affiliate migration marker is invalid.');
  }
  const completedIds = Array.isArray(marker.completedAffiliateIds)
    ? marker.completedAffiliateIds
    : [];
  const startedAt = canonicalIso(marker.startedAt);
  const completedAt = canonicalIso(marker.completedAt);
  const lastAppliedAt = canonicalIso(marker.lastAppliedAt);
  if (
    marker.schemaVersion !== 1
    || marker.migrationId !== LITERARY_CIRCLE_MIGRATION_ID
    || marker.status !== 'complete'
    || marker.expectedAffiliateCount !== FOUNDING_AFFILIATE_COUNT
    || marker.completedCount !== FOUNDING_AFFILIATE_COUNT
    || activationCanonicalJson(completedIds) !== activationCanonicalJson(affiliateIds)
    || typeof marker.backupId !== 'string'
    || !marker.backupId.trim()
    || typeof marker.backupManifestSha256 !== 'string'
    || !SHA256_HEX_PATTERN.test(marker.backupManifestSha256)
    || !startedAt
    || !completedAt
    || !lastAppliedAt
    || Date.parse(startedAt) > Date.parse(completedAt)
    || Date.parse(completedAt) > Date.parse(lastAppliedAt)
    || !Number.isSafeInteger(marker.attemptCount)
    || Number(marker.attemptCount) < 1
  ) {
    fail('backup', 'invalid_founding_migration_marker', 'The founding-affiliate migration marker is invalid.');
  }
  const identitySetSha256 = evidenceHash('founding-affiliate-identities', affiliateIds);
  return {
    affiliateCount: FOUNDING_AFFILIATE_COUNT,
    identitySetSha256,
    migrationEvidenceSha256: evidenceHash('founding-affiliate-migration', {
      migrationId: marker.migrationId,
      expectedAffiliateCount: marker.expectedAffiliateCount,
      completedAffiliateIdsSha256: identitySetSha256,
      backupManifestSha256: marker.backupManifestSha256,
      completedAt: marker.completedAt,
      attemptCount: marker.attemptCount,
    }),
  };
}

export interface AffiliateClickActivationProofEvidence {
  eventTimestamp: string;
  createdAt: string;
  observedAt: string;
  keyFingerprint: string;
  eventEvidenceSha256: string;
}

export function assertAffiliateClickActivationProofBackedUp(input: {
  backupClickDocuments: readonly BackupDocument[];
  documentId: unknown;
  value: unknown;
}): void {
  const documentId = typeof input.documentId === 'string' ? input.documentId : '';
  const matches = input.backupClickDocuments.filter(document => document.id === documentId);
  if (
    !CLICK_DOCUMENT_ID_PATTERN.test(documentId)
    || matches.length !== 1
    || activationCanonicalJson(matches[0].data) !== activationCanonicalJson(input.value)
  ) {
    fail('backup', 'proof_event_not_backed_up', 'The controlled proof event is not preserved by the fresh verified backup.');
  }
}

/** Validate one controlled, immutable v2 event produced by the deployed staging runtime. */
export function assertRecentAffiliateClickActivationProofEvent(input: {
  value: unknown;
  documentId: unknown;
  expectedKeyFingerprint: unknown;
  expectedAffiliateIdentities: readonly { id: unknown; code: unknown }[];
  firestoreSnapshot: unknown;
  createTime: unknown;
  updateTime: unknown;
}): AffiliateClickActivationProofEvidence {
  const documentId = typeof input.documentId === 'string' ? input.documentId : '';
  const expectedKeyFingerprint = typeof input.expectedKeyFingerprint === 'string'
    ? input.expectedKeyFingerprint
    : '';
  const event = normalizeDurableAffiliateClickEventV2(input.value);
  if (
    !event
    || !CLICK_DOCUMENT_ID_PATTERN.test(documentId)
    || event.id !== documentId
    || event.keyFingerprint !== expectedKeyFingerprint
    || !event.visitorKey
    || !event.dedupeWindowStartedAt
  ) {
    fail('precondition', 'invalid_proof_event', 'The controlled durable-click proof event is invalid.');
  }

  if (input.expectedAffiliateIdentities.length !== FOUNDING_AFFILIATE_COUNT) {
    fail('precondition', 'invalid_proof_affiliate_set', 'The controlled proof affiliate set is invalid.');
  }
  const identities = new Map<string, string>();
  for (const identity of input.expectedAffiliateIdentities) {
    const id = typeof identity.id === 'string' ? identity.id.trim() : '';
    const code = typeof identity.code === 'string' ? identity.code.trim().toUpperCase() : '';
    if (
      !SAFE_DOCUMENT_ID_PATTERN.test(id)
      || !SAFE_AFFILIATE_CODE_PATTERN.test(code)
      || identities.has(id)
      || [...identities.values()].includes(code)
    ) {
      fail('precondition', 'invalid_proof_affiliate_set', 'The controlled proof affiliate set is invalid.');
    }
    identities.set(id, code);
  }
  if (identities.get(event.affiliateId) !== event.affiliateCode) {
    fail('precondition', 'proof_affiliate_mismatch', 'The controlled proof event does not belong to a reconciled founding affiliate.');
  }

  const observedAt = firestoreSnapshotTimeIso(input.firestoreSnapshot);
  const observedMs = firestoreSnapshotTimeMillis(input.firestoreSnapshot);
  const createdAt = firestoreTimestampIso(input.createTime);
  const createdMs = firestoreTimestampMilliseconds(input.createTime);
  const updatedAt = firestoreTimestampIso(input.updateTime);
  const eventMs = Date.parse(event.timestamp);
  if (
    !observedAt
    || observedMs === null
    || !createdAt
    || createdMs === null
    || !updatedAt
    || !sameTimestamp(input.createTime, input.updateTime)
    || createdMs < eventMs
    || createdMs - eventMs > AFFILIATE_CLICK_ACTIVATION_MAX_CLOCK_DRIFT_MS
    || observedMs < createdMs
    || observedMs - eventMs > AFFILIATE_CLICK_ACTIVATION_MAX_PROOF_EVENT_AGE_MS
  ) {
    fail('precondition', 'stale_or_mutable_proof_event', 'The controlled durable-click proof event is stale, mutable, or lacks authoritative time.');
  }

  return {
    eventTimestamp: event.timestamp,
    createdAt,
    observedAt,
    keyFingerprint: event.keyFingerprint,
    eventEvidenceSha256: evidenceHash('affiliate-click-proof-event', {
      event,
      createTime: firestoreTimestampParts(input.createTime),
      updateTime: firestoreTimestampParts(input.updateTime),
    }),
  };
}

export function buildAffiliateClickActivationMarker(input: {
  authoritativeSnapshot: unknown;
  leadMinutes: number;
  keyFingerprint: string;
}): AffiliateClickAnalyticsActivationV1 {
  const activatedAt = firestoreSnapshotTimeIso(input.authoritativeSnapshot);
  if (!activatedAt) {
    fail('precondition', 'invalid_authoritative_time', 'A valid authoritative Firestore read time is required.');
  }
  if (
    !Number.isSafeInteger(input.leadMinutes)
    || input.leadMinutes < AFFILIATE_CLICK_ACTIVATION_MIN_LEAD_MINUTES
    || input.leadMinutes > AFFILIATE_CLICK_ACTIVATION_MAX_LEAD_MINUTES
  ) {
    fail('precondition', 'lead_minutes_out_of_range', 'Activation lead minutes are outside the safe range.');
  }
  if (!KEY_FINGERPRINT_PATTERN.test(input.keyFingerprint)) {
    fail('precondition', 'invalid_key_fingerprint', 'The click-key fingerprint is invalid.');
  }
  const completeFromMs = Date.parse(activatedAt) + input.leadMinutes * 60_000;
  let completeFrom: string;
  try {
    if (!Number.isSafeInteger(completeFromMs) || Math.abs(completeFromMs) > 8.64e15) {
      fail('precondition', 'invalid_activation_boundary', 'The activation boundary is outside the supported time range.');
    }
    completeFrom = new Date(completeFromMs).toISOString();
  } catch (error) {
    if (error instanceof AffiliateClickActivationSafeError) throw error;
    fail('precondition', 'invalid_activation_boundary', 'The activation boundary is outside the supported time range.');
  }
  const marker: AffiliateClickAnalyticsActivationV1 = {
    schemaVersion: 1,
    eventSchemaVersion: 2,
    activatedAt,
    completeFrom,
    keyVersion: 'v1',
    keyFingerprint: input.keyFingerprint,
  };
  if (!normalizeAffiliateClickAnalyticsActivationV1(marker)) {
    fail('precondition', 'invalid_activation_marker', 'The activation marker could not be built safely.');
  }
  return marker;
}

export function assertExactAffiliateClickActivationMarker(
  value: unknown,
): AffiliateClickAnalyticsActivationV1 {
  const marker = normalizeAffiliateClickAnalyticsActivationV1(value);
  if (!marker) {
    fail('conflict', 'invalid_activation_marker', 'The existing activation marker is invalid or unsupported.');
  }
  return marker;
}

function sameTimestamp(left: unknown, right: unknown): boolean {
  const leftParts = firestoreTimestampParts(left);
  const rightParts = firestoreTimestampParts(right);
  return Boolean(
    leftParts
    && rightParts
    && leftParts.seconds === rightParts.seconds
    && leftParts.nanoseconds === rightParts.nanoseconds,
  );
}

export interface AffiliateClickActivationMarkerEvidence {
  marker: AffiliateClickAnalyticsActivationV1;
  createdAt: string;
  updatedAt: string;
  evidenceSha256: string;
}

/** Apply must stop on any pre-existing marker, including an identical one. */
export function assertAffiliateClickActivationMarkerAbsentForApply(exists: unknown): void {
  if (exists !== false) {
    fail('conflict', 'activation_marker_exists', 'A durable-click activation marker already exists; apply was refused.');
  }
}

export function assertImmutableAffiliateClickActivationMarker(input: {
  value: unknown;
  createTime: unknown;
  updateTime: unknown;
  expected?: AffiliateClickAnalyticsActivationV1;
}): AffiliateClickActivationMarkerEvidence {
  const marker = assertExactAffiliateClickActivationMarker(input.value);
  const createdAt = firestoreTimestampIso(input.createTime);
  const updatedAt = firestoreTimestampIso(input.updateTime);
  if (
    !createdAt
    || !updatedAt
    || !sameTimestamp(input.createTime, input.updateTime)
    || Date.parse(createdAt) < Date.parse(marker.activatedAt)
    || Date.parse(createdAt) >= Date.parse(marker.completeFrom)
  ) {
    fail('conflict', 'mutable_activation_marker', 'The activation marker is not an immutable create-only record.');
  }
  if (input.expected && activationCanonicalJson(marker) !== activationCanonicalJson(input.expected)) {
    fail('conflict', 'activation_marker_conflict', 'The existing activation marker conflicts with the requested activation.');
  }
  return {
    marker,
    createdAt,
    updatedAt,
    evidenceSha256: evidenceHash('affiliate-click-activation-marker', {
      marker,
      createTime: firestoreTimestampParts(input.createTime),
      updateTime: firestoreTimestampParts(input.updateTime),
    }),
  };
}

export type AffiliateClickActivationReportStatus = 'ready' | 'created';

export interface AffiliateClickActivationRedactedReport {
  schemaVersion: 1;
  mode: AffiliateClickActivationMode;
  status: AffiliateClickActivationReportStatus;
  target: {
    projectId: string;
    databaseId: string;
    stagingAllowlistSha256: string;
    serviceAccountProjectSha256: string;
    serviceAccountIdentitySha256: string;
    credentialSource: 'FIREBASE_SERVICE_ACCOUNT_JSON';
  };
  backup: AffiliateClickActivationBackupEvidence;
  liveState: AffiliateClickActivationLiveStateEvidence;
  runtime: {
    keyFingerprint: string;
    deploymentEvidenceSha256: string;
  };
  proof: AffiliateClickActivationProofEvidence;
  clock: AffiliateClickActivationClockEvidence;
  founding: AffiliateClickActivationFoundingEvidence;
  marker: {
    schemaVersion: 1;
    eventSchemaVersion: 2;
    activatedAt: string;
    completeFrom: string;
    keyVersion: 'v1';
    keyFingerprint: string;
    evidenceSha256: string;
    createdAt?: string;
  };
  reportEvidenceSha256: string;
}

export function buildRedactedAffiliateClickActivationReport(input: {
  mode: AffiliateClickActivationMode;
  status: AffiliateClickActivationReportStatus;
  target: AffiliateClickActivationTargetEvidence;
  backup: AffiliateClickActivationBackupEvidence;
  liveState: AffiliateClickActivationLiveStateEvidence;
  keyFingerprint: string;
  deploymentEvidence: string;
  proof: AffiliateClickActivationProofEvidence;
  clock: AffiliateClickActivationClockEvidence;
  founding: AffiliateClickActivationFoundingEvidence;
  marker: AffiliateClickAnalyticsActivationV1;
  markerEvidence?: AffiliateClickActivationMarkerEvidence;
}): AffiliateClickActivationRedactedReport {
  const markerEvidenceSha256 = input.markerEvidence?.evidenceSha256
    || evidenceHash('affiliate-click-activation-plan', input.marker);
  const reportWithoutHash = {
    schemaVersion: 1 as const,
    mode: input.mode,
    status: input.status,
    target: { ...input.target },
    backup: { ...input.backup },
    liveState: { ...input.liveState },
    runtime: {
      keyFingerprint: input.keyFingerprint,
      deploymentEvidenceSha256: evidenceHash('required-deployment-evidence', input.deploymentEvidence),
    },
    proof: { ...input.proof },
    clock: { ...input.clock },
    founding: { ...input.founding },
    marker: {
      ...input.marker,
      evidenceSha256: markerEvidenceSha256,
      ...(input.markerEvidence ? { createdAt: input.markerEvidence.createdAt } : {}),
    },
  };
  return {
    ...reportWithoutHash,
    reportEvidenceSha256: evidenceHash('affiliate-click-activation-report', reportWithoutHash),
  };
}

export interface AffiliateClickActivationSafeFailure {
  status: 'error';
  code: string;
  message: string;
  exitCode: number;
}

/** Convert any thrown value to a bounded, non-provider, non-secret failure. */
export function safeAffiliateClickActivationFailure(
  error: unknown,
): AffiliateClickActivationSafeFailure {
  if (error instanceof AffiliateClickActivationSafeError) {
    return {
      status: 'error',
      code: error.safeCode,
      message: error.message,
      exitCode: error.exitCode,
    };
  }
  return {
    status: 'error',
    code: 'activation_failed',
    message: 'Affiliate click activation failed safely.',
    exitCode: AFFILIATE_CLICK_ACTIVATION_EXIT_CODES.firestore,
  };
}
