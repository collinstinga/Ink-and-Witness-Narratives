import { describe, expect, it } from 'vitest';
import { deriveAffiliateClickAnalyticsKeyFingerprint } from '../src/server/affiliateClickLedger.js';
import {
  AFFILIATE_BACKUP_DATASETS,
  AFFILIATE_BACKUP_SCHEMA_VERSION,
  type BackupDatasetPayload,
  type BackupDocument,
  type VerifiedAffiliateBackup,
} from './literary-circle-migration-lib.js';
import {
  AFFILIATE_CLICK_ACTIVATION_EXIT_CODES,
  AffiliateClickActivationSafeError,
  assertAffiliateClickActivationMarkerAbsentForApply,
  assertAffiliateClickActivationProofBackedUp,
  assertAffiliateClickActivationRuntime,
  assertAffiliateClickActivationStagingTarget,
  assertAuthoritativeFirestoreClock,
  assertExactAffiliateClickActivationLiveState,
  assertExactAffiliateClickActivationMarker,
  assertFoundingAffiliateMigrationReconciled,
  assertFreshAffiliateClickActivationBackup,
  assertImmutableAffiliateClickActivationMarker,
  assertRecentAffiliateClickActivationProofEvent,
  buildAffiliateClickActivationMarker,
  buildRedactedAffiliateClickActivationReport,
  parseAffiliateClickActivationArgs,
  safeAffiliateClickActivationFailure,
} from './affiliate-click-activation-lib.js';

const SECRET = 'activation-test-secret-that-is-safely-longer-than-thirty-two-characters';
const FINGERPRINT = deriveAffiliateClickAnalyticsKeyFingerprint(SECRET) as string;
const PROJECT_ID = 'ink-witness-staging';
const DATABASE_ID = '(default)';
const AUTHORITATIVE_TIME = '2026-10-21T09:00:00.000Z';
const HASH = 'a'.repeat(64);
const PROOF_EVENT_ID = `aclk2_${'b'.repeat(64)}`;
const VISITOR_KEY = `acv1_${'c'.repeat(43)}`;
const SERVICE_ACCOUNT = {
  type: 'service_account',
  project_id: PROJECT_ID,
  client_email: `activation@${PROJECT_ID}.iam.gserviceaccount.com`,
  private_key: '-----BEGIN PRIVATE KEY-----\nunit-test-only\n-----END PRIVATE KEY-----',
};

function baseArguments(): string[] {
  return [
    '--environment=staging',
    `--expected-project=${PROJECT_ID}`,
    `--expected-database=${DATABASE_ID}`,
    '--expected-affiliates=9',
    '--backup=data/backups/literary-circle-staging/manifest.json',
    `--expected-key-fingerprint=${FINGERPRINT}`,
    '--deployment-evidence=dpl_stagingRequired123',
    `--proof-event-id=${PROOF_EVENT_ID}`,
    '--lead-minutes=30',
  ];
}

function backupManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: AFFILIATE_BACKUP_SCHEMA_VERSION,
    backupId: 'literary-circle-2026-10-21-staging',
    createdAt: '2026-10-21T08:30:00.000Z',
    projectId: PROJECT_ID,
    databaseId: DATABASE_ID,
    contentSha256: HASH,
    datasets: [{ key: 'affiliates', count: 9 }],
    ...overrides,
  };
}

function affiliates(): BackupDocument[] {
  return Array.from({ length: 9 }, (_, index) => {
    const suffix = String(index + 1).padStart(2, '0');
    return {
      id: `affiliate-${suffix}`,
      data: {
        id: `affiliate-${suffix}`,
        affiliateCode: `PARTNER_${suffix}`,
        email: `partner-${suffix}@example.test`,
        literaryCircle: {
          schemaVersion: 1,
          memberSince: '2026-10-16T08:00:00.000Z',
          foundingMember: true,
          foundingRecognizedAt: '2026-10-16T08:00:00.000Z',
          complimentaryAccess: {
            status: 'active',
            scope: 'all_published',
            updatedAt: '2026-10-16T08:00:00.000Z',
          },
        },
      },
    };
  });
}

function foundingMarker(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const ids = affiliates().map(item => item.id).sort();
  return {
    schemaVersion: 1,
    migrationId: 'literary-circle-founding-affiliates-v1',
    status: 'complete',
    expectedAffiliateCount: 9,
    completedAffiliateIds: ids,
    completedCount: 9,
    backupId: 'literary-circle-original-backup',
    backupManifestSha256: HASH,
    startedAt: '2026-10-16T08:00:00.000Z',
    completedAt: '2026-10-16T08:00:01.000Z',
    lastAppliedAt: '2026-10-16T08:00:01.000Z',
    attemptCount: 1,
    ...overrides,
  };
}

