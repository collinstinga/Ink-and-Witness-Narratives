import type { Firestore } from 'firebase-admin/firestore';
import { getFirestoreClientTarget } from '../src/server/db.js';
import {
  FOUNDING_AFFILIATE_COUNT,
  assertStagingTarget,
  type FirebaseTarget,
} from './literary-circle-migration-lib.js';

const PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{4,29}[a-z0-9]$/;
const DATABASE_ID_PATTERN = /^(?:\(default\)|[A-Za-z0-9][A-Za-z0-9._-]{0,62})$/;

/** Only errors created here may be shown by the migration CLI. */
export class LiteraryCircleMigrationSafeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LiteraryCircleMigrationSafeError';
  }
}

export interface LiteraryCircleMigrationOptions {
  mode: 'dry-run' | 'apply';
  environment?: string;
  expectedProject: string;
  expectedDatabase: string;
  expectedAffiliates: number;
  backupPath?: string;
}

export function parseLiteraryCircleMigrationArgs(
  argv: readonly string[],
  environment = process.env.LITERARY_CIRCLE_ENV,
): LiteraryCircleMigrationOptions {
  const values = new Map<string, string>();
  const permitted = new Set([
    'environment', 'expected-project', 'expected-database', 'expected-affiliates', 'backup',
  ]);
  let apply = false;
  for (const argument of argv) {
    if (argument === '--apply') {
      if (apply) throw new LiteraryCircleMigrationSafeError('Duplicate migration argument.');
      apply = true;
      continue;
    }
    const match = /^--([a-z-]+)=(.+)$/.exec(argument);
    if (!match || !permitted.has(match[1])) {
      throw new LiteraryCircleMigrationSafeError('Unsupported or empty migration argument.');
    }
    const [, key, value] = match;
    if (values.has(key)) throw new LiteraryCircleMigrationSafeError('Duplicate migration argument.');
    if (value !== value.trim()) throw new LiteraryCircleMigrationSafeError('Migration arguments must not contain surrounding whitespace.');
    values.set(key, value);
  }
  const expectedProject = values.get('expected-project') || '';
  const expectedDatabase = values.get('expected-database') || '';
  if (!PROJECT_ID_PATTERN.test(expectedProject)) {
    throw new LiteraryCircleMigrationSafeError('A valid --expected-project is required.');
  }
  if (!DATABASE_ID_PATTERN.test(expectedDatabase)) {
    throw new LiteraryCircleMigrationSafeError('A valid explicit --expected-database is required.');
  }
  if (values.get('expected-affiliates') !== String(FOUNDING_AFFILIATE_COUNT)) {
    throw new LiteraryCircleMigrationSafeError(`This migration requires --expected-affiliates=${FOUNDING_AFFILIATE_COUNT}.`);
  }
  const backupPath = values.get('backup');
  if (apply && !backupPath) {
    throw new LiteraryCircleMigrationSafeError('--apply requires --backup=<data/backups/.../manifest.json>.');
  }
  return {
    mode: apply ? 'apply' : 'dry-run',
    environment: values.get('environment') || environment,
    expectedProject,
    expectedDatabase,
    expectedAffiliates: FOUNDING_AFFILIATE_COUNT,
    ...(backupPath ? { backupPath } : {}),
  };
}

/** Pure credential/database validation; never tries ADC or initializes a client. */
export function assertMigrationCredentialTarget(input: {
  expectedProject: string;
  expectedDatabase: string;
  target: FirebaseTarget;
  serviceAccount: unknown;
}): void {
  if (
    !PROJECT_ID_PATTERN.test(input.expectedProject)
    || !DATABASE_ID_PATTERN.test(input.expectedDatabase)
    || input.expectedProject !== input.target.projectId
    || input.expectedDatabase !== input.target.databaseId
  ) {
    throw new LiteraryCircleMigrationSafeError('The resolved Firebase project and database must exactly match the explicit staging target.');
  }
  let account: unknown;
  try {
    if (typeof input.serviceAccount !== 'string' || !input.serviceAccount.trim() || input.serviceAccount.length > 65_536) {
      throw new Error();
    }
    account = JSON.parse(input.serviceAccount);
  } catch {
    throw new LiteraryCircleMigrationSafeError('An explicit valid FIREBASE_SERVICE_ACCOUNT_JSON staging credential is required; ADC is not allowed.');
  }
  const record = account && typeof account === 'object' && !Array.isArray(account)
    ? account as Record<string, unknown>
    : {};
  const clientEmail = typeof record.client_email === 'string' ? record.client_email : '';
  const privateKey = typeof record.private_key === 'string' ? record.private_key.trim() : '';
  if (
    record.type !== 'service_account'
    || record.project_id !== input.target.projectId
    || clientEmail.length > 320
    || !/^[^@\s]+@[^@\s]+$/.test(clientEmail)
    || !clientEmail.endsWith(`@${input.target.projectId}.iam.gserviceaccount.com`)
    || !privateKey.startsWith('-----BEGIN PRIVATE KEY-----')
    || !privateKey.endsWith('-----END PRIVATE KEY-----')
  ) {
    throw new LiteraryCircleMigrationSafeError('The explicit service-account identity must belong to the exact staging project.');
  }
}

export function assertConfiguredMigrationTarget(
  options: LiteraryCircleMigrationOptions,
  target: FirebaseTarget,
): void {
  try {
    assertStagingTarget({ environment: options.environment, expectedProject: options.expectedProject, target });
  } catch {
    throw new LiteraryCircleMigrationSafeError('Migration requires an allowlisted non-production staging target with no emulators or production process environment.');
  }
  assertMigrationCredentialTarget({
    expectedProject: options.expectedProject,
    expectedDatabase: options.expectedDatabase,
    target,
    serviceAccount: process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
  });
}

/** Check recorded client construction metadata, not mutable environment labels. */
export function assertMigrationFirestoreTarget(db: Firestore, target: FirebaseTarget): void {
  const binding = getFirestoreClientTarget(db);
  if (!binding || binding.projectId !== target.projectId || binding.firestoreDatabaseId !== target.databaseId) {
    throw new LiteraryCircleMigrationSafeError('The initialized Firestore client is not bound to the verified staging project and database.');
  }
}
