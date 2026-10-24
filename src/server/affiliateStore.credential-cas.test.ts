import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AffiliateAccount } from '../types.js';

type Reference = { collection: string; id: string };
const fake = vi.hoisted(() => {
  const documents = new Map<string, any>();
  let queue = Promise.resolve();
  let failCommit = false;
  let failAudit = false;
  let beforeCommit: (() => void | Promise<void>) | undefined;
  const key = (reference: Reference) => `${reference.collection}/${reference.id}`;
  const runTransaction = vi.fn(async (operation: (transaction: any) => Promise<any>) => {
    const previous = queue;
    let release!: () => void;
    queue = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      const writes: Array<{ reference: Reference; data: any; merge: boolean }> = [];
      const result = await operation({
        get: async (reference: Reference) => {
          if (writes.length) throw new Error('Reads must precede writes');
          const value = documents.get(key(reference));
          return { exists: value !== undefined, data: () => structuredClone(value) };
        },
        set: (reference: Reference, data: any, options?: { merge?: boolean }) => {
          writes.push({ reference, data: structuredClone(data), merge: options?.merge === true });
        },
        create: (reference: Reference, data: any) => {
          if (failAudit && reference.collection === 'affiliate_audit') throw new Error('private audit provider failure');
          if (documents.has(key(reference))) throw new Error('already exists');
          writes.push({ reference, data: structuredClone(data), merge: false });
        },
      });
      if (failCommit) throw new Error('private credential provider failure');
      for (const write of writes) documents.set(key(write.reference), {
        ...(write.merge ? documents.get(key(write.reference)) || {} : {}), ...write.data,
      });
      await beforeCommit?.();
      return result;
    } finally { release(); }
  });
  const setDoc = vi.fn();
  const db = { collection: (collection: string) => ({ doc: (id: string) => ({ collection, id }) }), runTransaction };
  return { documents, db, setDoc, runTransaction,
    reset() { documents.clear(); queue = Promise.resolve(); failCommit = false; failAudit = false; beforeCommit = undefined; setDoc.mockClear(); runTransaction.mockClear(); },
    failCommit() { failCommit = true; }, failAudit() { failAudit = true; },
    afterCommit(callback: () => void | Promise<void>) { beforeCommit = callback; },
  };
});

vi.mock('fs', () => ({ default: {
  existsSync: () => false, mkdirSync: vi.fn(), readFileSync: vi.fn(), writeFileSync: vi.fn(), renameSync: vi.fn(),
} }));
vi.mock('./db.js', () => ({
  getDb: () => fake.db,
  getFirestoreDoc: async (collection: string, id: string) => structuredClone(fake.documents.get(`${collection}/${id}`) || null),
  getAllFirestoreDocs: async (collection: string) => [...fake.documents]
    .filter(([key]) => key.startsWith(`${collection}/`)).map(([, value]) => structuredClone(value)),
  setFirestoreDoc: fake.setDoc, updateFirestoreDoc: fake.setDoc, deleteFirestoreDoc: vi.fn(),
}));

import { affiliateStore } from './affiliateStore.js';

const LEGACY_HASH = 'a'.repeat(64);
const CURRENT_HASH = '$argon2id$v=19$m=65536,p=1,t=3$c2FsdA$aGFzaA';
const SESSION_VERSION = '1'.repeat(64);
const account: AffiliateAccount = {
  id: 'aff_credential_cas', affiliateCode: 'CAS1', name: 'CAS Fixture', email: 'cas@example.invalid',
  phone: '254700000001', passwordHash: LEGACY_HASH, sessionVersion: SESSION_VERSION,
  status: 'active', payoutMethod: 'mpesa', payoutDetails: { mpesaPhone: '254700000001' },
  totalClicks: 5, uniqueVisitors: 3, totalSalesCount: 2, totalRevenueKes: 1000,
  totalCommissionEarnedKes: 150, totalCommissionPaidKes: 25,
  balanceAvailableKes: 125, balancePendingKes: 0, walletRevision: 4,
  createdAt: '2026-10-01T08:00:00.000Z', updatedAt: '2026-10-01T08:00:00.000Z',
};
const expected = () => ({ passwordHash: LEGACY_HASH, sessionVersion: SESSION_VERSION });
const accountKey = `affiliates/${account.id}`;
const audits = () => [...fake.documents].filter(([key]) => key.startsWith('affiliate_audit/'));

