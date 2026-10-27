import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { AffiliateAccount, AffiliateLiteraryCircleMembership } from '../src/types.js';
import { getDb, resolveFirestoreTargetConfig } from '../src/server/db.js';

export const AFFILIATE_BACKUP_SCHEMA_VERSION = 9 as const;
export const LITERARY_CIRCLE_MIGRATION_ID = 'literary-circle-founding-affiliates-v1';
export const FOUNDING_AFFILIATE_COUNT = 9;
export const KNOWN_PRODUCTION_FIREBASE_PROJECT_IDS = [
  'ink-and-witness-narratives',
  'divine-experience-pq6d2'
] as const;

const LITERARY_CIRCLE_RESOURCES_DOCUMENT_ID = 'literary_circle_resources';
const AFFILIATE_NOTIFICATION_SETTINGS_DOCUMENT_ID = 'affiliate_notifications';
const LITERARY_CIRCLE_RESOURCE_ASSETS_DATASET_KEY = 'literary_circle_resource_assets';
const SAFE_FIREBASE_PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{4,29}[a-z0-9]$/;

export interface FirebaseTarget {
  projectId: string;
  databaseId: string;
}

export interface BackupDocument {
  id: string;
  data: Record<string, unknown>;
}

export interface BackupDatasetDefinition {
  key: string;
  collection: string;
  fileName: string;
  scope: 'all_documents' | 'affiliate_attributed_only' | 'explicit_documents';
  documentIds?: readonly string[];
  sumFields: Readonly<Record<string, readonly string[]>>;
}

export interface BackupDatasetPayload {
  schemaVersion: typeof AFFILIATE_BACKUP_SCHEMA_VERSION;
  key: string;
  collection: string;
  scope: BackupDatasetDefinition['scope'];
  documents: BackupDocument[];
}

export interface BackupDatasetManifestEntry {
  key: string;
  collection: string;
  scope: BackupDatasetDefinition['scope'];
  fileName: string;
  sha256: string;
  count: number;
  sums: Record<string, number>;
}

export interface AffiliateBackupManifest {
  schemaVersion: typeof AFFILIATE_BACKUP_SCHEMA_VERSION;
  backupId: string;
  createdAt: string;
  projectId: string;
  databaseId: string;
  datasets: BackupDatasetManifestEntry[];
  contentSha256: string;
}

export interface VerifiedAffiliateBackup {
  directory: string;
  manifest: AffiliateBackupManifest;
  payloads: Map<string, BackupDatasetPayload>;
}

const EMPTY_SUM_FIELDS = {} as const;

/**
 * The complete persisted affiliate history needed for this upgrade. Active
 * session documents are intentionally excluded: they are revocable bearer
 * credentials, not historical or financial records.
 */
