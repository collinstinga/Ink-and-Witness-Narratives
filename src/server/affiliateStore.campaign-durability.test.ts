import { beforeEach, describe, expect, it, vi } from 'vitest';

type Ref = { collectionName: string; id: string; key: string };
type Query = { kind: 'query'; collectionName: string; field?: string; value?: unknown; limitCount: number };

const firestoreMock = vi.hoisted(() => {
  const documents = new Map<string, any>();
  const clone = (value: any) => value === undefined ? undefined : structuredClone(value);
  let queue = Promise.resolve();
  let failNextCommit = false;
  let failReads = false;
  let commitGate: { ready: () => void; promise: Promise<void> } | undefined;
  const ref = (collectionName: string, id: string): Ref => ({ collectionName, id, key: `${collectionName}/${id}` });
  const snapshot = (document: Ref) => ({
    ...document, exists: documents.has(document.key), ref: document,
    data: () => clone(documents.get(document.key)),
  });
  const querySnapshot = (query: Query) => {
    if (failReads) throw new Error('SECRET provider path/token');
    const prefix = `${query.collectionName}/`;
    return { docs: [...documents.entries()].filter(([key, value]) => key.startsWith(prefix)
      && (query.field === undefined || value?.[query.field] === query.value))
      .slice(0, query.limitCount).map(([key]) => snapshot(ref(query.collectionName, key.slice(prefix.length)))) };
  };
  const collection = (collectionName: string) => ({
    doc: (id: string) => ref(collectionName, id),
    where: (field: string, _operation: string, value: unknown) => ({
      limit: (limitCount: number): Query => ({ kind: 'query', collectionName, field, value, limitCount }),
    }),
    limit: (limitCount: number) => ({ get: async () => querySnapshot({ kind: 'query', collectionName, limitCount }) }),
  });
  const runTransaction = vi.fn(async (operation: (transaction: any) => Promise<any>) => {
    const previous = queue;
    let release!: () => void;
    queue = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      const writes: Array<{ ref: Ref; data: any; create: boolean }> = [];
      const result = await operation({
        get: async (target: Ref | Query) => {
          if (failReads) throw new Error('SECRET provider path/token');
          return 'kind' in target ? querySnapshot(target) : snapshot(target);
        },
        set: (target: Ref, data: any) => writes.push({ ref: target, data: clone(data), create: false }),
        create: (target: Ref, data: any) => writes.push({ ref: target, data: clone(data), create: true }),
      });
      const gate = commitGate;
      commitGate = undefined;
      if (gate) { gate.ready(); await gate.promise; }
      if (failNextCommit) { failNextCommit = false; throw new Error('SECRET provider commit token'); }
      if (writes.some(write => write.create && documents.has(write.ref.key))) throw new Error('Already exists');
      for (const write of writes) documents.set(write.ref.key, clone(write.data));
      return result;
    } finally { release(); }
  });
  return {
    documents, db: { collection, runTransaction }, runTransaction,
    reset() { documents.clear(); queue = Promise.resolve(); failNextCommit = false; failReads = false; commitGate = undefined; runTransaction.mockClear(); },
    failCommit() { failNextCommit = true; },
    failRead() { failReads = true; },
    pauseCommit() {
      let ready!: () => void;
      let release!: () => void;
      const reached = new Promise<void>(resolve => { ready = resolve; });
      const promise = new Promise<void>(resolve => { release = resolve; });
      commitGate = { ready, promise };
      return { reached, release };
    },
  };
});

const fsMock = vi.hoisted(() => ({ existsSync: vi.fn(() => false), mkdirSync: vi.fn(), readFileSync: vi.fn(), writeFileSync: vi.fn(), renameSync: vi.fn() }));
vi.mock('fs', () => ({ default: fsMock, ...fsMock }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { increment: (amount: number) => ({ increment: amount }) } }));
vi.mock('./affiliateNotificationEvents.js', () => ({ prepareCommittedAffiliateNotification: vi.fn(async () => ({ status: 'disabled', intentCount: 0 })) }));
vi.mock('./db.js', () => ({
  getDb: vi.fn(() => firestoreMock.db),
  getFirestoreDoc: vi.fn(async (collectionName: string, id: string) => structuredClone(firestoreMock.documents.get(`${collectionName}/${id}`) ?? null)),
  getAllFirestoreDocs: vi.fn(async (collectionName: string) => [...firestoreMock.documents.entries()]
    .filter(([key]) => key.startsWith(`${collectionName}/`)).map(([, value]) => structuredClone(value))),
  setFirestoreDoc: vi.fn(async () => undefined), updateFirestoreDoc: vi.fn(async () => undefined), deleteFirestoreDoc: vi.fn(async () => undefined),
}));

