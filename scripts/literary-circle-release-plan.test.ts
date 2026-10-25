import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VerifiedAffiliateBackup } from './literary-circle-migration-lib.js';

const mocks = vi.hoisted(() => ({ verifyBackup: vi.fn(), getDb: vi.fn(() => { throw new Error('Network must never be initialized'); }) }));
vi.mock('../src/server/db.js', () => ({ getDb: mocks.getDb, resolveFirestoreTargetConfig: vi.fn() }));
vi.mock('./literary-circle-migration-lib.js', async importOriginal => ({
  ...await importOriginal<typeof import('./literary-circle-migration-lib.js')>(), verifyAffiliateBackup: mocks.verifyBackup,
}));
vi.mock('./literary-circle-release-plan-files.js', async importOriginal => ({
  ...await importOriginal<typeof import('./literary-circle-release-plan-files.js')>(),
  assertOfflineBackupPath: (value: string) => value,
}));
import { canonicalJson, sha256Hex } from './literary-circle-migration-lib.js';
import {
  buildLiteraryCircleReleasePlan, foundingCohortDigest, readReleaseReviewEvidence,
  RELEASE_REHEARSAL_CHECKS, RELEASE_BACKUP_MAX_AGE_MS, RELEASE_EVIDENCE_MAX_AGE_MS,
} from './literary-circle-release-plan-lib.js';
import { executeLiteraryCircleReleasePlan, parseLiteraryCircleReleasePlanArgs } from './plan-literary-circle-release.js';