function timestamp(iso: string, nanoseconds?: number): { seconds: number; nanoseconds: number } {
  const milliseconds = Date.parse(iso);
  return {
    seconds: Math.floor(milliseconds / 1_000),
    nanoseconds: nanoseconds ?? (milliseconds % 1_000) * 1_000_000,
  };
}

function firestoreSnapshot(iso: string): { readTime: { seconds: number; nanoseconds: number } } {
  return { readTime: timestamp(iso) };
}

function exactBackupState(): {
  verifiedBackup: VerifiedAffiliateBackup;
  livePayloads: Map<string, BackupDatasetPayload>;
} {
  const payloads = new Map<string, BackupDatasetPayload>();
  for (const definition of AFFILIATE_BACKUP_DATASETS) {
    payloads.set(definition.key, {
      schemaVersion: AFFILIATE_BACKUP_SCHEMA_VERSION,
      key: definition.key,
      collection: definition.collection,
      scope: definition.scope,
      documents: definition.key === 'affiliates' ? affiliates() : [],
    });
  }
  const verifiedBackup: VerifiedAffiliateBackup = {
    directory: 'data/backups/test',
    manifest: {
      schemaVersion: AFFILIATE_BACKUP_SCHEMA_VERSION,
      backupId: 'literary-circle-test-backup',
      createdAt: '2026-10-21T08:30:00.000Z',
      projectId: PROJECT_ID,
      databaseId: DATABASE_ID,
      datasets: AFFILIATE_BACKUP_DATASETS.map(definition => ({
        key: definition.key,
        collection: definition.collection,
        scope: definition.scope,
        fileName: definition.fileName,
        sha256: HASH,
        count: payloads.get(definition.key)?.documents.length || 0,
        sums: {},
      })),
      contentSha256: HASH,
    },
    payloads,
  };
  return {
    verifiedBackup,
    livePayloads: new Map([...payloads].map(([key, value]) => [
      key,
      JSON.parse(JSON.stringify(value)) as BackupDatasetPayload,
    ])),
  };
}

function expectSafeError(
  action: () => unknown,
  kind: AffiliateClickActivationSafeError['kind'],
  code?: string,
): AffiliateClickActivationSafeError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(AffiliateClickActivationSafeError);
    const safe = error as AffiliateClickActivationSafeError;
    expect(safe.kind).toBe(kind);
    if (code) expect(safe.safeCode).toBe(code);
    return safe;
  }
  throw new Error('Expected a safe activation error.');
}