export const AFFILIATE_BACKUP_DATASETS: readonly BackupDatasetDefinition[] = [
  {
    key: 'affiliates',
    collection: 'affiliates',
    fileName: 'affiliates.json',
    scope: 'all_documents',
    sumFields: {
      totalClicks: ['totalClicks'],
      uniqueVisitors: ['uniqueVisitors'],
      totalSalesCount: ['totalSalesCount'],
      totalRevenueKes: ['totalRevenueKes'],
      totalCommissionEarnedKes: ['totalCommissionEarnedKes'],
      totalCommissionPaidKes: ['totalCommissionPaidKes'],
      balanceAvailableKes: ['balanceAvailableKes'],
      balancePendingKes: ['balancePendingKes']
    }
  },
  {
    key: 'affiliate_commissions',
    collection: 'affiliate_commissions',
    fileName: 'affiliate_commissions.json',
    scope: 'all_documents',
    sumFields: {
      saleAmountKes: ['saleAmountKes'],
      commissionAmountKes: ['commissionAmountKes'],
      grossCreatorRevenueKes: ['grossCreatorRevenueKes']
    }
  },
  {
    key: 'affiliate_tier_periods',
    collection: 'affiliate_tier_periods',
    fileName: 'affiliate_tier_periods.json',
    scope: 'all_documents',
    sumFields: EMPTY_SUM_FIELDS
  },
  {
    key: 'affiliate_financial_adjustments',
    collection: 'affiliate_financial_adjustments',
    fileName: 'affiliate_financial_adjustments.json',
    scope: 'all_documents',
    sumFields: { amountMinor: ['amountMinor'], walletDeltaKes: ['walletDeltaKes'] }
  },
  {
    key: 'affiliate_financial_adjustment_summaries',
    collection: 'affiliate_financial_adjustment_summaries',
    fileName: 'affiliate_financial_adjustment_summaries.json',
    scope: 'all_documents',
    // These contain different summary kinds. Never sum them together.
    sumFields: EMPTY_SUM_FIELDS
  },
  {
    key: 'affiliate_financial_adjustment_claims',
    collection: 'affiliate_financial_adjustment_claims',
    fileName: 'affiliate_financial_adjustment_claims.json',
    scope: 'all_documents',
    sumFields: EMPTY_SUM_FIELDS
  },
  {
    key: 'affiliate_clicks',
    collection: 'affiliate_clicks',
    fileName: 'affiliate_clicks.json',
    scope: 'all_documents',
    sumFields: EMPTY_SUM_FIELDS
  },
  {
    key: 'affiliate_payouts',
    collection: 'affiliate_payouts',
    fileName: 'affiliate_payouts.json',
    scope: 'all_documents',
    sumFields: { amountKes: ['amountKes'] }
  },
  {
    key: 'affiliate_campaigns',
    collection: 'affiliate_campaigns',
    fileName: 'affiliate_campaigns.json',
    scope: 'all_documents',
    sumFields: {
      clicksCount: ['clicksCount'],
      salesCount: ['salesCount'],
      revenueKes: ['revenueKes'],
      commissionsKes: ['commissionsKes']
    }
  },
  {
    key: 'affiliate_audit',
    collection: 'affiliate_audit',
    fileName: 'affiliate_audit.json',
    scope: 'all_documents',
    sumFields: EMPTY_SUM_FIELDS
  },
  {
    key: 'affiliate_codes',
    collection: 'affiliate_codes',
    fileName: 'affiliate_codes.json',
    scope: 'all_documents',
    sumFields: EMPTY_SUM_FIELDS
  },
  {
    key: 'affiliate_emails',
    collection: 'affiliate_emails',
    fileName: 'affiliate_emails.json',
    scope: 'all_documents',
    sumFields: EMPTY_SUM_FIELDS
  },
  {
    key: 'affiliate_commission_outbox',
    collection: 'affiliate_commission_outbox',
    fileName: 'affiliate_commission_outbox.json',
    scope: 'all_documents',
    sumFields: EMPTY_SUM_FIELDS
  },
  {
    key: 'affiliate_attribution_claims',
    collection: 'affiliate_attribution_claims',
    fileName: 'affiliate_attribution_claims.json',
    scope: 'all_documents',
    sumFields: EMPTY_SUM_FIELDS
  },
  {
    key: 'affiliate_notification_outbox',
    collection: 'affiliate_notification_outbox',
    fileName: 'affiliate_notification_outbox.json',
    scope: 'all_documents',
    sumFields: EMPTY_SUM_FIELDS
  },
  {
    key: 'newsletter_campaigns',
    collection: 'newsletter_campaigns',
    fileName: 'newsletter_campaigns.json',
    scope: 'all_documents',
    sumFields: EMPTY_SUM_FIELDS
  },
  {
    key: 'affiliate_notification_deliveries',
    collection: 'affiliate_notification_deliveries',
    fileName: 'affiliate_notification_deliveries.json',
    scope: 'all_documents',
    sumFields: EMPTY_SUM_FIELDS
  },
  {
    key: 'release_source_articles',
    collection: 'articles',
    fileName: 'release_source_articles.json',
    scope: 'all_documents',
    sumFields: EMPTY_SUM_FIELDS
  },
  {
    key: 'affiliate_click_activation_marker',
    collection: 'site_configs',
    fileName: 'affiliate_click_activation_marker.json',
    scope: 'explicit_documents',
    documentIds: ['affiliate_click_analytics'],
    sumFields: EMPTY_SUM_FIELDS
  },
  {
    key: 'literary_circle_migration_markers',
    collection: 'migration_markers',
    fileName: 'literary_circle_migration_markers.json',
    scope: 'explicit_documents',
    documentIds: [LITERARY_CIRCLE_MIGRATION_ID],
    sumFields: EMPTY_SUM_FIELDS
  },
  {
    key: 'affiliate_transactions',
    collection: 'transactions',
    fileName: 'affiliate_transactions.json',
    scope: 'affiliate_attributed_only',
    sumFields: {
      amountKes: ['amount'],
      originalAmount: ['originalAmount'],
      commissionAmountKes: ['commission', 'amountKes']
    }
  },
  {
    key: 'affiliate_site_configs',
    collection: 'site_configs',
    fileName: 'affiliate_site_configs.json',
    scope: 'explicit_documents',
    documentIds: [
      'affiliate_settings',
      'affiliate_literary_circle',
      LITERARY_CIRCLE_RESOURCES_DOCUMENT_ID,
      AFFILIATE_NOTIFICATION_SETTINGS_DOCUMENT_ID,
      'affiliate_notification_delivery'
    ],
    sumFields: EMPTY_SUM_FIELDS
  },
  {
    key: LITERARY_CIRCLE_RESOURCE_ASSETS_DATASET_KEY,
    collection: 'uploaded_assets',
    fileName: 'literary_circle_resource_assets.json',
    scope: 'explicit_documents',
    sumFields: EMPTY_SUM_FIELDS
  }
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function literaryCircleResourceAssetIds(
  siteConfigPayload: BackupDatasetPayload | undefined
): string[] {
  const resources = siteConfigPayload?.documents.find(
    document => document.id === LITERARY_CIRCLE_RESOURCES_DOCUMENT_ID
  );
  const items = Array.isArray(resources?.data.items) ? resources.data.items : [];
  const assetIds = new Set<string>();
  for (const item of items) {
    if (!isRecord(item) || typeof item.assetId !== 'string') continue;
    const assetId = item.assetId.trim();
    if (assetId) assetIds.add(assetId);
  }
  return [...assetIds].sort((left, right) => left.localeCompare(right));
}

function assertLiteraryCircleResourceAssetClosure(
  payloads: ReadonlyMap<string, BackupDatasetPayload>
): void {
  const expectedIds = literaryCircleResourceAssetIds(payloads.get('affiliate_site_configs'));
  const assetPayload = payloads.get(LITERARY_CIRCLE_RESOURCE_ASSETS_DATASET_KEY);
  if (!assetPayload) {
    throw new Error('Backup is missing the Literary Circle resource-assets dataset.');
  }
  const actualIds = assetPayload.documents.map(document => document.id).sort((left, right) => left.localeCompare(right));
  if (canonicalJson(actualIds) !== canonicalJson(expectedIds)) {
    throw new Error('Literary Circle resource-assets backup must exactly match every asset referenced by the resource library.');
  }
}

function sortedJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedJsonValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map(key => [key, sortedJsonValue(value[key])])
  );
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortedJsonValue(value));
}

