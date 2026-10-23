import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getFirestoreClientTarget: vi.fn(),
  captureAffiliateDatasets: vi.fn(),
}));
vi.mock('../src/server/db.js', () => ({
  getDb: mocks.getDb,
  getFirestoreClientTarget: mocks.getFirestoreClientTarget,
  resolveFirestoreTargetConfig: () => ({ projectId: 'ink-circle-staging', firestoreDatabaseId: '(default)' }),
  sanitizeForFirestore: (value: unknown) => value,
}));
vi.mock('./literary-circle-migration-lib.js', async importOriginal => ({
  ...await importOriginal<typeof import('./literary-circle-migration-lib.js')>(),
  captureAffiliateDatasets: mocks.captureAffiliateDatasets,
}));

import {
  LiteraryCircleMigrationSafeError,
  assertConfiguredMigrationTarget,
  assertMigrationCredentialTarget,
  assertMigrationFirestoreTarget,
  parseLiteraryCircleMigrationArgs,
} from './literary-circle-migration-target.js';
import { executeLiteraryCircleMigration } from './migrate-literary-circle.js';

const TARGET = { projectId: 'ink-circle-staging', databaseId: '(default)' };
const SECRET_SENTINEL = 'unit-test-private-value-never-print';
const ACCOUNT = {
  type: 'service_account',
  project_id: TARGET.projectId,
  client_email: `migration@${TARGET.projectId}.iam.gserviceaccount.com`,
  private_key: `-----BEGIN PRIVATE KEY-----\n${SECRET_SENTINEL}\n-----END PRIVATE KEY-----`,
};
const BASE_ARGS = [
  '--environment=staging',
  `--expected-project=${TARGET.projectId}`,
  `--expected-database=${TARGET.databaseId}`,
  '--expected-affiliates=9',
];

function credentialInput(overrides: Record<string, unknown> = {}) {
  return {
    expectedProject: TARGET.projectId,
    expectedDatabase: TARGET.databaseId,
    target: TARGET,
    serviceAccount: JSON.stringify(ACCOUNT),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv('FIRESTORE_EMULATOR_HOST', '');
  vi.stubEnv('FIREBASE_DATABASE_EMULATOR_HOST', '');
  vi.stubEnv('FIREBASE_AUTH_EMULATOR_HOST', '');
  vi.stubEnv('LITERARY_CIRCLE_STAGING_PROJECT_IDS', TARGET.projectId);
  vi.stubEnv('LITERARY_CIRCLE_PRODUCTION_PROJECT_IDS', '');
  vi.stubEnv('FIREBASE_SERVICE_ACCOUNT_JSON', JSON.stringify(ACCOUNT));
});
afterEach(() => vi.unstubAllEnvs());

describe('strict migration argument parser', () => {
  it('requires explicit exact project, database and founding count for dry-run', () => {
    expect(parseLiteraryCircleMigrationArgs(BASE_ARGS)).toEqual({
      mode: 'dry-run', environment: 'staging', expectedProject: TARGET.projectId,
      expectedDatabase: TARGET.databaseId, expectedAffiliates: 9,
    });
  });

  it('accepts an explicitly named database and backed-up apply', () => {
    const args = BASE_ARGS.filter(argument => !argument.startsWith('--expected-database='));
    expect(parseLiteraryCircleMigrationArgs([
      ...args, '--expected-database=circle-stage', '--apply', '--backup=data/backups/test/manifest.json',
    ])).toMatchObject({ mode: 'apply', expectedDatabase: 'circle-stage' });
  });

  it.each([
    BASE_ARGS.filter(argument => !argument.startsWith('--expected-database=')),
    BASE_ARGS.filter(argument => !argument.startsWith('--expected-project=')),
    [...BASE_ARGS, '--expected-database=(default)'],
    [...BASE_ARGS, '--expected-database=other'],
    [...BASE_ARGS, '--expected-project=other-stage'],
    [...BASE_ARGS, '--apply', '--apply'],
    [...BASE_ARGS, '--apply'],
    [...BASE_ARGS, '--dry-run'],
    [...BASE_ARGS, '--unknown=secret-value'],
    [...BASE_ARGS, '--'],
    BASE_ARGS.map(argument => argument.startsWith('--expected-database=') ? '--expected-database= ' : argument),
    BASE_ARGS.map(argument => argument.startsWith('--expected-database=') ? '--expected-database=../production' : argument),
    BASE_ARGS.map(argument => argument === '--expected-affiliates=9' ? '--expected-affiliates=9e0' : argument),
    [...BASE_ARGS, '--backup='],
  ].map(args => [args]))('rejects ambiguous, missing, duplicate or unsafe arguments %#', args => {
    expect(() => parseLiteraryCircleMigrationArgs(args)).toThrow(LiteraryCircleMigrationSafeError);
  });
});

