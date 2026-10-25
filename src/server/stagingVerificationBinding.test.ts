import crypto from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const PROJECT = 'ink-witness-staging-20261024';
const EMAIL = `literary-staging-runtime@${PROJECT}.iam.gserviceaccount.com`;
const SHA = '627f98fb6581b318ae0339ab469c279e28719b4f10512f114dac9da26a3e8a61';
const MARKER = 'literary-circle-founding-affiliates-v1';
const backend = vi.hoisted(() => {
  const state: {
    target: { projectId: string; firestoreDatabaseId: string } | null;
    sdkProject: string; sdkDatabase: string; marker: any; error: Error | null; sdkError: Error | null;
  } = { target: null, sdkProject: '', sdkDatabase: '', marker: undefined, error: null, sdkError: null };
  const read = vi.fn(async () => {
    if (state.error) throw state.error;
    return { exists: state.marker !== undefined, data: () => structuredClone(state.marker) };
  });
  const collection = vi.fn((name: string) => {
    if (name !== 'migration_markers') throw new Error('unexpected collection or scan');
    return { doc: (id: string) => {
      if (id !== 'literary-circle-founding-affiliates-v1') throw new Error('unexpected marker');
      return { get: read };
    } };
  });
  const db = {
    get projectId() { if (state.sdkError) throw state.sdkError; return state.sdkProject; },
    get databaseId() { return state.sdkDatabase; },
    collection,
  };
  return { state, read, collection, db, getDb: vi.fn(() => db), getTarget: vi.fn(() => state.target) };
});
vi.mock('./db.js', () => ({ getDb: backend.getDb, getFirestoreClientTarget: backend.getTarget }));
import { isStagingVerificationBindingEnabled, readStagingVerificationBinding } from './stagingVerificationBinding.js';

function environment(): NodeJS.ProcessEnv {
  return { VERCEL_ENV: 'preview', NODE_ENV: 'production', FIREBASE_PROJECT_ID: PROJECT, FIRESTORE_DATABASE_ID: '(default)',
    FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({ type: 'service_account', project_id: PROJECT, client_email: EMAIL,
      private_key: 'not-a-real-key-do-not-return' }) };
}
function marker() {
  return { schemaVersion: 1, migrationId: MARKER, status: 'complete', backupManifestSha256: SHA,
    completedAffiliateIds: ['never-public-private-cohort-id'], privateField: 'never-return-marker-fields' };
}
beforeEach(() => {
  vi.clearAllMocks(); Object.assign(backend.state, {
    target: { projectId: PROJECT, firestoreDatabaseId: '(default)' }, sdkProject: PROJECT,
    sdkDatabase: '(default)', marker: marker(), error: null, sdkError: null,
  });
});