export function prettyStableJson(value: unknown): string {
  return `${JSON.stringify(sortedJsonValue(value), null, 2)}\n`;
}

export function sha256Hex(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function encodeNumber(value: number): unknown {
  if (Number.isNaN(value)) return { $firestoreType: 'number', value: 'NaN' };
  if (value === Number.POSITIVE_INFINITY) return { $firestoreType: 'number', value: 'Infinity' };
  if (value === Number.NEGATIVE_INFINITY) return { $firestoreType: 'number', value: '-Infinity' };
  return value;
}

/** Convert Firestore-specific values to lossless, deterministic JSON. */
export function encodeFirestoreValue(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return encodeNumber(value);
  if (value instanceof Date) return { $firestoreType: 'date', iso: value.toISOString() };
  if (Buffer.isBuffer(value)) return { $firestoreType: 'bytes', base64: value.toString('base64') };
  if (value instanceof Uint8Array) {
    return { $firestoreType: 'bytes', base64: Buffer.from(value).toString('base64') };
  }
  if (Array.isArray(value)) return value.map(item => encodeFirestoreValue(item));
  if (!isRecord(value)) return String(value);

  const constructorName = value.constructor?.name;
  if (constructorName === 'Timestamp' && typeof value.toDate === 'function') {
    const timestamp = value as { seconds?: number; _seconds?: number; nanoseconds?: number; _nanoseconds?: number };
    return {
      $firestoreType: 'timestamp',
      seconds: timestamp.seconds ?? timestamp._seconds ?? 0,
      nanoseconds: timestamp.nanoseconds ?? timestamp._nanoseconds ?? 0
    };
  }
  if (constructorName === 'GeoPoint' && typeof value.latitude === 'number' && typeof value.longitude === 'number') {
    return { $firestoreType: 'geopoint', latitude: value.latitude, longitude: value.longitude };
  }
  if (constructorName === 'DocumentReference' && typeof value.path === 'string') {
    return { $firestoreType: 'reference', path: value.path };
  }

  const encoded: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (nestedValue !== undefined) encoded[key] = encodeFirestoreValue(nestedValue);
  }
  return encoded;
}

function numericValueAtPath(value: Record<string, unknown>, fieldPath: readonly string[]): number {
  let current: unknown = value;
  for (const segment of fieldPath) {
    if (!isRecord(current)) return 0;
    current = current[segment];
  }
  return typeof current === 'number' && Number.isFinite(current) ? current : 0;
}

function normalizedSum(value: number): number {
  return Number(value.toFixed(6));
}

export function summarizeDatasetDocuments(
  documents: readonly BackupDocument[],
  definition: BackupDatasetDefinition
): { count: number; sums: Record<string, number> } {
  const sums: Record<string, number> = {};
  for (const [sumName, fieldPath] of Object.entries(definition.sumFields)) {
    sums[sumName] = normalizedSum(
      documents.reduce((total, document) => total + numericValueAtPath(document.data, fieldPath), 0)
    );
  }
  return { count: documents.length, sums };
}

