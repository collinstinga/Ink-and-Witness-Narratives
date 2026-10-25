import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import {
  AFFILIATE_BACKUP_DATASETS, buildBackupManifest, buildDatasetPayload,
  isAffiliateAttributedTransaction, literaryCircleResourceAssetIds, prettyStableJson,
  type BackupDatasetPayload, type VerifiedAffiliateBackup,
} from './literary-circle-migration-lib.js';
import { DEFAULT_LITERARY_CIRCLE_SETTINGS } from '../src/server/literaryCircle.js';
import {
  activateLiteraryCircleProductionCore, LiteraryCircleProductionCoreError,
  PRODUCTION_CORE_COHORT_SHA256, PRODUCTION_CORE_MARKER_ID, PRODUCTION_CORE_OWNER,
  PRODUCTION_CORE_PROJECT_ID, type ProductionCoreActivationInput,
} from './literary-circle-production-core.js';

const authority = vi.hoisted(() => ({ binding: null as null | { projectId: string; firestoreDatabaseId: string },
  cohort: 'd1c67263f094f594e6d8b92b8a2c391a8cf789fd9d2cda3ddedb72360db35555' }));
vi.mock('../src/server/db.js', async importOriginal => ({ ...await importOriginal<typeof import('../src/server/db.js')>(),
  getFirestoreClientTarget: vi.fn(() => authority.binding),
}));
// Never put the private original nine identities into a committed fixture. The
// separately tested digest projector is mocked only at this private-cohort pin.
vi.mock('./literary-circle-release-plan-lib.js', async importOriginal => ({
  ...await importOriginal<typeof import('./literary-circle-release-plan-lib.js')>(),
  foundingCohortDigest: vi.fn(() => authority.cohort),
}));
const NOW = '2026-10-25T10:00:00.000Z';
const SHA = 'a'.repeat(40);
type Ref = { path: string; id: string };
type Query = { collection: string; maximum: number };
type Data = Record<string, any>;
function merge(existing: Data, patch: Data): Data {
  const result = structuredClone(existing);
  for (const [key, value] of Object.entries(patch)) result[key] = value && typeof value === 'object' && !Array.isArray(value)
    && result[key] && typeof result[key] === 'object' && !Array.isArray(result[key]) ? merge(result[key], value) : structuredClone(value);
  return result;
}
function harness() {
  const documents = new Map<string, Data>();
  for (let index = 1; index <= 9; index++) documents.set(`affiliates/partner-${index}`, {
    id: `partner-${index}`, affiliateCode: `ORIGINAL${index}`, email: `private-${index}@example.invalid`,
    name: `Private Name ${index}`, passwordHash: 'private-credential-never-audited', phone: 'private-phone',
    status: index === 9 ? 'suspended' : 'active', createdAt: '2026-09-01T00:00:00.000Z',
    customCommissionRate: 17, walletRevision: index, balanceAvailableKes: 100 * index,
    totalSalesCount: index, notificationPreferences: { marketingConsent: { state: 'unknown' } },
  });
  documents.set('affiliate_commissions/old-sale', { status: 'PAID', commissionAmountKes: 31.5, secretHistoricalField: 'preserve' });
  documents.set('affiliate_payouts/old-payout', { status: 'PAID', amountKes: 31.5, reference: 'preserve' });
  documents.set('transactions/old-transaction', { affiliateCode: 'ORIGINAL1', amount: 200, status: 'CONFIRMED' });
  documents.set('transactions/non-affiliate', { amount: 100, status: 'CONFIRMED', customerId: 'private-reader' });
  documents.set('site_configs/affiliate_settings', { defaultCommissionRate: 17, pieceCommissionOverrides: { old: 22 }, minimumPayoutKes: 500 });
  documents.set('articles/old-piece', { status: 'published', content: 'Private paid body remains unchanged.' });
  const reads: string[] = []; const writes: Array<{ kind: string; path: string; data: Data }> = []; const limits: number[] = [];
  let documentReads = 0;
  const behavior = { readFailure: false, commitFailure: false, omitReference: false, malformedQuerySize: false };
  const ref = (name: string, id: string): Ref => ({ path: `${name}/${id}`, id });
  const db = {
    projectId: PRODUCTION_CORE_PROJECT_ID, databaseId: '(default)',
    collection: (name: string) => ({ doc: (id: string) => ref(name, id), limit: (maximum: number): Query => ({ collection: name, maximum }) }),
    runTransaction: vi.fn(async (operation: (transaction: any) => Promise<unknown>, options: unknown) => {
      expect(options).toEqual({ maxAttempts: 3 });
      const view = new Map([...documents].map(([key, data]) => [key, structuredClone(data)]));
      const pending: Array<{ kind: string; path: string; data: Data }> = [];
      const snapshot = (target: Ref) => ({ ref: target, id: target.id, exists: view.has(target.path),
        data: () => structuredClone(view.get(target.path)) });
      const checkRead = () => {
        if (pending.length) throw new Error('read-after-write');
        if (behavior.readFailure) throw new Error('private-provider-resource-and-credential');
      };
      const get = async (target: Ref | Query) => {
        checkRead();
        if ('collection' in target) {
          limits.push(target.maximum); reads.push(`${target.collection}/*`);
          const docs = [...view.keys()].filter(path => path.split('/')[0] === target.collection).sort().slice(0, target.maximum)
            .map(path => snapshot({ path, id: path.slice(target.collection.length + 1) }));
          documentReads += Math.max(1, docs.length);
          return { docs, size: docs.length + (behavior.malformedQuerySize ? 1 : 0) };
        }
        reads.push(target.path); documentReads++; return snapshot(target);
      };
      const schedule = (kind: string, target: Ref, data: Data) => { pending.push({ kind, path: target.path, data: structuredClone(data) }); };
      const result = await operation({ get, getAll: async (...refs: Ref[]) => {
        const snapshots = await Promise.all(refs.map(get));
        return behavior.omitReference ? snapshots.slice(1) : snapshots.reverse();
      }, create: (target: Ref, data: Data) => schedule('create', target, data),
      set: (target: Ref, data: Data, options: unknown) => { expect(options).toEqual({ merge: true }); schedule('set', target, data); },
      update: () => { throw new Error('unexpected update'); }, delete: () => { throw new Error('unexpected delete'); } });
      if (behavior.commitFailure) throw new Error('private-commit-provider-error');
      const committed = new Map([...documents].map(([key, data]) => [key, structuredClone(data)]));
      for (const write of pending) {
        if (write.kind === 'create' && committed.has(write.path)) throw new Error('create collision');
        committed.set(write.path, write.kind === 'set' ? merge(committed.get(write.path) || {}, write.data) : write.data);
      }
      documents.clear(); for (const [key, data] of committed) documents.set(key, data);
      writes.push(...pending); return result;
    }),
  };
  function backup(): VerifiedAffiliateBackup {
    const payloads = new Map<string, BackupDatasetPayload>();
    for (const definition of AFFILIATE_BACKUP_DATASETS) {
      const ids = definition.key === 'literary_circle_resource_assets' ? literaryCircleResourceAssetIds(payloads.get('affiliate_site_configs')) : definition.documentIds;
      let rows = [...documents].filter(([path]) => path.split('/')[0] === definition.collection)
        .map(([path, data]) => ({ id: path.slice(definition.collection.length + 1), data: structuredClone(data) }));
      if (definition.scope === 'explicit_documents') rows = rows.filter(row => ids?.includes(row.id));
      if (definition.scope === 'affiliate_attributed_only') rows = rows.filter(row => isAffiliateAttributedTransaction(row.data));
      payloads.set(definition.key, buildDatasetPayload(definition, rows));
    }
    const manifest = buildBackupManifest({ backupId: 'private-fixture-backup', createdAt: NOW,
      target: { projectId: PRODUCTION_CORE_PROJECT_ID, databaseId: '(default)' },
      payloadFiles: new Map([...payloads].map(([key, payload]) => [key, { payload, contents: prettyStableJson(payload) }])),
    });
    return { directory: 'unused-no-filesystem-access', payloads, manifest };
  }
  const initialBackup = backup();
  const input: ProductionCoreActivationInput = { db: db as unknown as Firestore, backup: initialBackup,
    expectedTarget: { projectId: PRODUCTION_CORE_PROJECT_ID, databaseId: '(default)' }, sourceCommit: SHA,
    expectedBackupSha256: initialBackup.manifest.contentSha256, expectedCohortSha256: PRODUCTION_CORE_COHORT_SHA256,
    actor: PRODUCTION_CORE_OWNER, applyCore: true, now: NOW,
    proof: { sourceCommit: SHA, ciSourceCommit: SHA, ciConclusion: 'success', productionBuildSourceCommit: SHA,
      productionBuildState: 'READY', productionBuildTarget: 'production', productionDeploymentId: 'dpl_reviewedProduction123', verifiedOwnerEmail: PRODUCTION_CORE_OWNER } };
  function rebackup() { input.backup = backup(); input.expectedBackupSha256 = input.backup.manifest.contentSha256; }
  return { documents, reads, writes, limits, behavior, db, input, rebackup, documentReads: () => documentReads };
}
beforeEach(() => {
  authority.binding = null; authority.cohort = PRODUCTION_CORE_COHORT_SHA256;
  for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_DATABASE_EMULATOR_HOST']) vi.stubEnv(key, '');
});
afterEach(() => vi.unstubAllEnvs());

