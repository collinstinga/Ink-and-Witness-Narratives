import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AffiliateAccount } from '../types.js';

type Ref = { collection: string; id: string; key: string };
const fixture = vi.hoisted(() => {
  const documents = new Map<string, any>();
  const clone = (value: any) => value === undefined ? undefined : structuredClone(value);
  let commitFailure = false;
  let auditFailure = false;
  let responseGate: Promise<void> | undefined;
  let responseStarted: (() => void) | undefined;
  const writes: Array<{ target: Ref; value: any; merge: boolean }> = [];
  const ref = (collection: string, id: string): Ref => ({ collection, id, key: `${collection}/${id}` });
  const read = (target: Ref) => ({ exists: documents.has(target.key), data: () => clone(documents.get(target.key)) });
  const setDoc = vi.fn(async (collection: string, id: string, data: any) => {
    documents.set(`${collection}/${id}`, { ...clone(documents.get(`${collection}/${id}`) || {}), ...clone(data) });
  });
  const deleteDoc = vi.fn();
  const runTransaction = vi.fn(async (operation: (transaction: any) => Promise<any>) => {
    const staged: typeof writes = [];
    const result = await operation({
      get: async (target: Ref) => {
        if (staged.length) throw new Error('Transaction read after write');
        return read(target);
      },
      set: (target: Ref, value: any, options?: { merge?: boolean }) => {
        staged.push({ target, value: clone(value), merge: options?.merge === true });
      },
      create: (target: Ref, value: any) => {
        if (auditFailure) { auditFailure = false; throw new Error('private audit backend details'); }
        if (documents.has(target.key)) throw new Error('already exists');
        staged.push({ target, value: clone(value), merge: false });
      }
    });
    if (commitFailure) { commitFailure = false; throw new Error('private datastore quota credentials details'); }
    for (const write of staged) {
      documents.set(write.target.key, { ...(write.merge ? clone(documents.get(write.target.key) || {}) : {}), ...write.value });
      writes.push(write);
    }
    const gate = responseGate;
    const started = responseStarted;
    responseGate = undefined;
    responseStarted = undefined;
    if (gate) { started?.(); await gate; }
    return result;
  });
  return {
    documents, writes, setDoc, deleteDoc, runTransaction,
    db: { collection: (collection: string) => ({ doc: (id: string) => ref(collection, id) }), runTransaction },
    reset() {
      documents.clear(); writes.length = 0; commitFailure = false; auditFailure = false;
      responseGate = undefined; responseStarted = undefined;
      setDoc.mockClear(); deleteDoc.mockClear(); runTransaction.mockClear();
    },
    failCommit() { commitFailure = true; },
    failAudit() { auditFailure = true; },
    holdResponse() {
      let release!: () => void;
      responseGate = new Promise<void>(resolve => { release = resolve; });
      const started = new Promise<void>(resolve => { responseStarted = resolve; });
      return { started, release };
    }
  };
});

vi.mock('fs', () => ({ default: { existsSync: () => false, mkdirSync: vi.fn(), readFileSync: vi.fn(), writeFileSync: vi.fn(), renameSync: vi.fn() } }));
vi.mock('./db.js', () => ({
  getDb: () => fixture.db,
  getFirestoreDoc: async (collection: string, id: string) => structuredClone(fixture.documents.get(`${collection}/${id}`) || null),
  getAllFirestoreDocs: async (collection: string) => [...fixture.documents.entries()]
    .filter(([key]) => key.startsWith(`${collection}/`)).map(([, value]) => structuredClone(value)),
  setFirestoreDoc: fixture.setDoc, replaceFirestoreDoc: fixture.setDoc, updateFirestoreDoc: fixture.setDoc,
  deleteFirestoreDoc: fixture.deleteDoc
}));
vi.mock('./affiliateNotificationEvents.js', () => ({ prepareCommittedAffiliateNotification: vi.fn(async () => ({ status: 'disabled', intentCount: 0 })) }));

import { affiliateStore } from './affiliateStore.js';

const account: AffiliateAccount = {
  id: 'profile_partner', affiliateCode: 'PROFILE1', name: 'Existing Partner', email: 'profile@example.test', phone: '254700000001',
  passwordHash: '$argon2id$v=19$m=65536,p=1,t=3$c2FsdA$aGFzaA', sessionVersion: 'a'.repeat(64),
  status: 'active', payoutMethod: 'mpesa', payoutDetails: { mpesaPhone: '254700000001', bankName: 'Existing Bank' },
  totalClicks: 20, uniqueVisitors: 10, totalSalesCount: 3, totalRevenueKes: 3_000,
  totalCommissionEarnedKes: 450, totalCommissionPaidKes: 100, balanceAvailableKes: 300, balancePendingKes: 50,
  walletRevision: 3, acceptedTerms: true, createdAt: '2026-10-01T08:00:00.000Z', updatedAt: '2026-10-01T08:00:00.000Z'
};
const document = () => fixture.documents.get(`affiliates/${account.id}`);
const snapshot = () => JSON.stringify([...fixture.documents.entries()]);