const now = Date.parse('2026-10-24T17:00:00.000Z');
const target = { projectId: 'ink-and-witness-narratives', databaseId: '(default)' };
const sourceCommit = 'a'.repeat(40);
const backupSha = 'b'.repeat(64);
const privateSentinel = 'PRIVATE_CONTACT_CREDENTIAL_PROVIDER_DETAILS';
function fixture(): VerifiedAffiliateBackup {
  return {
    directory: '/private/backup',
    manifest: { schemaVersion: 8, backupId: 'test-backup', createdAt: new Date(now - 60_000).toISOString(),
      projectId: target.projectId, databaseId: target.databaseId, contentSha256: backupSha, datasets: [] },
    payloads: new Map([
      ['affiliates', { schemaVersion: 8, key: 'affiliates', collection: 'affiliates', scope: 'all_documents',
        documents: Array.from({ length: 9 }, (_, index) => ({ id: `original_${index}`, data: {
          id: `original_${index}`, email: `private-${index}@example.test`, affiliateCode: `ORIGINAL${index}`,
          status: 'active', passwordHash: privateSentinel, totalCommissionEarnedKes: 100 + index,
        } })) }],
      ['affiliate_site_configs', { schemaVersion: 8, key: 'affiliate_site_configs', collection: 'site_configs', scope: 'explicit_documents',
        documents: [{ id: 'affiliate_settings', data: { defaultCommissionRate: 15, minPayoutThresholdKes: 1000 } },
          { id: 'affiliate_literary_circle', data: { enabled: false, commissionPolicy: { status: 'draft', version: 1 } } }] }],
    ]),
  };
}
function evidence() {
  return { schemaVersion: 1, sourceCommit, stagingProjectId: 'ink-witness-staging-20261024', databaseId: '(default)',
    deploymentId: 'dpl_ValidTestDeployment123', deploymentUrl: 'https://narrativesbyjake-example123-ink-n-witness.vercel.app',
    verifiedAt: new Date(now - 30_000).toISOString(),
    checks: RELEASE_REHEARSAL_CHECKS.map(id => ({ id, status: 'passed', artifactSha256: 'c'.repeat(64) })) };
}
function options(backup = fixture()) {
  return { backup, expectedTarget: { ...target }, expectedBackupSha256: backupSha,
    expectedCohortSha256: foundingCohortDigest(backup), sourceCommit, evidence: evidence(), now };
}
const args = () => {
  const item = options();
  return ['--expected-project=ink-and-witness-narratives', '--expected-database=(default)', '--expected-affiliates=9',
    '--backup=data/backups/review/manifest.json', `--expected-backup-sha256=${backupSha}`,
    `--expected-cohort-sha256=${item.expectedCohortSha256}`, `--source-commit=${sourceCommit}`];
};
let output: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks(); mocks.verifyBackup.mockReturnValue(fixture());
  output = vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('offline production release review plan', () => {
  it('pins identities, policy, backup and source without changing any verified payload', () => {
    const item = options(); const before = canonicalJson([...item.backup.payloads]);
    const plan = buildLiteraryCircleReleasePlan(item);
    expect(plan).toMatchObject({ sourceCommit, target, backupManifestSha256: backupSha, foundingAffiliateCount: 9,
      priorExplicitApprovals: 0, requiredFutureApprovalCount: 9, preserveExistingCommissionArrangements: true,
      activateNewCommissionPolicy: false, historicalFinancialRewritesAllowed: false });
    expect(canonicalJson([...item.backup.payloads])).toBe(before);
    expect(plan.financialPolicySha256).toMatch(/^[a-f0-9]{64}$/);
    expect(plan.affiliateDocumentsSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(plan)).not.toMatch(/private-0|ORIGINAL0|original_0|PRIVATE_CONTACT/);
    const { planSha256, ...unsigned } = plan;
    expect(planSha256).toBe(sha256Hex(canonicalJson(unsigned)));
  });

  it('cannot authorize apply, sends or charges even when every reported rehearsal passes', () => {
    const plan = buildLiteraryCircleReleasePlan(options());
    expect(plan).toMatchObject({ status: 'blocked', writeAuthorized: false, allowedDatabaseWrites: [],
      sendsOrChargesAuthorized: false, evidenceClassification: 'operator_report_not_authorization' });
    for (const id of ['reviewed_production_apply', 'live_transactional_drift_fence', 'explicit_cohort_approval_and_audit', 'tested_production_build_before_domain_promotion']) {
      expect(plan.checks).toContainEqual({ id, status: 'pending' });
    }
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it('never treats legacy active status or partial approval fields as explicit approval', () => {
    const item = options();
    const docs = item.backup.payloads.get('affiliates')!.documents;
    docs[0].data.approvedAt = '2026-10-20T10:00:00.000Z';
    docs[1].data.approvedBy = 'Writer';
    Object.assign(docs[2].data, { approvedAt: '2026-10-20T10:00:00.000Z', approvedBy: 'Writer' });
    Object.assign(docs[3].data, { approvedAt: '2026-10-20T10:00:00.000Z', approvedBy: 'Writer', status: 'suspended' });
    expect(buildLiteraryCircleReleasePlan(item)).toMatchObject({ priorExplicitApprovals: 1, requiredFutureApprovalCount: 8 });
  });

  it('blocks a stale backup rather than bypassing the fixed freshness window', () => {
    const item = options(); item.backup.manifest.createdAt = new Date(now - RELEASE_BACKUP_MAX_AGE_MS - 1).toISOString();
    expect(buildLiteraryCircleReleasePlan(item).checks).toContainEqual({ id: 'fresh_production_backup', status: 'blocked' });
  });

  it.each(['missing', 'stale'] as const)('keeps absent or old staging evidence visibly unverified: %s', kind => {
    const item = options();
    if (kind === 'missing') item.evidence = undefined;
    else item.evidence.verifiedAt = new Date(now - RELEASE_EVIDENCE_MAX_AGE_MS - 1).toISOString();
    const plan = buildLiteraryCircleReleasePlan(item);
    expect(plan.checks).toContainEqual({ id: 'fresh_source_bound_staging_evidence', status: 'blocked' });
    expect(plan.checks).toContainEqual({ id: 'access_and_registration', status: 'pending' });
  });

  it('retains pending/blocked provider and browser checks instead of inferring proof', () => {
    const item = options();
    item.evidence.checks[6].status = 'pending'; item.evidence.checks[7].status = 'blocked';
    const plan = buildLiteraryCircleReleasePlan(item);
    expect(plan.checks).toContainEqual({ id: 'notification_delivery', status: 'pending' });
    expect(plan.checks).toContainEqual({ id: 'browser_mobile', status: 'blocked' });
  });

  it.each(['target', 'database', 'backup', 'cohort', 'source', 'count', 'identity', 'future_backup', 'future_evidence'])(
    'rejects a changed or invalid pin: %s', failure => {
      const item = options();
      if (failure === 'target') item.expectedTarget = { ...target, projectId: 'ink-witness-staging-20261024' };
      if (failure === 'database') item.expectedTarget = { ...target, databaseId: 'other-db' };
      if (failure === 'backup') item.expectedBackupSha256 = 'd'.repeat(64);
      if (failure === 'cohort') item.expectedCohortSha256 = 'd'.repeat(64);
      if (failure === 'source') item.sourceCommit = 'not-a-commit';
      if (failure === 'count') item.backup.payloads.get('affiliates')!.documents.pop();
      if (failure === 'identity') item.backup.payloads.get('affiliates')!.documents[0].data.affiliateCode = 'CHANGED';
      if (failure === 'future_backup') item.backup.manifest.createdAt = new Date(now + 1).toISOString();
      if (failure === 'future_evidence') item.evidence.verifiedAt = new Date(now + 1).toISOString();
      expect(() => buildLiteraryCircleReleasePlan(item)).toThrow();
    }
  );

  it('copies only allowlisted target fields into public output', () => {
    const item = options(); Object.assign(item.expectedTarget, { secret: privateSentinel });
    expect(JSON.stringify(buildLiteraryCircleReleasePlan(item))).not.toContain(privateSentinel);
  });
});

describe('strict operator evidence and CLI boundary', () => {
  it.each(['source', 'production', 'url', 'timestamp', 'unknown_key', 'duplicate', 'unknown_check', 'no_digest', 'bad_digest'])(
    'rejects invalid operator evidence: %s', failure => {
      const item = evidence();
      if (failure === 'source') item.sourceCommit = 'd'.repeat(40);
      if (failure === 'production') item.stagingProjectId = target.projectId;
      if (failure === 'url') item.deploymentUrl = 'https://www.inkandwitness-narratives.co.ke';
      if (failure === 'timestamp') item.verifiedAt = 'yesterday';
      if (failure === 'unknown_key') Object.assign(item, { privateKey: privateSentinel });
      if (failure === 'duplicate') item.checks[0] = { ...item.checks[1] };
      if (failure === 'unknown_check') Object.assign(item.checks[0], { id: 'made_up_proof' });
      if (failure === 'no_digest') Reflect.deleteProperty(item.checks[0], 'artifactSha256');
      if (failure === 'bad_digest') item.checks[0].artifactSha256 = 'bad';
      expect(() => readReleaseReviewEvidence(item, sourceCommit, target)).toThrow();
    }
  );

  it.each(['--apply', '--confirm', '--allow-production-writes', '--max-backup-age=999999999', '--expected-affiliates=10',
    '--expected-project=ink-and-witness-narratives', '--backup=', '--source-commit= secret ', '--unknown=private'])('rejects unsupported/duplicate flags: %s', flag => {
    expect(() => parseLiteraryCircleReleasePlanArgs([...args(), flag])).toThrow();
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it('requires every pin rather than using environment-derived defaults', () => {
    for (let index = 0; index < args().length; index++) {
      expect(() => parseLiteraryCircleReleasePlanArgs(args().filter((_, position) => position !== index))).toThrow();
    }
  });

  it.each([['passed'], ['blocked'], ['pending'], { toString: () => 'passed' }, true, null])('rejects non-string evidence statuses', status => {
    const item = evidence(); Object.assign(item.checks[0], { status }); Reflect.deleteProperty(item.checks[0], 'artifactSha256');
    expect(() => readReleaseReviewEvidence(item, sourceCommit, target)).toThrow();
  });

  it('verifies local files with the exact target and never initializes a database client', async () => {
    const plan = await executeLiteraryCircleReleasePlan(args());
    expect(mocks.verifyBackup).toHaveBeenCalledWith('data/backups/review/manifest.json', { target, expectedAffiliates: 9 });
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(plan.writeAuthorized).toBe(false);
    expect(JSON.parse(String(output.mock.calls[0][0]))).toMatchObject({ status: 'blocked', writeAuthorized: false });
  });

  it('redacts arbitrary payload/filesystem/provider details and prints no success', async () => {
    mocks.verifyBackup.mockImplementationOnce(() => { throw new Error(privateSentinel); });
    await expect(executeLiteraryCircleReleasePlan(args())).rejects.toThrow('private details were suppressed');
    expect(output).not.toHaveBeenCalled(); expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