describe('affiliate click activation argument guards', () => {
  it('parses a complete dry-run without granting write authority', () => {
    expect(parseAffiliateClickActivationArgs(baseArguments())).toEqual({
      mode: 'dry-run',
      environment: 'staging',
      expectedProject: PROJECT_ID,
      expectedDatabase: DATABASE_ID,
      expectedAffiliates: 9,
      backupPath: 'data/backups/literary-circle-staging/manifest.json',
      expectedKeyFingerprint: FINGERPRINT,
      deploymentEvidence: 'dpl_stagingRequired123',
      proofEventId: PROOF_EVENT_ID,
      leadMinutes: 30,
      acknowledgeCreateOnly: false,
      acknowledgeNoRollback: false,
      acknowledgeTrafficQuiesced: false,
    });
  });

  it('requires both irreversible-boundary acknowledgements for apply', () => {
    expectSafeError(
      () => parseAffiliateClickActivationArgs([...baseArguments(), '--apply']),
      'precondition',
      'missing_apply_acknowledgement',
    );
    const parsed = parseAffiliateClickActivationArgs([
      ...baseArguments(),
      '--apply',
      '--acknowledge-create-only',
      '--acknowledge-no-rollback',
      '--acknowledge-staging-traffic-quiesced',
    ]);
    expect(parsed.mode).toBe('apply');
    expect(parsed.acknowledgeCreateOnly).toBe(true);
    expect(parsed.acknowledgeNoRollback).toBe(true);
    expect(parsed.acknowledgeTrafficQuiesced).toBe(true);
  });

  it.each([
    ['create-only', ['--acknowledge-no-rollback', '--acknowledge-staging-traffic-quiesced']],
    ['no-rollback', ['--acknowledge-create-only', '--acknowledge-staging-traffic-quiesced']],
    ['traffic-quiesced', ['--acknowledge-create-only', '--acknowledge-no-rollback']],
  ])('requires the %s acknowledgement independently', (_label, acknowledgements) => {
    expectSafeError(
      () => parseAffiliateClickActivationArgs([...baseArguments(), '--apply', ...acknowledgements]),
      'precondition',
      'missing_apply_acknowledgement',
    );
  });

  it.each([
    ['unknown option', ['--surprise=true']],
    ['positional argument', ['staging']],
    ['duplicate option', [`--expected-project=${PROJECT_ID}`]],
    ['boolean with value', ['--apply=true']],
  ])('rejects %s', (_label, additions) => {
    expectSafeError(
      () => parseAffiliateClickActivationArgs([...baseArguments(), ...additions]),
      'usage',
    );
  });

  it.each(['29', '1441', '30.5', '-30', 'x'])('rejects unsafe lead minutes %s', lead => {
    const args = baseArguments().filter(value => !value.startsWith('--lead-minutes='));
    expectSafeError(
      () => parseAffiliateClickActivationArgs([...args, `--lead-minutes=${lead}`]),
      'usage',
    );
  });

  it('accepts both lead-time boundaries', () => {
    for (const lead of [30, 1440]) {
      const args = baseArguments().filter(value => !value.startsWith('--lead-minutes='));
      expect(parseAffiliateClickActivationArgs([...args, `--lead-minutes=${lead}`]).leadMinutes).toBe(lead);
    }
  });

  it('requires exact staging, project, database, nine accounts, backup, fingerprint and evidence', () => {
    const replacements = [
      ['--environment=staging', '--environment=production'],
      ['--expected-affiliates=9', '--expected-affiliates=8'],
      [`--expected-database=${DATABASE_ID}`, '--expected-database='],
      ['--backup=data/backups/literary-circle-staging/manifest.json', '--backup='],
      [`--expected-key-fingerprint=${FINGERPRINT}`, '--expected-key-fingerprint=ack1_bad'],
      ['--deployment-evidence=dpl_stagingRequired123', '--deployment-evidence='],
      [`--proof-event-id=${PROOF_EVENT_ID}`, '--proof-event-id=aclk2_bad'],
    ];
    for (const [current, replacement] of replacements) {
      expect(() => parseAffiliateClickActivationArgs(
        baseArguments().map(value => value === current ? replacement : value),
      )).toThrow(AffiliateClickActivationSafeError);
    }
  });
});

