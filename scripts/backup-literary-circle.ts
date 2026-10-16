import path from 'path';
import {
  FOUNDING_AFFILIATE_COUNT,
  assertReadOnlyBackupTarget,
  captureAffiliateDatasets,
  configuredFirebaseTarget,
  validateFoundingAffiliateDocuments,
  verifyAffiliateBackup,
  writeAffiliateBackup
} from './literary-circle-migration-lib.js';

function argumentValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length);
}

function expectedAffiliateCount(): number {
  const value = Number(argumentValue('expected-affiliates'));
  if (value !== FOUNDING_AFFILIATE_COUNT) {
    throw new Error(`This migration checkpoint requires --expected-affiliates=${FOUNDING_AFFILIATE_COUNT}.`);
  }
  return value;
}

async function main(): Promise<void> {
  const target = configuredFirebaseTarget();
  const expectedAffiliates = expectedAffiliateCount();
  assertReadOnlyBackupTarget({
    environment: argumentValue('environment') || process.env.LITERARY_CIRCLE_ENV,
    expectedProject: argumentValue('expected-project'),
    allowProductionReadOnly: process.argv.includes('--allow-production-read-only'),
    target
  });

  const payloads = await captureAffiliateDatasets();
  const affiliatePayload = payloads.get('affiliates');
  if (!affiliatePayload) throw new Error('Affiliate dataset was not captured.');
  validateFoundingAffiliateDocuments(affiliatePayload.documents, expectedAffiliates);

  const written = writeAffiliateBackup({ payloads, target });
  const verified = verifyAffiliateBackup(written.manifestPath, { target, expectedAffiliates });
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
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Literary Circle backup failed.');
  process.exitCode = 1;
});
