import fs from 'fs';
import path from 'path';
import { FieldPath } from 'firebase-admin/firestore';
import type { PaymentTransaction } from '../src/types.js';
import { getDb, sanitizeForFirestore } from '../src/server/db.js';
import { planSalesLedgerBackfill } from '../src/server/salesLedgerMigration.js';

type BackfillMode = 'dry-run' | 'apply';

interface CliOptions {
  mode: BackfillMode;
  expectedProject?: string;
  limit?: number;
}

interface PlannedUpdate {
  documentId: string;
  orderId: string;
  patch: NonNullable<ReturnType<typeof planSalesLedgerBackfill>['patch']>;
}

function argumentValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length);
}

function parseOptions(): CliOptions {
  const mode: BackfillMode = process.argv.includes('--apply') ? 'apply' : 'dry-run';
  const expectedProject = argumentValue('expected-project')?.trim();
  const rawLimit = argumentValue('limit');
  const limit = rawLimit ? Number(rawLimit) : undefined;
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1)) {
    throw new Error('--limit must be a positive integer.');
  }
  if (mode === 'apply' && !expectedProject) {
    throw new Error('--apply requires --expected-project=<firebase-project-id>.');
  }
  if (mode === 'apply' && limit !== undefined) {
    throw new Error('--limit is dry-run only; apply must validate the complete transaction collection.');
  }
  return { mode, expectedProject, limit };
}

function configuredProjectId(): string {
  const fromEnvironment = process.env.FIREBASE_PROJECT_ID?.trim();
  if (fromEnvironment) return fromEnvironment;
  const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
  const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as { projectId?: string };
  if (!parsed.projectId) throw new Error('Firebase project ID is not configured.');
  return parsed.projectId;
}

async function main() {
  const options = parseOptions();
  const projectId = configuredProjectId();
  if (options.mode === 'apply' && options.expectedProject !== projectId) {
    throw new Error(`Project mismatch: expected ${options.expectedProject}, configured ${projectId}.`);
  }

  let query: FirebaseFirestore.Query = getDb()
    .collection('transactions')
    .orderBy(FieldPath.documentId());
  if (options.limit) query = query.limit(options.limit);
  const snapshot = await query.get();
  const updates: PlannedUpdate[] = [];
  const errors: Array<{ documentId: string; error: string }> = [];
  const warnings: Array<{ documentId: string; warnings: string[] }> = [];
  let skipped = 0;
  const orderOwners = new Map<string, string>();

  for (const document of snapshot.docs) {
    const transaction = document.data() as PaymentTransaction;
    const plan = planSalesLedgerBackfill(transaction);
    if (plan.warnings.length) warnings.push({ documentId: document.id, warnings: plan.warnings });
    if (plan.action === 'error' || !plan.patch && plan.action === 'update') {
      errors.push({ documentId: document.id, error: plan.error || 'Backfill plan is invalid.' });
      continue;
    }
    const orderId = transaction.orderId || plan.patch?.orderId;
    if (orderId) {
      const owner = orderOwners.get(orderId);
      if (owner && owner !== document.id) {
        errors.push({ documentId: document.id, error: `Duplicate order ID also belongs to ${owner}.` });
      } else {
        orderOwners.set(orderId, document.id);
      }
    }
    if (plan.action === 'update' && plan.patch && orderId) {
      updates.push({ documentId: document.id, orderId, patch: plan.patch });
    } else {
      skipped += 1;
    }
  }

  const report = {
    mode: options.mode,
    projectId,
    scanned: snapshot.size,
    updatesPlanned: updates.length,
    skipped,
    warningCount: warnings.length,
    errorCount: errors.length,
    warnings,
    errors
  };
  console.log(JSON.stringify(report, null, 2));

  if (options.mode === 'dry-run') return;
  if (errors.length) {
    throw new Error('Apply refused because the dry-run plan contains errors.');
  }

  for (let offset = 0; offset < updates.length; offset += 400) {
    const batch = getDb().batch();
    for (const update of updates.slice(offset, offset + 400)) {
      batch.set(
        getDb().collection('transactions').doc(update.documentId),
        sanitizeForFirestore(update.patch),
        { merge: true }
      );
    }
    await batch.commit();
  }
  console.log(JSON.stringify({ applied: updates.length, projectId }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