import { affiliateStore, publishCommittedAffiliateCampaignSnapshot } from './affiliateStore.js';
import { setFirestoreDoc } from './db.js';

const campaign = {
  id: 'campaign_existing', code: 'EXISTING', name: 'Existing campaign', description: 'Original description',
  commissionRate: 20, attributionDays: 30, eligiblePieceIds: ['piece_1'],
  startDate: '2026-10-01', endDate: '2026-12-01', isActive: true,
  clicksCount: 12, salesCount: 4, revenueKes: 2_000, commissionsKes: 400,
  createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-01T10:00:00.000Z',
};
const campaignKey = `affiliate_campaigns/${campaign.id}`;
const audits = () => [...firestoreMock.documents.entries()].filter(([key]) => key.startsWith('affiliate_audit/'));
const storedCampaigns = () => [...firestoreMock.documents.entries()].filter(([key]) => key.startsWith('affiliate_campaigns/'));

describe('Firestore-authoritative campaign management', () => {
  beforeEach(async () => {
    firestoreMock.reset();
    fsMock.existsSync.mockReset().mockReturnValue(false);
    fsMock.readFileSync.mockReset();
    fsMock.writeFileSync.mockClear();
    firestoreMock.documents.set(campaignKey, structuredClone(campaign));
    await affiliateStore.init();
    firestoreMock.runTransaction.mockClear();
    fsMock.writeFileSync.mockClear();
  });

  it('creates a campaign and audit together with safe server-owned identity and totals', async () => {
    const saved = await affiliateStore.saveCampaign({ code: ' new_launch ', name: 'New launch',
      clicksCount: 999, salesCount: 999, revenueKes: 999, commissionsKes: 999,
      createdAt: '2000-01-01T00:00:00.000Z', updatedBy: 'Forged actor' }, 'Writer');
    expect(saved).toMatchObject({ code: 'NEW_LAUNCH', name: 'New launch', revision: 1, updatedBy: 'Writer',
      clicksCount: 0, salesCount: 0, revenueKes: 0, commissionsKes: 0 });
    expect(saved.id).toMatch(/^camp_[a-f0-9]{40}$/);
    expect(saved.createdAt).not.toBe('2000-01-01T00:00:00.000Z');
    expect(Date.parse(saved.endDate) - Date.parse(saved.startDate)).toBe(30 * 86_400_000);
    expect(firestoreMock.documents.get(`affiliate_campaigns/${saved.id}`)).toEqual(saved);
    expect(audits()).toHaveLength(1);
    expect(audits()[0][1]).toMatchObject({ action: 'campaign_saved', targetId: saved.id, actor: 'Writer', newValue: saved });
    saved.name = 'Caller mutation';
    expect(affiliateStore.getCampaigns().find(item => item.id === saved.id)?.name).toBe('New launch');
  });

  it('never uploads a local campaign projection when the cloud directory is empty', async () => {
    firestoreMock.documents.delete(campaignKey);
    fsMock.existsSync.mockImplementation((filename?: unknown) => String(filename).endsWith('affiliate_campaigns.json'));
    fsMock.readFileSync.mockReturnValue(JSON.stringify([campaign]));
    vi.mocked(setFirestoreDoc).mockClear();
    await affiliateStore.init();
    expect(affiliateStore.getCampaigns()).toEqual([campaign]);
    expect(firestoreMock.documents.has(campaignKey)).toBe(false);
    expect(vi.mocked(setFirestoreDoc).mock.calls.filter(([collection]) => collection === 'affiliate_campaigns')).toEqual([]);
    expect(await affiliateStore.getCampaignsFresh()).toEqual([]);
  });

  it('reads the latest record, preserving committed totals, creation time and unknown fields instead of stale cache or request values', async () => {
    const fresh = { ...campaign, revision: 4, clicksCount: 25, salesCount: 9, revenueKes: 5_000, commissionsKes: 1_000,
      futureMetadata: { attributionLedger: 'keep-this' } };
    firestoreMock.documents.set(campaignKey, structuredClone(fresh));
    const saved = await affiliateStore.saveCampaign({ ...campaign, revision: 4, name: 'Updated name',
      clicksCount: 1, salesCount: 1, revenueKes: 1, commissionsKes: 1, createdAt: 'forged', updatedBy: 'forged' }, 'Writer');
    expect(saved).toMatchObject({ ...fresh, name: 'Updated name', revision: 5, updatedBy: 'Writer', updatedAt: expect.any(String) });
    expect(saved.createdAt).toBe(campaign.createdAt);
    expect(saved.startDate).toBe(campaign.startDate);
    expect(audits()[0][1].previousValue).toEqual(fresh);
    expect(affiliateStore.getCampaigns().find(item => item.id === campaign.id)).toEqual(saved);
  });

  it('does not acknowledge or publish local state before a commit', async () => {
    const gate = firestoreMock.pauseCommit();
    const pending = affiliateStore.saveCampaign({ id: campaign.id, name: 'Pending name' });
    await gate.reached;
    expect(affiliateStore.getCampaigns().find(item => item.id === campaign.id)?.name).toBe(campaign.name);
    expect(firestoreMock.documents.get(campaignKey)).toEqual(campaign);
    expect(audits()).toHaveLength(0);
    expect(fsMock.writeFileSync).not.toHaveBeenCalled();
    gate.release();
    expect((await pending).name).toBe('Pending name');
    expect(audits()).toHaveLength(1);
  });

  it('preserves database, cache and audit on failed commit and permits a clean retry', async () => {
    firestoreMock.failCommit();
    await expect(affiliateStore.saveCampaign({ id: campaign.id, name: 'Not yet saved' })).rejects.toThrow('no local fallback');
    expect(firestoreMock.documents.get(campaignKey)).toEqual(campaign);
    expect(affiliateStore.getCampaigns().find(item => item.id === campaign.id)).toEqual(campaign);
    expect(audits()).toHaveLength(0);
    expect(fsMock.writeFileSync).not.toHaveBeenCalled();
    const saved = await affiliateStore.saveCampaign({ id: campaign.id, name: 'Retried' });
    expect(saved.revision).toBe(1);
    expect(audits()).toHaveLength(1);
  });

  it('allows only one of two concurrent updates from the same revision', async () => {
    const outcomes = await Promise.allSettled([
      affiliateStore.saveCampaign({ id: campaign.id, revision: 0, name: 'First editor' }),
      affiliateStore.saveCampaign({ id: campaign.id, revision: 0, name: 'Second editor' }),
    ]);
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.find(outcome => outcome.status === 'rejected')).toMatchObject({ reason: { statusCode: 409 } });
    expect(audits()).toHaveLength(1);
    expect(firestoreMock.documents.get(campaignKey).revision).toBe(1);
  });

  it('requires a revision after a record has been upgraded and rejects stale or nonexistent updates', async () => {
    await affiliateStore.saveCampaign({ id: campaign.id, name: 'Versioned' });
    for (const update of [{ id: campaign.id, name: 'Legacy tab' }, { id: campaign.id, revision: 0 }, { id: 'missing_campaign', name: 'Missing' }]) {
      await expect(affiliateStore.saveCampaign(update)).rejects.toMatchObject({ statusCode: 409 });
    }
    expect(audits()).toHaveLength(1);
    expect((await affiliateStore.saveCampaign({ id: campaign.id, revision: 1, isActive: false })).isActive).toBe(false);
  });

  it('preserves an existing referral identity and never treats a duplicate create as an update', async () => {
    await expect(affiliateStore.saveCampaign({ id: campaign.id, code: 'NEWCODE' })).rejects.toMatchObject({ statusCode: 409 });
    await expect(affiliateStore.saveCampaign({ code: campaign.code, name: 'Duplicate create' })).rejects.toMatchObject({ statusCode: 409 });
    expect(firestoreMock.documents.get(campaignKey)).toEqual(campaign);
    expect(audits()).toHaveLength(0);
  });

  it('allows only one concurrent creation of a normalized code', async () => {
    const outcomes = await Promise.allSettled([
      affiliateStore.saveCampaign({ code: 'same_code', name: 'First create' }),
      affiliateStore.saveCampaign({ code: 'SAME_CODE', name: 'Second create' }),
    ]);
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.find(outcome => outcome.status === 'rejected')).toMatchObject({ reason: { statusCode: 409 } });
    expect(storedCampaigns().filter(([, value]) => value.code === 'SAME_CODE')).toHaveLength(1);
    expect(audits()).toHaveLength(1);
  });

  it('canonicalizes explicit valid dates and preserves omitted piece selection', async () => {
    const saved = await affiliateStore.saveCampaign({ id: campaign.id, startDate: '2026-11-01', endDate: '2026-12-02', commissionRate: 12.5, attributionDays: 90 });
    expect(saved).toMatchObject({ startDate: '2026-11-01T00:00:00.000Z', endDate: '2026-12-02T00:00:00.000Z', eligiblePieceIds: ['piece_1'], commissionRate: 12.5, attributionDays: 90 });
  });

  it.each([
    { id: '../escape' }, { code: 'bad code' }, { code: 'A'.repeat(65) }, { name: '' }, { name: 'A'.repeat(121) },
    { description: 'A'.repeat(2_001) }, { commissionRate: 0 }, { commissionRate: 101 }, { commissionRate: '20' },
    { attributionDays: 0 }, { attributionDays: 91 }, { attributionDays: 1.5 }, { isActive: 'true' },
    { eligiblePieceIds: ['piece_1', 'piece_1'] }, { eligiblePieceIds: ['../piece'] }, { eligiblePieceIds: Array.from({ length: 201 }, (_, index) => `piece_${index}`) },
    { startDate: '2026-02-30' }, { endDate: '2026-10-01' }, { startDate: 'not-a-date' },
    { isActive: null }, { commissionRate: null }, { surprise: true },
  ])('rejects invalid editable inputs without committing: %j', async patch => {
    await expect(affiliateStore.saveCampaign({ id: campaign.id, ...patch } as any)).rejects.toMatchObject({ statusCode: 400 });
    expect(firestoreMock.documents.get(campaignKey)).toEqual(campaign);
    expect(audits()).toHaveLength(0);
  });

  it('returns current Firestore campaigns rather than cached state and isolates caller mutations', async () => {
    firestoreMock.documents.set(campaignKey, { ...campaign, name: 'Changed on another instance', revision: 3 });
    const fresh = await affiliateStore.getCampaignsFresh();
    expect(fresh[0]).toMatchObject({ name: 'Changed on another instance', revision: 3 });
    fresh[0].name = 'Caller mutation';
    expect((await affiliateStore.getCampaignsFresh())[0].name).toBe('Changed on another instance');
    expect(affiliateStore.getCampaigns().find(item => item.id === campaign.id)?.name).toBe(campaign.name);
  });

  it('keeps newer writer edits when a late click or sale projects an older configuration', async () => {
    const edited = { ...campaign, name: 'New writer configuration', commissionRate: 25, revision: 3,
      updatedAt: '2026-10-23T10:00:00.000Z', futureMetadata: { keep: true } };
    publishCommittedAffiliateCampaignSnapshot(edited);
    const projected = publishCommittedAffiliateCampaignSnapshot({ ...campaign, revision: 2, clicksCount: 30,
      salesCount: 10, revenueKes: 5_000, commissionsKes: 1_000 });
    expect(projected).toMatchObject({ ...edited, clicksCount: 30, salesCount: 10, revenueKes: 5_000, commissionsKes: 1_000 });
    expect(firestoreMock.documents.get(campaignKey)).toEqual(campaign);
  });

  it('keeps fresher independent financial counters when a delayed writer save projects its snapshot', async () => {
    publishCommittedAffiliateCampaignSnapshot({ ...campaign, revision: 1, clicksCount: 30, salesCount: 10,
      revenueKes: 5_000, commissionsKes: 1_000 });
    const projected = publishCommittedAffiliateCampaignSnapshot({ ...campaign, revision: 2, name: 'New writer configuration' });
    expect(projected).toMatchObject({ revision: 2, name: 'New writer configuration', clicksCount: 30,
      salesCount: 10, revenueKes: 5_000, commissionsKes: 1_000 });
    projected.name = 'Caller mutation';
    expect(affiliateStore.getCampaigns().find(item => item.id === campaign.id)?.name).toBe('New writer configuration');
    expect(firestoreMock.documents.get(campaignKey)).toEqual(campaign);
  });

  it('fails closed instead of truncating a campaign directory above the reviewed read bound', async () => {
    for (let index = 0; index < 500; index++) firestoreMock.documents.set(`affiliate_campaigns/extra_${index}`, { ...campaign, id: `extra_${index}` });
    await expect(affiliateStore.getCampaignsFresh()).rejects.toThrow('could not be loaded');
    expect(audits()).toHaveLength(0);
  });

  it('redacts provider errors from both write and fresh-read paths', async () => {
    firestoreMock.failRead();
    await expect(affiliateStore.saveCampaign({ id: campaign.id, name: 'Failed' })).rejects.toThrow(/^Campaign settings could not be committed/);
    await expect(affiliateStore.getCampaignsFresh()).rejects.toThrow(/^Current affiliate campaigns could not be loaded/);
    expect(audits()).toHaveLength(0);
  });

  it('pauses an authoritative campaign absent from this instance cache without removing history or fields', async () => {
    const fresh = { ...campaign, id: 'another_instance_campaign', code: 'OTHER_INSTANCE', revision: 3,
      clicksCount: 55, salesCount: 12, revenueKes: 6_000, commissionsKes: 1_200, futureMetadata: { retain: true } };
    const key = `affiliate_campaigns/${fresh.id}`;
    firestoreMock.documents.set(key, structuredClone(fresh));
    expect(affiliateStore.getCampaigns().some(item => item.id === fresh.id)).toBe(false);
    expect(await affiliateStore.deleteCampaign(fresh.id, 'Writer', 3)).toBe(true);
    const saved = firestoreMock.documents.get(key);
    expect(saved).toMatchObject({ ...fresh, revision: 4, isActive: false, updatedAt: expect.any(String), updatedBy: 'Writer' });
    expect(audits()).toHaveLength(1);
    expect(audits()[0][1]).toMatchObject({ action: 'campaign_archived', targetId: fresh.id, previousValue: fresh, newValue: saved });
    expect(affiliateStore.getCampaigns().find(item => item.id === fresh.id)).toEqual(saved);
    expect((await affiliateStore.saveCampaign({ id: fresh.id, revision: 4, isActive: true })).isActive).toBe(true);
    expect(firestoreMock.documents.get(key)).toMatchObject({ code: fresh.code, clicksCount: 55, salesCount: 12, revenueKes: 6_000, commissionsKes: 1_200 });
  });

  it('preserves database, cache and audit when a pause commit fails', async () => {
    firestoreMock.failCommit();
    await expect(affiliateStore.deleteCampaign(campaign.id, 'Writer')).rejects.toThrow(/^Campaign pause could not be committed/);
    expect(firestoreMock.documents.get(campaignKey)).toEqual(campaign);
    expect(affiliateStore.getCampaigns().find(item => item.id === campaign.id)).toEqual(campaign);
    expect(audits()).toHaveLength(0);
    expect(fsMock.writeFileSync).not.toHaveBeenCalled();
  });

  it('rejects missing or stale revisions on versioned pauses', async () => {
    firestoreMock.documents.set(campaignKey, { ...campaign, revision: 2 });
    await expect(affiliateStore.deleteCampaign(campaign.id)).rejects.toMatchObject({ statusCode: 409 });
    await expect(affiliateStore.deleteCampaign(campaign.id, 'Writer', 1)).rejects.toMatchObject({ statusCode: 409 });
    await expect(affiliateStore.deleteCampaign(campaign.id, 'Writer', '2' as any)).rejects.toMatchObject({ statusCode: 400 });
    expect(audits()).toHaveLength(0);
    expect(firestoreMock.documents.get(campaignKey).isActive).toBe(true);
  });

  it('returns false without creating an audit or record when pausing an absent campaign', async () => {
    expect(await affiliateStore.deleteCampaign('does_not_exist')).toBe(false);
    expect(firestoreMock.documents.has('affiliate_campaigns/does_not_exist')).toBe(false);
    expect(audits()).toHaveLength(0);
    expect(fsMock.writeFileSync).not.toHaveBeenCalled();
  });

  it('does not create another audit or revision for an already paused current campaign', async () => {
    expect(await affiliateStore.deleteCampaign(campaign.id)).toBe(true);
    expect(await affiliateStore.deleteCampaign(campaign.id, 'Writer', 1)).toBe(true);
    expect(audits()).toHaveLength(1);
    expect(firestoreMock.documents.get(campaignKey)).toMatchObject({ revision: 1, isActive: false });
  });
});
