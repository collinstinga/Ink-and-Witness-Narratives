import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(), getFirestoreClientTarget: vi.fn(), configuredTarget: vi.fn(),
  capture: vi.fn(), validateAffiliates: vi.fn(), writeBackup: vi.fn(), verifyBackup: vi.fn()
}));
vi.mock('../src/server/db.js', () => ({
  getDb: mocks.getDb, getFirestoreClientTarget: mocks.getFirestoreClientTarget,
  resolveFirestoreTargetConfig: vi.fn()
}));
vi.mock('./literary-circle-migration-lib.js', async importOriginal => ({
  ...await importOriginal<typeof import('./literary-circle-migration-lib.js')>(),
  configuredFirebaseTarget: mocks.configuredTarget,
  captureAffiliateDatasets: mocks.capture,
  validateFoundingAffiliateDocuments: mocks.validateAffiliates,
  writeAffiliateBackup: mocks.writeBackup,
  verifyAffiliateBackup: mocks.verifyBackup
}));

import {
  LiteraryCircleBackupSafeError, assertBackupFirestoreTarget, assertConfiguredBackupTarget,
  parseLiteraryCircleBackupArgs, safeLiteraryCircleBackupError
} from './literary-circle-backup-target.js';
import { executeLiteraryCircleBackup } from './backup-literary-circle.js';

const TARGET = { projectId: 'ink-circle-staging', databaseId: '(default)' };
const ARGS = ['--environment=staging', `--expected-project=${TARGET.projectId}`,
  '--expected-database=(default)', '--expected-affiliates=9'];
