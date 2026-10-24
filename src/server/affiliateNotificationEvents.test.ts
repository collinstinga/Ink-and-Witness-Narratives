import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import crypto from 'crypto';
import { AFFILIATE_MARKETING_DISCLOSURE_VERSION, DEFAULT_AFFILIATE_NOTIFICATION_PREFERENCES } from './affiliateNotificationPreferences.js';

vi.mock('./db.js', () => ({
  getFirestoreClientTarget: (client: { projectId?: string; databaseId?: string }) => ({
    projectId: client.projectId, firestoreDatabaseId: client.databaseId,
  }),
  getDb: vi.fn(() => { throw new Error('Unexpected default database initialization'); }),
  getFirestoreDoc: vi.fn(),
  sanitizeForFirestore: (value: unknown) => value,
}));
import { DEFAULT_AFFILIATE_NOTIFICATION_SETTINGS } from './affiliateNotifications.js';
import { createLiteraryCircleMembership, DEFAULT_LITERARY_CIRCLE_SETTINGS } from './literaryCircle.js';
import { buildLiteraryCircleTierTransition } from './literaryCircleTierTransition.js';
import type { AffiliateAccount, AffiliateSaleCommission } from '../types.js';
import { prepareCommittedAffiliateNotification, recoverCommittedAffiliateNotifications, resolveAffiliateNotificationSource } from './affiliateNotificationEvents.js';

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
  it('reconstructs payment-joined delivery evidence and does not treat a stored intent as send permission', async () => {
    const h = harness();
    await prepareCommittedAffiliateNotification({ db: h.client, kind: 'new_commission', sourceId: 'commission-one', now: NOW }, ENV);
    const held = [...h.documents.values()].find(value => value.kind === 'source')!;
    const resolved = await resolveAffiliateNotificationSource({ db: h.client, source: held.source as any, now: NOW }, ENV);
    expect(resolved).not.toBeNull();
    expect(resolved!.context).toEqual({ commissionAmount: 'KES 75.00', pieceTitle: 'a literary purchase' });
    expect(resolved!.evidenceSha256).toMatch(/^[a-f0-9]{64}$/);
    const transaction = { getAll: h.db.getAll } as any;
    expect(await resolved!.verifySource(transaction)).toBe(true);
    h.documents.get('transactions/checkout-one')!.status = 'REVERSED';
    expect(await resolved!.verifySource(transaction)).toBe(false);
    expect(await resolveAffiliateNotificationSource({ db: h.client, source: held.source as any, now: NOW }, ENV)).toBeNull();
    expect([...h.documents.values()].filter(value => value.kind === 'intent')).toHaveLength(1);
    expect(h.writes).toHaveLength(2);
  });

  it('rejects persisted source tampering and staging-disabled delivery resolution before reads', async () => {
    const h = harness();
    const source = { eventType: 'new_commission' as const, sourceId: 'commission-one', sourceVersion: 1,
      occurredAt: '2026-10-23T09:00:00.000Z', targetAffiliateId: 'another-partner' };
    expect(await resolveAffiliateNotificationSource({ db: h.client, source, now: NOW }, {})).toBeNull();
    expect(h.db.getAll).not.toHaveBeenCalled();
    expect(await resolveAffiliateNotificationSource({ db: h.client, source, now: NOW }, ENV)).toBeNull();
    expect(h.writes).toEqual([]);
  });

  function tierUpgrade(h: ReturnType<typeof harness>) {
    const idFor = (checkout: string) => `com_tx_${crypto.createHash('sha256').update(checkout).digest('hex').slice(0, 40)}`;
    const settings = structuredClone(DEFAULT_LITERARY_CIRCLE_SETTINGS);
    settings.enabled = true;
    settings.qualificationEffectiveFrom = '2026-01-01T00:00:00.000Z';
    settings.commissionPolicy = { status: 'active', version: 8, effectiveAt: '2026-01-01T00:00:00.000Z', subscriptionRenewalsEligible: false };
    settings.tiers.find(tier => tier.id === 'literary-ambassador')!.monthlyVerifiedSalesThreshold = 2;
    const affiliate = h.documents.get('affiliates/partner-one')!;
    affiliate.affiliateCode = 'PARTNER';
    affiliate.literaryCircle = createLiteraryCircleMembership({ now: '2026-10-01T00:00:00.000Z', settings, actor: 'Writer', foundingMember: true, audience: 'existing_upgrade' });
    h.documents.set('site_configs/affiliate_literary_circle', settings as unknown as Record<string, unknown>);
    const current = { ...h.documents.get('affiliate_commissions/commission-one')!, id: idFor('checkout-one'),
      purchaseKind: 'piece', commissionRateSource: 'literary_circle_tier', commissionRate: 20,
      commissionAmountKes: 100, grossCreatorRevenueKes: 400,
      literaryCirclePolicyVersion: 8, literaryCircleTierId: 'literary-ambassador' } as unknown as AffiliateSaleCommission;
    const prior = { ...current, id: idFor('checkout-prior'), checkoutRequestId: 'checkout-prior', transactionId: 'tx-prior',
      receiptNumber: 'PRIOR-RECEIPT', createdAt: '2026-10-23T08:59:00.000Z',
      commissionRate: 15, commissionAmountKes: 75, grossCreatorRevenueKes: 425, literaryCircleTierId: 'literary-partner' };
    const transition = buildLiteraryCircleTierTransition({
      commission: current, affiliate: { ...affiliate, id: 'partner-one' } as unknown as AffiliateAccount,
      settings, history: [prior], monthlyVerifiedSalesAfter: 2, historyComplete: true, paymentType: 'PURCHASE',
    });
    expect(transition).toBeDefined();
    current.literaryCircleTierTransition = transition;
    h.documents.set(`affiliate_commissions/${current.id}`, current as unknown as Record<string, unknown>);
    h.documents.set(`affiliate_commissions/${prior.id}`, prior as unknown as Record<string, unknown>);
    h.documents.get('transactions/checkout-one')!.createdAt = current.createdAt;
    h.documents.set('transactions/checkout-prior', { ...h.documents.get('transactions/checkout-one')!,
      id: 'tx-prior', checkoutRequestId: 'checkout-prior', mpesaReceiptNumber: 'PRIOR-RECEIPT', createdAt: prior.createdAt });
    return { request: { db: h.client, kind: 'tier_upgrade' as const, sourceId: current.id, now: NOW }, current, prior };
  }

  it('prepares one tier alert from committed threshold and backing payment evidence, separate from commission alerts', async () => {
    const h = harness(); const { request } = tierUpgrade(h);
    const financial = structuredClone([...h.documents]);
    expect(await prepareCommittedAffiliateNotification(request, ENV)).toEqual({ status: 'created', intentCount: 1 });
    expect(await prepareCommittedAffiliateNotification(request, ENV)).toEqual({ status: 'existing', intentCount: 1 });
    expect(h.writes).toHaveLength(2);
    expect((await prepareCommittedAffiliateNotification({ ...request, kind: 'new_commission' }, ENV)).status).toBe('created');
    expect(h.writes).toHaveLength(4);
    for (const [path, data] of financial) expect(h.documents.get(path)).toEqual(data);
  });

  it.each(['metadata', 'canonical_id', 'payment_pending', 'prior_tip', 'prior_reversed', 'prior_missing', 'policy_changed', 'current_time', 'prior_time', 'priority_time'] as const)('refuses invalid tier evidence: %s', async change => {
    const h = harness(); const { request, current, prior } = tierUpgrade(h);
    if (change === 'metadata') (current.literaryCircleTierTransition!).threshold = 99;
    if (change === 'canonical_id') current.id = 'different-id';
    if (change === 'payment_pending') h.documents.get('transactions/checkout-prior')!.status = 'PENDING';
    if (change === 'prior_tip') h.documents.get('transactions/checkout-prior')!.type = 'TIP';
    if (change === 'prior_reversed') prior.status = 'REVERSED';
    if (change === 'prior_missing') h.documents.delete(`affiliate_commissions/${prior.id}`);
    if (change === 'policy_changed') (h.documents.get('site_configs/affiliate_literary_circle')!.commissionPolicy as { version: number }).version = 9;
    if (change === 'current_time') h.documents.get('transactions/checkout-one')!.createdAt = '2026-10-22T09:00:00.000Z';
    if (change === 'prior_time') h.documents.get('transactions/checkout-prior')!.createdAt = '2026-10-22T08:59:00.000Z';
    if (change === 'priority_time') h.documents.get('transactions/checkout-prior')!.confirmedAt = '2026-10-23T08:58:00.000Z';
    expect((await prepareCommittedAffiliateNotification(request, ENV)).status).toBe('ineligible');
    expect(h.writes).toEqual([]);
  });

  it('rechecks supporting payment evidence in the transaction and suppresses old-period upgrades', async () => {
    const h = harness(); const { request } = tierUpgrade(h);
    expect((await prepareCommittedAffiliateNotification({ ...request, now: '2026-11-01T10:00:00.000Z' }, ENV)).status).toBe('ineligible');
    h.beforeTransaction(() => { h.documents.get('transactions/checkout-prior')!.status = 'FAILED'; });
    expect((await prepareCommittedAffiliateNotification(request, ENV)).status).toBe('ineligible');
    expect(h.writes).toEqual([]);
  });

  it('bounds tier recovery more tightly because supporting payments require extra reads', async () => {
    const h = harness();
    await expect(recoverCommittedAffiliateNotifications({ db: h.client, kind: 'tier_upgrade', sourceIds: Array.from({ length: 6 }, (_, i) => `source-${i}`), now: NOW }, ENV))
      .rejects.toThrow('Invalid partner notification recovery batch.');
    expect(h.db.getAll).not.toHaveBeenCalled();
  });

  function release(h: ReturnType<typeof harness>) {
    const id = `nlc_${crypto.createHash('sha256').update('release\0piece-one').digest('hex').slice(0, 48)}`;
    h.documents.set(`newsletter_campaigns/${id}`, {
      kind: 'release', status: 'queued', createdBy: 'Writer',
      createdAt: '2026-10-23T08:00:00.000Z', queuedAt: '2026-10-23T09:00:00.000Z',
      content: { pieceId: 'piece-one' },
    });
    h.documents.set('articles/piece-one', { status: 'published', publishedAt: '2026-09-01' });
    h.documents.get('affiliates/partner-one')!.notificationPreferences = {
      ...DEFAULT_AFFILIATE_NOTIFICATION_PREFERENCES,
      marketingConsent: 'granted', marketingConsentVersion: AFFILIATE_MARKETING_DISCLOSURE_VERSION,
      marketingConsentAt: '2026-10-23T08:30:00.000Z', allMarketingOptOut: false, releaseUpdates: true,
      releaseUpdatesEnabledAt: '2026-10-23T08:30:00.000Z',
    };
    return { db: h.client, kind: 'new_release' as const, sourceId: id, affiliateIds: ['partner-one'], now: NOW };
  }

  it('prepares a committed release once using queue time, not the article display date', async () => {
    const h = harness();
    const input = release(h);
    expect(await prepareCommittedAffiliateNotification(input, ENV)).toEqual({ status: 'created', intentCount: 1 });
    h.documents.get(`newsletter_campaigns/${input.sourceId}`)!.status = 'sent';
    h.documents.get('articles/piece-one')!.publishedAt = '2026-10-23T09:30:00.000Z';
    expect(await prepareCommittedAffiliateNotification(input, ENV)).toEqual({ status: 'existing', intentCount: 1 });
    expect(h.writes).toHaveLength(2);
    const source = [...h.documents.values()].find(record => record.kind === 'source');
    expect(source?.source).toMatchObject({ occurredAt: '2026-10-23T09:00:00.000Z', sourceVersion: 1 });
  });

  it('expires release notifications after seven days instead of creating a historical automation backlog', async () => {
    const h = harness(); const input = release(h);
    const expiredAt = '2026-10-30T09:00:00.000Z';
    expect((await prepareCommittedAffiliateNotification({ ...input, now: expiredAt }, ENV)).status).toBe('ineligible');
    expect(h.writes).toEqual([]);
    expect((await prepareCommittedAffiliateNotification(input, ENV)).status).toBe('created');
    h.documents.get('articles/piece-one')!.title = 'Verified New Piece';
    const held = [...h.documents.values()].find(record => record.kind === 'source')!;
    expect(await resolveAffiliateNotificationSource({ db: h.client, source: held.source as any, now: expiredAt }, ENV)).toBeNull();
    expect(h.writes).toHaveLength(2);
  });

  it('does not misclassify a transient delivery-source read outage as permanent ineligibility', async () => {
    const h = harness();
    h.db.getAll.mockRejectedValueOnce(new Error('provider-private@example.test SECRET'));
    const source = { eventType: 'new_commission' as const, sourceId: 'commission-one', sourceVersion: 1,
      occurredAt: '2026-10-23T09:00:00.000Z', targetAffiliateId: 'partner-one' };
    await expect(resolveAffiliateNotificationSource({ db: h.client, source, now: NOW }, ENV))
      .rejects.toThrow('Partner notification source could not be verified.');
    expect(h.writes).toEqual([]);
  });

  it.each(['draft', 'cancelled', 'failed'])('rejects release campaign status %s', async status => {
    const h = harness(); const input = release(h);
    h.documents.get(`newsletter_campaigns/${input.sourceId}`)!.status = status;
    expect((await prepareCommittedAffiliateNotification(input, ENV)).status).toBe('ineligible');
    expect(h.writes).toEqual([]);
  });

  it('rejects missing, future or backwards campaign chronology', async () => {
    for (const queuedAt of [undefined, 'tomorrow', '2026-10-23', '2026-10-24T00:00:00.000Z', '2026-10-23T07:00:00.000Z']) {
      const h = harness(); const input = release(h);
      h.documents.get(`newsletter_campaigns/${input.sourceId}`)!.queuedAt = queuedAt;
      expect((await prepareCommittedAffiliateNotification(input, ENV)).status).toBe('ineligible');
      expect(h.writes).toEqual([]);
    }
  });

  it('rejects unpublished pieces and races with unpublishing', async () => {
    const h = harness(); const input = release(h);
    h.documents.get('articles/piece-one')!.status = 'draft';
    expect((await prepareCommittedAffiliateNotification(input, ENV)).status).toBe('ineligible');
    h.documents.get('articles/piece-one')!.status = 'published';
    h.beforeTransaction(() => { h.documents.get('articles/piece-one')!.status = 'draft'; });
    expect((await prepareCommittedAffiliateNotification(input, ENV)).status).toBe('ineligible');
    expect(h.writes).toEqual([]);
  });

  it.each([
    { kind: 'announcement' }, { createdBy: '' }, { content: { pieceId: 'different-piece' } },
    { createdAt: '2026-10-23' },
  ])('rejects tampered release identity or approval evidence: %j', patch => {
    const h = harness(); const input = release(h);
    Object.assign(h.documents.get(`newsletter_campaigns/${input.sourceId}`)!, patch);
    return prepareCommittedAffiliateNotification(input, ENV).then(result => {
      expect(result.status).toBe('ineligible'); expect(h.writes).toEqual([]);
    });
  });

  it('requires a bounded explicit audience and preserves it across retries', async () => {
    const h = harness(); const input = release(h);
    for (const affiliateIds of [undefined, [], ['partner-one', 'partner-one'], Array.from({ length: 201 }, (_, i) => `p${i}`)]) {
      expect((await prepareCommittedAffiliateNotification({ ...input, affiliateIds }, ENV)).status).toBe('ineligible');
    }
    expect(h.db.getAll).not.toHaveBeenCalled();
    expect((await prepareCommittedAffiliateNotification(input, ENV)).status).toBe('created');
    expect((await prepareCommittedAffiliateNotification({ ...input, affiliateIds: ['partner-two'] }, ENV)).status).toBe('failed');
    expect(h.writes).toHaveLength(2);
  });

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
