import type { Firestore } from 'firebase-admin/firestore';
import { getFirestoreClientTarget } from '../src/server/db.js';
import { FOUNDING_AFFILIATE_COUNT, KNOWN_PRODUCTION_FIREBASE_PROJECT_IDS, type FirebaseTarget } from './literary-circle-migration-lib.js';

const PROJECT_ID = /^[a-z][a-z0-9-]{4,29}[a-z0-9]$/;
const DATABASE_ID = /^(?:\(default\)|[A-Za-z0-9][A-Za-z0-9._-]{0,62})$/;
const GENERIC_FAILURE = 'Literary Circle backup failed safely. Verify the read-only target, access and backup prerequisites; provider details were suppressed.';

/** Only messages deliberately created by this boundary may reach CLI output. */
export class LiteraryCircleBackupSafeError extends Error {
  constructor(message: string) { super(message); this.name = 'LiteraryCircleBackupSafeError'; }
}

export interface LiteraryCircleBackupOptions {
  environment: 'staging' | 'production';
  expectedProject: string;
  expectedDatabase: string;
  expectedAffiliates: number;
  allowProductionReadOnly: boolean;
}

export function parseLiteraryCircleBackupArgs(
  argv: readonly string[], fallbackEnvironment = process.env.LITERARY_CIRCLE_ENV
): LiteraryCircleBackupOptions {
  const permitted = new Set(['environment', 'expected-project', 'expected-database', 'expected-affiliates']);
  const values = new Map<string, string>();
  let allowProductionReadOnly = false;
  for (const argument of argv) {
    if (argument === '--allow-production-read-only') {
      if (allowProductionReadOnly) throw new LiteraryCircleBackupSafeError('Duplicate backup argument.');
      allowProductionReadOnly = true;
      continue;
    }
    const match = /^--([a-z-]+)=(.+)$/.exec(argument);
    if (!match || !permitted.has(match[1])) throw new LiteraryCircleBackupSafeError('Unsupported or empty backup argument.');
    const [, key, value] = match;
    if (values.has(key)) throw new LiteraryCircleBackupSafeError('Duplicate backup argument.');
    if (value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) throw new LiteraryCircleBackupSafeError('Backup arguments must not contain whitespace padding or control characters.');
    values.set(key, value);
  }
  const environment = values.get('environment') || fallbackEnvironment;
  if (environment !== 'staging' && environment !== 'production') {
    throw new LiteraryCircleBackupSafeError('Backup requires --environment=staging or --environment=production.');
  }
  const expectedProject = values.get('expected-project') || '';
  const expectedDatabase = values.get('expected-database') || '';
  if (!PROJECT_ID.test(expectedProject)) throw new LiteraryCircleBackupSafeError('A valid explicit --expected-project is required.');
  if (!DATABASE_ID.test(expectedDatabase)) throw new LiteraryCircleBackupSafeError('A valid explicit --expected-database is required.');
  if (values.get('expected-affiliates') !== String(FOUNDING_AFFILIATE_COUNT)) {
    throw new LiteraryCircleBackupSafeError(`This backup requires --expected-affiliates=${FOUNDING_AFFILIATE_COUNT}.`);
  }
  if (environment === 'production' && !allowProductionReadOnly) {
    throw new LiteraryCircleBackupSafeError('Production backup requires the explicit --allow-production-read-only flag; it never enables database writes.');
  }
  if (environment !== 'production' && allowProductionReadOnly) {
    throw new LiteraryCircleBackupSafeError('The production read-only opt-in is valid only with --environment=production.');
  }
  return { environment, expectedProject, expectedDatabase, expectedAffiliates: FOUNDING_AFFILIATE_COUNT, allowProductionReadOnly };
}

/** Validate configuration before client initialization; never weakens migration guards. */
export function assertConfiguredBackupTarget(
  options: LiteraryCircleBackupOptions, target: FirebaseTarget, environment: NodeJS.ProcessEnv = process.env
): void {
  if (!PROJECT_ID.test(options.expectedProject) || !DATABASE_ID.test(options.expectedDatabase)
    || target.projectId !== options.expectedProject || target.databaseId !== options.expectedDatabase) {
    throw new LiteraryCircleBackupSafeError('The configured project and database must exactly match the explicit backup target.');
  }
  if (options.environment !== 'staging' && options.environment !== 'production') {
    throw new LiteraryCircleBackupSafeError('A valid explicit backup environment is required.');
  }
  if (options.environment === 'production' && options.allowProductionReadOnly !== true) {
    throw new LiteraryCircleBackupSafeError('Production backup requires explicit read-only authorization.');
  }
  if (environment.FIRESTORE_EMULATOR_HOST?.trim() || environment.FIREBASE_DATABASE_EMULATOR_HOST?.trim()
    || environment.FIREBASE_AUTH_EMULATOR_HOST?.trim()) {
    throw new LiteraryCircleBackupSafeError('Real database backups cannot run while a Firebase emulator is configured.');
  }
  const productionProjects = new Set<string>([...KNOWN_PRODUCTION_FIREBASE_PROJECT_IDS,
    ...(environment.LITERARY_CIRCLE_PRODUCTION_PROJECT_IDS || '').split(',').map(value => value.trim()).filter(Boolean)]);
  if (options.environment === 'staging' && (productionProjects.has(target.projectId)
    || environment.NODE_ENV?.trim().toLowerCase() === 'production'
    || environment.VERCEL_ENV?.trim().toLowerCase() === 'production')) {
    throw new LiteraryCircleBackupSafeError('A production target or process cannot be relabelled as staging to bypass the production read-only opt-in.');
  }
}

/** Recorded client construction metadata, not mutable environment labels. */
export function assertBackupFirestoreTarget(db: Firestore, target: FirebaseTarget): void {
  const binding = getFirestoreClientTarget(db);
  if (!binding || binding.projectId !== target.projectId || binding.firestoreDatabaseId !== target.databaseId) {
    throw new LiteraryCircleBackupSafeError('The initialized Firestore client is not bound to the verified backup project and database.');
  }
}

export function safeLiteraryCircleBackupError(error: unknown): string {
  return error instanceof LiteraryCircleBackupSafeError ? error.message : GENERIC_FAILURE;
}
