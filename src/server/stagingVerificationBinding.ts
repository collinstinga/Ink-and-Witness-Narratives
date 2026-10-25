import crypto from 'crypto';
import { getDb, getFirestoreClientTarget } from './db.js';

const PROJECT = 'ink-witness-staging-20261024';
const DATABASE = '(default)';
const RUNTIME_IDENTITY = `literary-staging-runtime@${PROJECT}.iam.gserviceaccount.com`;
const MARKER_ID = 'literary-circle-founding-affiliates-v1';
const BACKUP_SHA256 = '2df71f3312571b18964c52f10ef6e8f1a8bb52508e4087ad42cb4bc269579b02';

export interface StagingVerificationBinding {
  projectId: string;
  databaseId: string;
  credentialIdentitySha256: string;
  migrationMarker: { status: 'complete'; backupManifestSha256: string };
}
export type StagingVerificationBindingResult =
  | { status: 'not_found' | 'unavailable' }
  | { status: 'verified'; binding: StagingVerificationBinding };

/** Exact operator-controlled staging gate. Production, emulator, omitted and
 * padded labels never initialize a client or reveal that this route exists. */
export function isStagingVerificationBindingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.VERCEL_ENV !== 'preview' || env.FIREBASE_PROJECT_ID !== PROJECT || env.FIRESTORE_DATABASE_ID !== DATABASE
    || env.FIRESTORE_EMULATOR_HOST || env.FIREBASE_DATABASE_EMULATOR_HOST || env.FIREBASE_AUTH_EMULATOR_HOST
    || typeof env.FIREBASE_SERVICE_ACCOUNT_JSON !== 'string' || env.FIREBASE_SERVICE_ACCOUNT_JSON.length > 100_000) return false;
  try {
    const credential = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
    return credential?.type === 'service_account' && credential.project_id === PROJECT && credential.client_email === RUNTIME_IDENTITY;
  } catch { return false; }
}

/** Read-only attestation for the protected immutable staging preview. Environment
 * labels alone are insufficient: verify the constructed client metadata, public
 * SDK target and an exact existing marker through that same actual SDK client.
 * No request input, credentials, record spreads or mutation/provider operations. */
export async function readStagingVerificationBinding(env: NodeJS.ProcessEnv = process.env): Promise<StagingVerificationBindingResult> {
  if (!isStagingVerificationBindingEnabled(env)) return { status: 'not_found' };
  try {
    const db = getDb();
    const target = getFirestoreClientTarget(db);
    if (target?.projectId !== PROJECT || target.firestoreDatabaseId !== DATABASE
      || db.projectId !== PROJECT || db.databaseId !== DATABASE) return { status: 'unavailable' };
    const snapshot = await db.collection('migration_markers').doc(MARKER_ID).get();
    const marker = snapshot.exists ? snapshot.data() : undefined;
    if (!marker || marker.schemaVersion !== 1 || marker.migrationId !== MARKER_ID
      || marker.status !== 'complete' || marker.backupManifestSha256 !== BACKUP_SHA256) return { status: 'unavailable' };
    return { status: 'verified', binding: {
      projectId: PROJECT,
      databaseId: DATABASE,
      credentialIdentitySha256: crypto.createHash('sha256').update(RUNTIME_IDENTITY).digest('hex'),
      migrationMarker: { status: 'complete', backupManifestSha256: BACKUP_SHA256 },
    } };
  } catch {
    // Never print SDK errors, environment values, keys, emails or marker data.
    return { status: 'unavailable' };
  }
}
