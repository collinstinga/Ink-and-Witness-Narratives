import {
  FOUNDING_AFFILIATE_COUNT, KNOWN_PRODUCTION_FIREBASE_PROJECT_IDS, canonicalJson, sha256Hex,
  validateFoundingAffiliateDocuments, type FirebaseTarget, type VerifiedAffiliateBackup,
} from './literary-circle-migration-lib.js';

const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const DATABASE = /^(?:\(default\)|[A-Za-z0-9][A-Za-z0-9._-]{0,62})$/;
export const RELEASE_BACKUP_MAX_AGE_MS = 30 * 60_000;
export const RELEASE_EVIDENCE_MAX_AGE_MS = 24 * 60 * 60_000;
export const RELEASE_REHEARSAL_CHECKS = [
  'access_and_registration', 'financial_preservation', 'writer_controls',
  'reader_purchases_and_chapters', 'subscription_referral_checkout',
  'refund_reconciliation', 'notification_delivery', 'browser_mobile',
] as const;
type CheckId = typeof RELEASE_REHEARSAL_CHECKS[number];
type CheckStatus = 'passed' | 'pending' | 'blocked';

export class LiteraryCircleReleasePlanError extends Error {
  constructor(message: string) { super(message); this.name = 'LiteraryCircleReleasePlanError'; }
}

const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).every(key => keys.includes(key));
function isoMs(value: unknown): number {
  if (typeof value !== 'string') return NaN;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString() === value ? ms : NaN;
}

export interface ReleaseReviewEvidence {
  schemaVersion: 1;
  sourceCommit: string;
  stagingProjectId: string;
  databaseId: string;
  deploymentId: string;
  deploymentUrl: string;
  verifiedAt: string;
  checks: Array<{ id: CheckId; status: CheckStatus; artifactSha256?: string }>;
}

/** Evidence is an operator's report, not a signature, provider confirmation or
 * permission grant. Even all-passed evidence can only prepare a review plan. */
export function readReleaseReviewEvidence(value: unknown, sourceCommit: string, target: FirebaseTarget): ReleaseReviewEvidence {
  if (!record(value) || !exactKeys(value, ['schemaVersion', 'sourceCommit', 'stagingProjectId', 'databaseId', 'deploymentId', 'deploymentUrl', 'verifiedAt', 'checks'])
    || value.schemaVersion !== 1 || value.sourceCommit !== sourceCommit
    || typeof value.stagingProjectId !== 'string' || !/^[a-z][a-z0-9-]{4,29}[a-z0-9]$/.test(value.stagingProjectId)
    || value.stagingProjectId === target.projectId || (KNOWN_PRODUCTION_FIREBASE_PROJECT_IDS as readonly string[]).includes(value.stagingProjectId)
    || typeof value.databaseId !== 'string' || !DATABASE.test(value.databaseId)
    || typeof value.deploymentId !== 'string' || !/^dpl_[A-Za-z0-9]{8,100}$/.test(value.deploymentId)
    || typeof value.deploymentUrl !== 'string' || !/^https:\/\/narrativesbyjake-[a-z0-9]+-ink-n-witness\.vercel\.app$/.test(value.deploymentUrl)
    || !Number.isFinite(isoMs(value.verifiedAt)) || !Array.isArray(value.checks) || value.checks.length !== RELEASE_REHEARSAL_CHECKS.length) {
    throw new LiteraryCircleReleasePlanError('Staging review evidence must match the exact source commit and an isolated staging deployment.');
  }
  const ids = new Set<string>();
  for (const check of value.checks) {
    if (!record(check) || !exactKeys(check, ['id', 'status', 'artifactSha256'])
      || typeof check.id !== 'string' || !(RELEASE_REHEARSAL_CHECKS as readonly string[]).includes(check.id) || ids.has(check.id)
      || typeof check.status !== 'string' || !['passed', 'pending', 'blocked'].includes(check.status)
      || (check.artifactSha256 !== undefined && (typeof check.artifactSha256 !== 'string' || !SHA256.test(check.artifactSha256)))
      || (check.status === 'passed' && !check.artifactSha256)) {
      throw new LiteraryCircleReleasePlanError('Each rehearsal check requires a unique known ID, explicit status and a digest for any claimed pass.');
    }
    ids.add(check.id);
  }
  return structuredClone(value) as unknown as ReleaseReviewEvidence;
}

export function foundingCohortDigest(backup: VerifiedAffiliateBackup): string {
  const affiliates = backup.payloads.get('affiliates');
  if (!affiliates) throw new LiteraryCircleReleasePlanError('The verified backup has no affiliate cohort.');
  const cohort = validateFoundingAffiliateDocuments(affiliates.documents, FOUNDING_AFFILIATE_COUNT);
  return sha256Hex(canonicalJson(cohort.map(item => ({
    id: item.documentId, code: item.codeIndexId, emailHash: item.emailIndexId,
  })).sort((left, right) => left.id.localeCompare(right.id))));
}

