import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';

vi.mock('./db.js', () => ({
  getFirestoreClientTarget: (client: { projectId?: string; databaseId?: string }) => ({
    projectId: client.projectId, firestoreDatabaseId: client.databaseId,
  }),
  getDb: vi.fn(() => { throw new Error('Unexpected default database initialization'); }),
  getFirestoreDoc: vi.fn(),
  sanitizeForFirestore: (value: unknown) => value,
}));
import { DEFAULT_AFFILIATE_NOTIFICATION_SETTINGS } from './affiliateNotifications.js';
import { prepareCommittedAffiliateNotification, recoverCommittedAffiliateNotifications } from './affiliateNotificationEvents.js';

const NOW = '2026-10-23T10:00:00.000Z';
const ENV: NodeJS.ProcessEnv = {
  AFFILIATE_NOTIFICATION_EVENT_MODE: 'held', FIREBASE_PROJECT_ID: 'ink-witness-staging',
  LITERARY_CIRCLE_STAGING_PROJECT_IDS: 'ink-witness-staging', VERCEL_ENV: 'preview', NODE_ENV: 'production',
};
type Ref = { id: string; path: string };

function harness() {
  const documents = new Map<string, Record<string, unknown>>();
  const writes: string[] = [];
  let beforeTransaction: (() => void) | undefined;
  let failCommit = false;
  const snapshot = (ref: Ref) => ({ id: ref.id, ref, exists: documents.has(ref.path), data: () => structuredClone(documents.get(ref.path)) });
  const db = {
    projectId: 'ink-witness-staging',
    databaseId: '(default)',
    collection: (name: string) => ({ doc: (id: string): Ref => ({ id, path: `${name}/${id}` }) }),
    getAll: vi.fn(async (...refs: Ref[]) => refs.map(snapshot)),
    runTransaction: vi.fn(async (callback: (transaction: unknown) => Promise<unknown>) => {
      beforeTransaction?.();
      beforeTransaction = undefined;
      const staged: Array<{ ref: Ref; data: Record<string, unknown> }> = [];
      const result = await callback({
        get: async (ref: Ref) => { if (staged.length) throw new Error('read after write'); return snapshot(ref); },
        getAll: async (...refs: Ref[]) => { if (staged.length) throw new Error('read after write'); return refs.map(snapshot); },
        create: (ref: Ref, data: Record<string, unknown>) => {
          if (documents.has(ref.path)) throw new Error('already exists');
          staged.push({ ref, data: structuredClone(data) });
        },
      });
      if (failCommit) throw new Error('private-provider-error@example.test');
      for (const { ref, data } of staged) { documents.set(ref.path, data); writes.push(ref.path); }
      return result;
    }),
  };
  const settings = structuredClone(DEFAULT_AFFILIATE_NOTIFICATION_SETTINGS);
  settings.enabled = true;
  settings.templates.forEach(template => { template.enabled = true; });
  documents.set('site_configs/affiliate_notifications', settings as unknown as Record<string, unknown>);
  documents.set('affiliates/partner-one', {
    status: 'active', approvedAt: '2026-10-23T08:00:00.000Z', approvedBy: 'Writer', acceptedTerms: true,
    email: 'private-partner@example.test', name: 'Private Partner',
    literaryCircle: { complimentaryAccess: { status: 'active' }, tier: { id: 'literary-partner' } },
  });
  documents.set('affiliate_commissions/commission-one', {
    affiliateId: 'partner-one', affiliateCode: 'PARTNER', transactionId: 'transaction-one',
    checkoutRequestId: 'checkout-one', receiptNumber: 'PRIVATE-RECEIPT', articleId: 'piece-one',
    saleAmountKes: 500, commissionAmountKes: 75, status: 'APPROVED', createdAt: '2026-10-23T09:00:00.000Z',
  });
  documents.set('transactions/checkout-one', {
    id: 'transaction-one', checkoutRequestId: 'checkout-one', affiliateCode: 'PARTNER', articleId: 'piece-one',
    amount: 500, mpesaReceiptNumber: 'PRIVATE-RECEIPT', status: 'CONFIRMED', type: 'PURCHASE', paymentMethod: 'mpesa',
  });
  return {
    db, documents, writes,
    client: db as unknown as Firestore,
    beforeTransaction: (operation: () => void) => { beforeTransaction = operation; },
    failCommit: () => { failCommit = true; },
  };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('committed affiliate notification sources', () => {
  it('defaults off without database reads or transactions', async () => {
    const h = harness();
    expect(await prepareCommittedAffiliateNotification({ db: h.client, kind: 'activation', sourceId: 'partner-one' }, {}))
      .toEqual({ status: 'disabled', intentCount: 0 });
    expect(h.db.getAll).not.toHaveBeenCalled();
    expect(h.db.runTransaction).not.toHaveBeenCalled();
  });

  it.each([
    { VERCEL_ENV: 'production' }, { FIREBASE_PROJECT_ID: 'ink-and-witness-narratives' },
    { FIREBASE_PROJECT_ID: 'different-staging' }, { LITERARY_CIRCLE_STAGING_PROJECT_IDS: '' },
    { LITERARY_CIRCLE_STAGING_PROJECT_IDS: 'ink-witness-staging,ink-and-witness-narratives' },
    { FIRESTORE_EMULATOR_HOST: 'localhost:8080' }, { AFFILIATE_NOTIFICATION_EVENT_MODE: 'live' },
    { FIRESTORE_DATABASE_ID: 'different-database' }, { FIREBASE_AUTH_EMULATOR_HOST: 'localhost:9099' },
  ])('refuses an unsafe runtime before reads: %j', override => {
    const h = harness();
    return prepareCommittedAffiliateNotification({ db: h.client, kind: 'activation', sourceId: 'partner-one', now: NOW }, { ...ENV, ...override })
      .then(result => { expect(result.status).toBe('blocked'); expect(h.db.getAll).not.toHaveBeenCalled(); });
  });

  it('checks the actual Firestore client project rather than trusting the environment label', async () => {
    const h = harness();
    h.db.projectId = 'different-project';
    expect((await prepareCommittedAffiliateNotification({ db: h.client, kind: 'activation', sourceId: 'partner-one', now: NOW }, ENV)).status).toBe('blocked');
    expect(h.db.getAll).not.toHaveBeenCalled();
  });

  it.each([{ status: 'pending' }, { approvedBy: ' ' }, { approvedAt: 'invalid' }, { approvedAt: '2026-10-24T00:00:00.000Z' }])('does not invent activation from incomplete approval: %j', async fields => {
    const h = harness();
    Object.assign(h.documents.get('affiliates/partner-one')!, fields);
    expect((await prepareCommittedAffiliateNotification({ db: h.client, kind: 'activation', sourceId: 'partner-one', now: NOW }, ENV)).status).toBe('ineligible');
    expect(h.writes).toEqual([]);
  });

  it.each(['activation', 'new_commission'] as const)('prepares one held %s and retries without duplicate writes', async kind => {
    const h = harness();
    const request = { db: h.client, kind, sourceId: kind === 'activation' ? 'partner-one' : 'commission-one', now: NOW };
    const initial = structuredClone([...h.documents]);
    expect(await prepareCommittedAffiliateNotification(request, ENV)).toEqual({ status: 'created', intentCount: 1 });
    expect(await prepareCommittedAffiliateNotification(request, ENV)).toEqual({ status: 'existing', intentCount: 1 });
    expect(h.writes).toHaveLength(2);
    expect(h.writes.every(path => path.startsWith('affiliate_notification_outbox/'))).toBe(true);
    for (const [path, value] of initial) expect(h.documents.get(path)).toEqual(value);
    const records = JSON.stringify(h.writes.map(path => h.documents.get(path)));
    expect(records).not.toMatch(/private-partner@example|PRIVATE-RECEIPT|Private Partner/);
  });

  it.each([
    ['affiliate_commissions/commission-one', { status: 'REVERSED' }],
    ['affiliate_commissions/commission-one', { fraudFlag: { flagged: true } }],
    ['affiliate_commissions/commission-one', { commissionAmountKes: 0 }],
    ['affiliate_commissions/commission-one', { commissionAmountKes: 501 }],
    ['affiliate_commissions/commission-one', { articleId: undefined }],
    ['affiliate_commissions/commission-one', { createdAt: '2026-10-24T00:00:00.000Z' }],
    ['transactions/checkout-one', { status: 'PENDING' }],
    ['transactions/checkout-one', { type: 'TIP' }],
    ['transactions/checkout-one', { amount: 499 }],
    ['transactions/checkout-one', { affiliateCode: 'ANOTHER-PARTNER' }],
    ['transactions/checkout-one', { id: 'different-transaction' }],
    ['transactions/checkout-one', { mpesaReceiptNumber: 'different-receipt' }],
    ['transactions/checkout-one', { articleId: 'different-piece' }],
  ] as const)('rejects a mismatched/unverified financial source at %s: %j', async (path, fields) => {
    const h = harness();
    Object.assign(h.documents.get(path)!, fields);
    expect((await prepareCommittedAffiliateNotification({ db: h.client, kind: 'new_commission', sourceId: 'commission-one', now: NOW }, ENV)).status)
      .toBe('ineligible');
    expect(h.writes).toEqual([]);
  });

  it.each(['activation', 'new_commission'] as const)('checks %s source again in the outbox transaction', async kind => {
    const h = harness();
    h.beforeTransaction(() => {
      if (kind === 'activation') h.documents.get('affiliates/partner-one')!.status = 'suspended';
      else h.documents.get('transactions/checkout-one')!.status = 'FAILED';
    });
    expect((await prepareCommittedAffiliateNotification({ db: h.client, kind, sourceId: kind === 'activation' ? 'partner-one' : 'commission-one', now: NOW }, ENV)).status)
      .toBe('ineligible');
    expect(h.writes).toEqual([]);
  });

  it('leaves a committed sale unchanged on preparation failure and recovers by exact ID', async () => {
    const h = harness();
    const financialBefore = structuredClone(h.documents.get('transactions/checkout-one'));
    h.beforeTransaction(() => { throw new Error('private-provider-error@example.test'); });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await prepareCommittedAffiliateNotification({ db: h.client, kind: 'new_commission', sourceId: 'commission-one', now: NOW }, ENV)).status)
      .toBe('failed');
    expect(h.documents.get('transactions/checkout-one')).toEqual(financialBefore);
    // Clear the injected failure, then replay the committed source only.
    h.beforeTransaction(() => {});
    expect(await recoverCommittedAffiliateNotifications({ db: h.client, kind: 'new_commission', sourceIds: ['commission-one'], now: NOW }, ENV))
      .toEqual({ attempted: 1, counts: { created: 1 } });
    expect(JSON.stringify(warning.mock.calls)).not.toContain('private-provider-error');
  });

  it('bounds recovery, rejects duplicate IDs and performs no scans or provider calls', async () => {
    const h = harness();
    const fetchSpy = vi.fn(() => { throw new Error('Unexpected external request'); });
    vi.stubGlobal('fetch', fetchSpy);
    for (const ids of [['commission-one', 'commission-one'], Array.from({ length: 26 }, (_, i) => `commission-${i}`)]) {
      await expect(recoverCommittedAffiliateNotifications({ db: h.client, kind: 'new_commission', sourceIds: ids, now: NOW }, ENV))
        .rejects.toThrow('Invalid partner notification recovery batch.');
    }
    const result = await recoverCommittedAffiliateNotifications({ db: h.client, kind: 'new_commission', sourceIds: ['commission-one', 'missing-commission'], now: NOW }, ENV);
    expect(result).toEqual({ attempted: 2, counts: { created: 1, ineligible: 1 } });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/commission-one|receipt|partner|email/i);
  });

  it('freezes the validated recovery batch before asynchronous work', async () => {
    const h = harness();
    const ids = ['commission-one'];
    h.beforeTransaction(() => { ids.push(...Array.from({ length: 30 }, (_, i) => `late-source-${i}`)); });
    expect(await recoverCommittedAffiliateNotifications({ db: h.client, kind: 'new_commission', sourceIds: ids, now: NOW }, ENV))
      .toEqual({ attempted: 1, counts: { created: 1 } });
    expect(h.db.getAll).toHaveBeenCalledTimes(2);
  });

  it('rejects non-string receipt evidence even if both stored records agree', async () => {
    const h = harness();
    h.documents.get('affiliate_commissions/commission-one')!.receiptNumber = 12345;
    h.documents.get('transactions/checkout-one')!.mpesaReceiptNumber = 12345;
    expect((await prepareCommittedAffiliateNotification({ db: h.client, kind: 'new_commission', sourceId: 'commission-one', now: NOW }, ENV)).status).toBe('ineligible');
    expect(h.writes).toEqual([]);
  });
});