beforeEach(async () => {
  vi.stubEnv('VERCEL', '1');
  fixture.reset();
  fixture.documents.set(`affiliates/${account.id}`, structuredClone(account));
  await affiliateStore.init();
});
afterEach(() => vi.unstubAllEnvs());

describe('durable affiliate profiles and non-destructive account removal', () => {
  it('uses a fresh document and atomically commits a narrow profile patch plus redacted audit', async () => {
    fixture.documents.set(`affiliates/${account.id}`, { ...document(), walletRevision: 4,
      balanceAvailableKes: 350, payoutDetails: { ...account.payoutDetails, bankName: 'Fresh Bank' } });
    const updated = await affiliateStore.updateAffiliate(account.id, { name: 'Renamed Partner',
      customCommissionRate: 20, payoutDetails: { mpesaName: 'Verified Name' } }, 'Writer');
    expect(updated).toMatchObject({ name: 'Renamed Partner', customCommissionRate: 20,
      walletRevision: 4, balanceAvailableKes: 350, payoutDetails: { bankName: 'Fresh Bank', mpesaName: 'Verified Name' } });
    const profileWrite = fixture.writes.find(write => write.target.collection === 'affiliates');
    expect(profileWrite?.value).toEqual({ name: 'Renamed Partner', customCommissionRate: 20,
      payoutDetails: { ...account.payoutDetails, bankName: 'Fresh Bank', mpesaName: 'Verified Name' },
      profileRevision: 1, updatedAt: expect.any(String) });
    expect(profileWrite?.merge).toBe(true);
    const audit = fixture.writes.find(write => write.target.collection === 'affiliate_audit')?.value;
    expect(audit).toMatchObject({ action: 'affiliate_updated', actor: 'Writer', targetId: account.id });
    expect(JSON.stringify(audit)).not.toMatch(/passwordHash|sessionVersion|balanceAvailableKes/);
    expect(fixture.setDoc).not.toHaveBeenCalled();
  });

  it.each(['failCommit', 'failAudit'] as const)('keeps cached and durable profiles unchanged when %s fails', async failure => {
    const before = snapshot();
    fixture[failure]();
    await expect(affiliateStore.updateAffiliate(account.id, { name: 'Not Saved' })).rejects.toMatchObject({
      message: 'Affiliate profile changes could not be committed. Please retry.', statusCode: 503
    });
    expect(snapshot()).toBe(before);
    expect(affiliateStore.getAffiliateById(account.id)?.name).toBe(account.name);
    expect(affiliateStore.getAuditLogs()).toEqual([]);
  });

  it('does not publish an in-flight profile until its commit response succeeds', async () => {
    const hold = fixture.holdResponse();
    const pending = affiliateStore.updateAffiliate(account.id, { name: 'Durable Update' });
    await hold.started;
    expect(affiliateStore.getAffiliateById(account.id)?.name).toBe(account.name);
    hold.release();
    expect((await pending).name).toBe('Durable Update');
  });

  it('does not roll back a newer profile when an older commit response arrives last', async () => {
    const hold = fixture.holdResponse();
    const earlier = affiliateStore.updateAffiliate(account.id, { name: 'Earlier Name' });
    await hold.started;
    await affiliateStore.updateAffiliate(account.id, { name: 'Latest Name' });
    hold.release();
    expect((await earlier).name).toBe('Latest Name');
    expect(affiliateStore.getAffiliateById(account.id)?.name).toBe('Latest Name');
    expect(document()).toMatchObject({ name: 'Latest Name', profileRevision: 2 });
  });

  it('does not regress wallet revision, monetary balances or monotonic referral counters', async () => {
    const hold = fixture.holdResponse();
    const pending = affiliateStore.updateAffiliate(account.id, { name: 'Preserved Update' });
    await hold.started;
    fixture.documents.set(`affiliates/${account.id}`, { ...document(), walletRevision: 5,
      balanceAvailableKes: 800, totalCommissionEarnedKes: 950, totalSalesCount: 5, totalClicks: 24, uniqueVisitors: 12 });
    await affiliateStore.getAffiliateByIdFresh(account.id);
    hold.release();
    expect(await pending).toMatchObject({ name: 'Preserved Update', walletRevision: 5,
      balanceAvailableKes: 800, totalCommissionEarnedKes: 950, totalSalesCount: 5, totalClicks: 24, uniqueVisitors: 12 });
  });

  it('does not resurrect an old credential/session generation after a concurrent password rotation', async () => {
    const hold = fixture.holdResponse();
    const pending = affiliateStore.updateAffiliate(account.id, { name: 'Updated Contact' });
    await hold.started;
    const passwordHash = '$argon2id$v=19$m=65536,p=1,t=3$bmV3c2FsdA$bmV3aGFzaA';
    const rotated = await affiliateStore.updateAffiliateCredential(account.id, passwordHash, 'Writer');
    hold.release();
    expect(await pending).toMatchObject({ passwordHash, sessionVersion: rotated.sessionVersion });
    expect(affiliateStore.getAffiliateById(account.id)?.sessionVersion).not.toBe(account.sessionVersion);
  });

  it('ignores identity, credentials, approval, access and status fields outside the profile allowlist', async () => {
    await affiliateStore.updateAffiliate(account.id, { name: 'Allowed Name', email: 'other@example.test',
      affiliateCode: 'OTHER', passwordHash: 'attacker', sessionVersion: 'attacker', status: 'pending',
      approvedBy: 'attacker', linksDisabled: true, literaryCircle: {} as any });
    expect(document()).toMatchObject({ name: 'Allowed Name', email: account.email, affiliateCode: account.affiliateCode,
      passwordHash: account.passwordHash, sessionVersion: account.sessionVersion, status: 'active' });
    expect(document()).not.toHaveProperty('approvedBy');
    expect(document()).not.toHaveProperty('linksDisabled');
    expect(document()).not.toHaveProperty('literaryCircle');
  });

  it.each([
    { name: '' }, { name: 'bad\nname' }, { customCommissionRate: 101 }, { customCommissionRate: '20' },
    { attributionDays: 91 }, { payoutMethod: 'crypto' }, { payoutDetails: { token: 'unsafe' } },
    { allowedPieceIds: ['piece/unsafe'] }, { lastLoginAt: 'not-a-date' }, { balanceAvailableKes: 5_000 }
  ])('rejects invalid profile input without starting a transaction: %j', async patch => {
    await expect(affiliateStore.updateAffiliate(account.id, patch as any)).rejects.toThrow();
    expect(fixture.runTransaction).not.toHaveBeenCalled();
    expect(document()).toEqual(account);
  });

  it('does not resurrect an account deleted outside this workflow', async () => {
    fixture.documents.delete(`affiliates/${account.id}`);
    await expect(affiliateStore.updateAffiliate(account.id, { name: 'Cannot Resurrect' })).rejects.toThrow('Affiliate not found');
    expect(document()).toBeUndefined();
    expect(fixture.writes).toEqual([]);
  });

  it('records terms through the durable profile boundary and never moves last login backwards', async () => {
    await affiliateStore.acceptAffiliateTerms(account.id, '2026.2', 'Affiliate');
    await affiliateStore.updateAffiliate(account.id, { lastLoginAt: '2026-10-01T08:00:00.000Z' }, 'System');
    await affiliateStore.updateAffiliate(account.id, { lastLoginAt: '2026-09-01T08:00:00.000Z' }, 'System');
    expect(document()).toMatchObject({ acceptedTerms: true, termsVersion: '2026.2',
      termsAcceptedAt: expect.any(String), lastLoginAt: '2026-10-01T08:00:00.000Z' });
  });

  it('suspends instead of deleting and preserves every dependent financial/referral record and identity', async () => {
    for (const collection of ['affiliate_commissions', 'affiliate_payouts', 'affiliate_clicks', 'affiliate_identity_reservations']) {
      fixture.documents.set(`${collection}/historical`, { affiliateId: account.id, proof: collection });
    }
    const history = [...fixture.documents.entries()].filter(([key]) => !key.startsWith('affiliates/'));
    expect(await affiliateStore.deleteAffiliate(account.id, 'Writer')).toBe(true);
    expect(document()).toMatchObject({ ...account, status: 'suspended', linksDisabled: true,
      sessionVersion: expect.stringMatching(/^[a-f0-9]{64}$/), updatedAt: expect.any(String) });
    expect(document().sessionVersion).not.toBe(account.sessionVersion);
    for (const [key, value] of history) expect(fixture.documents.get(key)).toEqual(value);
    expect(fixture.deleteDoc).not.toHaveBeenCalled();
    expect(affiliateStore.getAffiliateById(account.id)).toMatchObject({ status: 'suspended', linksDisabled: true });
    expect(affiliateStore.getAuditLogs()[0]).toMatchObject({ action: 'affiliate_archived', targetId: account.id });
    const after = snapshot();
    expect(await affiliateStore.deleteAffiliate(account.id, 'Writer')).toBe(true);
    expect(snapshot()).toBe(after);
  });

  it.each(['failCommit', 'failAudit'] as const)('does not suspend or rotate a session when archival %s fails', async failure => {
    const before = snapshot();
    const cachedBefore = structuredClone(affiliateStore.getAffiliateById(account.id));
    fixture[failure]();
    await expect(affiliateStore.deleteAffiliate(account.id, 'Writer')).rejects.toThrow('Affiliate profile changes could not be committed');
    expect(snapshot()).toBe(before);
    expect(affiliateStore.getAffiliateById(account.id)).toEqual(cachedBefore);
  });

  it('returns false without creating history when the archival target does not exist', async () => {
    expect(await affiliateStore.deleteAffiliate('missing_partner')).toBe(false);
    expect(fixture.writes).toEqual([]);
  });
});
