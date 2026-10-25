import path from 'path';
import { pathToFileURL } from 'url';
import { verifyAffiliateBackup, FOUNDING_AFFILIATE_COUNT } from './literary-circle-migration-lib.js';
import { buildLiteraryCircleReleasePlan, LiteraryCircleReleasePlanError } from './literary-circle-release-plan-lib.js';
import { assertOfflineBackupPath, readBoundedReleaseEvidence, releaseArtifactPath } from './literary-circle-release-plan-files.js';

export function parseLiteraryCircleReleasePlanArgs(argv: readonly string[]) {
  const permitted = ['expected-project', 'expected-database', 'expected-affiliates', 'backup',
    'expected-backup-sha256', 'expected-cohort-sha256', 'source-commit', 'staging-evidence'];
  const values = new Map<string, string>();
  for (const argument of argv) {
    const match = /^--([a-z0-9-]+)=(.+)$/.exec(argument);
    if (!match || !permitted.includes(match[1]) || values.has(match[1]) || match[2] !== match[2].trim()
      || /[\u0000-\u001f\u007f]/.test(match[2])) throw new LiteraryCircleReleasePlanError('Unsupported, duplicate or ambiguous release-plan argument.');
    values.set(match[1], match[2]);
  }
  if (permitted.filter(key => key !== 'staging-evidence').some(key => !values.get(key))
    || values.get('expected-affiliates') !== String(FOUNDING_AFFILIATE_COUNT)
    || !/^[a-z][a-z0-9-]{4,29}[a-z0-9]$/.test(values.get('expected-project')!)
    || !/^(?:\(default\)|[A-Za-z0-9][A-Za-z0-9._-]{0,62})$/.test(values.get('expected-database')!)
    || !/^[a-f0-9]{40}$/.test(values.get('source-commit')!)
    || !/^[a-f0-9]{64}$/.test(values.get('expected-backup-sha256')!)
    || !/^[a-f0-9]{64}$/.test(values.get('expected-cohort-sha256')!)) {
    throw new LiteraryCircleReleasePlanError('Explicit project, database, nine-account count, backup/cohort digests and source commit are required.');
  }
  return { target: { projectId: values.get('expected-project')!, databaseId: values.get('expected-database')! },
    backupPath: values.get('backup')!, expectedBackupSha256: values.get('expected-backup-sha256')!,
    expectedCohortSha256: values.get('expected-cohort-sha256')!, sourceCommit: values.get('source-commit')!,
    evidencePath: values.get('staging-evidence') };
}

/** Offline only. No getDb(), credentials, network, writes, sends or charges. */
export async function executeLiteraryCircleReleasePlan(argv: readonly string[] = process.argv.slice(2)) {
  try {
    const options = parseLiteraryCircleReleasePlanArgs(argv);
    // Reject network/device/path escapes for BOTH artifacts before any I/O.
    releaseArtifactPath(options.backupPath, 'data/backups');
    if (options.evidencePath) releaseArtifactPath(options.evidencePath, 'data');
    const backupPath = assertOfflineBackupPath(options.backupPath);
    const backup = verifyAffiliateBackup(backupPath, { target: options.target, expectedAffiliates: FOUNDING_AFFILIATE_COUNT });
    let evidence: unknown;
    if (options.evidencePath) {
      evidence = readBoundedReleaseEvidence(options.evidencePath);
    }
    const plan = buildLiteraryCircleReleasePlan({ backup, expectedTarget: options.target,
      expectedBackupSha256: options.expectedBackupSha256, expectedCohortSha256: options.expectedCohortSha256,
      sourceCommit: options.sourceCommit, evidence });
    console.log(JSON.stringify(plan, null, 2));
    return plan;
  } catch (error) {
    throw error instanceof LiteraryCircleReleasePlanError ? error : new LiteraryCircleReleasePlanError(
      'Release planning failed safely. Verify local backup/evidence integrity and exact targets; private details were suppressed.'
    );
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  executeLiteraryCircleReleasePlan().then(() => { process.exitCode = 2; }).catch(error => {
    console.error(error instanceof LiteraryCircleReleasePlanError ? error.message : 'Release planning failed safely.');
    process.exitCode = 1;
  });
}
