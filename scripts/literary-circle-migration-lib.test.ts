import fs from 'fs';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AffiliateAccount } from '../src/types.js';
import { createLiteraryCircleMembership } from '../src/server/literaryCircle.js';
import {
  AFFILIATE_BACKUP_DATASETS,
  FOUNDING_AFFILIATE_COUNT,
  assertLiveStateMatchesBackup,
  assertReadOnlyBackupTarget,
  assertStagingTarget,
  buildDatasetPayload,
  canonicalJson,
  captureAffiliateDatasets,
  configuredFirebaseTarget,
  mergeFoundingMembership,
  planIndexReservation,
  prettyStableJson,
  sha256Hex,
  summarizeDatasetDocuments,
  validateFoundingAffiliateDocuments,
  verifyAffiliateBackup,
  writeAffiliateBackup,
  type BackupDatasetPayload,
  type BackupDocument
} from './literary-circle-migration-lib.js';

const cleanupDirectories: string[] = [];

afterEach(() => {
  for (const directory of cleanupDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function affiliate(index: number): AffiliateAccount {
  return {
    id: `affiliate-${index}`,
    affiliateCode: `FOUNDER${index}`,
    name: `Founder ${index}`,
    email: `founder-${index}@example.test`,
    phone: `2547000000${index}`,
    status: 'active',
    payoutMethod: 'mpesa',
    payoutDetails: {},
    totalClicks: index,
    uniqueVisitors: index,
    totalSalesCount: index,
    totalRevenueKes: index * 100,
    totalCommissionEarnedKes: index * 15,
    totalCommissionPaidKes: 0,
    balanceAvailableKes: index * 15,
    balancePendingKes: 0,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z'
  };
}

function completePayloadSet(): Map<string, BackupDatasetPayload> {
  const payloads = new Map<string, BackupDatasetPayload>();
  for (const definition of AFFILIATE_BACKUP_DATASETS) {
    const documents: BackupDocument[] = definition.key === 'affiliates'
      ? Array.from({ length: FOUNDING_AFFILIATE_COUNT }, (_, offset) => {
          const account = affiliate(offset + 1);
          return { id: account.id, data: account as unknown as Record<string, unknown> };
        })
      : [];
    payloads.set(definition.key, buildDatasetPayload(definition, documents));
  }
  return payloads;
}

function payloadSetWithResourceAssets(): Map<string, BackupDatasetPayload> {
  const payloads = completePayloadSet();
  const siteConfigs = AFFILIATE_BACKUP_DATASETS.find(item => item.key === 'affiliate_site_configs')!;
  const resourceAssets = AFFILIATE_BACKUP_DATASETS.find(item => item.key === 'literary_circle_resource_assets')!;
  payloads.set('affiliate_site_configs', buildDatasetPayload(siteConfigs, [{
    id: 'literary_circle_resources',
    data: {
      items: [
        { id: 'published-resource', assetId: 'asset-public', isPublished: true },
        { id: 'draft-resource', assetId: 'asset-private', isPublished: false }
      ]
    }
  }]));
  payloads.set('literary_circle_resource_assets', buildDatasetPayload(resourceAssets, [
    { id: 'asset-private', data: { accessScope: 'literary_circle_private', dataUrl: 'data:image/png;base64,cHJpdmF0ZQ==' } },
    { id: 'asset-public', data: { accessScope: 'public', dataUrl: 'data:image/png;base64,cHVibGlj' } }
  ]));
  return payloads;
}

type CaptureDb = NonNullable<Parameters<typeof captureAffiliateDatasets>[0]>;

function fakeFirestore(documents: ReadonlyMap<string, Record<string, unknown>>): CaptureDb {
  const snapshot = (collection: string, id: string) => {
    const data = documents.get(`${collection}/${id}`);
    return {
      id,
      exists: data !== undefined,
      data: () => data
    };
  };
  return {
    collection(collection: string) {
      return {
        doc(id: string) {
          return { get: async () => snapshot(collection, id) };
        },
        async get() {
          const prefix = `${collection}/`;
          return {
            docs: [...documents.keys()]
              .filter(documentPath => (
                documentPath.startsWith(prefix)
                && !documentPath.slice(prefix.length).includes('/')
              ))
              .map(documentPath => snapshot(collection, documentPath.slice(prefix.length)))
          };
        }
      };
    }
  } as unknown as CaptureDb;
}

describe('Literary Circle migration safety helpers', () => {
  it('canonicalizes object keys and reports configured sums', () => {
    expect(canonicalJson({ z: 1, nested: { b: 2, a: 1 } }))
      .toBe(canonicalJson({ nested: { a: 1, b: 2 }, z: 1 }));
    const definition = AFFILIATE_BACKUP_DATASETS.find(item => item.key === 'affiliate_commissions');
    expect(definition).toBeTruthy();
    const summary = summarizeDatasetDocuments([
      { id: 'one', data: { saleAmountKes: 100, commissionAmountKes: 15, grossCreatorRevenueKes: 85 } },
      { id: 'two', data: { saleAmountKes: 250, commissionAmountKes: 50, grossCreatorRevenueKes: 200 } }
    ], definition!);
    expect(summary).toEqual({
      count: 2,
      sums: { saleAmountKes: 350, commissionAmountKes: 65, grossCreatorRevenueKes: 285 }
    });
  });

  it('adds founding defaults without overwriting existing membership state or unknown fields', () => {
    const seeded = createLiteraryCircleMembership({
      now: '2026-10-16T00:00:00.000Z',
      foundingMember: true,
      audience: 'existing_upgrade',
      actor: 'test'
    });
    const existing = {
      ...seeded,
      foundingMember: false,
      foundingRecognizedAt: undefined,
      complimentaryAccess: {
        ...seeded.complimentaryAccess,
        status: 'suspended',
        customReasonCode: 'writer-review'
      },
      futureField: { keep: true }
    };
    const merged = mergeFoundingMembership(existing, seeded, '2026-10-16T00:00:00.000Z');
    expect(merged.foundingMember).toBe(true);
    expect(merged.foundingRecognizedAt).toBe('2026-10-16T00:00:00.000Z');
    expect(merged.complimentaryAccess.status).toBe('suspended');
    expect((merged.complimentaryAccess as unknown as Record<string, unknown>).customReasonCode).toBe('writer-review');
    expect((merged as unknown as Record<string, unknown>).futureField).toEqual({ keep: true });
  });

  it('only creates an index when absent or backfills one owned by the same affiliate', () => {
    expect(planIndexReservation({
      existing: undefined,
      affiliateId: 'affiliate-1',
      expectedFields: { affiliateId: 'affiliate-1', affiliateCode: 'FOUNDER1' }
    })).toEqual({
      action: 'create',
      patch: { affiliateId: 'affiliate-1', affiliateCode: 'FOUNDER1' }
    });
    expect(planIndexReservation({
      existing: { affiliateId: 'affiliate-1', affiliateCode: 'FOUNDER1' },
      affiliateId: 'affiliate-1',
      expectedFields: { affiliateId: 'affiliate-1', affiliateCode: 'FOUNDER1', reservedAt: 'now' }
    })).toEqual({ action: 'backfill', patch: { reservedAt: 'now' } });
    expect(planIndexReservation({
      existing: { affiliateId: 'affiliate-2' },
      affiliateId: 'affiliate-1',
      expectedFields: { affiliateId: 'affiliate-1' }
    })).toEqual({ action: 'conflict', patch: {} });
  });

  it('requires exactly nine unique founding identities', () => {
    const documents = Array.from({ length: FOUNDING_AFFILIATE_COUNT }, (_, offset) => {
      const account = affiliate(offset + 1);
      return { id: account.id, data: account as unknown as Record<string, unknown> };
    });
    expect(validateFoundingAffiliateDocuments(documents)).toHaveLength(FOUNDING_AFFILIATE_COUNT);
    const duplicate = documents.map(document => ({ ...document, data: { ...document.data } }));
    duplicate[1].data.affiliateCode = duplicate[0].data.affiliateCode;
    expect(() => validateFoundingAffiliateDocuments(duplicate)).toThrow(/not unique/i);
  });

  it('captures the resource library and only its referenced public and private assets', async () => {
    const payloads = await captureAffiliateDatasets(fakeFirestore(new Map([
      ['site_configs/literary_circle_resources', {
        items: [
          { id: 'published-resource', assetId: 'asset-public', isPublished: true },
          { id: 'draft-resource', assetId: 'asset-private', isPublished: false }
        ]
      }],
      ['site_configs/affiliate_notifications', {
        schemaVersion: 1,
        revision: 2,
        deliveryMode: 'preview_only'
      }],
      ['uploaded_assets/asset-public', { accessScope: 'public', dataUrl: 'data:image/png;base64,cHVibGlj' }],
      ['uploaded_assets/asset-private', {
        accessScope: 'literary_circle_private',
        dataUrl: 'data:image/png;base64,cHJpdmF0ZQ=='
      }],
      ['uploaded_assets/unrelated-asset', { accessScope: 'public', dataUrl: 'data:image/png;base64,b3RoZXI=' }]
    ])));

    expect(payloads.get('affiliate_site_configs')?.documents.map(document => document.id))
      .toContain('literary_circle_resources');
    expect(payloads.get('affiliate_site_configs')?.documents.map(document => document.id))
      .toContain('affiliate_notifications');
    expect(payloads.get('literary_circle_resource_assets')?.documents.map(document => document.id))
      .toEqual(['asset-private', 'asset-public']);
  });

  it('refuses to capture a resource library with a missing referenced asset', async () => {
    await expect(captureAffiliateDatasets(fakeFirestore(new Map([
      ['site_configs/literary_circle_resources', {
        items: [{ id: 'draft-resource', assetId: 'missing-asset', isPublished: false }]
      }]
    ])))).rejects.toThrow(/missing uploaded_assets documents: missing-asset/i);
  });

  it('writes a verifiable snapshot and rejects a changed dataset file', () => {
    const target = { projectId: 'literary-circle-test', databaseId: '(default)' };
    const written = writeAffiliateBackup({
      payloads: payloadSetWithResourceAssets(),
      target,
      now: '2026-10-16T00:00:00.000Z'
    });
    cleanupDirectories.push(written.directory);
    const verified = verifyAffiliateBackup(written.manifestPath, {
      target,
      expectedAffiliates: FOUNDING_AFFILIATE_COUNT
    });
    expect(verified.manifest.schemaVersion).toBe(3);
    expect(verified.manifest.contentSha256).toBe(written.manifest.contentSha256);
    expect(verified.payloads.get('literary_circle_resource_assets')?.documents.map(document => document.id))
      .toEqual(['asset-private', 'asset-public']);

    fs.appendFileSync(path.join(written.directory, 'affiliate_clicks.json'), ' ');
    expect(() => verifyAffiliateBackup(written.manifestPath, {
      target,
      expectedAffiliates: FOUNDING_AFFILIATE_COUNT
    })).toThrow(/hash check failed/i);
  });

  it('rejects resource-asset payloads that do not exactly close the library references', () => {
    const target = { projectId: 'literary-circle-test', databaseId: '(default)' };
    const payloads = payloadSetWithResourceAssets();
    const resourceAssets = AFFILIATE_BACKUP_DATASETS.find(item => item.key === 'literary_circle_resource_assets')!;
    payloads.set('literary_circle_resource_assets', buildDatasetPayload(resourceAssets, [{
      id: 'asset-public',
      data: { accessScope: 'public' }
    }]));

    expect(() => writeAffiliateBackup({
      payloads,
      target,
      now: '2026-10-16T00:30:00.000Z'
    })).toThrow(/must exactly match every asset referenced/i);
  });

  it('verifies resource-asset closure independently of manifest hashes and counts', () => {
    const target = { projectId: 'literary-circle-test', databaseId: '(default)' };
    const written = writeAffiliateBackup({
      payloads: payloadSetWithResourceAssets(),
      target,
      now: '2026-10-16T00:45:00.000Z'
    });
    cleanupDirectories.push(written.directory);

    const payloadPath = path.join(written.directory, 'literary_circle_resource_assets.json');
    const assetPayload = JSON.parse(fs.readFileSync(payloadPath, 'utf8')) as BackupDatasetPayload;
    assetPayload.documents = assetPayload.documents.filter(document => document.id === 'asset-public');
    const assetContents = prettyStableJson(assetPayload);
    fs.writeFileSync(payloadPath, assetContents);

    const manifest = JSON.parse(fs.readFileSync(written.manifestPath, 'utf8')) as Record<string, any>;
    const manifestEntry = manifest.datasets.find((entry: Record<string, unknown>) => (
      entry.key === 'literary_circle_resource_assets'
    ));
    if (!manifestEntry) throw new Error('Test backup is missing the resource-assets manifest entry.');
    manifestEntry.sha256 = sha256Hex(assetContents);
    manifestEntry.count = 1;
    const { contentSha256: _contentSha256, ...unsignedManifest } = manifest;
    manifest.contentSha256 = sha256Hex(canonicalJson(unsignedManifest));
    fs.writeFileSync(written.manifestPath, prettyStableJson(manifest));

    expect(() => verifyAffiliateBackup(written.manifestPath, {
      target,
      expectedAffiliates: FOUNDING_AFFILIATE_COUNT
    })).toThrow(/must exactly match every asset referenced/i);
  });

  it('requires explicit read-only confirmation before backing up production', () => {
    const target = { projectId: 'ink-witness-production', databaseId: '(default)' };
    expect(() => assertReadOnlyBackupTarget({
      environment: 'production',
      expectedProject: target.projectId,
      target
    })).toThrow(/allow-production-read-only/i);
    expect(() => assertReadOnlyBackupTarget({
      environment: 'production',
      expectedProject: target.projectId,
      allowProductionReadOnly: true,
      target
    })).not.toThrow();
  });

  it('always refuses to apply a staging migration to the known production project', () => {
    const target = { projectId: 'ink-and-witness-narratives', databaseId: '(default)' };
    expect(() => assertStagingTarget({
      environment: 'staging',
      expectedProject: target.projectId,
      target
    })).toThrow(/known production Firebase project/i);
  });

  it('validates the same environment-overridden Firebase target that getDb will open', () => {
    const directory = fs.mkdtempSync(path.join(process.cwd(), '.literary-circle-target-test-'));
    cleanupDirectories.push(directory);
    fs.writeFileSync(path.join(directory, 'firebase-applet-config.json'), JSON.stringify({
      projectId: 'ink-and-witness-narratives',
      firestoreDatabaseId: '(default)'
    }));
    const previousProjectId = process.env.FIREBASE_PROJECT_ID;
    const previousDatabaseId = process.env.FIRESTORE_DATABASE_ID;
    process.env.FIREBASE_PROJECT_ID = 'ink-and-witness-staging';
    process.env.FIRESTORE_DATABASE_ID = 'staging-db';
    try {
      expect(configuredFirebaseTarget(directory)).toEqual({
        projectId: 'ink-and-witness-staging',
        databaseId: 'staging-db'
      });
    } finally {
      if (previousProjectId === undefined) delete process.env.FIREBASE_PROJECT_ID;
      else process.env.FIREBASE_PROJECT_ID = previousProjectId;
      if (previousDatabaseId === undefined) delete process.env.FIRESTORE_DATABASE_ID;
      else process.env.FIRESTORE_DATABASE_ID = previousDatabaseId;
    }
  });

  it('refuses a live ledger change even when aggregate totals are unchanged', () => {
    const payloads = completePayloadSet();
    const commissionDefinition = AFFILIATE_BACKUP_DATASETS.find(item => item.key === 'affiliate_commissions')!;
    payloads.set('affiliate_commissions', buildDatasetPayload(commissionDefinition, [{
      id: 'commission-1',
      data: { saleAmountKes: 0, commissionAmountKes: 0, grossCreatorRevenueKes: 0, status: 'PENDING' }
    }]));
    const target = { projectId: 'literary-circle-test', databaseId: '(default)' };
    const written = writeAffiliateBackup({
      payloads,
      target,
      now: '2026-10-16T01:00:00.000Z'
    });
    cleanupDirectories.push(written.directory);
    const verified = verifyAffiliateBackup(written.manifestPath, {
      target,
      expectedAffiliates: FOUNDING_AFFILIATE_COUNT
    });
    const changed = new Map(payloads);
    const commissions = buildDatasetPayload(
      commissionDefinition,
      [{
        id: 'commission-1',
        data: { saleAmountKes: 0, commissionAmountKes: 0, grossCreatorRevenueKes: 0, status: 'REVERSED' }
      }]
    );
    changed.set('affiliate_commissions', commissions);

    expect(() => assertLiveStateMatchesBackup(verified, changed)).toThrow(/documents differ/i);
  });
});