describe('exact read-only isolated staging runtime binding', () => {
  it('attests the actual SDK marker with only the approved non-secret projection', async () => {
    const env = environment(); const before = structuredClone(backend.state.marker);
    expect(isStagingVerificationBindingEnabled(env)).toBe(true);
    expect(await readStagingVerificationBinding(env)).toEqual({ status: 'verified', binding: {
      projectId: PROJECT, databaseId: '(default)', credentialIdentitySha256: crypto.createHash('sha256').update(EMAIL).digest('hex'),
      migrationMarker: { status: 'complete', backupManifestSha256: SHA },
    } });
    expect(backend.getDb).toHaveBeenCalledTimes(1); expect(backend.getTarget).toHaveBeenCalledWith(backend.db);
    expect(backend.collection).toHaveBeenCalledWith('migration_markers'); expect(backend.read).toHaveBeenCalledTimes(1);
    expect(backend.state.marker).toEqual(before);
    expect(JSON.stringify(await readStagingVerificationBinding(env))).not.toMatch(/never-public|private_key|not-a-real-key|iam\.gserviceaccount|privateField/);
  });

  it.each(['production', 'development', 'missing_environment', 'padded_environment', 'wrong_project', 'padded_project', 'missing_database',
    'wrong_database', 'missing_credential', 'malformed_credential', 'wrong_type', 'wrong_credential_project', 'wrong_identity',
    'firestore_emulator', 'auth_emulator', 'database_emulator'])('keeps %s absent before any client construction or database read', async change => {
    const env = environment();
    if (change === 'production') env.VERCEL_ENV = 'production';
    if (change === 'development') env.VERCEL_ENV = 'development';
    if (change === 'missing_environment') delete env.VERCEL_ENV;
    if (change === 'padded_environment') env.VERCEL_ENV = ' preview ';
    if (change === 'wrong_project') env.FIREBASE_PROJECT_ID = 'ink-and-witness-narratives';
    if (change === 'padded_project') env.FIREBASE_PROJECT_ID = ` ${PROJECT}`;
    if (change === 'missing_database') delete env.FIRESTORE_DATABASE_ID;
    if (change === 'wrong_database') env.FIRESTORE_DATABASE_ID = 'other';
    if (change === 'missing_credential') delete env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (change === 'malformed_credential') env.FIREBASE_SERVICE_ACCOUNT_JSON = '{private-provider-error';
    const credential = JSON.parse(environment().FIREBASE_SERVICE_ACCOUNT_JSON!);
    if (change === 'wrong_type') credential.type = 'authorized_user';
    if (change === 'wrong_credential_project') credential.project_id = 'ink-and-witness-narratives';
    if (change === 'wrong_identity') credential.client_email = `different-runtime@${PROJECT}.iam.gserviceaccount.com`;
    if (['wrong_type', 'wrong_credential_project', 'wrong_identity'].includes(change)) env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify(credential);
    if (change === 'firestore_emulator') env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
    if (change === 'auth_emulator') env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099';
    if (change === 'database_emulator') env.FIREBASE_DATABASE_EMULATOR_HOST = 'localhost:9000';
    expect(isStagingVerificationBindingEnabled(env)).toBe(false);
    expect(await readStagingVerificationBinding(env)).toEqual({ status: 'not_found' });
    expect(backend.getDb).not.toHaveBeenCalled(); expect(backend.read).not.toHaveBeenCalled();
  });

  it.each(['missing_binding', 'bound_project', 'bound_database', 'sdk_project', 'sdk_database', 'sdk_getter'])('rejects %s before reading a marker from an unverified target', async change => {
    if (change === 'missing_binding') backend.state.target = null;
    if (change === 'bound_project') backend.state.target!.projectId = 'ink-and-witness-narratives';
    if (change === 'bound_database') backend.state.target!.firestoreDatabaseId = 'other';
    if (change === 'sdk_project') backend.state.sdkProject = 'ink-and-witness-narratives';
    if (change === 'sdk_database') backend.state.sdkDatabase = 'other';
    if (change === 'sdk_getter') backend.state.sdkError = new Error('private-client-credential');
    expect(await readStagingVerificationBinding(environment())).toEqual({ status: 'unavailable' });
    expect(backend.read).not.toHaveBeenCalled();
  });

  it.each(['missing', 'wrong_schema', 'wrong_id', 'incomplete', 'wrong_backup', 'original_production_backup', 'sdk_failure'])('holds %s marker evidence without exposing SDK errors or record fields', async change => {
    if (change === 'missing') backend.state.marker = undefined;
    if (change === 'wrong_schema') backend.state.marker.schemaVersion = 0;
    if (change === 'wrong_id') backend.state.marker.migrationId = 'another-migration';
    if (change === 'incomplete') backend.state.marker.status = 'in_progress';
    if (change === 'wrong_backup') backend.state.marker.backupManifestSha256 = 'f'.repeat(64);
    if (change === 'original_production_backup') backend.state.marker.backupManifestSha256 = '2df71f3312571b18964c52f10ef6e8f1a8bb52508e4087ad42cb4bc269579b02';
    if (change === 'sdk_failure') backend.state.error = new Error('private-provider-key@example.test');
    expect(await readStagingVerificationBinding(environment())).toEqual({ status: 'unavailable' });
    expect(backend.read).toHaveBeenCalledTimes(1);
  });

  it('never substitutes a cached attestation when the next real marker read fails', async () => {
    expect((await readStagingVerificationBinding(environment())).status).toBe('verified');
    backend.state.error = new Error('unavailable');
    expect(await readStagingVerificationBinding(environment())).toEqual({ status: 'unavailable' });
    expect(backend.read).toHaveBeenCalledTimes(2);
  });
});
