import { describe, expect, it } from 'vitest';
import type { DocumentReference, DocumentSnapshot, Firestore, Transaction } from 'firebase-admin/firestore';
import { deriveAffiliateClickAnalyticsKeyFingerprint } from '../src/server/affiliateClickLedger.js';
import {
  AFFILIATE_BACKUP_DATASETS,
  AFFILIATE_BACKUP_SCHEMA_VERSION,
  type BackupDatasetPayload,
  type BackupDocument,
  type VerifiedAffiliateBackup,
} from './literary-circle-migration-lib.js';
import {
  AFFILIATE_CLICK_ACTIVATION_MARKER_COLLECTION,
  AFFILIATE_CLICK_ACTIVATION_MARKER_DOCUMENT_ID,
  AffiliateClickActivationSafeError,
} from './affiliate-click-activation-lib.js';
import { executeAffiliateClickActivation } from './activate-affiliate-click-analytics.js';

const PROJECT_ID = 'ink-witness-staging';
const DATABASE_ID = '(default)';
const NOW = '2026-10-21T09:00:00.000Z';
const PROOF_EVENT_ID = `aclk2_${'b'.repeat(64)}`;
const SECRET = 'activation-cli-test-secret-that-is-longer-than-thirty-two-characters';
const FINGERPRINT = deriveAffiliateClickAnalyticsKeyFingerprint(SECRET) as string;
const HASH = 'a'.repeat(64);
const SERVICE_ACCOUNT = JSON.stringify({
  type: 'service_account',
  project_id: PROJECT_ID,
  client_email: `activation@${PROJECT_ID}.iam.gserviceaccount.com`,
  private_key: '-----BEGIN PRIVATE KEY-----\nunit-test-only\n-----END PRIVATE KEY-----',
});