describe('staging target and runtime guards', () => {
  const options = {
    environment: 'staging' as const,
    expectedProject: PROJECT_ID,
    expectedDatabase: DATABASE_ID,
  };
  const validTarget = {
    options,
    resolvedProjectId: PROJECT_ID,
    resolvedDatabaseId: DATABASE_ID,
    stagingProjectAllowlist: PROJECT_ID,
    productionProjectIds: 'ink-witness-production',
    serviceAccount: JSON.stringify(SERVICE_ACCOUNT),
    credentialSource: 'FIREBASE_SERVICE_ACCOUNT_JSON',
  };

  it('returns hashes rather than service-account contents', () => {
    const evidence = assertAffiliateClickActivationStagingTarget(validTarget);
    const serialized = JSON.stringify(evidence);
    expect(evidence).toMatchObject({ projectId: PROJECT_ID, databaseId: DATABASE_ID });
    expect(evidence.stagingAllowlistSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(evidence.serviceAccountProjectSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain('private_key');
  });

  it.each([
    ['wrong project', { resolvedProjectId: 'other-staging-project' }],
    ['wrong database', { resolvedDatabaseId: 'another-db' }],
    ['production NODE_ENV', { nodeEnv: 'production' }],
    ['production VERCEL_ENV', { vercelEnv: 'production' }],
    ['Firestore emulator', { firestoreEmulatorHost: '127.0.0.1:8080' }],
    ['Realtime Database emulator', { firebaseDatabaseEmulatorHost: '127.0.0.1:9000' }],
    ['Auth emulator', { firebaseAuthEmulatorHost: '127.0.0.1:9099' }],
    ['missing allowlist', { stagingProjectAllowlist: '' }],
    ['project outside allowlist', { stagingProjectAllowlist: 'different-staging' }],
    ['production overlap', { productionProjectIds: PROJECT_ID }],
    ['service account mismatch', { serviceAccount: { ...SERVICE_ACCOUNT, project_id: 'different-staging' } }],
    ['missing credential source', { credentialSource: undefined }],
    ['incomplete service account', { serviceAccount: { type: 'service_account', project_id: PROJECT_ID } }],
    ['application-default credential', { serviceAccount: undefined }],
  ])('rejects %s', (_label, overrides) => {
    expectSafeError(
      () => assertAffiliateClickActivationStagingTarget({ ...validTarget, ...overrides }),
      'target',
    );
  });

  it('always denies the known production project, even when labelled staging', () => {
    expectSafeError(() => assertAffiliateClickActivationStagingTarget({
      ...validTarget,
      options: {
        ...options,
        expectedProject: 'ink-and-witness-narratives',
      },
      resolvedProjectId: 'ink-and-witness-narratives',
      stagingProjectAllowlist: 'ink-and-witness-narratives',
      serviceAccount: { ...SERVICE_ACCOUNT, project_id: 'ink-and-witness-narratives' },
    }), 'target', 'staging_allowlist_contains_production');
  });

  it('requires required mode, a dedicated secret, and the exact fingerprint', () => {
    expect(assertAffiliateClickActivationRuntime({
      ledgerMode: 'required',
      analyticsSecret: `  ${SECRET}  `,
      expectedKeyFingerprint: FINGERPRINT,
    })).toEqual({ keyFingerprint: FINGERPRINT });
    expectSafeError(() => assertAffiliateClickActivationRuntime({
      ledgerMode: 'shadow', analyticsSecret: SECRET, expectedKeyFingerprint: FINGERPRINT,
    }), 'precondition', 'ledger_mode_not_required');
    expectSafeError(() => assertAffiliateClickActivationRuntime({
      ledgerMode: 'required', analyticsSecret: 'short', expectedKeyFingerprint: FINGERPRINT,
    }), 'precondition', 'missing_click_secret');
    expectSafeError(() => assertAffiliateClickActivationRuntime({
      ledgerMode: 'required', analyticsSecret: `${SECRET}different`, expectedKeyFingerprint: FINGERPRINT,
    }), 'precondition', 'click_key_fingerprint_mismatch');
  });
});

describe('authoritative time and fresh backup guards', () => {
  it('accepts authoritative Firestore time within 30 seconds of local time', () => {
    expect(assertAuthoritativeFirestoreClock({
      firestoreSnapshot: firestoreSnapshot(AUTHORITATIVE_TIME),
      localNow: new Date('2026-10-21T09:00:30.000Z'),
    })).toEqual({
      authoritativeReadTime: AUTHORITATIVE_TIME,
      localTime: '2026-10-21T09:00:30.000Z',
      absoluteDriftMs: 30_000,
    });
  });

  it('rejects missing read time and drift beyond 30 seconds', () => {
    expectSafeError(() => assertAuthoritativeFirestoreClock({
      firestoreSnapshot: undefined,
      localNow: new Date(AUTHORITATIVE_TIME),
    }), 'precondition', 'invalid_authoritative_time');
    expectSafeError(() => assertAuthoritativeFirestoreClock({
      firestoreSnapshot: firestoreSnapshot(AUTHORITATIVE_TIME),
      localNow: new Date('2026-10-21T09:00:30.001Z'),
    }), 'precondition', 'local_clock_drift');
  });

  it.each([
    ['Date', { readTime: new Date(AUTHORITATIVE_TIME) }],
    ['string', { readTime: AUTHORITATIVE_TIME }],
    ['toDate-only object', { readTime: { toDate: () => new Date(AUTHORITATIVE_TIME) } }],
    ['legacy private fields', { readTime: { _seconds: 1_761_038_400, _nanoseconds: 0 } }],
    ['out-of-range timestamp', { readTime: { seconds: Number.MAX_SAFE_INTEGER, nanoseconds: 0 } }],
  ])('rejects a non-Firestore authoritative %s', (_label, candidate) => {
    expectSafeError(() => assertAuthoritativeFirestoreClock({
      firestoreSnapshot: candidate,
      localNow: new Date(AUTHORITATIVE_TIME),
    }), 'precondition', 'invalid_authoritative_time');
    expectSafeError(() => buildAffiliateClickActivationMarker({
      authoritativeSnapshot: candidate,
      leadMinutes: 30,
      keyFingerprint: FINGERPRINT,
    }), 'precondition', 'invalid_authoritative_time');
  });

  it('accepts a verified current-schema backup up to 60 minutes old', () => {
    const evidence = assertFreshAffiliateClickActivationBackup({
      manifest: backupManifest({ createdAt: '2026-10-21T08:00:00.000Z' }),
      authoritativeSnapshot: firestoreSnapshot(AUTHORITATIVE_TIME),
      expectedProject: PROJECT_ID,
      expectedDatabase: DATABASE_ID,
      expectedAffiliates: 9,
    });
    expect(evidence).toMatchObject({
      schemaVersion: AFFILIATE_BACKUP_SCHEMA_VERSION,
      affiliateCount: 9,
      ageMs: 60 * 60 * 1_000,
    });
    expect(evidence.evidenceSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each([
    ['wrong schema', { schemaVersion: 2 }],
    ['older schema without notification outbox coverage', { schemaVersion: 3 }],
    ['wrong project', { projectId: 'other-staging-project' }],
    ['wrong database', { databaseId: 'another-db' }],
    ['wrong affiliate count', { datasets: [{ key: 'affiliates', count: 8 }] }],
    ['duplicate affiliate dataset', { datasets: [{ key: 'affiliates', count: 9 }, { key: 'affiliates', count: 9 }] }],
    ['invalid manifest hash', { contentSha256: 'not-a-hash' }],
    ['unsafe backup identifier', { backupId: 'token@example.test' }],
  ])('rejects a backup with %s', (_label, override) => {
    expectSafeError(() => assertFreshAffiliateClickActivationBackup({
      manifest: backupManifest(override),
      authoritativeSnapshot: firestoreSnapshot(AUTHORITATIVE_TIME),
      expectedProject: PROJECT_ID,
      expectedDatabase: DATABASE_ID,
    }), 'backup');
  });

  it('rejects stale and materially future-dated backups', () => {
    for (const createdAt of ['2026-10-21T07:59:59.999Z', '2026-10-21T09:00:30.001Z']) {
      expectSafeError(() => assertFreshAffiliateClickActivationBackup({
        manifest: backupManifest({ createdAt }),
        authoritativeSnapshot: firestoreSnapshot(AUTHORITATIVE_TIME),
        expectedProject: PROJECT_ID,
        expectedDatabase: DATABASE_ID,
      }), 'backup', 'stale_backup');
    }
  });
});

describe('founding affiliate reconciliation', () => {
  it('returns identity and migration evidence hashes without returning PII', () => {
    const result = assertFoundingAffiliateMigrationReconciled({
      migrationMarker: foundingMarker(),
      backupAffiliates: affiliates(),
      liveAffiliates: affiliates(),
    });
    const serialized = JSON.stringify(result);
    expect(result.affiliateCount).toBe(9);
    expect(result.identitySetSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.migrationEvidenceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(serialized).not.toContain('@example.test');
    expect(serialized).not.toContain('PARTNER_');
  });

  it('rejects identity drift, duplicate ownership, and unreconciled membership', () => {
    const identityDrift = affiliates();
    identityDrift[0] = { ...identityDrift[0], data: { ...identityDrift[0].data, email: 'changed@example.test' } };
    expectSafeError(() => assertFoundingAffiliateMigrationReconciled({
      migrationMarker: foundingMarker(), backupAffiliates: affiliates(), liveAffiliates: identityDrift,
    }), 'backup', 'founding_identity_conflict');

    const duplicateCode = affiliates();
    duplicateCode[1] = { ...duplicateCode[1], data: { ...duplicateCode[1].data, affiliateCode: 'PARTNER_01' } };
    expectSafeError(() => assertFoundingAffiliateMigrationReconciled({
      migrationMarker: foundingMarker(), backupAffiliates: duplicateCode, liveAffiliates: duplicateCode,
    }), 'backup', 'founding_identity_conflict');

    const noMembership = affiliates();
    noMembership[0] = { ...noMembership[0], data: { ...noMembership[0].data, literaryCircle: undefined } };
    expectSafeError(() => assertFoundingAffiliateMigrationReconciled({
      migrationMarker: foundingMarker(), backupAffiliates: affiliates(), liveAffiliates: noMembership,
    }), 'backup', 'founding_membership_not_reconciled');
  });

  it.each([
    ['incomplete status', { status: 'started' }],
    ['wrong count', { completedCount: 8 }],
    ['changed IDs', { completedAffiliateIds: affiliates().map(item => item.id).slice(1) }],
    ['unknown field', { unexpected: true }],
    ['bad timestamp', { completedAt: 'yesterday' }],
    ['impossible timestamp ordering', {
      startedAt: '2026-10-16T08:00:02.000Z',
      completedAt: '2026-10-16T08:00:01.000Z',
    }],
  ])('rejects a founding migration marker with %s', (_label, override) => {
    expectSafeError(() => assertFoundingAffiliateMigrationReconciled({
      migrationMarker: foundingMarker(override),
      backupAffiliates: affiliates(),
      liveAffiliates: affiliates(),
    }), 'backup', 'invalid_founding_migration_marker');
  });
});

describe('exact activation backup equality', () => {
  it('proves every captured dataset is byte-for-byte equal to the verified backup', () => {
    const state = exactBackupState();
    const evidence = assertExactAffiliateClickActivationLiveState(state);
    expect(evidence).toMatchObject({
      datasetCount: AFFILIATE_BACKUP_DATASETS.length,
      documentCount: 9,
    });
    expect(evidence.evidenceSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects even Literary Circle or click-ledger drift after the fresh backup', () => {
    for (const datasetKey of ['affiliates', 'affiliate_clicks']) {
      const state = exactBackupState();
      const payload = state.livePayloads.get(datasetKey) as BackupDatasetPayload;
      if (datasetKey === 'affiliates') {
        payload.documents[0].data.literaryCircle = { changed: true };
      } else {
        payload.documents.push({ id: 'unexpected-click', data: { schemaVersion: 2 } });
      }
      expectSafeError(
        () => assertExactAffiliateClickActivationLiveState(state),
        'backup',
        'live_state_drift',
      );
    }
  });
});

describe('controlled deployed-runtime proof event', () => {
  const event = {
    schemaVersion: 2,
    id: PROOF_EVENT_ID,
    keyFingerprint: FINGERPRINT,
    affiliateCode: 'PARTNER_01',
    affiliateId: 'affiliate-01',
    articleId: 'piece-one',
    visitorKey: VISITOR_KEY,
    timestamp: '2026-10-21T08:59:59.000Z',
    dedupeWindowStartedAt: '2026-10-21T08:30:00.000Z',
  };
  const validInput = {
    value: event,
    documentId: PROOF_EVENT_ID,
    expectedKeyFingerprint: FINGERPRINT,
    expectedAffiliateIdentities: affiliates().map(document => ({
      id: document.id,
      code: document.data.affiliateCode,
    })),
    firestoreSnapshot: firestoreSnapshot(AUTHORITATIVE_TIME),
    createTime: timestamp('2026-10-21T08:59:59.100Z'),
    updateTime: timestamp('2026-10-21T08:59:59.100Z'),
  };

  it('accepts a recent immutable v2 event without returning identity material', () => {
    const evidence = assertRecentAffiliateClickActivationProofEvent(validInput);
    const serialized = JSON.stringify(evidence);
    expect(evidence).toMatchObject({
      eventTimestamp: event.timestamp,
      keyFingerprint: FINGERPRINT,
    });
    expect(evidence.eventEvidenceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(serialized).not.toContain(event.affiliateId);
    expect(serialized).not.toContain(event.affiliateCode);
    expect(serialized).not.toContain(VISITOR_KEY);
    expect(serialized).not.toContain(PROOF_EVENT_ID);
    expect(() => assertAffiliateClickActivationProofBackedUp({
      backupClickDocuments: [{ id: PROOF_EVENT_ID, data: event }],
      documentId: PROOF_EVENT_ID,
      value: event,
    })).not.toThrow();
  });

  it('requires the exact controlled event to be present in the fresh backup', () => {
    for (const backupClickDocuments of [
      [],
      [{ id: PROOF_EVENT_ID, data: { ...event, articleId: 'changed' } }],
    ]) {
      expectSafeError(() => assertAffiliateClickActivationProofBackedUp({
        backupClickDocuments,
        documentId: PROOF_EVENT_ID,
        value: event,
      }), 'backup', 'proof_event_not_backed_up');
    }
  });

  it.each([
    ['wrong document id', { documentId: `aclk2_${'d'.repeat(64)}` }],
    ['wrong fingerprint', { expectedKeyFingerprint: `ack1_${'d'.repeat(43)}` }],
    ['unknown private field', { value: { ...event, ipHash: 'private' } }],
    ['missing visitor key', { value: { ...event, visitorKey: undefined, dedupeWindowStartedAt: undefined } }],
    ['wrong affiliate owner', { value: { ...event, affiliateId: 'affiliate-02' } }],
  ])('rejects a proof event with %s', (_label, override) => {
    expectSafeError(
      () => assertRecentAffiliateClickActivationProofEvent({ ...validInput, ...override }),
      'precondition',
    );
  });

  it('rejects stale, future, mutable, and non-authoritative proof timing', () => {
    const stale = {
      ...event,
      timestamp: '2026-10-21T08:44:59.999Z',
      dedupeWindowStartedAt: '2026-10-21T08:30:00.000Z',
    };
    const cases = [
      { value: stale, createTime: timestamp(stale.timestamp), updateTime: timestamp(stale.timestamp) },
      { value: { ...event, timestamp: '2026-10-21T08:59:59.200Z' } },
      { updateTime: timestamp('2026-10-21T08:59:59.101Z') },
      { firestoreSnapshot: { readTime: new Date(AUTHORITATIVE_TIME) } },
    ];
    for (const override of cases) {
      expectSafeError(
        () => assertRecentAffiliateClickActivationProofEvent({ ...validInput, ...override }),
        'precondition',
        'stale_or_mutable_proof_event',
      );
    }
  });
});

describe('activation marker creation and immutable metadata', () => {
  const marker = buildAffiliateClickActivationMarker({
    authoritativeSnapshot: firestoreSnapshot(AUTHORITATIVE_TIME),
    leadMinutes: 30,
    keyFingerprint: FINGERPRINT,
  });

  it('builds exactly the strict six-field marker from authoritative time', () => {
    expect(marker).toEqual({
      schemaVersion: 1,
      eventSchemaVersion: 2,
      activatedAt: AUTHORITATIVE_TIME,
      completeFrom: '2026-10-21T09:30:00.000Z',
      keyVersion: 'v1',
      keyFingerprint: FINGERPRINT,
    });
    expect(Object.keys(marker)).toHaveLength(6);
    expect(assertExactAffiliateClickActivationMarker(marker)).toEqual(marker);
  });

  it('rejects unknown fields and invalid marker versions', () => {
    expectSafeError(() => assertExactAffiliateClickActivationMarker({ ...marker, privateValue: 'no' }), 'conflict');
    expectSafeError(() => assertExactAffiliateClickActivationMarker({ ...marker, eventSchemaVersion: 1 }), 'conflict');
  });

  it('permits apply only when the fixed marker document is absent', () => {
    expect(() => assertAffiliateClickActivationMarkerAbsentForApply(false)).not.toThrow();
    for (const exists of [true, undefined, null, 0]) {
      expectSafeError(
        () => assertAffiliateClickActivationMarkerAbsentForApply(exists),
        'conflict',
        'activation_marker_exists',
      );
    }
  });

  it('requires createTime and updateTime to be identical and before completeFrom', () => {
    const metadataTime = timestamp('2026-10-21T09:00:01.000Z');
    const evidence = assertImmutableAffiliateClickActivationMarker({
      value: marker,
      createTime: metadataTime,
      updateTime: { ...metadataTime },
      expected: marker,
    });
    expect(evidence).toMatchObject({
      marker,
      createdAt: '2026-10-21T09:00:01.000Z',
      updatedAt: '2026-10-21T09:00:01.000Z',
    });
    expect(evidence.evidenceSha256).toMatch(/^[a-f0-9]{64}$/);

    expectSafeError(() => assertImmutableAffiliateClickActivationMarker({
      value: marker,
      createTime: metadataTime,
      updateTime: timestamp('2026-10-21T09:00:01.001Z'),
    }), 'conflict', 'mutable_activation_marker');
    expectSafeError(() => assertImmutableAffiliateClickActivationMarker({
      value: marker,
      createTime: timestamp(marker.completeFrom),
      updateTime: timestamp(marker.completeFrom),
    }), 'conflict', 'mutable_activation_marker');
    expectSafeError(() => assertImmutableAffiliateClickActivationMarker({
      value: marker,
      createTime: timestamp('2026-10-21T08:59:59.999Z'),
      updateTime: timestamp('2026-10-21T08:59:59.999Z'),
    }), 'conflict', 'mutable_activation_marker');
    expect(() => assertImmutableAffiliateClickActivationMarker({
      value: marker,
      createTime: timestamp(marker.activatedAt),
      updateTime: timestamp(marker.activatedAt),
    })).not.toThrow();
  });

  it('compares timestamp metadata at nanosecond precision', () => {
    const createTime = timestamp('2026-10-21T09:00:01.000Z', 1);
    const updateTime = timestamp('2026-10-21T09:00:01.000Z', 2);
    expectSafeError(() => assertImmutableAffiliateClickActivationMarker({
      value: marker, createTime, updateTime,
    }), 'conflict', 'mutable_activation_marker');
  });

  it('rejects a valid but conflicting existing marker', () => {
    const requested = buildAffiliateClickActivationMarker({
      authoritativeSnapshot: firestoreSnapshot(AUTHORITATIVE_TIME),
      leadMinutes: 31,
      keyFingerprint: FINGERPRINT,
    });
    const metadata = timestamp('2026-10-21T09:00:01.000Z');
    expectSafeError(() => assertImmutableAffiliateClickActivationMarker({
      value: marker,
      createTime: metadata,
      updateTime: metadata,
      expected: requested,
    }), 'conflict', 'activation_marker_conflict');
  });
});

describe('redacted reports and safe failures', () => {
  it('hashes deployment evidence and excludes secrets and affiliate identities', () => {
    const target = assertAffiliateClickActivationStagingTarget({
      options: { environment: 'staging', expectedProject: PROJECT_ID, expectedDatabase: DATABASE_ID },
      resolvedProjectId: PROJECT_ID,
      resolvedDatabaseId: DATABASE_ID,
      stagingProjectAllowlist: PROJECT_ID,
      productionProjectIds: 'ink-witness-production',
      serviceAccount: SERVICE_ACCOUNT,
      credentialSource: 'FIREBASE_SERVICE_ACCOUNT_JSON',
    });
    const backup = assertFreshAffiliateClickActivationBackup({
      manifest: backupManifest(),
      authoritativeSnapshot: firestoreSnapshot(AUTHORITATIVE_TIME),
      expectedProject: PROJECT_ID,
      expectedDatabase: DATABASE_ID,
    });
    const clock = assertAuthoritativeFirestoreClock({
      firestoreSnapshot: firestoreSnapshot(AUTHORITATIVE_TIME),
      localNow: new Date(AUTHORITATIVE_TIME),
    });
    const founding = assertFoundingAffiliateMigrationReconciled({
      migrationMarker: foundingMarker(),
      backupAffiliates: affiliates(),
      liveAffiliates: affiliates(),
    });
    const marker = buildAffiliateClickActivationMarker({
      authoritativeSnapshot: firestoreSnapshot(AUTHORITATIVE_TIME),
      leadMinutes: 30,
      keyFingerprint: FINGERPRINT,
    });
    const report = buildRedactedAffiliateClickActivationReport({
      mode: 'dry-run',
      status: 'ready',
      target,
      backup,
      liveState: {
        datasetCount: AFFILIATE_BACKUP_DATASETS.length,
        documentCount: 9,
        evidenceSha256: HASH,
      },
      keyFingerprint: FINGERPRINT,
      deploymentEvidence: 'dpl_stagingRequired123',
      proof: {
        eventTimestamp: '2026-10-21T08:59:59.000Z',
        createdAt: AUTHORITATIVE_TIME,
        observedAt: AUTHORITATIVE_TIME,
        keyFingerprint: FINGERPRINT,
        eventEvidenceSha256: HASH,
      },
      clock,
      founding,
      marker,
    });
    const serialized = JSON.stringify(report);
    expect(report.runtime.deploymentEvidenceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(report.reportEvidenceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain('dpl_stagingRequired123');
    expect(serialized).not.toContain('@example.test');
    expect(serialized).not.toContain('PARTNER_');
    expect(serialized).not.toContain('private_key');
  });

  it('maps typed errors to stable exits and fully redacts unknown provider errors', () => {
    const typed = new AffiliateClickActivationSafeError('target', 'target_refused', 'The staging target was refused.');
    expect(safeAffiliateClickActivationFailure(typed)).toEqual({
      status: 'error',
      code: 'target_refused',
      message: 'The staging target was refused.',
      exitCode: AFFILIATE_CLICK_ACTIVATION_EXIT_CODES.target,
    });
    const providerSecret = 'provider-secret-email@example.test';
    const unknown = safeAffiliateClickActivationFailure(new Error(providerSecret));
    expect(unknown).toEqual({
      status: 'error',
      code: 'activation_failed',
      message: 'Affiliate click activation failed safely.',
      exitCode: AFFILIATE_CLICK_ACTIVATION_EXIT_CODES.firestore,
    });
    expect(JSON.stringify(unknown)).not.toContain(providerSecret);
  });
});
