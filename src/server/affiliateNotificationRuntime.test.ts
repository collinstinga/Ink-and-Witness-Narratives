import crypto from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import type { AffiliateNotificationSource } from './affiliateNotificationPlan.js';

const adapters = vi.hoisted(() => ({
  sourceGate: vi.fn(), deliveryGate: vi.fn(), resolve: vi.fn(), inspect: vi.fn(),
  committed: vi.fn(), scheduled: vi.fn(), deliver: vi.fn(), plan: vi.fn(), verify: vi.fn(),
}));

vi.mock('./affiliateNotificationEvents.js', () => ({
  affiliateNotificationSourceGate: adapters.sourceGate, prepareCommittedAffiliateNotification: adapters.committed,
  resolveAffiliateNotificationSource: adapters.resolve,
}));
vi.mock('./affiliateNotificationSchedule.js', () => ({
  inspectScheduledAffiliateNotificationSource: adapters.inspect, prepareScheduledAffiliateNotifications: adapters.scheduled,
}));
vi.mock('./affiliateNotificationDelivery.js', () => ({
  AFFILIATE_NOTIFICATION_DELIVERY_COLLECTION: 'affiliate_notification_deliveries',
  affiliateNotificationDeliveryGate: adapters.deliveryGate, deliverHeldAffiliateNotification: adapters.deliver,
  affiliateNotificationDeliveryHash: (value: unknown) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'),
}));
vi.mock('./affiliateNotificationPlan.js', () => ({ planAffiliateNotifications: adapters.plan }));
vi.mock('./affiliateNotifications.js', () => ({ validateAffiliateNotificationSettings: (value: unknown) => value }));

import { campaignNotificationAuditId, literaryCircleNotificationAuditId } from './affiliateNotificationAudit.js';
import {
  affiliateNotificationRuntimeSourceVerifier,
  getAffiliateNotificationRuntimeStatus,
  runAffiliateNotificationJob,
} from './affiliateNotificationRuntime.js';

const NOW = '2026-10-24T10:00:00.000Z';
const COLLECTION = 'affiliate_notification_deliveries';
const ENV: NodeJS.ProcessEnv = { AFFILIATE_NOTIFICATION_EVENT_MODE: 'held', AFFILIATE_NOTIFICATION_DELIVERY_MODE: 'staging_test' };
type Ref = { id: string; path: string };
type Filters = Array<[string, string, unknown]>;

function digest(value: unknown) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function intentId(index: number) { return `ani1_${index.toString(16).padStart(64, '0')}`; }
function deliveryId(id: string) { return `nld_${crypto.createHash('sha256').update(`affiliate\0${id}`).digest('hex').slice(0, 48)}`; }

function sourceFor(eventType: AffiliateNotificationSource['eventType'], sourceId: string, evidenceId?: string): AffiliateNotificationSource {
  return { eventType, sourceId, sourceVersion: 1, occurredAt: '2026-10-24T09:00:00.000Z',
    ...(eventType === 'upcoming_campaign' || eventType === 'exclusive_opportunity' ? {
      evidenceId: evidenceId || 'audit-one', notBefore: NOW, expiresAt: '2026-10-25T10:00:00.000Z',
    } : {}),
  };
}

function resolved(source: AffiliateNotificationSource) {
  return { source, context: { pieceTitle: 'A Verified Piece', piecePath: '/?monograph=piece-one' },
    evidenceSha256: digest(source), verifySource: adapters.verify };
}