function timestamp(iso: string): { seconds: number; nanoseconds: number } {
  const milliseconds = Date.parse(iso);
  return {
    seconds: Math.floor(milliseconds / 1_000),
    nanoseconds: (milliseconds % 1_000) * 1_000_000,
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

function proofEvent(): Record<string, unknown> {
  return {
    schemaVersion: 2,
    id: PROOF_EVENT_ID,
    keyFingerprint: FINGERPRINT,
    affiliateCode: 'PARTNER_01',
    affiliateId: 'affiliate-01',
    articleId: 'piece-one',
    visitorKey: `acv1_${'c'.repeat(43)}`,
    timestamp: '2026-10-21T08:59:59.000Z',
    dedupeWindowStartedAt: '2026-10-21T08:30:00.000Z',
  };
}

function migrationMarker(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    migrationId: 'literary-circle-founding-affiliates-v1',
    status: 'complete',
    expectedAffiliateCount: 9,
    completedAffiliateIds: affiliates().map(document => document.id).sort(),
    completedCount: 9,
    backupId: 'literary-circle-original-backup',
    backupManifestSha256: HASH,
    startedAt: '2026-10-16T08:00:00.000Z',
    completedAt: '2026-10-16T08:00:01.000Z',
    lastAppliedAt: '2026-10-16T08:00:01.000Z',
    attemptCount: 1,
  };
}

function verifiedBackup(): VerifiedAffiliateBackup {
  const payloads = new Map<string, BackupDatasetPayload>();
  for (const definition of AFFILIATE_BACKUP_DATASETS) {
    payloads.set(definition.key, {
      schemaVersion: AFFILIATE_BACKUP_SCHEMA_VERSION,
      key: definition.key,
      collection: definition.collection,
      scope: definition.scope,
      documents: definition.key === 'affiliates'
        ? affiliates()
        : definition.key === 'affiliate_clicks'
          ? [{ id: PROOF_EVENT_ID, data: proofEvent() }]
          : [],
    });
  }
  return {
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
}

function clonePayloads(source: ReadonlyMap<string, BackupDatasetPayload>): Map<string, BackupDatasetPayload> {
  return new Map([...source].map(([key, value]) => [
    key,
    JSON.parse(JSON.stringify(value)) as BackupDatasetPayload,
  ]));
}

function argumentsFor(mode: 'dry-run' | 'apply' = 'dry-run'): string[] {
  return [
    '--environment=staging',
    `--expected-project=${PROJECT_ID}`,
    `--expected-database=${DATABASE_ID}`,
    '--expected-affiliates=9',
    '--backup=data/backups/test/manifest.json',
    `--expected-key-fingerprint=${FINGERPRINT}`,
    '--deployment-evidence=dpl_RequiredStaging123',
    `--proof-event-id=${PROOF_EVENT_ID}`,
    '--lead-minutes=30',
    ...(mode === 'apply' ? [
      '--apply',
      '--acknowledge-create-only',
      '--acknowledge-no-rollback',
      '--acknowledge-staging-traffic-quiesced',
    ] : []),
  ];
}

interface StoredDocument {
  data: Record<string, unknown>;
  createTime: string;
  updateTime: string;
}

function fakeFirestore(options: {
  existingMarker?: Record<string, unknown>;
  createFailure?: unknown;
  mutateCreatedMarkerMetadata?: boolean;
} = {}): {
  db: Firestore;
  writes: Array<{ kind: string; path: string; value: unknown }>;
  transactions: number;
} {
  const markerPath = `${AFFILIATE_CLICK_ACTIVATION_MARKER_COLLECTION}/${AFFILIATE_CLICK_ACTIVATION_MARKER_DOCUMENT_ID}`;
  const documents = new Map<string, StoredDocument>();
  for (const affiliate of affiliates()) {
    documents.set(`affiliates/${affiliate.id}`, {
      data: affiliate.data,
      createTime: '2026-10-16T08:00:00.000Z',
      updateTime: '2026-10-16T08:00:00.000Z',
    });
  }
  documents.set(`affiliate_clicks/${PROOF_EVENT_ID}`, {
    data: proofEvent(),
    createTime: '2026-10-21T08:59:59.100Z',
    updateTime: '2026-10-21T08:59:59.100Z',
  });
  documents.set('migration_markers/literary-circle-founding-affiliates-v1', {
    data: migrationMarker(),
    createTime: '2026-10-16T08:00:00.000Z',
    updateTime: '2026-10-16T08:00:01.000Z',
  });
  if (options.existingMarker) {
    documents.set(markerPath, {
      data: options.existingMarker,
      createTime: '2026-10-21T09:00:01.000Z',
      updateTime: '2026-10-21T09:00:01.000Z',
    });
  }

  const writes: Array<{ kind: string; path: string; value: unknown }> = [];
  let transactions = 0;
  let readTime = NOW;
  const refs = new Map<string, DocumentReference>();

  const snapshot = (reference: DocumentReference): DocumentSnapshot => {
    const stored = documents.get(reference.path);
    return {
      id: reference.id,
      ref: reference,
      exists: Boolean(stored),
      data: () => stored?.data,
      createTime: stored ? timestamp(stored.createTime) : undefined,
      updateTime: stored ? timestamp(stored.updateTime) : undefined,
      readTime: timestamp(readTime),
    } as unknown as DocumentSnapshot;
  };

  const reference = (collection: string, id: string): DocumentReference => {
    const key = `${collection}/${id}`;
    const existing = refs.get(key);
    if (existing) return existing;
    const created = {
      id,
      path: key,
      get: async () => snapshot(created as unknown as DocumentReference),
    } as unknown as DocumentReference;
    refs.set(key, created);
    return created;
  };

  const db = {
    collection: (collection: string) => ({ doc: (id: string) => reference(collection, id) }),
    getAll: async (...requested: DocumentReference[]) => requested.map(snapshot),
    runTransaction: async <T>(callback: (transaction: Transaction) => Promise<T>): Promise<T> => {
      transactions += 1;
      const pending: Array<{ reference: DocumentReference; value: Record<string, unknown> }> = [];
      const transaction = {
        getAll: async (...requested: DocumentReference[]) => requested.map(snapshot),
        create: (requested: DocumentReference, value: Record<string, unknown>) => {
          if (options.createFailure) throw options.createFailure;
          if (documents.has(requested.path)) {
            throw Object.assign(new Error('not exposed'), { code: 6 });
          }
          pending.push({ reference: requested, value });
          writes.push({ kind: 'create', path: requested.path, value });
          return transaction;
        },
      } as unknown as Transaction;
      const result = await callback(transaction);
      for (const item of pending) {
        documents.set(item.reference.path, {
          data: item.value,
          createTime: '2026-10-21T09:00:01.000Z',
          updateTime: options.mutateCreatedMarkerMetadata
            ? '2026-10-21T09:00:01.001Z'
            : '2026-10-21T09:00:01.000Z',
        });
      }
      readTime = '2026-10-21T09:00:02.000Z';
      return result;
    },
  } as unknown as Firestore;

  return {
    db,
    writes,
    get transactions() {
      return transactions;
    },
  };
}

function dependencies(firestore = fakeFirestore(), backup = verifiedBackup()) {
  let captures = 0;
  return {
    firestore,
    get captures() {
      return captures;
    },
    values: {
      env: {
        FIREBASE_SERVICE_ACCOUNT_JSON: SERVICE_ACCOUNT,
        FIREBASE_PROJECT_ID: PROJECT_ID,
        FIRESTORE_DATABASE_ID: DATABASE_ID,
        LITERARY_CIRCLE_STAGING_PROJECT_IDS: PROJECT_ID,
        LITERARY_CIRCLE_PRODUCTION_PROJECT_IDS: 'ink-and-witness-narratives',
        AFFILIATE_CLICK_LEDGER_MODE: 'required',
        AFFILIATE_CLICK_ANALYTICS_SECRET: SECRET,
      },
      now: () => new Date(NOW),
      configuredTarget: () => ({ projectId: PROJECT_ID, databaseId: DATABASE_ID }),
      getFirestore: () => firestore.db,
      verifyBackup: () => backup,
      captureDatasets: async (_db: Firestore) => {
        captures += 1;
        return clonePayloads(backup.payloads);
      },
    },
  };
}

describe('affiliate click activation CLI boundary', () => {
  it('defaults to a zero-write dry run and emits only redacted evidence', async () => {
    const setup = dependencies();
    const report = await executeAffiliateClickActivation(argumentsFor(), setup.values);
    const serialized = JSON.stringify(report);
    expect(report).toMatchObject({ mode: 'dry-run', status: 'ready' });
    expect(setup.firestore.transactions).toBe(0);
    expect(setup.firestore.writes).toEqual([]);
    expect(setup.captures).toBe(1);
    expect(serialized).not.toContain('dpl_RequiredStaging123');
    expect(serialized).not.toContain('affiliate-01');
    expect(serialized).not.toContain('PARTNER_01');
    expect(serialized).not.toContain(`acv1_${'c'.repeat(43)}`);
    expect(serialized).not.toContain(SERVICE_ACCOUNT);
    expect(serialized).not.toContain(SECRET);
  });

  it('applies exactly one six-field create at the fixed path and verifies it', async () => {
    const setup = dependencies();
    const report = await executeAffiliateClickActivation(argumentsFor('apply'), setup.values);
    expect(report).toMatchObject({ mode: 'apply', status: 'created' });
    expect(setup.firestore.transactions).toBe(1);
    expect(setup.firestore.writes).toHaveLength(1);
    expect(setup.firestore.writes[0]).toMatchObject({
      kind: 'create',
      path: 'site_configs/affiliate_click_analytics',
    });
    expect(Object.keys(setup.firestore.writes[0].value as object).sort()).toEqual([
      'activatedAt',
      'completeFrom',
      'eventSchemaVersion',
      'keyFingerprint',
      'keyVersion',
      'schemaVersion',
    ]);
    expect(setup.captures).toBe(2);
  });

  it('refuses any pre-existing marker before entering an apply transaction', async () => {
    const existing = {
      schemaVersion: 1,
      eventSchemaVersion: 2,
      activatedAt: NOW,
      completeFrom: '2026-10-21T09:30:00.000Z',
      keyVersion: 'v1',
      keyFingerprint: FINGERPRINT,
    };
    const setup = dependencies(fakeFirestore({ existingMarker: existing }));
    await expect(executeAffiliateClickActivation(argumentsFor('apply'), setup.values))
      .rejects.toMatchObject({
        kind: 'conflict',
        safeCode: 'activation_marker_exists',
        exitCode: 6,
      });
    expect(setup.firestore.transactions).toBe(0);
    expect(setup.firestore.writes).toEqual([]);
  });

  it('maps a create race to conflict without update, delete, or repair', async () => {
    const setup = dependencies(fakeFirestore({
      createFailure: Object.assign(new Error('provider payload must not escape'), { code: 6 }),
    }));
    await expect(executeAffiliateClickActivation(argumentsFor('apply'), setup.values))
      .rejects.toMatchObject({
        kind: 'conflict',
        safeCode: 'activation_marker_exists',
        exitCode: 6,
      });
    expect(setup.firestore.writes).toEqual([]);
  });

  it('never repairs or deletes a marker when post-verification fails', async () => {
    const setup = dependencies(fakeFirestore({ mutateCreatedMarkerMetadata: true }));
    await expect(executeAffiliateClickActivation(argumentsFor('apply'), setup.values))
      .rejects.toMatchObject({
        kind: 'conflict',
        safeCode: 'mutable_activation_marker',
      });
    expect(setup.firestore.writes).toHaveLength(1);
    expect(setup.firestore.writes[0].kind).toBe('create');
  });

  it('stops before Firestore when apply acknowledgements are incomplete', async () => {
    const setup = dependencies();
    const incomplete = [...argumentsFor(), '--apply', '--acknowledge-create-only'];
    await expect(executeAffiliateClickActivation(incomplete, setup.values))
      .rejects.toBeInstanceOf(AffiliateClickActivationSafeError);
    expect(setup.firestore.transactions).toBe(0);
    expect(setup.firestore.writes).toEqual([]);
    expect(setup.captures).toBe(0);
  });

  it('stops before the transaction when the live state drifts from the backup', async () => {
    const backup = verifiedBackup();
    const setup = dependencies(fakeFirestore(), backup);
    const originalCapture = setup.values.captureDatasets;
    setup.values.captureDatasets = async db => {
      const payloads = await originalCapture(db);
      payloads.get('affiliate_clicks')?.documents.push({ id: 'unexpected', data: {} });
      return payloads;
    };
    await expect(executeAffiliateClickActivation(argumentsFor('apply'), setup.values))
      .rejects.toMatchObject({ kind: 'backup', safeCode: 'live_state_drift' });
    expect(setup.firestore.transactions).toBe(0);
    expect(setup.firestore.writes).toEqual([]);
  });
});
