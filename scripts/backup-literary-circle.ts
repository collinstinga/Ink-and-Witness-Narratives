import path from 'path';
import { pathToFileURL } from 'url';
import { getDb } from '../src/server/db.js';
import {
  captureAffiliateDatasets,
  configuredFirebaseTarget,
  validateFoundingAffiliateDocuments,
  verifyAffiliateBackup,
  writeAffiliateBackup
} from './literary-circle-migration-lib.js';
import {
  LiteraryCircleBackupSafeError,
  assertBackupFirestoreTarget,
  assertConfiguredBackupTarget,
  parseLiteraryCircleBackupArgs,
  safeLiteraryCircleBackupError
} from './literary-circle-backup-target.js';

export async function executeLiteraryCircleBackup(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  try {
    const options = parseLiteraryCircleBackupArgs(argv);
    const target = Object.freeze(configuredFirebaseTarget());
    const expectedAffiliates = options.expectedAffiliates;
    assertConfiguredBackupTarget(options, target);
    const db = getDb();
    assertBackupFirestoreTarget(db, target);

    // Pass the checked client explicitly: never let a later helper select a
    // different default client while labelling its output with this target.
    const payloads = await captureAffiliateDatasets(db);
    const affiliatePayload = payloads.get('affiliates');
    if (!affiliatePayload) throw new Error('Affiliate dataset was not captured.');
    validateFoundingAffiliateDocuments(affiliatePayload.documents, expectedAffiliates);

    assertBackupFirestoreTarget(db, target);
    const written = writeAffiliateBackup({ payloads, target });
    const verified = verifyAffiliateBackup(written.manifestPath, { target, expectedAffiliates });
    assertBackupFirestoreTarget(db, target);
    console.log(JSON.stringify({
      status: 'verified',
      backupId: verified.manifest.backupId,
      backupDirectory: path.relative(process.cwd(), verified.directory),
      manifestSha256: verified.manifest.contentSha256,
      affiliateCount: affiliatePayload.documents.length,
      datasets: verified.manifest.datasets.map(dataset => ({
        key: dataset.key,
        count: dataset.count,
        sums: dataset.sums,
        sha256: dataset.sha256
      }))
    }, null, 2));
  } catch (error) {
    throw new LiteraryCircleBackupSafeError(safeLiteraryCircleBackupError(error));
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  executeLiteraryCircleBackup().catch(error => {
    console.error(safeLiteraryCircleBackupError(error));
    process.exitCode = 1;
  });
}