export function buildLiteraryCircleReleasePlan(input: {
  backup: VerifiedAffiliateBackup;
  expectedTarget: FirebaseTarget;
  expectedBackupSha256: string;
  expectedCohortSha256: string;
  sourceCommit: string;
  evidence?: unknown;
  now?: number;
}) {
  const { backup } = input;
  const target = { projectId: input.expectedTarget.projectId, databaseId: input.expectedTarget.databaseId };
  const now = input.now ?? Date.now();
  if (!Number.isFinite(now) || !(KNOWN_PRODUCTION_FIREBASE_PROJECT_IDS as readonly string[]).includes(target.projectId)
    || !DATABASE.test(target.databaseId) || backup.manifest.projectId !== target.projectId || backup.manifest.databaseId !== target.databaseId
    || !COMMIT.test(input.sourceCommit) || !SHA256.test(input.expectedBackupSha256) || !SHA256.test(input.expectedCohortSha256)
    || backup.manifest.contentSha256 !== input.expectedBackupSha256) {
    throw new LiteraryCircleReleasePlanError('Release planning requires an exact production target, source commit and verified backup digest.');
  }
  const cohortSha256 = foundingCohortDigest(backup);
  if (cohortSha256 !== input.expectedCohortSha256) {
    throw new LiteraryCircleReleasePlanError('The backed-up identities do not match the separately pinned original founding cohort.');
  }
  const capturedAt = isoMs(backup.manifest.createdAt);
  if (!Number.isFinite(capturedAt) || capturedAt > now) throw new LiteraryCircleReleasePlanError('The backup timestamp is invalid or in the future.');
  const evidence = input.evidence === undefined ? undefined : readReleaseReviewEvidence(input.evidence, input.sourceCommit, target);
  const reviewedAt = evidence ? isoMs(evidence.verifiedAt) : NaN;
  if (Number.isFinite(reviewedAt) && reviewedAt > now) throw new LiteraryCircleReleasePlanError('Staging evidence cannot be dated in the future.');
  const evidenceFresh = Boolean(evidence) && now - reviewedAt <= RELEASE_EVIDENCE_MAX_AGE_MS;
  const checks: Array<{ id: string; status: CheckStatus }> = [
    { id: 'fresh_production_backup', status: now - capturedAt <= RELEASE_BACKUP_MAX_AGE_MS ? 'passed' : 'blocked' },
    { id: 'fresh_source_bound_staging_evidence', status: evidenceFresh ? 'passed' : 'blocked' },
    ...RELEASE_REHEARSAL_CHECKS.map(id => ({ id,
      status: evidenceFresh ? evidence!.checks.find(check => check.id === id)!.status : 'pending' as const })),
    // Deliberately impossible to authorize via a local report. A future, reviewed
    // apply must independently fence current source/config/cohort state and
    // verify explicit owner-authorized approval, not legacy active status.
    { id: 'reviewed_production_apply', status: 'pending' },
    { id: 'live_transactional_drift_fence', status: 'pending' },
    { id: 'explicit_cohort_approval_and_audit', status: 'pending' },
    { id: 'tested_production_build_before_domain_promotion', status: 'pending' },
  ];
  const configs = backup.payloads.get('affiliate_site_configs')?.documents;
  if (!configs) throw new LiteraryCircleReleasePlanError('The verified backup has no programme policy evidence.');
  const accounts = backup.payloads.get('affiliates')!.documents;
  const priorExplicitApprovals = accounts.filter(({ data }) => data.status === 'active'
    && typeof data.approvedAt === 'string' && Number.isFinite(Date.parse(data.approvedAt))
    && typeof data.approvedBy === 'string' && Boolean(data.approvedBy.trim())).length;
  const plan = {
    schemaVersion: 1, kind: 'literary_circle_production_review_plan', status: 'blocked' as const,
    generatedAt: new Date(now).toISOString(), target, sourceCommit: input.sourceCommit,
    backupManifestSha256: backup.manifest.contentSha256, backupCapturedAt: backup.manifest.createdAt,
    foundingCohortSha256: cohortSha256, foundingAffiliateCount: accounts.length, priorExplicitApprovals,
    affiliateDocumentsSha256: sha256Hex(canonicalJson(accounts)),
    financialPolicySha256: sha256Hex(canonicalJson(configs.filter(document => ['affiliate_settings', 'affiliate_literary_circle'].includes(document.id)))),
    stagingEvidenceSha256: evidence ? sha256Hex(canonicalJson(evidence)) : null,
    stagingDeploymentId: evidence?.deploymentId ?? null,
    evidenceClassification: 'operator_report_not_authorization',
    checks,
    requiredFutureApprovalCount: accounts.length - priorExplicitApprovals,
    preserveExistingCommissionArrangements: true,
    activateNewCommissionPolicy: false,
    historicalFinancialRewritesAllowed: false,
    writeAuthorized: false,
    allowedDatabaseWrites: [],
    sendsOrChargesAuthorized: false,
  };
  return { ...plan, planSha256: sha256Hex(canonicalJson(plan)) };
}