describe('separate production Literary Circle core activation', () => {
  it('atomically adds only core defaults/ownership/approvals/audits while preserving complete historical records and consent', async () => {
    const h = harness(); const before = structuredClone([...h.documents]); const backupBefore = structuredClone([...h.input.backup.payloads]);
    const result = await activateLiteraryCircleProductionCore(h.input);
    expect(result).toEqual({ status: 'applied', markerId: PRODUCTION_CORE_MARKER_ID, affiliateCount: 9,
      approvedCount: 8, membershipChanges: 9, reservationsCreated: 18, auditCount: 10 });
    for (const [path, data] of before) expect(h.documents.get(path)).toMatchObject(data);
    expect(h.documents.get('affiliates/partner-1')).toMatchObject({ approvedBy: PRODUCTION_CORE_OWNER, approvedAt: NOW,
      literaryCircle: { foundingMember: true, complimentaryAccess: { status: 'active', scope: 'all_published' } } });
    expect(h.documents.get('affiliates/partner-9')).toMatchObject({ status: 'suspended' });
    expect(h.documents.get('affiliates/partner-9')).not.toHaveProperty('approvedAt');
    expect(h.documents.get('site_configs/affiliate_literary_circle')).toMatchObject({ enabled: true,
      commissionPolicy: { status: 'draft', subscriptionRenewalsEligible: false }, community: { enabled: false } });
    expect(h.writes.every(write => /^(affiliates|affiliate_codes|affiliate_emails|affiliate_audit)\//.test(write.path)
      || write.path === 'site_configs/affiliate_literary_circle' || write.path === `migration_markers/${PRODUCTION_CORE_MARKER_ID}`)).toBe(true);
    expect(h.limits.every(limit => limit === 1001)).toBe(true);
    const audits = h.writes.filter(write => write.path.startsWith('affiliate_audit/'));
    expect(JSON.stringify(audits)).not.toMatch(/private-credential|Private Name|private-phone|private-reader|passwordHash/);
    expect(h.db.runTransaction).toHaveBeenCalledTimes(1);
    expect([...h.input.backup.payloads]).toEqual(backupBefore);
  });

  it('enables an existing programme with an enabled-only patch and preserves all policy/rates/private community fields', async () => {
    const h = harness(); const settings = { ...structuredClone(DEFAULT_LITERARY_CIRCLE_SETTINGS), enabled: false,
      commissionPolicy: { status: 'active', version: 8, effectiveAt: '2026-10-01T00:00:00.000Z', subscriptionRenewalsEligible: true },
      community: { enabled: false, posts: [], title: 'Private existing', description: 'Preserve' }, opaqueField: 'preserve' };
    h.documents.set('site_configs/affiliate_literary_circle', settings); h.rebackup();
    await activateLiteraryCircleProductionCore(h.input);
    expect(h.documents.get('site_configs/affiliate_literary_circle')).toEqual({ ...settings, enabled: true });
    expect(h.writes.find(write => write.path === 'site_configs/affiliate_literary_circle')?.data).toEqual({ enabled: true });
  });

  it('preserves explicit revoked reading access, manual tier and onboarding progress while adding missing founding leaves', async () => {
    const h = harness(); const membership = { schemaVersion: 1, complimentaryAccess: { status: 'revoked', scope: 'all_published' },
      tier: { id: 'literary-patron', source: 'manual', assignedAt: '2026-09-01T00:00:00.000Z' },
      onboarding: { status: 'complete', completedStepIds: ['welcome'], welcomeRequired: false } };
    h.documents.get('affiliates/partner-2')!.literaryCircle = membership; h.rebackup();
    await activateLiteraryCircleProductionCore(h.input);
    expect(h.documents.get('affiliates/partner-2')!.literaryCircle).toMatchObject(membership);
    expect(h.documents.get('affiliates/partner-2')!.literaryCircle.foundingMember).toBe(true);
  });

  it('keeps existing explicit approvals and same-owner reservation metadata unchanged', async () => {
    const h = harness(); const account = h.documents.get('affiliates/partner-1')!;
    account.approvedAt = '2026-09-02T00:00:00.000Z'; account.approvedBy = 'Existing Writer';
    h.documents.set('affiliate_codes/ORIGINAL1', { affiliateId: 'partner-1', affiliateCode: 'ORIGINAL1', reservedAt: 'existing', opaque: 23 }); h.rebackup();
    await activateLiteraryCircleProductionCore(h.input);
    expect(h.documents.get('affiliates/partner-1')).toMatchObject({ approvedAt: account.approvedAt, approvedBy: account.approvedBy });
    expect(h.documents.get('affiliate_codes/ORIGINAL1')).toEqual({ affiliateId: 'partner-1', affiliateCode: 'ORIGINAL1', reservedAt: 'existing', opaque: 23 });
  });

  it.each(['affiliate_commissions/old-sale', 'affiliate_payouts/old-payout', 'transactions/old-transaction',
    'affiliates/partner-1', 'site_configs/affiliate_settings', 'articles/old-piece'])('refuses current mutation of %s before any writes', async path => {
    const h = harness(); h.documents.get(path)!.unexpected = 'concurrent live change';
    await expect(activateLiteraryCircleProductionCore(h.input)).rejects.toMatchObject({ code: 'LIVE_DRIFT' });
    expect(h.writes).toEqual([]); expect(h.documents.has(`migration_markers/${PRODUCTION_CORE_MARKER_ID}`)).toBe(false);
  });
  it.each(['affiliate_commissions/new-sale', 'affiliates/new-account', 'affiliate_codes/new-code'])('detects newly inserted %s through bounded complete query snapshots', async path => {
    const h = harness(); h.documents.set(path, { unexpected: true });
    await expect(activateLiteraryCircleProductionCore(h.input)).rejects.toMatchObject({ code: 'LIVE_DRIFT' }); expect(h.writes).toEqual([]);
  });
  it('detects removals instead of silently processing only remaining identities', async () => {
    const h = harness(); h.documents.delete('affiliates/partner-3');
    await expect(activateLiteraryCircleProductionCore(h.input)).rejects.toMatchObject({ code: 'LIVE_DRIFT' }); expect(h.writes).toEqual([]);
  });

  it.each(['suspended_membership', 'reservation_owner', 'invalid_approval'])('refuses explicit %s conflicts without repairing account data', async kind => {
    const h = harness();
    if (kind === 'suspended_membership') h.documents.get('affiliates/partner-1')!.literaryCircle = { schemaVersion: 1, foundingMember: false };
    if (kind === 'reservation_owner') h.documents.set('affiliate_codes/ORIGINAL1', { affiliateId: 'different-account' });
    if (kind === 'invalid_approval') h.documents.get('affiliates/partner-1')!.approvedAt = 'not-a-date';
    h.rebackup(); const before = structuredClone([...h.documents]);
    await expect(activateLiteraryCircleProductionCore(h.input)).rejects.toBeInstanceOf(LiteraryCircleProductionCoreError);
    expect([...h.documents]).toEqual(before); expect(h.writes).toEqual([]);
  });

  it('is zero-write idempotent against the original backup or a fresh exact post-state backup', async () => {
    const h = harness(); await activateLiteraryCircleProductionCore(h.input); const count = h.writes.length;
    const result = await activateLiteraryCircleProductionCore(h.input);
    expect(result).toMatchObject({ status: 'already_applied', membershipChanges: 0, reservationsCreated: 0, auditCount: 0 });
    expect(h.writes).toHaveLength(count); h.rebackup();
    expect((await activateLiteraryCircleProductionCore(h.input)).status).toBe('already_applied'); expect(h.writes).toHaveLength(count);
  });
  it('preserves an absent stored account id and hashes the actual committed document on replay', async () => {
    const h = harness(); delete h.documents.get('affiliates/partner-1')!.id; h.rebackup();
    await activateLiteraryCircleProductionCore(h.input);
    expect(h.documents.get('affiliates/partner-1')).not.toHaveProperty('id');
    expect((await activateLiteraryCircleProductionCore(h.input)).status).toBe('already_applied');
  });
  it('never repairs or reapplies a completed marker after later legitimate profile/financial changes', async () => {
    const h = harness(); await activateLiteraryCircleProductionCore(h.input); const count = h.writes.length;
    h.documents.get('affiliates/partner-1')!.name = 'New writer-approved name'; h.rebackup();
    await expect(activateLiteraryCircleProductionCore(h.input)).rejects.toMatchObject({ code: 'MARKER_DRIFT' });
    expect(h.documents.get('affiliates/partner-1')!.name).toBe('New writer-approved name'); expect(h.writes).toHaveLength(count);
  });
  it('rejects a colliding production marker for another source', async () => {
    const h = harness(); h.documents.set(`migration_markers/${PRODUCTION_CORE_MARKER_ID}`, { sourceCommit: 'b'.repeat(40) });
    await expect(activateLiteraryCircleProductionCore(h.input)).rejects.toMatchObject({ code: 'MARKER_DRIFT' }); expect(h.writes).toEqual([]);
  });

  it.each(['readFailure', 'commitFailure'] as const)('rolls back/redacts %s without partial writes or profile publication', async failure => {
    const h = harness(); const before = structuredClone([...h.documents]); h.behavior[failure] = true;
    const error = await activateLiteraryCircleProductionCore(h.input).catch(value => value);
    expect(error).toMatchObject({ code: 'UNAVAILABLE' }); expect(String(error)).not.toMatch(/private-|credential|resource/);
    expect([...h.documents]).toEqual(before); expect(h.writes).toEqual([]);
  });
  it('rejects the bounded query sentinel rather than accepting a truncated transaction history', async () => {
    const h = harness(); for (let index = 0; index < 1_001; index++) h.documents.set(`transactions/extra-${index}`, { amount: 1 });
    await expect(activateLiteraryCircleProductionCore(h.input)).rejects.toMatchObject({ code: 'READ_LIMIT' }); expect(h.writes).toEqual([]);
  });
  it('rejects an oversized backed-up dataset before opening a transaction', async () => {
    const h = harness(); for (let index = 0; index < 1_001; index++) h.documents.set(`affiliate_clicks/extra-${index}`, { count: 1 }); h.rebackup();
    await expect(activateLiteraryCircleProductionCore(h.input)).rejects.toBeInstanceOf(LiteraryCircleProductionCoreError);
    expect(h.db.runTransaction).not.toHaveBeenCalled(); expect(h.writes).toEqual([]);
  });
  it('caps a later query by the cumulative remaining budget and refuses a full shortened page', async () => {
    const h = harness();
    for (const name of ['affiliate_commissions', 'affiliate_tier_periods', 'affiliate_clicks', 'affiliate_payouts']) {
      const existing = [...h.documents.keys()].filter(path => path.startsWith(`${name}/`)).length;
      for (let index = existing; index < 1_000; index++) h.documents.set(`${name}/budget-${index}`, { preserved: true });
    }
    for (let index = 0; index < 900; index++) h.documents.set(`affiliate_campaigns/budget-${index}`, { preserved: true });
    h.rebackup();
    // These inserts are outside the pinned backup and must not be mistaken for
    // a complete page, nor allow one last 1,001-document over-budget read.
    for (let index = 900; index < 1_100; index++) h.documents.set(`affiliate_campaigns/budget-${index}`, { preserved: true });
    await expect(activateLiteraryCircleProductionCore(h.input)).rejects.toMatchObject({ code: 'READ_LIMIT' });
    expect(h.limits.at(-1)).toBeLessThan(1001);
    expect(h.documentReads()).toBeLessThanOrEqual(5_000);
    expect(h.writes).toEqual([]);
  });
  it.each(['omitReference', 'malformedQuerySize'] as const)('fails closed on incomplete SDK %s responses', async behavior => {
    const h = harness(); h.behavior[behavior] = true;
    await expect(activateLiteraryCircleProductionCore(h.input)).rejects.toBeInstanceOf(LiteraryCircleProductionCoreError); expect(h.writes).toEqual([]);
  });

  it.each(['actor', 'apply', 'proof_owner', 'ci', 'source', 'preview', 'not_ready', 'database', 'sdk_project', 'recorded_binding', 'emulator'])('rejects %s authority mismatch before database access', async kind => {
    const h = harness();
    if (kind === 'actor') h.input.actor = 'different@example.invalid';
    if (kind === 'apply') h.input.applyCore = false;
    if (kind === 'proof_owner') h.input.proof.verifiedOwnerEmail = 'different@example.invalid';
    if (kind === 'ci') h.input.proof.ciConclusion = 'failure' as any;
    if (kind === 'source') h.input.proof.productionBuildSourceCommit = 'b'.repeat(40);
    if (kind === 'preview') h.input.proof.productionBuildTarget = 'preview' as any;
    if (kind === 'not_ready') h.input.proof.productionBuildState = 'BUILDING' as any;
    if (kind === 'database') h.db.databaseId = 'not-default';
    if (kind === 'sdk_project') h.db.projectId = 'divine-experience-pq6d2';
    if (kind === 'recorded_binding') authority.binding = { projectId: 'other-project', firestoreDatabaseId: '(default)' };
    if (kind === 'emulator') vi.stubEnv('FIRESTORE_EMULATOR_HOST', '127.0.0.1:8080');
    await expect(activateLiteraryCircleProductionCore(h.input)).rejects.toBeInstanceOf(LiteraryCircleProductionCoreError);
    expect(h.db.runTransaction).not.toHaveBeenCalled(); expect(h.writes).toEqual([]);
  });
  it.each(['old_backup', 'future_backup', 'backup_pin', 'cohort_pin', 'different_private_cohort', 'mutated_payload'])('rejects %s evidence before any database access', async kind => {
    const h = harness();
    if (kind === 'old_backup') h.input.now = '2026-10-25T10:30:00.001Z';
    if (kind === 'future_backup') h.input.now = '2026-10-25T09:59:59.999Z';
    if (kind === 'backup_pin') h.input.expectedBackupSha256 = '0'.repeat(64);
    if (kind === 'cohort_pin') h.input.expectedCohortSha256 = '0'.repeat(64);
    if (kind === 'different_private_cohort') authority.cohort = '0'.repeat(64);
    if (kind === 'mutated_payload') h.input.backup.payloads.get('affiliates')!.documents[0].data.balanceAvailableKes = 999;
    await expect(activateLiteraryCircleProductionCore(h.input)).rejects.toBeInstanceOf(LiteraryCircleProductionCoreError);
    expect(h.db.runTransaction).not.toHaveBeenCalled(); expect(h.writes).toEqual([]);
  });
  it('requires resource asset closure and detects missing live private assets', async () => {
    const h = harness(); h.documents.set('site_configs/literary_circle_resources', { items: [{ assetId: 'cover-private' }] });
    h.documents.set('uploaded_assets/cover-private', { dataUrl: 'private-asset-content', accessScope: 'literary_circle_private' }); h.rebackup();
    h.documents.delete('uploaded_assets/cover-private');
    await expect(activateLiteraryCircleProductionCore(h.input)).rejects.toMatchObject({ code: 'ASSET_CLOSURE' }); expect(h.writes).toEqual([]);
  });
});