function harness() {
  const documents = new Map<string, any>(); const writes: string[] = [];
  const queries: Array<{ collection: string; filters: Filters; maximum: number; after?: string }> = [];
  const snapshot = (ref: Ref) => ({ id: ref.id, ref, exists: documents.has(ref.path), data: () => structuredClone(documents.get(ref.path)) });
  const makeTransaction = () => {
    const pending: Array<{ ref: Ref; value: any }> = [];
    return {
      get: async (ref: Ref) => { if (pending.length) throw new Error('read after write'); return snapshot(ref); },
      getAll: async (...refs: Ref[]) => { if (pending.length) throw new Error('read after write'); return refs.map(snapshot); },
      create: (ref: Ref, value: unknown) => { if (documents.has(ref.path)) throw new Error('already exists'); pending.push({ ref, value: structuredClone(value) }); },
      set: (ref: Ref, value: unknown) => { pending.push({ ref, value: structuredClone(value) }); },
      commit: () => { for (const { ref, value } of pending) { documents.set(ref.path, value); writes.push(ref.path); } },
    };
  };
  const query = (collection: string, filters: Filters = [], maximum?: number, after?: string): any => ({
    doc: (id: string) => ({ id, path: `${collection}/${id}` }),
    where: (field: string, op: string, value: unknown) => query(collection, [...filters, [field, op, value]], maximum, after),
    orderBy: () => query(collection, filters, maximum, after),
    startAfter: (value: string) => query(collection, filters, maximum, value),
    limit: (value: number) => query(collection, filters, value, after),
    get: async () => {
      if (!Number.isSafeInteger(maximum) || maximum! < 1 || maximum! > 1_001) throw new Error('unbounded query');
      queries.push({ collection, filters: structuredClone(filters), maximum: maximum!, ...(after ? { after } : {}) });
      const matches = [...documents].filter(([path, value]) => path.startsWith(`${collection}/`) && !path.slice(collection.length + 1).includes('/')
        && filters.every(([field, op, expected]) => op === '==' && value[field] === expected))
        .map(([path]) => ({ path, id: path.slice(collection.length + 1) })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
        .filter(ref => !after || ref.id > after).slice(0, maximum);
      return { docs: matches.map(snapshot) };
    },
  });
  const db = {
    collection: (name: string) => query(name),
    getAll: vi.fn(async (...refs: Ref[]) => refs.map(snapshot)),
    runTransaction: vi.fn(async (operation: (transaction: unknown) => Promise<any>) => {
      const transaction = makeTransaction(); const value = await operation(transaction); transaction.commit(); return value;
    }),
  };
  documents.set('site_configs/affiliate_notifications', { enabled: true, revision: 1, templates: [
    { eventType: 'upcoming_campaign', enabled: true }, { eventType: 'new_release', enabled: true },
    { eventType: 'exclusive_opportunity', enabled: true }, { eventType: 'inactivity_reminder', enabled: false },
  ] });
  documents.set('affiliates/partner-one', { id: 'partner-one', status: 'active', email: 'private@example.test', balanceAvailableKes: 550 });
  documents.set('site_configs/affiliate_literary_circle', { enabled: true, revision: 4, community: { enabled: true, posts: [] } });
  return { documents, writes, queries, db, client: db as unknown as Firestore,
    tx: () => makeTransaction() as unknown as Transaction,
  };
}

function addCampaign(h: ReturnType<typeof harness>, id: string, revision = 1) {
  h.documents.set(`affiliate_campaigns/${id}`, { id, revision, isActive: true });
}

function addIntent(h: ReturnType<typeof harness>, index: number, terminal = false) {
  const id = intentId(index);
  h.documents.set(`affiliate_notification_outbox/${id}`, { kind: 'intent', schemaVersion: 1, id, state: 'held', private: 'private-reader@example.test' });
  if (terminal) h.documents.set(`${COLLECTION}/${deliveryId(id)}`, { schemaVersion: 1, kind: 'delivery',
    id: deliveryId(id), intentId: id, status: 'accepted', email: 'never-expose@example.test' });
  return id;
}

beforeEach(() => {
  Object.values(adapters).forEach(mock => mock.mockReset());
  adapters.sourceGate.mockImplementation((_db, env) => env.AFFILIATE_NOTIFICATION_EVENT_MODE === 'held' ? 'held' : 'disabled');
  adapters.deliveryGate.mockImplementation((_db, env) => env.AFFILIATE_NOTIFICATION_DELIVERY_MODE === 'staging_test' ? 'allowed' : 'disabled');
  adapters.verify.mockResolvedValue(true);
  adapters.resolve.mockImplementation(async ({ source }) => resolved(source));
  adapters.inspect.mockImplementation(async ({ kind, sourceId, evidenceId }) => resolved(sourceFor(kind, sourceId, evidenceId)));
  adapters.plan.mockImplementation(({ source, affiliates }) => ({ eventId: `ane1_${digest([source.eventType, source.sourceId, source.sourceVersion])}`,
    intents: affiliates.map((affiliate: { id: string }) => ({ affiliateId: affiliate.id })) }));
  adapters.committed.mockResolvedValue({ status: 'created', intentCount: 1 });
  adapters.scheduled.mockImplementation(async ({ affiliateIds, kind }) => ({ attempted: kind === 'inactivity_reminder' ? affiliateIds.length : 1,
    counts: { created: kind === 'inactivity_reminder' ? affiliateIds.length : 1 }, intentCount: affiliateIds.length }));
  adapters.deliver.mockResolvedValue({ status: 'accepted' });
});

describe('server-owned notification runtime orchestration', () => {
  it.each(['prepare', 'dispatch'] as const)('defaults %s off before every query, transaction or source operation', async mode => {
    const h = harness();
    expect(await runAffiliateNotificationJob({ db: h.client, mode, now: NOW }, {})).toMatchObject({ status: 'disabled', attempted: 0 });
    expect(h.db.getAll).not.toHaveBeenCalled(); expect(h.db.runTransaction).not.toHaveBeenCalled();
    expect(h.queries).toEqual([]); expect(adapters.resolve).not.toHaveBeenCalled(); expect(adapters.deliver).not.toHaveBeenCalled();
  });

  it('requires the independent delivery review gate before cursor/query access and does not conflate prepare with send', async () => {
    const h = harness();
    expect((await runAffiliateNotificationJob({ db: h.client, mode: 'dispatch', now: NOW }, { AFFILIATE_NOTIFICATION_EVENT_MODE: 'held' })).status).toBe('disabled');
    expect(h.db.getAll).not.toHaveBeenCalled(); expect(h.queries).toEqual([]); expect(h.writes).toEqual([]);
    addCampaign(h, 'campaign-one');
    expect((await runAffiliateNotificationJob({ db: h.client, mode: 'prepare', now: NOW }, ENV)).status).toBe('completed');
    expect(adapters.scheduled).toHaveBeenCalled(); expect(adapters.deliver).not.toHaveBeenCalled();
  });

  it('honors blocked staging targets before any read and disabled templates before candidate reads/writes', async () => {
    const h = harness(); adapters.sourceGate.mockReturnValue('blocked');
    expect((await runAffiliateNotificationJob({ db: h.client, mode: 'prepare', now: NOW }, ENV)).status).toBe('blocked');
    expect(h.db.getAll).not.toHaveBeenCalled();
    adapters.sourceGate.mockReturnValue('held'); h.documents.get('site_configs/affiliate_notifications').enabled = false;
    expect((await runAffiliateNotificationJob({ db: h.client, mode: 'prepare', now: NOW }, ENV)).status).toBe('disabled');
    expect(h.queries).toEqual([]); expect(h.writes).toEqual([]);
  });

  it.each(['active_affiliates', 'campaigns', 'release_campaigns', 'community_posts'] as const)('reports %s overflow before any marker or outbox write instead of truncating an audience', async dataset => {
    const h = harness();
    if (dataset === 'active_affiliates') for (let i = 0; i < 200; i++) h.documents.set(`affiliates/partner-${i}`, { status: 'active' });
    if (dataset === 'campaigns') for (let i = 0; i < 101; i++) addCampaign(h, `campaign-${i}`);
    if (dataset === 'release_campaigns') for (let i = 0; i < 101; i++) h.documents.set(`newsletter_campaigns/release-${i}`, { kind: 'release' });
    if (dataset === 'community_posts') h.documents.get('site_configs/affiliate_literary_circle').community.posts = Array.from({ length: 41 }, (_, i) => ({ id: `post-${i}` }));
    expect(await runAffiliateNotificationJob({ db: h.client, mode: 'prepare', now: NOW }, ENV)).toMatchObject({ status: 'overflow', overflow: [dataset], attempted: 0 });
    expect(h.writes).toEqual([]); expect(h.db.runTransaction).not.toHaveBeenCalled();
    expect(h.queries.every(query => query.maximum <= 201)).toBe(true);
  });

  it('derives exact current campaign/community audit IDs and preserves source/intent/financial documents', async () => {
    const h = harness(); addCampaign(h, 'campaign-one', 3);
    h.documents.get('site_configs/affiliate_literary_circle').community.posts = [{ id: 'opportunity-one', type: 'announcement', isPublished: true }];
    h.documents.set('newsletter_campaigns/release-one', { kind: 'release', status: 'queued', queuedAt: NOW });
    h.documents.set('affiliate_notification_outbox/existing-source', { kind: 'source', preserved: true });
    h.documents.set('affiliate_commissions/commission-one', { amount: 500 });
    const originals = structuredClone([...h.documents]);
    const output = await runAffiliateNotificationJob({ db: h.client, mode: 'prepare', now: NOW }, ENV);
    expect(output).toMatchObject({ status: 'completed', scanned: 3, intentCount: 3 });
    expect(adapters.inspect).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 'campaign-one', evidenceId: campaignNotificationAuditId('campaign-one', 3) }), ENV);
    expect(adapters.inspect).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 'opportunity-one', evidenceId: literaryCircleNotificationAuditId(4) }), ENV);
    expect(adapters.committed).toHaveBeenCalledWith(expect.objectContaining({ kind: 'new_release', sourceId: 'release-one', affiliateIds: ['partner-one'] }), ENV);
    for (const [path, value] of originals) expect(h.documents.get(path)).toEqual(value);
    expect(h.writes.every(path => path.startsWith(`${COLLECTION}/`))).toBe(true);
  });

  it('freezes a complete source audience once and retries the same identities after a new affiliate joins', async () => {
    const h = harness(); addCampaign(h, 'campaign-one');
    await runAffiliateNotificationJob({ db: h.client, mode: 'prepare', now: NOW }, ENV);
    const audiences = structuredClone([...h.documents].filter(([path]) => path.includes('/audience_')));
    expect(audiences).toHaveLength(1);
    h.documents.set('affiliates/partner-two', { status: 'active', email: 'new-private@example.test' });
    await runAffiliateNotificationJob({ db: h.client, mode: 'prepare', now: NOW }, ENV);
    expect(adapters.scheduled.mock.calls.at(-1)![0].affiliateIds).toEqual(['partner-one']);
    for (const [path, value] of audiences) expect(h.documents.get(path)).toEqual(value);
    expect(JSON.stringify(audiences)).not.toContain('@');
  });

  it('does not freeze an ineligible or consentless source and never overwrites conflicting audience evidence', async () => {
    const h = harness(); addCampaign(h, 'campaign-one');
    adapters.inspect.mockResolvedValueOnce(null);
    await runAffiliateNotificationJob({ db: h.client, mode: 'prepare', now: NOW }, ENV);
    expect([...h.documents.values()].filter(value => value.kind === 'runtime_audience')).toHaveLength(0);
    adapters.plan.mockReturnValueOnce({ eventId: `ane1_${'0'.repeat(64)}`, intents: [] });
    await runAffiliateNotificationJob({ db: h.client, mode: 'prepare', now: NOW }, ENV);
    expect([...h.documents.values()].filter(value => value.kind === 'runtime_audience')).toHaveLength(0);
    await runAffiliateNotificationJob({ db: h.client, mode: 'prepare', now: NOW }, ENV);
    const [path, original] = [...h.documents].find(([, value]) => value.kind === 'runtime_audience')!;
    const corrupt = { ...original, audienceSha256: 'wrong' }; h.documents.set(path, corrupt);
    const failed = await runAffiliateNotificationJob({ db: h.client, mode: 'prepare', now: NOW }, ENV);
    expect(failed.counts.failed).toBe(1); expect(h.documents.get(path)).toEqual(corrupt);
  });

  it('rotates preparation past expired/invalid leading sources instead of starving later valid campaigns', async () => {
    const h = harness(); for (let i = 0; i < 30; i++) addCampaign(h, `campaign-${String(i).padStart(3, '0')}`);
    adapters.inspect.mockImplementation(async ({ kind, sourceId, evidenceId }) => sourceId === 'campaign-025' ? resolved(sourceFor(kind, sourceId, evidenceId)) : null);
    const first = await runAffiliateNotificationJob({ db: h.client, mode: 'prepare', now: NOW }, ENV);
    expect(first).toMatchObject({ scanned: 20, hasMore: true, intentCount: 0 });
    const second = await runAffiliateNotificationJob({ db: h.client, mode: 'prepare', now: NOW }, ENV);
    expect(second).toMatchObject({ scanned: 10, hasMore: false, intentCount: 1 });
    expect(adapters.scheduled).toHaveBeenCalledOnce();
    expect(adapters.scheduled.mock.calls[0][0].sourceId).toBe('campaign-025');
  });

  it('chunks inactivity accounts to <=25 without splitting any broadcast source audience', async () => {
    const h = harness(); for (let i = 0; i < 50; i++) h.documents.set(`affiliates/aff-${String(i).padStart(2, '0')}`, { status: 'active' });
    h.documents.get('site_configs/affiliate_notifications').templates.find((template: any) => template.eventType === 'inactivity_reminder').enabled = true;
    const output = await runAffiliateNotificationJob({ db: h.client, mode: 'prepare', now: NOW }, ENV);
    expect(output.attempted).toBe(51);
    expect(adapters.scheduled.mock.calls.map(call => call[0].affiliateIds.length)).toEqual([25, 25, 1]);
    expect(new Set(adapters.scheduled.mock.calls.flatMap(call => call[0].affiliateIds)).size).toBe(51);
  });

  it('validates explicit dispatch batches and passes the real source verifier to the worker without a scan cursor', async () => {
    const h = harness();
    for (const ids of [[], [intentId(1), intentId(1)], ['wrong'], Array.from({ length: 11 }, (_, i) => intentId(i))]) {
      expect((await runAffiliateNotificationJob({ db: h.client, mode: 'dispatch', intentIds: ids, now: NOW }, ENV)).status).toBe('invalid');
    }
    expect(h.queries).toEqual([]); expect(h.writes).toEqual([]);
    const output = await runAffiliateNotificationJob({ db: h.client, mode: 'dispatch', intentIds: [intentId(1), intentId(2)], now: NOW }, ENV);
    expect(output).toMatchObject({ attempted: 2, scanned: 2, counts: { accepted: 2 } });
    expect(adapters.deliver.mock.calls[0][0]).toMatchObject({ intentId: intentId(1), verifySource: expect.any(Function), env: ENV });
    expect(h.queries).toEqual([]); expect(h.writes).toEqual([]);
  });

  it('advances a durable delivery cursor past processed held records, preserving every immutable source row', async () => {
    const h = harness(); for (let i = 1; i <= 25; i++) addIntent(h, i, true); addIntent(h, 26);
    const original = structuredClone([...h.documents].filter(([path]) => path.startsWith('affiliate_notification_outbox/')));
    const first = await runAffiliateNotificationJob({ db: h.client, mode: 'dispatch', now: NOW }, ENV);
    expect(first).toMatchObject({ scanned: 20, attempted: 0, hasMore: true, counts: { already_processed: 20 } });
    const second = await runAffiliateNotificationJob({ db: h.client, mode: 'dispatch', now: NOW }, ENV);
    expect(second).toMatchObject({ scanned: 6, attempted: 1, hasMore: false, counts: { already_processed: 5, accepted: 1 } });
    expect(adapters.deliver.mock.calls[0][0].intentId).toBe(intentId(26));
    for (const [path, value] of original) expect(h.documents.get(path)).toEqual(value);
    expect(h.documents.get(`${COLLECTION}/runtime_delivery_cursor_v1`).afterKey).toBeNull();
  });

  it('caps dispatch work and advances only the consumed page prefix so undispatched intents are not skipped', async () => {
    const h = harness(); for (let i = 1; i <= 22; i++) addIntent(h, i);
    const first = await runAffiliateNotificationJob({ db: h.client, mode: 'dispatch', now: NOW }, ENV);
    expect(first).toMatchObject({ attempted: 10, scanned: 10, hasMore: true });
    expect(h.documents.get(`${COLLECTION}/runtime_delivery_cursor_v1`).afterKey).toBe(intentId(10));
    await runAffiliateNotificationJob({ db: h.client, mode: 'dispatch', now: NOW }, ENV);
    expect(adapters.deliver.mock.calls.slice(10).map(call => call[0].intentId)).toEqual(Array.from({ length: 10 }, (_, i) => intentId(11 + i)));
  });

  it('honors a concurrent cursor lease and fails closed on corrupt cursor state without replacing it', async () => {
    const h = harness(); const path = `${COLLECTION}/runtime_delivery_cursor_v1`;
    const value = { schemaVersion: 1, kind: 'runtime_cursor', id: 'runtime_delivery_cursor_v1', mode: 'dispatch', afterKey: null,
      updatedAt: NOW, leaseToken: 'a'.repeat(48), leaseExpiresAt: '2026-10-24T10:10:00.000Z' };
    h.documents.set(path, value);
    expect((await runAffiliateNotificationJob({ db: h.client, mode: 'dispatch', now: NOW }, ENV)).status).toBe('busy');
    expect(h.documents.get(path)).toEqual(value);
    h.documents.set(path, { ...value, leaseToken: 'corrupt' });
    expect((await runAffiliateNotificationJob({ db: h.client, mode: 'dispatch', now: NOW }, ENV)).status).toBe('conflict');
    expect(h.writes).toEqual([]); expect(h.queries).toEqual([]);
  });

  it('verifies source snapshots inside each caller transaction and distinguishes outages from true ineligibility', async () => {
    const h = harness(); const verify = affiliateNotificationRuntimeSourceVerifier(h.client, ENV);
    const transaction = h.tx(); const source = sourceFor('new_release', 'release-one');
    const input = { transaction, source, intent: { id: intentId(1) } as any, now: NOW };
    expect(await verify(input)).toMatchObject({ eligible: true, variables: { pieceTitle: 'A Verified Piece' }, evidenceSha256: digest(source) });
    expect(adapters.verify).toHaveBeenCalledWith(transaction);
    adapters.verify.mockResolvedValueOnce(false); expect(await verify(input)).toBeNull();
    adapters.resolve.mockResolvedValueOnce(null); expect(await verify(input)).toBeNull();
    adapters.resolve.mockRejectedValueOnce(new Error('redacted transient source failure'));
    await expect(verify(input)).rejects.toThrow('redacted transient source failure');
    expect(h.writes).toEqual([]);
  });

  it('returns safe bounded status counts with explicit truncation, no private recipients or provider envelopes', async () => {
    const h = harness();
    for (let i = 0; i < 502; i++) h.documents.set(`${COLLECTION}/delivery-${String(i).padStart(4, '0')}`, {
      kind: 'delivery', status: i % 2 ? 'retry_pending' : 'dead_letter', email: 'private-status@example.test', providerPayload: 'SECRET-DATA' });
    for (let i = 1; i <= 1_002; i++) addIntent(h, i);
    const status = await getAffiliateNotificationRuntimeStatus({ db: h.client, now: NOW }, ENV);
    expect(status).toMatchObject({ status: 'ready', sampledDeliveries: 500, preparedIntents: 1_000,
      counts: { retry_pending: 250, dead_letter: 250 }, truncated: { deliveries: true, intents: true } });
    expect(JSON.stringify(status)).not.toMatch(/private|SECRET|providerPayload|@/);
    expect(h.writes).toEqual([]); expect(h.queries.map(query => query.maximum)).toEqual([501, 1_001]);
  });

  it('status defaults off without reading a database or pretending counts are a complete audit', async () => {
    const h = harness(); const status = await getAffiliateNotificationRuntimeStatus({ db: h.client, now: NOW }, {});
    expect(status).toMatchObject({ status: 'disabled', preparedIntents: 0, sampledDeliveries: 0 });
    expect(h.queries).toEqual([]); expect(h.db.getAll).not.toHaveBeenCalled();
  });

  it('redacts infrastructure errors from job results and never attempts a local financial or notification fallback', async () => {
    const h = harness(); h.db.getAll.mockRejectedValueOnce(new Error('private@example.test API-SECRET'));
    const output = await runAffiliateNotificationJob({ db: h.client, mode: 'prepare', now: NOW }, ENV);
    expect(output.status).toBe('failed'); expect(JSON.stringify(output)).not.toMatch(/private|SECRET|@/);
    expect(h.writes).toEqual([]); expect(adapters.deliver).not.toHaveBeenCalled();
  });
});