describe('pure credential and database pinning', () => {
  it('accepts only explicit service-account JSON pinned to the staging project', () => {
    expect(() => assertMigrationCredentialTarget(credentialInput())).not.toThrow();
  });

  it.each([
    undefined, '', ' ', '{invalid-secret', 'null', '[]', 'true', '{}',
    JSON.stringify({ ...ACCOUNT, type: 'authorized_user' }),
    JSON.stringify({ ...ACCOUNT, project_id: 'other-staging' }),
    JSON.stringify({ ...ACCOUNT, project_id: ` ${TARGET.projectId}` }),
    JSON.stringify({ ...ACCOUNT, client_email: 'migration@other-staging.iam.gserviceaccount.com' }),
    JSON.stringify({ ...ACCOUNT, client_email: `evil\n@${TARGET.projectId}.iam.gserviceaccount.com` }),
    JSON.stringify({ ...ACCOUNT, private_key: SECRET_SENTINEL }),
    JSON.stringify({ ...ACCOUNT, private_key: '' }),
    JSON.stringify({ ...ACCOUNT, private_key: `-----BEGIN PRIVATE KEY-----${'x'.repeat(65_536)}-----END PRIVATE KEY-----` }),
  ])('rejects missing/ADC, malformed and cross-project credentials %# without disclosure', serviceAccount => {
    try {
      assertMigrationCredentialTarget(credentialInput({ serviceAccount }));
      throw new Error('Expected credential refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(LiteraryCircleMigrationSafeError);
      expect(String(error)).not.toContain(SECRET_SENTINEL);
      expect(String(error)).not.toContain('other-staging');
    }
  });

  it.each([
    { expectedDatabase: 'other-database' },
    { expectedDatabase: '' },
    { expectedProject: 'other-staging' },
    { target: { ...TARGET, databaseId: 'other-database' } },
    { target: { ...TARGET, projectId: 'other-staging' } },
  ])('rejects differing explicit/resolved target %#', overrides => {
    expect(() => assertMigrationCredentialTarget(credentialInput(overrides))).toThrow(LiteraryCircleMigrationSafeError);
  });
});

describe('existing staging isolation remains mandatory', () => {
  it('accepts isolated staging without touching a Firestore client', () => {
    expect(() => assertConfiguredMigrationTarget(parseLiteraryCircleMigrationArgs(BASE_ARGS), TARGET)).not.toThrow();
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it.each([
    ['NODE_ENV', 'production'], ['VERCEL_ENV', 'production'],
    ['FIRESTORE_EMULATOR_HOST', 'localhost:8080'],
    ['FIREBASE_DATABASE_EMULATOR_HOST', 'localhost:9000'],
    ['FIREBASE_AUTH_EMULATOR_HOST', 'localhost:9099'],
    ['LITERARY_CIRCLE_STAGING_PROJECT_IDS', ''],
    ['LITERARY_CIRCLE_STAGING_PROJECT_IDS', `${TARGET.projectId},ink-and-witness-narratives`],
    ['LITERARY_CIRCLE_PRODUCTION_PROJECT_IDS', TARGET.projectId],
  ])('rejects %s isolation hazard', (key, value) => {
    vi.stubEnv(key, value);
    expect(() => assertConfiguredMigrationTarget(parseLiteraryCircleMigrationArgs(BASE_ARGS), TARGET)).toThrow(LiteraryCircleMigrationSafeError);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});

describe('initialized client target guard', () => {
  it('accepts exact public construction metadata', () => {
    mocks.getFirestoreClientTarget.mockReturnValue({ projectId: TARGET.projectId, firestoreDatabaseId: TARGET.databaseId });
    expect(() => assertMigrationFirestoreTarget({} as Firestore, TARGET)).not.toThrow();
  });

  it.each([
    null,
    { projectId: 'ink-and-witness-narratives', firestoreDatabaseId: '(default)' },
    { projectId: TARGET.projectId, firestoreDatabaseId: 'different-db' },
  ])('rejects unknown/cached wrong client before any dry-run or apply reads %#', async binding => {
    const db = { collection: vi.fn(), getAll: vi.fn(), runTransaction: vi.fn() };
    mocks.getDb.mockReturnValue(db);
    mocks.getFirestoreClientTarget.mockReturnValue(binding);
    for (const args of [BASE_ARGS, [...BASE_ARGS, '--apply', '--backup=data/backups/test/manifest.json']]) {
      await expect(executeLiteraryCircleMigration(args)).rejects.toThrow(LiteraryCircleMigrationSafeError);
    }
    expect(mocks.captureAffiliateDatasets).not.toHaveBeenCalled();
    expect(db.collection).not.toHaveBeenCalled();
    expect(db.getAll).not.toHaveBeenCalled();
    expect(db.runTransaction).not.toHaveBeenCalled();
  });

  it('rejects missing explicit JSON before any client initialization, despite ambient ADC', async () => {
    vi.stubEnv('FIREBASE_SERVICE_ACCOUNT_JSON', '');
    vi.stubEnv('GOOGLE_APPLICATION_CREDENTIALS', 'must-not-be-used.json');
    await expect(executeLiteraryCircleMigration(BASE_ARGS)).rejects.toThrow(LiteraryCircleMigrationSafeError);
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.captureAffiliateDatasets).not.toHaveBeenCalled();
  });
});
