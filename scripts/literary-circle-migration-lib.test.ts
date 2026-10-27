import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AffiliateAccount } from '../src/types.js';
import { createLiteraryCircleMembership } from '../src/server/literaryCircle.js';
import {
  AFFILIATE_BACKUP_DATASETS,
  AFFILIATE_BACKUP_SCHEMA_VERSION,
  FOUNDING_AFFILIATE_COUNT,
  assertLiveStateMatchesBackup,
  assertMigrationMarkerMatchesBackup,
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
  migrationMarkerDocumentId,
  LITERARY_CIRCLE_MIGRATION_ID,
  type BackupDatasetPayload,
  type BackupDocument
} from './literary-circle-migration-lib.js';

const cleanupDirectories: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
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
  it('captures only the named activation/migration markers and preserves their exact fields', async () => {
    const records = new Map<string, Record<string, unknown>>([
      ['site_configs/affiliate_click_analytics', { schemaVersion: 1, activatedAt: '2026-10-23T00:00:00.000Z', custom: 'preserved' }],
      [`migration_markers/${migrationMarkerDocumentId()}`, { status: 'complete', attemptCount: 1, custom: ['preserved'] }],
      ['migration_markers/unrelated', { private: 'excluded' }],
    ]);
    const captured = await captureAffiliateDatasets(fakeFirestore(records));
    for (const key of ['affiliate_click_activation_marker', 'literary_circle_migration_markers']) {
      const definition = AFFILIATE_BACKUP_DATASETS.find(item => item.key === key)!;
      expect(captured.get(key)?.documents).toEqual([{ id: definition.documentIds![0], data: records.get(`${definition.collection}/${definition.documentIds![0]}`) }]);
    }
  });

  it('allows only a completed first migration marker bound to the exact backup on retry', () => {
    const target = { projectId: 'literary-circle-test', databaseId: '(default)' };
    const written = writeAffiliateBackup({ payloads: completePayloadSet(), target, now: '2026-10-16T00:00:00.000Z' });
    cleanupDirectories.push(written.directory);
    const verified = verifyAffiliateBackup(written.manifestPath, { target, expectedAffiliates: FOUNDING_AFFILIATE_COUNT });
    const marker: BackupDocument = { id: migrationMarkerDocumentId(), data: {
      schemaVersion: 1, migrationId: LITERARY_CIRCLE_MIGRATION_ID, status: 'complete',
      expectedAffiliateCount: 9, completedCount: 9,
      completedAffiliateIds: verified.payloads.get('affiliates')!.documents.map(document => document.id).sort(),
      backupId: written.manifest.backupId, backupManifestSha256: written.manifest.contentSha256,
      startedAt: '2026-10-16T00:00:01.000Z', completedAt: '2026-10-16T00:00:02.000Z',
      lastAppliedAt: '2026-10-16T00:00:02.000Z', attemptCount: 1,
    } };
    expect(() => assertMigrationMarkerMatchesBackup(verified, [])).not.toThrow();
    expect(() => assertMigrationMarkerMatchesBackup(verified, [marker])).not.toThrow();
    for (const patch of [
      { backupManifestSha256: 'wrong' }, { backupId: 'wrong' }, { status: 'pending' },
      { attemptCount: 2 }, { completedCount: 8 }, { completedAffiliateIds: [] }, { unexpected: true },
      { startedAt: '2026-10-15T00:00:00.000Z' }, { completedAt: 'invalid' },
    ]) {
      expect(() => assertMigrationMarkerMatchesBackup(verified, [{ ...marker, data: { ...marker.data, ...patch } }])).toThrow(/migration marker/);
    }
    const definition = AFFILIATE_BACKUP_DATASETS.find(item => item.key === 'literary_circle_migration_markers')!;
    const live = new Map(verified.payloads);
    live.set(definition.key, buildDatasetPayload(definition, [marker]));
    expect(() => assertLiveStateMatchesBackup(verified, live)).not.toThrow();
    expect(() => assertLiveStateMatchesBackup(verified, live, { expectedMigrationMarker: marker })).not.toThrow();
    expect(() => assertLiveStateMatchesBackup(verified, live, { expectedMigrationMarker: { ...marker, data: { ...marker.data, attemptCount: 2 } } })).toThrow(/committed transaction/);
    const baseline = { ...verified, payloads: new Map(live) };
    expect(() => assertMigrationMarkerMatchesBackup(baseline, [marker])).not.toThrow();
    expect(() => assertMigrationMarkerMatchesBackup(baseline, [])).toThrow(/migration marker/);
  });

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

  it('captures notification source and intent records without projecting away evidence', async () => {
    const records = new Map<string, Record<string, unknown>>([
      ['affiliate_notification_outbox/ane1_source', { kind: 'source', sourceSha256: 'source-evidence' }],
      ['affiliate_notification_outbox/ani1_intent', { kind: 'intent', state: 'held', affiliateId: 'affiliate-1' }],
    ]);
    const payloads = await captureAffiliateDatasets(fakeFirestore(records));
    expect(payloads.get('affiliate_notification_outbox')?.documents).toEqual([
      { id: 'ane1_source', data: records.get('affiliate_notification_outbox/ane1_source') },
      { id: 'ani1_intent', data: records.get('affiliate_notification_outbox/ani1_intent') },
    ]);
  });

  it('preserves independent notification delivery, retry and suppression state with its reviewed configuration', async () => {
    const records = new Map<string, Record<string, unknown>>([
      ['affiliate_notification_deliveries/nld_example', { attempts: 2, state: 'retry', lease: { expiresAt: '2026-10-23T10:10:00.000Z' }, privateEvidence: ['preserve-exactly'] }],
      ['affiliate_notification_deliveries/suppression_example', { state: 'suppressed', emailSha256: 'one-way-identity' }],
      ['site_configs/affiliate_notification_delivery', { mode: 'staging_test', settingsRevision: 5, allowedRecipients: ['test@example.test'] }],
    ]);
    const payloads = await captureAffiliateDatasets(fakeFirestore(records));
    expect(AFFILIATE_BACKUP_SCHEMA_VERSION).toBe(9);
    expect(payloads.get('affiliate_notification_deliveries')?.documents).toEqual([
      { id: 'nld_example', data: records.get('affiliate_notification_deliveries/nld_example') },
      { id: 'suppression_example', data: records.get('affiliate_notification_deliveries/suppression_example') },
    ]);
    expect(payloads.get('affiliate_site_configs')?.documents).toContainEqual({
      id: 'affiliate_notification_delivery', data: records.get('site_configs/affiliate_notification_delivery'),
    });
    const target = { projectId: 'literary-circle-test', databaseId: '(default)' };
    const complete = completePayloadSet();
    complete.set('affiliate_notification_deliveries', payloads.get('affiliate_notification_deliveries')!);
    const written = writeAffiliateBackup({ payloads: complete, target });
    cleanupDirectories.push(written.directory);
    const verified = verifyAffiliateBackup(written.manifestPath, { target, expectedAffiliates: FOUNDING_AFFILIATE_COUNT });
    const live = new Map(complete);
    live.set('affiliate_notification_deliveries', buildDatasetPayload(AFFILIATE_BACKUP_DATASETS.find(item => item.key === 'affiliate_notification_deliveries')!, []));
    expect(() => assertLiveStateMatchesBackup(verified, live)).toThrow(/affiliate_notification_deliveries/);
    fs.writeFileSync(written.manifestPath, JSON.stringify({ ...written.manifest, schemaVersion: 6 }));
    expect(() => verifyAffiliateBackup(written.manifestPath, { target, expectedAffiliates: FOUNDING_AFFILIATE_COUNT })).toThrow(/Unsupported affiliate backup schema version/);
  });

  it('round-trips notification outbox evidence and refuses live drift or an older incomplete backup', () => {
    const target = { projectId: 'literary-circle-test', databaseId: '(default)' };
    const payloads = completePayloadSet();
    const definition = AFFILIATE_BACKUP_DATASETS.find(item => item.key === 'affiliate_notification_outbox')!;
    payloads.set(definition.key, buildDatasetPayload(definition, [{ id: 'held-intent', data: { state: 'held', evidence: 'preserve-exactly' } }]));
    const written = writeAffiliateBackup({ payloads, target });
    cleanupDirectories.push(written.directory);
    const verified = verifyAffiliateBackup(written.manifestPath, { target, expectedAffiliates: FOUNDING_AFFILIATE_COUNT });
    expect(verified.payloads.get(definition.key)?.documents).toEqual(payloads.get(definition.key)?.documents);
    const live = new Map(payloads);
    live.set(definition.key, buildDatasetPayload(definition, []));
    expect(() => assertLiveStateMatchesBackup(verified, live)).toThrow(/affiliate_notification_outbox/);
    fs.writeFileSync(written.manifestPath, JSON.stringify({ ...written.manifest, schemaVersion: 3 }));
    expect(() => verifyAffiliateBackup(written.manifestPath, { target, expectedAffiliates: FOUNDING_AFFILIATE_COUNT }))
      .toThrow(/Unsupported affiliate backup schema version/);
  });

  it.each(['affiliate_financial_adjustments', 'affiliate_financial_adjustment_summaries', 'affiliate_financial_adjustment_claims'])(
    'round-trips exact private financial evidence and refuses missing live coverage: %s', async collection => {
      const record = { schemaVersion: 1, kind: 'refund', amountMinor: 12_501, walletDeltaKes: -25,
        confirmationReference: 'PRIVATE-PROOF', sourceSha256: 'preserve-source', revision: 4 };
      const captured = await captureAffiliateDatasets(fakeFirestore(new Map([[`${collection}/original-entry`, record]])));
      expect(captured.get(collection)?.documents).toEqual([{ id: 'original-entry', data: record }]);
      const payloads = completePayloadSet(); payloads.set(collection, captured.get(collection)!);
      const target = { projectId: 'literary-circle-test', databaseId: '(default)' };
      const written = writeAffiliateBackup({ payloads, target }); cleanupDirectories.push(written.directory);
      const verified = verifyAffiliateBackup(written.manifestPath, { target, expectedAffiliates: FOUNDING_AFFILIATE_COUNT });
      expect(verified.payloads.get(collection)?.documents).toEqual([{ id: 'original-entry', data: record }]);
      const drift = new Map(payloads);
      drift.set(collection, buildDatasetPayload(AFFILIATE_BACKUP_DATASETS.find(item => item.key === collection)!, []));
      expect(() => assertLiveStateMatchesBackup(verified, drift)).toThrow(collection);
      fs.writeFileSync(written.manifestPath, JSON.stringify({ ...written.manifest, schemaVersion: 8 }));
      expect(() => verifyAffiliateBackup(written.manifestPath, { target, expectedAffiliates: FOUNDING_AFFILIATE_COUNT })).toThrow(/Unsupported affiliate backup schema version/);
    });

  it('captures and exactly verifies monthly tier qualification evidence and rejects schema 7', async () => {
    const record = { schemaVersion: 1, affiliateId: 'affiliate-1', periodKey: '2026-10', revision: 2,
      evidenceComplete: true, members: [{ id: 'canonical-commission', checkoutRequestId: 'checkout-1', createdAt: '2026-10-23T10:00:00.000Z' }],
      awardedMilestones: ['4:literary-ambassador'], customPreservedField: 'exact-snapshot' };
    const captured = await captureAffiliateDatasets(fakeFirestore(new Map([
      ['affiliate_tier_periods/period-1', record],
    ])));
    expect(captured.get('affiliate_tier_periods')?.documents).toEqual([{ id: 'period-1', data: record }]);
    const payloads = completePayloadSet();
    payloads.set('affiliate_tier_periods', captured.get('affiliate_tier_periods')!);
    const target = { projectId: 'literary-circle-test', databaseId: '(default)' };
    const written = writeAffiliateBackup({ payloads, target });
    cleanupDirectories.push(written.directory);
    const verified = verifyAffiliateBackup(written.manifestPath, { target, expectedAffiliates: FOUNDING_AFFILIATE_COUNT });
    expect(verified.payloads.get('affiliate_tier_periods')?.documents).toEqual([{ id: 'period-1', data: record }]);
    const drift = new Map(payloads);
    drift.set('affiliate_tier_periods', buildDatasetPayload(AFFILIATE_BACKUP_DATASETS.find(item => item.key === 'affiliate_tier_periods')!, []));
    expect(() => assertLiveStateMatchesBackup(verified, drift)).toThrow(/affiliate_tier_periods/);
    fs.writeFileSync(written.manifestPath, JSON.stringify({ ...written.manifest, schemaVersion: 7 }));
    expect(() => verifyAffiliateBackup(written.manifestPath, { target, expectedAffiliates: FOUNDING_AFFILIATE_COUNT })).toThrow(/Unsupported affiliate backup schema version/);
  });

  it.each([
    ['newsletter_campaigns', 'newsletter_campaigns'],
    ['release_source_articles', 'articles'],
  ])('captures and verifies complete release source evidence: %s', async (key, collection) => {
    const records = new Map<string, Record<string, unknown>>([
      [`${collection}/source-one`, { status: 'draft', content: { text: 'private unpublished evidence' }, createdAt: '2026-10-23T08:00:00.000Z' }],
      [`${collection}/source-two`, { status: 'published', customField: ['preserve', 42] }],
    ]);
    const captured = await captureAffiliateDatasets(fakeFirestore(records));
    expect(captured.get(key)?.documents).toEqual([
      { id: 'source-one', data: records.get(`${collection}/source-one`) },
      { id: 'source-two', data: records.get(`${collection}/source-two`) },
    ]);
    const payloads = completePayloadSet();
    payloads.set(key, captured.get(key)!);
    const target = { projectId: 'literary-circle-test', databaseId: '(default)' };
    const written = writeAffiliateBackup({ payloads, target });
    cleanupDirectories.push(written.directory);
    const verified = verifyAffiliateBackup(written.manifestPath, { target, expectedAffiliates: FOUNDING_AFFILIATE_COUNT });
    expect(verified.payloads.get(key)?.documents).toEqual(captured.get(key)?.documents);
    const definition = AFFILIATE_BACKUP_DATASETS.find(item => item.key === key)!;
    const live = new Map(payloads);
    live.set(key, buildDatasetPayload(definition, []));
    expect(() => assertLiveStateMatchesBackup(verified, live)).toThrow(key);
    fs.writeFileSync(written.manifestPath, JSON.stringify({ ...written.manifest, schemaVersion: 4 }));
    expect(() => verifyAffiliateBackup(written.manifestPath, { target, expectedAffiliates: FOUNDING_AFFILIATE_COUNT }))
      .toThrow(/Unsupported affiliate backup schema version/);
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
    expect(verified.manifest.schemaVersion).toBe(AFFILIATE_BACKUP_SCHEMA_VERSION);
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

  describe('staging target isolation', () => {
    const target = { projectId: 'ink-witness-staging', databaseId: '(default)' };
    const options = { environment: 'staging', expectedProject: target.projectId, target };

    beforeEach(() => {
      vi.stubEnv('NODE_ENV', 'test');
      vi.stubEnv('VERCEL_ENV', '');
      vi.stubEnv('FIRESTORE_EMULATOR_HOST', '');
      vi.stubEnv('FIREBASE_DATABASE_EMULATOR_HOST', '');
      vi.stubEnv('FIREBASE_AUTH_EMULATOR_HOST', '');
      vi.stubEnv('LITERARY_CIRCLE_PRODUCTION_PROJECT_IDS', '');
      vi.stubEnv('LITERARY_CIRCLE_STAGING_PROJECT_IDS', target.projectId);
    });

    it('accepts only an exact explicitly allowlisted staging target', () => {
      vi.stubEnv('LITERARY_CIRCLE_STAGING_PROJECT_IDS', ` other-staging, ${target.projectId},${target.projectId} `);
      expect(() => assertStagingTarget(options)).not.toThrow();
      expect(() => assertStagingTarget({ ...options, environment: 'production' })).toThrow(/environment=staging/i);
      expect(() => assertStagingTarget({ ...options, expectedProject: 'other-staging' })).toThrow(/exactly match/i);
    });

    it.each(['', ' , ', 'other-staging', 'invalid_project', `${target.projectId},INVALID-STAGING`])(
      'refuses absent, invalid, or nonmatching staging allowlist: %s', allowlist => {
        vi.stubEnv('LITERARY_CIRCLE_STAGING_PROJECT_IDS', allowlist);
        expect(() => assertStagingTarget(options)).toThrow(/allowlist/i);
      }
    );

    it.each(['ink-and-witness-narratives', 'divine-experience-pq6d2'])(
      'always refuses known production project %s even when allowlisted', projectId => {
        vi.stubEnv('LITERARY_CIRCLE_STAGING_PROJECT_IDS', projectId);
        expect(() => assertStagingTarget({
          ...options,
          expectedProject: projectId,
          target: { ...target, projectId }
        })).toThrow(/known production Firebase project/i);
      }
    );

    it.each(['ink-and-witness-narratives', 'divine-experience-pq6d2', 'additional-production'])(
      'refuses the whole allowlist when any production ID overlaps: %s', productionProject => {
        vi.stubEnv('LITERARY_CIRCLE_PRODUCTION_PROJECT_IDS', ' additional-production ');
        vi.stubEnv('LITERARY_CIRCLE_STAGING_PROJECT_IDS', `${target.projectId},${productionProject}`);
        expect(() => assertStagingTarget(options)).toThrow(/overlaps a production project/i);
      }
    );

    it.each(['NODE_ENV', 'VERCEL_ENV'])(
      'refuses production process marker %s', variable => {
        vi.stubEnv(variable, ' Production ');
        expect(() => assertStagingTarget(options)).toThrow(/marked as production/i);
      }
    );

    it.each(['FIRESTORE_EMULATOR_HOST', 'FIREBASE_DATABASE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST'])(
      'refuses configured emulator %s', variable => {
        vi.stubEnv(variable, ' localhost:8080 ');
        expect(() => assertStagingTarget(options)).toThrow(/emulator/i);
      }
    );
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