beforeEach(async () => {
  vi.stubEnv('VERCEL', '1');
  vi.stubEnv('AFFILIATE_NOTIFICATION_EVENT_MODE', 'off');
  fake.reset();
  fake.documents.set('site_configs/affiliate_settings', { minPayoutThresholdKes: 500 });
  await affiliateStore.init();
  // Simulate another warm instance creating/importing the legacy account.
  // It is deliberately absent from this instance's startup cache.
  fake.documents.set(accountKey, structuredClone(account));
  fake.documents.set('reader_licenses/preserved', { readerId: 'reader_1', pieceId: 'piece_1', paid: true });
  fake.documents.set('affiliate_commissions/preserved', { affiliateId: account.id, amount: 150 });
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('compare-and-swap affiliate login rehash', () => {
  it('migrates a freshly verified account absent from startup cache with an atomic redacted audit', async () => {
    expect(affiliateStore.getAffiliateById(account.id)).toBeUndefined();
    const result = await affiliateStore.updateAffiliateCredential(account.id, CURRENT_HASH, 'System (credential migration)', expected());
    expect(result).toMatchObject({ passwordHash: CURRENT_HASH, balanceAvailableKes: 125,
      totalCommissionEarnedKes: 150, walletRevision: 4, affiliateCode: 'CAS1', email: account.email });
    expect(result.sessionVersion).not.toBe(SESSION_VERSION);
    expect(fake.documents.get(accountKey)).toEqual(result);
    expect(audits()).toHaveLength(1);
    const audit = audits()[0][1];
    expect(audit).toMatchObject({ action: 'affiliate_credential_updated', targetId: account.id,
      newValue: { credentialFormat: 'argon2id', sessionsRotated: true } });
    for (const confidential of [LEGACY_HASH, CURRENT_HASH, SESSION_VERSION, result.sessionVersion!]) {
      expect(JSON.stringify(audit)).not.toContain(confidential);
    }
    expect(fake.setDoc).not.toHaveBeenCalled();
    expect(fake.documents.get('reader_licenses/preserved')).toEqual({ readerId: 'reader_1', pieceId: 'piece_1', paid: true });
    expect(fake.documents.get('affiliate_commissions/preserved')).toEqual({ affiliateId: account.id, amount: 150 });
  });

  it.each([
    { passwordHash: 'writer-reset-credential', sessionVersion: '2'.repeat(64) },
    { passwordHash: 'writer-reset-credential' },
    { sessionVersion: '2'.repeat(64) },
    { status: 'suspended' },
    { status: 'pending' },
  ])('refuses to overwrite a concurrent reset, session rotation or status change: %j', async patch => {
    const changed = { ...account, ...patch };
    fake.documents.set(accountKey, changed);
    await expect(affiliateStore.updateAffiliateCredential(account.id, CURRENT_HASH, 'System', expected()))
      .rejects.toMatchObject({ statusCode: 401, code: 'CREDENTIALS_CHANGED' });
    expect(fake.documents.get(accountKey)).toEqual(changed);
    expect(audits()).toHaveLength(0);
    expect(affiliateStore.getAffiliateById(account.id)).toBeUndefined();
  });

  it('refuses a deleted account rather than recreating it', async () => {
    fake.documents.delete(accountKey);
    await expect(affiliateStore.updateAffiliateCredential(account.id, CURRENT_HASH, 'System', expected()))
      .rejects.toMatchObject({ statusCode: 401, code: 'CREDENTIALS_CHANGED' });
    expect(fake.documents.has(accountKey)).toBe(false);
    expect(audits()).toHaveLength(0);
  });

  it.each(['failCommit', 'failAudit'] as const)('does not publish a credential or partial audit after %s', async failure => {
    fake[failure]();
    await expect(affiliateStore.updateAffiliateCredential(account.id, CURRENT_HASH, 'System', expected()))
      .rejects.toMatchObject({ statusCode: 503, message: expect.not.stringContaining('private') });
    expect(fake.documents.get(accountKey)).toEqual(account);
    expect(audits()).toHaveLength(0);
    expect(affiliateStore.getAffiliateById(account.id)).toBeUndefined();
  });

  it('allows only one of two competing migrations against the same verified generation', async () => {
    const result = await Promise.allSettled([
      affiliateStore.updateAffiliateCredential(account.id, CURRENT_HASH, 'System', expected()),
      affiliateStore.updateAffiliateCredential(account.id, CURRENT_HASH, 'System', expected()),
    ]);
    expect(result.filter(item => item.status === 'fulfilled')).toHaveLength(1);
    expect((result.find(item => item.status === 'rejected') as PromiseRejectedResult).reason)
      .toMatchObject({ statusCode: 401, code: 'CREDENTIALS_CHANGED' });
    expect(audits()).toHaveLength(1);
  });

  it('supports a verified legacy account that has no prior session generation', async () => {
    const { sessionVersion: _removed, ...withoutGeneration } = account;
    fake.documents.set(accountKey, withoutGeneration);
    const result = await affiliateStore.updateAffiliateCredential(account.id, CURRENT_HASH, 'System', { passwordHash: LEGACY_HASH });
    expect(result.sessionVersion).toMatch(/^[a-f0-9]{64}$/);
    expect(result.passwordHash).toBe(CURRENT_HASH);
  });

  it('preserves a newer local wallet and credential publication but returns only the exact CAS generation for session verification', async () => {
    await affiliateStore.getAffiliateByIdFresh(account.id);
    const newer = { passwordHash: 'newer-writer-reset', sessionVersion: '3'.repeat(64), walletRevision: 9, balanceAvailableKes: 75 };
    fake.afterCommit(async () => {
      fake.documents.set(accountKey, { ...fake.documents.get(accountKey), ...newer });
      await affiliateStore.getAffiliateByIdFresh(account.id);
    });
    const result = await affiliateStore.updateAffiliateCredential(account.id, CURRENT_HASH, 'System', expected());
    expect(affiliateStore.getAffiliateById(account.id)).toMatchObject(newer);
    expect(result).toMatchObject({ passwordHash: CURRENT_HASH, walletRevision: 4, balanceAvailableKes: 125 });
    expect(result.sessionVersion).not.toBe(newer.sessionVersion);
    expect(fake.documents.get(accountKey)).toMatchObject(newer);
  });
});