export function isAffiliateAttributedTransaction(data: Record<string, unknown>): boolean {
  const meaningful = (value: unknown) => typeof value === 'string' && value.trim().length > 0;
  const commission = isRecord(data.commission) ? data.commission : undefined;
  return meaningful(data.affiliateCode)
    || meaningful(data.campaignCode)
    || meaningful(data.affiliateAttributionClaimId)
    || meaningful(data.affiliateAttributionAt)
    || meaningful(data.affiliateAttributionExpiresAt)
    || meaningful(data.commissionId)
    || Boolean(commission && (meaningful(commission.affiliateId) || meaningful(commission.affiliateCode)));
}

export function buildDatasetPayload(
  definition: BackupDatasetDefinition,
  documents: readonly BackupDocument[]
): BackupDatasetPayload {
  const encodedDocuments = documents
    .map(document => ({
      id: document.id,
      data: encodeFirestoreValue(document.data) as Record<string, unknown>
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return {
    schemaVersion: AFFILIATE_BACKUP_SCHEMA_VERSION,
    key: definition.key,
    collection: definition.collection,
    scope: definition.scope,
    documents: encodedDocuments
  };
}

export function buildBackupManifest(options: {
  backupId: string;
  createdAt: string;
  target: FirebaseTarget;
  payloadFiles: ReadonlyMap<string, { payload: BackupDatasetPayload; contents: string }>;
}): AffiliateBackupManifest {
  const datasets = AFFILIATE_BACKUP_DATASETS.map(definition => {
    const entry = options.payloadFiles.get(definition.key);
    if (!entry) throw new Error(`Backup payload is missing required dataset ${definition.key}.`);
    const summary = summarizeDatasetDocuments(entry.payload.documents, definition);
    return {
      key: definition.key,
      collection: definition.collection,
      scope: definition.scope,
      fileName: definition.fileName,
      sha256: sha256Hex(entry.contents),
      ...summary
    };
  });
  const unsigned = {
    schemaVersion: AFFILIATE_BACKUP_SCHEMA_VERSION,
    backupId: options.backupId,
    createdAt: options.createdAt,
    projectId: options.target.projectId,
    databaseId: options.target.databaseId,
    datasets
  };
  return { ...unsigned, contentSha256: sha256Hex(canonicalJson(unsigned)) };
}

export async function captureAffiliateDatasets(
  db: ReturnType<typeof getDb> = getDb()
): Promise<Map<string, BackupDatasetPayload>> {
  const payloads = new Map<string, BackupDatasetPayload>();
  for (const definition of AFFILIATE_BACKUP_DATASETS) {
    let documents: BackupDocument[];
    if (definition.scope === 'explicit_documents') {
      const documentIds = definition.key === LITERARY_CIRCLE_RESOURCE_ASSETS_DATASET_KEY
        ? literaryCircleResourceAssetIds(payloads.get('affiliate_site_configs'))
        : definition.documentIds || [];
      const snapshots = await Promise.all(
        documentIds.map(documentId => db.collection(definition.collection).doc(documentId).get())
      );
      if (definition.key === LITERARY_CIRCLE_RESOURCE_ASSETS_DATASET_KEY) {
        const missingIds = snapshots
          .map((snapshot, index) => snapshot.exists ? undefined : documentIds[index])
          .filter((documentId): documentId is string => Boolean(documentId));
        if (missingIds.length) {
          throw new Error(
            `Literary Circle resource library references missing uploaded_assets documents: ${missingIds.join(', ')}.`
          );
        }
      }
      documents = snapshots
        .filter(snapshot => snapshot.exists)
        .map(snapshot => ({ id: snapshot.id, data: snapshot.data() as Record<string, unknown> }));
    } else {
      const snapshot = await db.collection(definition.collection).get();
      documents = snapshot.docs.map(document => ({
        id: document.id,
        data: document.data() as Record<string, unknown>
      }));
      if (definition.scope === 'affiliate_attributed_only') {
        documents = documents.filter(document => isAffiliateAttributedTransaction(document.data));
      }
    }
    payloads.set(definition.key, buildDatasetPayload(definition, documents));
  }
  assertLiteraryCircleResourceAssetClosure(payloads);
  return payloads;
}

export function writeAffiliateBackup(options: {
  payloads: ReadonlyMap<string, BackupDatasetPayload>;
  target: FirebaseTarget;
  now?: string;
  cwd?: string;
}): { directory: string; manifestPath: string; manifest: AffiliateBackupManifest } {
  assertLiteraryCircleResourceAssetClosure(options.payloads);
  const cwd = options.cwd || process.cwd();
  const createdAt = options.now || new Date().toISOString();
  const timestamp = createdAt.replace(/[^0-9A-Za-z]+/g, '-').replace(/-+$/g, '');
  const backupId = `literary-circle-${timestamp}-${crypto.randomBytes(4).toString('hex')}`;
  const root = backupRoot(cwd);
  const directory = path.join(root, backupId);
  const temporaryDirectory = path.join(root, `.${backupId}.tmp-${process.pid}`);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  assertInsideBackupRoot(directory, cwd);
  assertInsideBackupRoot(temporaryDirectory, cwd);
  if (fs.existsSync(directory) || fs.existsSync(temporaryDirectory)) {
    throw new Error('Backup destination already exists; retry to generate a new backup ID.');
  }

  const payloadFiles = new Map<string, { payload: BackupDatasetPayload; contents: string }>();
  for (const definition of AFFILIATE_BACKUP_DATASETS) {
    const payload = options.payloads.get(definition.key);
    if (!payload) throw new Error(`Cannot write backup without ${definition.key}.`);
    payloadFiles.set(definition.key, { payload, contents: prettyStableJson(payload) });
  }
  const manifest = buildBackupManifest({ backupId, createdAt, target: options.target, payloadFiles });

  try {
    fs.mkdirSync(temporaryDirectory, { mode: 0o700 });
    for (const definition of AFFILIATE_BACKUP_DATASETS) {
      const payloadFile = payloadFiles.get(definition.key);
      if (!payloadFile) throw new Error(`Cannot write backup without ${definition.key}.`);
      fs.writeFileSync(path.join(temporaryDirectory, definition.fileName), payloadFile.contents, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600
      });
    }
    fs.writeFileSync(path.join(temporaryDirectory, 'manifest.json'), prettyStableJson(manifest), {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600
    });
    fs.renameSync(temporaryDirectory, directory);
  } catch (error) {
    if (fs.existsSync(temporaryDirectory)) fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
  return { directory, manifestPath: path.join(directory, 'manifest.json'), manifest };
}

export function configuredFirebaseTarget(cwd = process.cwd()): FirebaseTarget {
  const target = resolveFirestoreTargetConfig(cwd);
  return { projectId: target.projectId, databaseId: target.firestoreDatabaseId };
}

export function assertReadOnlyBackupTarget(options: {
  environment?: string;
  expectedProject?: string;
  allowProductionReadOnly?: boolean;
  target: FirebaseTarget;
}): void {
  const environment = options.environment?.trim().toLowerCase();
  if (environment !== 'staging' && environment !== 'production') {
    throw new Error('Refusing database read: pass --environment=staging or --environment=production.');
  }
  if (!options.expectedProject || options.expectedProject !== options.target.projectId) {
    throw new Error('Refusing database read: --expected-project must exactly match the configured project.');
  }
  if (environment === 'production' && options.allowProductionReadOnly !== true) {
    throw new Error('Production backup requires the explicit --allow-production-read-only flag.');
  }
}

export function assertStagingTarget(options: {
  environment?: string;
  expectedProject?: string;
  target: FirebaseTarget;
}): void {
  if (options.environment?.trim().toLowerCase() !== 'staging') {
    throw new Error('Refusing database access: pass --environment=staging.');
  }
  if (!options.expectedProject || options.expectedProject !== options.target.projectId) {
    throw new Error('Refusing database access: --expected-project must exactly match the configured project.');
  }
  if (process.env.NODE_ENV?.trim().toLowerCase() === 'production' || process.env.VERCEL_ENV?.trim().toLowerCase() === 'production') {
    throw new Error('Refusing to run while the process environment is marked as production.');
  }
  if (
    process.env.FIRESTORE_EMULATOR_HOST?.trim()
    || process.env.FIREBASE_DATABASE_EMULATOR_HOST?.trim()
    || process.env.FIREBASE_AUTH_EMULATOR_HOST?.trim()
  ) {
    throw new Error('Refusing staging database access while a Firebase emulator is configured.');
  }
  const productionProjects = new Set([
    ...KNOWN_PRODUCTION_FIREBASE_PROJECT_IDS,
    ...(process.env.LITERARY_CIRCLE_PRODUCTION_PROJECT_IDS || '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean)
  ]);
  if (productionProjects.has(options.target.projectId)) {
    throw new Error('Refusing to run the staging migration against a known production Firebase project.');
  }
  const stagingProjects = [...new Set((process.env.LITERARY_CIRCLE_STAGING_PROJECT_IDS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean))];
  if (!stagingProjects.length || stagingProjects.some(projectId => !SAFE_FIREBASE_PROJECT_ID_PATTERN.test(projectId))) {
    throw new Error('Staging database access requires a valid explicit LITERARY_CIRCLE_STAGING_PROJECT_IDS allowlist.');
  }
  if (stagingProjects.some(projectId => productionProjects.has(projectId))) {
    throw new Error('Refusing staging database access because the staging allowlist overlaps a production project.');
  }
  if (!stagingProjects.includes(options.target.projectId)) {
    throw new Error('The configured Firebase project is not in the explicit staging project allowlist.');
  }
}

export function backupRoot(cwd = process.cwd()): string {
  return path.resolve(cwd, 'data', 'backups');
}

function assertInsideBackupRoot(candidate: string, cwd = process.cwd()): void {
  const root = backupRoot(cwd);
  const relative = path.relative(root, candidate);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    if (candidate === root) return;
    throw new Error('Backup path must be inside data/backups.');
  }
}

function manifestUnsignedValue(manifest: AffiliateBackupManifest): Omit<AffiliateBackupManifest, 'contentSha256'> {
  const { contentSha256: _contentSha256, ...unsigned } = manifest;
  return unsigned;
}

function safeJsonObject(value: unknown, description: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${description} must contain a JSON object.`);
  return value;
}

function assertSameJson(left: unknown, right: unknown, message: string): void {
  if (canonicalJson(left) !== canonicalJson(right)) throw new Error(message);
}

export function verifyAffiliateBackup(
  backupPath: string,
  options: { target: FirebaseTarget; expectedAffiliates: number; cwd?: string }
): VerifiedAffiliateBackup {
  const cwd = options.cwd || process.cwd();
  const supplied = path.resolve(cwd, backupPath);
  if (!fs.existsSync(supplied)) throw new Error('The requested backup path does not exist.');
  const suppliedStat = fs.statSync(supplied);
  const manifestPath = suppliedStat.isDirectory() ? path.join(supplied, 'manifest.json') : supplied;
  if (path.basename(manifestPath) !== 'manifest.json' || !fs.existsSync(manifestPath)) {
    throw new Error('Backup path must be a backup directory or its manifest.json file.');
  }
  const directory = fs.realpathSync(path.dirname(manifestPath));
  assertInsideBackupRoot(directory, cwd);

  const manifestValue = safeJsonObject(JSON.parse(fs.readFileSync(manifestPath, 'utf8')), 'Backup manifest');
  const manifest = manifestValue as unknown as AffiliateBackupManifest;
  if (manifest.schemaVersion !== AFFILIATE_BACKUP_SCHEMA_VERSION) {
    throw new Error('Unsupported affiliate backup schema version.');
  }
  if (manifest.projectId !== options.target.projectId || manifest.databaseId !== options.target.databaseId) {
    throw new Error('Backup target does not match the configured Firestore target.');
  }
  if (!Array.isArray(manifest.datasets) || manifest.datasets.length !== AFFILIATE_BACKUP_DATASETS.length) {
    throw new Error('Backup manifest does not contain the exact required dataset list.');
  }
  const expectedContentHash = sha256Hex(canonicalJson(manifestUnsignedValue(manifest)));
  if (manifest.contentSha256 !== expectedContentHash) throw new Error('Backup manifest integrity check failed.');

  const payloads = new Map<string, BackupDatasetPayload>();
  for (const definition of AFFILIATE_BACKUP_DATASETS) {
    const entry = manifest.datasets.find(candidate => candidate.key === definition.key);
    if (!entry) throw new Error(`Backup manifest is missing dataset ${definition.key}.`);
    if (
      entry.collection !== definition.collection
      || entry.scope !== definition.scope
      || entry.fileName !== definition.fileName
    ) {
      throw new Error(`Backup manifest definition mismatch for ${definition.key}.`);
    }
    if (path.basename(entry.fileName) !== entry.fileName) throw new Error('Backup dataset filename is unsafe.');
    const filePath = path.join(directory, entry.fileName);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      throw new Error(`Backup dataset file is missing for ${definition.key}.`);
    }
    const contents = fs.readFileSync(filePath, 'utf8');
    if (sha256Hex(contents) !== entry.sha256) throw new Error(`Backup hash check failed for ${definition.key}.`);
    const payload = safeJsonObject(JSON.parse(contents), definition.key) as unknown as BackupDatasetPayload;
    if (
      payload.schemaVersion !== AFFILIATE_BACKUP_SCHEMA_VERSION
      || payload.key !== definition.key
      || payload.collection !== definition.collection
      || payload.scope !== definition.scope
      || !Array.isArray(payload.documents)
    ) {
      throw new Error(`Backup payload definition mismatch for ${definition.key}.`);
    }
    const ids = payload.documents.map(document => document?.id);
    if (ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length) {
      throw new Error(`Backup dataset ${definition.key} contains invalid or duplicate document IDs.`);
    }
    const summary = summarizeDatasetDocuments(payload.documents, definition);
    if (summary.count !== entry.count) throw new Error(`Backup count check failed for ${definition.key}.`);
    assertSameJson(summary.sums, entry.sums, `Backup sum check failed for ${definition.key}.`);
    payloads.set(definition.key, payload);
  }

  assertLiteraryCircleResourceAssetClosure(payloads);

  const affiliates = payloads.get('affiliates');
  if (!affiliates || affiliates.documents.length !== options.expectedAffiliates) {
    throw new Error('Verified backup affiliate count does not match --expected-affiliates.');
  }
  return { directory, manifest, payloads };
}

/** Permit only an unchanged marker or the completed first apply tied to this backup. */
export function assertMigrationMarkerMatchesBackup(
  verified: VerifiedAffiliateBackup,
  documents: readonly BackupDocument[]
): void {
  const original = verified.payloads.get('literary_circle_migration_markers')?.documents;
  if (!original) throw new Error('Verified backup is missing migration marker evidence.');
  if (canonicalJson(original) === canonicalJson(documents)) return;
  const document = documents[0];
  const marker = document?.data;
  const expectedIds = (verified.payloads.get('affiliates')?.documents || []).map(item => item.id).sort();
  const isoMs = (value: unknown): number => {
    const milliseconds = typeof value === 'string' ? Date.parse(value) : NaN;
    return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value ? milliseconds : NaN;
  };
  const started = isoMs(marker?.startedAt);
  const completed = isoMs(marker?.completedAt);
  if (original.length || documents.length !== 1 || document.id !== migrationMarkerDocumentId() || !isRecord(marker)
    || Object.keys(marker).some(key => !['schemaVersion', 'migrationId', 'status', 'expectedAffiliateCount', 'completedAffiliateIds', 'completedCount', 'backupId', 'backupManifestSha256', 'startedAt', 'completedAt', 'lastAppliedAt', 'attemptCount'].includes(key))
    || marker.schemaVersion !== 1 || marker.migrationId !== LITERARY_CIRCLE_MIGRATION_ID || marker.status !== 'complete'
    || marker.backupId !== verified.manifest.backupId || marker.backupManifestSha256 !== verified.manifest.contentSha256
    || expectedIds.length !== FOUNDING_AFFILIATE_COUNT || marker.expectedAffiliateCount !== expectedIds.length
    || marker.completedCount !== expectedIds.length || canonicalJson(marker.completedAffiliateIds) !== canonicalJson(expectedIds)
    || marker.attemptCount !== 1 || !Number.isFinite(started) || !Number.isFinite(completed)
    || started < Date.parse(verified.manifest.createdAt) || completed < started || completed > Date.now()
    || marker.lastAppliedAt !== marker.completedAt) {
    throw new Error('Current migration marker differs from the verified backup or its exact completed first apply.');
  }
}

export function assertLiveStateMatchesBackup(
  verified: VerifiedAffiliateBackup,
  livePayloads: ReadonlyMap<string, BackupDatasetPayload>,
  options: { expectedMigrationMarker?: BackupDocument } = {}
): void {
  const backupAffiliates = verified.payloads.get('affiliates');
  const liveAffiliates = livePayloads.get('affiliates');
  if (!backupAffiliates || !liveAffiliates) throw new Error('Affiliate dataset is unavailable.');
  assertSameJson(
    backupAffiliates.documents.map(document => document.id).sort(),
    liveAffiliates.documents.map(document => document.id).sort(),
    'Current affiliate identities differ from the verified backup.'
  );

  for (const definition of AFFILIATE_BACKUP_DATASETS) {
    const backupPayload = verified.payloads.get(definition.key);
    const livePayload = livePayloads.get(definition.key);
    if (!backupPayload || !livePayload) throw new Error(`Live comparison is missing ${definition.key}.`);

    if (definition.key === 'literary_circle_migration_markers') {
      if (options.expectedMigrationMarker) {
        if (options.expectedMigrationMarker.id !== migrationMarkerDocumentId()) throw new Error('Unexpected migration marker identity.');
        assertSameJson(livePayload.documents, [options.expectedMigrationMarker], 'Post-migration marker differs from the committed transaction result.');
      } else {
        assertMigrationMarkerMatchesBackup(verified, livePayload.documents);
      }
      continue;
    }

    // A successful first run legitimately adds index documents, so subsequent
    // idempotency runs may have a larger index count or same-owner backfill
    // fields than the pre-migration backup. Every backed-up field must still
    // exist with the same value.
    if (definition.key === 'affiliate_codes' || definition.key === 'affiliate_emails') {
      const liveById = new Map(livePayload.documents.map(document => [document.id, document.data]));
      for (const backupDocument of backupPayload.documents) {
        const liveDocument = liveById.get(backupDocument.id);
        if (!liveDocument) throw new Error(`Current ${definition.key} is missing a verified backup document.`);
        for (const [key, value] of Object.entries(backupDocument.data)) {
          assertSameJson(
            liveDocument[key],
            value,
            `Current ${definition.key}/${backupDocument.id}.${key} differs from the verified backup.`
          );
        }
      }
      continue;
    }

    if (definition.key === 'affiliates') {
      const withoutCircle = (documents: readonly BackupDocument[]) => documents.map(document => {
        const { literaryCircle: _literaryCircle, ...preserved } = document.data;
        return { id: document.id, data: preserved };
      });
      assertSameJson(
        withoutCircle(livePayload.documents),
        withoutCircle(backupPayload.documents),
        'Current affiliate account fields differ from the verified backup.'
      );
      continue;
    }

    assertSameJson(
      livePayload.documents,
      backupPayload.documents,
      `Current ${definition.key} documents differ from the verified backup.`
    );
  }
}

function addMissingDefaults(defaultValue: unknown, existingValue: unknown, pathLabel: string): unknown {
  if (existingValue === undefined) return defaultValue;
  if (isRecord(defaultValue)) {
    if (!isRecord(existingValue)) {
      throw new Error(`Existing ${pathLabel} has an incompatible shape; migration refused.`);
    }
    const merged: Record<string, unknown> = { ...existingValue };
    for (const [key, nestedDefault] of Object.entries(defaultValue)) {
      merged[key] = addMissingDefaults(nestedDefault, existingValue[key], `${pathLabel}.${key}`);
    }
    return merged;
  }
  return existingValue;
}

export function mergeFoundingMembership(
  existing: unknown,
  seeded: AffiliateLiteraryCircleMembership,
  recognizedAt: string
): AffiliateLiteraryCircleMembership {
  const merged = addMissingDefaults(seeded, existing, 'literaryCircle') as Record<string, unknown>;
  const schemaVersion = merged.schemaVersion;
  if (schemaVersion !== seeded.schemaVersion) {
    throw new Error('Existing Literary Circle schema version is not supported by this migration.');
  }
  return {
    ...(merged as unknown as AffiliateLiteraryCircleMembership),
    foundingMember: true,
    foundingRecognizedAt: typeof merged.foundingRecognizedAt === 'string'
      ? merged.foundingRecognizedAt
      : recognizedAt
  };
}

export interface IndexReservationPlan {
  action: 'create' | 'backfill' | 'unchanged' | 'conflict';
  patch: Record<string, unknown>;
}

export function planIndexReservation(options: {
  existing: Record<string, unknown> | undefined;
  affiliateId: string;
  expectedFields: Record<string, unknown>;
}): IndexReservationPlan {
  if (!options.existing) return { action: 'create', patch: { ...options.expectedFields } };
  if (options.existing.affiliateId !== options.affiliateId) return { action: 'conflict', patch: {} };
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(options.expectedFields)) {
    if (options.existing[key] === undefined || options.existing[key] === null || options.existing[key] === '') {
      patch[key] = value;
    }
  }
  return { action: Object.keys(patch).length ? 'backfill' : 'unchanged', patch };
}

export function affiliateEmailIndexId(email: string): string {
  return sha256Hex(email.trim().toLowerCase());
}

export function affiliateCodeIndexId(code: string): string {
  return code.trim().toUpperCase();
}

export function validateFoundingAffiliateDocuments(
  documents: readonly BackupDocument[],
  expectedCount = FOUNDING_AFFILIATE_COUNT
): Array<{ documentId: string; affiliate: AffiliateAccount; codeIndexId: string; emailIndexId: string }> {
  if (documents.length !== expectedCount) throw new Error(`Expected exactly ${expectedCount} affiliate accounts.`);
  const result = documents.map(document => {
    const affiliate = document.data as unknown as AffiliateAccount;
    if (affiliate.id && affiliate.id !== document.id) {
      throw new Error('An affiliate document ID does not match its stored account ID.');
    }
    const codeIndexId = affiliateCodeIndexId(affiliate.affiliateCode || '');
    const normalizedEmail = (affiliate.email || '').trim().toLowerCase();
    if (!document.id || !codeIndexId || !normalizedEmail) {
      throw new Error('Every founding affiliate requires an ID, referral code, and email address.');
    }
    return { documentId: document.id, affiliate, codeIndexId, emailIndexId: affiliateEmailIndexId(normalizedEmail) };
  });
  if (new Set(result.map(item => item.codeIndexId)).size !== result.length) {
    throw new Error('Founding affiliate referral codes are not unique.');
  }
  if (new Set(result.map(item => item.emailIndexId)).size !== result.length) {
    throw new Error('Founding affiliate email identities are not unique.');
  }
  return result;
}

export function migrationMarkerDocumentId(): string {
  return LITERARY_CIRCLE_MIGRATION_ID;
}