const PRIVATE = 'sensitive-test-provider-value-never-print';
let output: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv('LITERARY_CIRCLE_ENV', '');
  vi.stubEnv('LITERARY_CIRCLE_PRODUCTION_PROJECT_IDS', '');
  for (const field of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_DATABASE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) vi.stubEnv(field, '');
  mocks.configuredTarget.mockReturnValue({ ...TARGET });
  mocks.getDb.mockReturnValue({ collection: vi.fn(), runTransaction: vi.fn(), batch: vi.fn() });
  mocks.getFirestoreClientTarget.mockReturnValue({ projectId: TARGET.projectId, firestoreDatabaseId: TARGET.databaseId });
  mocks.capture.mockResolvedValue(new Map([['affiliates', { documents: Array.from({ length: 9 }, (_, index) => ({ id: `private_${index}`, data: {} })) }]]));
  mocks.writeBackup.mockReturnValue({ manifestPath: 'data/backups/test/manifest.json' });
  mocks.verifyBackup.mockReturnValue({ directory: `${process.cwd()}/data/backups/test`,
    manifest: { backupId: 'test-backup', contentSha256: 'a'.repeat(64),
      datasets: [{ key: 'affiliates', count: 9, sums: {}, sha256: 'b'.repeat(64) }] } });
  output = vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('strict read-only backup arguments', () => {
  it('requires exact explicit project, database and founding count', () => {
    expect(parseLiteraryCircleBackupArgs(ARGS)).toEqual({ environment: 'staging',
      expectedProject: TARGET.projectId, expectedDatabase: '(default)', expectedAffiliates: 9, allowProductionReadOnly: false });
    expect(parseLiteraryCircleBackupArgs(ARGS.map(arg => arg === '--expected-database=(default)' ? '--expected-database=named-db' : arg)).expectedDatabase).toBe('named-db');
  });

  it('preserves explicit production read-only opt-in without introducing any apply mode', () => {
    const production = ARGS.map(arg => arg === '--environment=staging' ? '--environment=production' : arg);
    expect(() => parseLiteraryCircleBackupArgs(production)).toThrow(/read-only/);
    expect(parseLiteraryCircleBackupArgs([...production, '--allow-production-read-only'])).toMatchObject({ environment: 'production', allowProductionReadOnly: true });
    expect(() => parseLiteraryCircleBackupArgs([...ARGS, '--allow-production-read-only'])).toThrow(/only with/);
  });

  it.each([
    ARGS.filter(arg => !arg.startsWith('--expected-database=')),
    ARGS.filter(arg => !arg.startsWith('--expected-project=')),
    [...ARGS, '--expected-database=(default)'], [...ARGS, '--expected-project=other-stage'],
    [...ARGS, '--apply'], [...ARGS, '--unknown=secret-value'], [...ARGS, '--'],
    [...ARGS, '--expected-database='], [...ARGS, '--allow-production-read-only=true'],
    [...ARGS, '--allow-production-read-only', '--allow-production-read-only'],
    ARGS.map(arg => arg === '--expected-database=(default)' ? '--expected-database=../production' : arg),
    ARGS.map(arg => arg === '--expected-database=(default)' ? '--expected-database= padded ' : arg),
    ARGS.map(arg => arg === '--expected-affiliates=9' ? '--expected-affiliates=9e0' : arg),
    ARGS.map(arg => arg === '--expected-affiliates=9' ? '--expected-affiliates=10' : arg),
    ARGS.map(arg => arg === '--environment=staging' ? '--environment=production ' : arg),
    ARGS.map(arg => arg === '--environment=staging' ? '--environment=production\n' : arg)
  ].map(args => [args]))('rejects ambiguous or unsupported arguments before initializing a client %#', async args => {
    await expect(executeLiteraryCircleBackup(args)).rejects.toBeInstanceOf(LiteraryCircleBackupSafeError);
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it('supports only a valid legacy environment fallback, not an omitted database fallback', () => {
    const noEnvironment = ARGS.filter(arg => !arg.startsWith('--environment='));
    expect(parseLiteraryCircleBackupArgs(noEnvironment, 'staging').environment).toBe('staging');
    expect(() => parseLiteraryCircleBackupArgs(noEnvironment, ' staging ')).toThrow();
    expect(() => parseLiteraryCircleBackupArgs(noEnvironment, '')).toThrow();
  });
});

describe('exact configured and initialized backup target', () => {
  it.each([
    { projectId: 'other-staging', databaseId: '(default)' },
    { projectId: TARGET.projectId, databaseId: 'other-db' }
  ])('rejects a resolved target mismatch before client initialization %#', async target => {
    mocks.configuredTarget.mockReturnValue(target);
    await expect(executeLiteraryCircleBackup(ARGS)).rejects.toThrow(/exactly match/);
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it.each([
    null, { projectId: 'other-staging', firestoreDatabaseId: '(default)' },
    { projectId: TARGET.projectId, firestoreDatabaseId: 'other-db' }
  ])('rejects missing or cross-target recorded client metadata before any reads or files %#', async binding => {
    mocks.getFirestoreClientTarget.mockReturnValue(binding);
    await expect(executeLiteraryCircleBackup(ARGS)).rejects.toThrow(/initialized Firestore client/);
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(mocks.writeBackup).not.toHaveBeenCalled();
  });

  it.each(['FIRESTORE_EMULATOR_HOST', 'FIREBASE_DATABASE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST'])('rejects emulator %s before client initialization', async field => {
    vi.stubEnv(field, 'localhost:8080');
    await expect(executeLiteraryCircleBackup(ARGS)).rejects.toThrow(/emulator/);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it.each(['ink-and-witness-narratives', 'divine-experience-pq6d2', 'custom-production'])('cannot bypass production opt-in by labelling %s staging', projectId => {
    const options = { ...parseLiteraryCircleBackupArgs(ARGS), expectedProject: projectId };
    expect(() => assertConfiguredBackupTarget(options, { ...TARGET, projectId }, { LITERARY_CIRCLE_PRODUCTION_PROJECT_IDS: 'custom-production' })).toThrow(/relabelled/);
  });

  it.each(['NODE_ENV', 'VERCEL_ENV'])('does not label a production %s process as staging', async field => {
    vi.stubEnv(field, 'production');
    await expect(executeLiteraryCircleBackup(ARGS)).rejects.toThrow(/relabelled/);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it('allows an explicitly opted-in production read-only process but no writes', async () => {
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('VERCEL_ENV', 'production');
    const target = { projectId: 'ink-and-witness-narratives', databaseId: '(default)' };
    mocks.configuredTarget.mockReturnValue(target);
    mocks.getFirestoreClientTarget.mockReturnValue({ projectId: target.projectId, firestoreDatabaseId: target.databaseId });
    await executeLiteraryCircleBackup(['--environment=production', '--allow-production-read-only',
      `--expected-project=${target.projectId}`, '--expected-database=(default)', '--expected-affiliates=9']);
    const db = mocks.getDb.mock.results[0].value;
    expect(mocks.capture).toHaveBeenCalledWith(db);
    expect(db.collection).not.toHaveBeenCalled(); expect(db.runTransaction).not.toHaveBeenCalled(); expect(db.batch).not.toHaveBeenCalled();
    expect(mocks.getFirestoreClientTarget).toHaveBeenCalledTimes(3);
    expect(mocks.writeBackup).toHaveBeenCalledWith(expect.objectContaining({ target }));
    const report = JSON.parse(String(output.mock.calls[0][0]));
    expect(report).toMatchObject({ status: 'verified', affiliateCount: 9 });
    expect(JSON.stringify(report)).not.toContain('private_');
  });

  it('refuses publication if binding changes after capture', async () => {
    mocks.getFirestoreClientTarget.mockReturnValueOnce({ projectId: TARGET.projectId, firestoreDatabaseId: '(default)' }).mockReturnValue(null);
    await expect(executeLiteraryCircleBackup(ARGS)).rejects.toThrow(/initialized Firestore client/);
    expect(mocks.capture).toHaveBeenCalledTimes(1);
    expect(mocks.writeBackup).not.toHaveBeenCalled();
    expect(output).not.toHaveBeenCalled();
  });

  it('independently rejects unknown client objects in the pure boundary', () => {
    mocks.getFirestoreClientTarget.mockReturnValue(null);
    expect(() => assertBackupFirestoreTarget({} as any, TARGET)).toThrow(LiteraryCircleBackupSafeError);
  });
});

describe('controlled backup errors', () => {
  it('never echoes raw errors, stack traces, thrown objects or lookalike safe error names', () => {
    for (const error of [new Error(PRIVATE), PRIVATE, { message: PRIVATE }, Object.assign(new Error(PRIVATE), { name: 'LiteraryCircleBackupSafeError' })]) {
      expect(safeLiteraryCircleBackupError(error)).toMatch(/failed safely/);
      expect(safeLiteraryCircleBackupError(error)).not.toContain(PRIVATE);
    }
    expect(safeLiteraryCircleBackupError(new LiteraryCircleBackupSafeError('Explicit target mismatch.'))).toBe('Explicit target mismatch.');
  });

  it.each(['configuredTarget', 'getDb', 'capture', 'validateAffiliates', 'writeBackup', 'verifyBackup'] as const)('redacts a private %s failure and prints no success', async method => {
    if (method === 'capture') mocks[method].mockRejectedValueOnce(new Error(PRIVATE));
    else mocks[method].mockImplementationOnce(() => { throw new Error(PRIVATE); });
    await expect(executeLiteraryCircleBackup(ARGS)).rejects.toThrow(/failed safely/);
    try { await executeLiteraryCircleBackup([...ARGS, `--unknown=${PRIVATE}`]); } catch (error) {
      expect(String(error)).not.toContain(PRIVATE);
    }
    expect(output).not.toHaveBeenCalled();
  });
});
