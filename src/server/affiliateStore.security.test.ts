import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => ({
  documents: new Map<string, any>(),
  getDb: vi.fn(),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  getDoc: vi.fn(),
  getAllDocs: vi.fn(),
  deleteDoc: vi.fn(),
  runTransaction: vi.fn()
}));
const notifications = vi.hoisted(() => ({ prepare: vi.fn() }));
vi.mock('./affiliateNotificationEvents.js', () => ({ prepareCommittedAffiliateNotification: notifications.prepare }));

vi.mock('./db.js', () => ({
  getDb: firestore.getDb,
  resolveFirestoreTargetConfig: () => ({ projectId: 'ink-and-witness-narratives', firestoreDatabaseId: '(default)' }),
  getFirestoreClientTarget: (client: unknown) => client === firestore.getDb.mock.results.at(-1)?.value
    ? { projectId: 'ink-and-witness-narratives', firestoreDatabaseId: '(default)' } : null,
  replaceFirestoreDoc: firestore.setDoc,
  setFirestoreDoc: firestore.setDoc,
  updateFirestoreDoc: firestore.updateDoc,
  getFirestoreDoc: firestore.getDoc,
  getAllFirestoreDocs: firestore.getAllDocs,
  deleteFirestoreDoc: firestore.deleteDoc
}));

import { affiliateStore } from './affiliateStore.js';
import {
  createAffiliateSessionVersion,
  getAffiliateSessionDocumentId
} from './affiliateSessionSecurity.js';

const TEST_HASH = '$argon2id$v=19$m=65536,p=1,t=3$c2FsdA$aGFzaA';
const originalVercelEnvironment = process.env.VERCEL;
const originalAffiliateSigningSecret = process.env.AFFILIATE_SESSION_SIGNING_SECRET;

function clone<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

describe('affiliate store credential boundaries', () => {
  beforeAll(async () => {
    process.env.VERCEL = '1';
    process.env.AFFILIATE_SESSION_SIGNING_SECRET = 'affiliate-store-test-secret-with-more-than-thirty-two-characters';
    firestore.documents.clear();
    firestore.documents.set('site_configs/affiliate_settings', {
      defaultCommissionRate: 15,
      minPayoutThresholdKes: 1000,
      defaultAttributionDays: 30,
      allowSelfRegistration: true,
      pieceCommissionOverrides: {}
    });

    firestore.setDoc.mockImplementation(async (collection: string, id: string, value: any) => {
      const key = `${collection}/${id}`;
      firestore.documents.set(key, { ...(firestore.documents.get(key) || {}), ...clone(value) });
    });
    firestore.updateDoc.mockImplementation(async (collection: string, id: string, value: any) => {
      const key = `${collection}/${id}`;
      if (!firestore.documents.has(key)) throw new Error('document not found');
      firestore.documents.set(key, { ...firestore.documents.get(key), ...clone(value) });
    });
    firestore.getDoc.mockImplementation(async (collection: string, id: string) => {
      return clone(firestore.documents.get(`${collection}/${id}`) ?? null);
    });
    firestore.getAllDocs.mockImplementation(async (collection: string) => {
      const prefix = `${collection}/`;
      return Array.from(firestore.documents.entries())
        .filter(([key]) => key.startsWith(prefix))
        .map(([, value]) => clone(value));
    });
    firestore.deleteDoc.mockImplementation(async (collection: string, id: string) => {
      firestore.documents.delete(`${collection}/${id}`);
    });

    const query = (collection: string, filters: Array<[string, unknown]> = [], limitCount = Infinity): any => ({
      collection, filters, limitCount,
      doc: (id: string) => ({ collection, id }),
      where: (field: string, _operator: string, value: unknown) => query(collection, [...filters, [field, value]], limitCount),
      limit: (count: number) => query(collection, filters, count),
    });
    const db = {
      collection: (collection: string) => query(collection),
      runTransaction: firestore.runTransaction
    };
    firestore.runTransaction.mockImplementation(async (operation: (transaction: any) => Promise<any>) => {
      const writes: Array<{ reference: { collection: string; id: string }; value: any; merge?: boolean }> = [];
      const transaction = {
        get: async (reference: { collection: string; id?: string; filters?: Array<[string, unknown]>; limitCount?: number }) => {
          if (reference.filters) return { docs: [...firestore.documents.entries()]
            .filter(([key, value]) => key.startsWith(`${reference.collection}/`) && reference.filters!.every(([field, expected]) => value[field] === expected))
            .slice(0, reference.limitCount).map(([key, value]) => ({ id: key.slice(reference.collection.length + 1), data: () => clone(value) })) };
          const value = firestore.documents.get(`${reference.collection}/${reference.id}`);
          return {
            exists: value !== undefined,
            data: () => clone(value)
          };
        },
        set: (reference: { collection: string; id: string }, value: any, options?: { merge?: boolean }) => {
          writes.push({ reference, value: clone(value), merge: options?.merge });
        },
        create: (reference: { collection: string; id: string }, value: any) => {
          if (firestore.documents.has(`${reference.collection}/${reference.id}`)) throw new Error('already exists');
          writes.push({ reference, value: clone(value), merge: false });
        },
      };
      const result = await operation(transaction);
      for (const write of writes) {
        firestore.documents.set(
          `${write.reference.collection}/${write.reference.id}`,
          { ...(write.merge ? firestore.documents.get(`${write.reference.collection}/${write.reference.id}`) || {} : {}), ...write.value }
        );
      }
      return result;
    });
    firestore.getDb.mockReturnValue(db);
    await affiliateStore.init();
  });

  beforeEach(() => {
    notifications.prepare.mockReset();
    notifications.prepare.mockResolvedValue({ status: 'disabled', intentCount: 0 });
    firestore.setDoc.mockClear();
    firestore.updateDoc.mockClear();
    firestore.getDoc.mockClear();
    firestore.getAllDocs.mockClear();
    firestore.deleteDoc.mockClear();
    firestore.runTransaction.mockClear();
  });

  it('prepares activation only after an explicitly approved active account is durably created', async () => {
    notifications.prepare.mockImplementation(async (input: { db: unknown; kind: string; sourceId: string }) => {
      expect(input.kind).toBe('activation');
      expect(input.db).toBe(firestore.getDb());
      expect(firestore.documents.get(`affiliates/${input.sourceId}`)).toMatchObject({
        status: 'active', approvedBy: 'Writer', approvedAt: '2026-10-24T09:00:00.000Z',
      });
      return { status: 'disabled', intentCount: 0 };
    });
    const created = await affiliateStore.createAffiliate({ name: 'Approved Activation Fixture',
      email: 'approved-activation@example.test', phone: '254700000059', passwordHash: TEST_HASH,
      status: 'active', approvedAt: '2026-10-24T09:00:00.000Z', approvedBy: 'Writer',
    });
    expect(notifications.prepare).toHaveBeenCalledTimes(1);
    expect(notifications.prepare.mock.calls[0][0].sourceId).toBe(created.id);
    notifications.prepare.mockClear();
    await affiliateStore.createAffiliate({ name: 'Pending Activation Fixture', email: 'pending-activation@example.test',
      phone: '254700000058', passwordHash: TEST_HASH, status: 'pending',
    });
    expect(notifications.prepare).not.toHaveBeenCalled();
  });

  afterAll(() => {
    if (originalVercelEnvironment === undefined) {
      delete process.env.VERCEL;
    } else {
      process.env.VERCEL = originalVercelEnvironment;
    }
    if (originalAffiliateSigningSecret === undefined) {
      delete process.env.AFFILIATE_SESSION_SIGNING_SECRET;
    } else {
      process.env.AFFILIATE_SESSION_SIGNING_SECRET = originalAffiliateSigningSecret;
    }
  });

  it('persists a payout threshold before publishing it to the in-memory settings cache', async () => {
    const previousThreshold = affiliateStore.getSettings().minPayoutThresholdKes;
    const nextThreshold = previousThreshold === 2750 ? 2751 : 2750;

    const saved = await affiliateStore.saveSettings({
      minPayoutThresholdKes: nextThreshold
    }, 'Threshold Durability Test');

    expect(saved.minPayoutThresholdKes).toBe(nextThreshold);
    expect(affiliateStore.getSettings().minPayoutThresholdKes).toBe(nextThreshold);
    expect(firestore.documents.get('site_configs/affiliate_settings')).toMatchObject({
      minPayoutThresholdKes: nextThreshold
    });
    expect(firestore.setDoc).toHaveBeenCalledWith(
      'site_configs',
      'affiliate_settings',
      expect.objectContaining({ minPayoutThresholdKes: nextThreshold })
    );

    await affiliateStore.saveSettings({
      minPayoutThresholdKes: previousThreshold
    }, 'Threshold Durability Test Cleanup');
  });

  it('refreshes payout settings from the durable source of truth', async () => {
    const previousSettings = affiliateStore.getSettings();
    const durableThreshold = previousSettings.minPayoutThresholdKes === 4321 ? 4322 : 4321;
    firestore.documents.set('site_configs/affiliate_settings', {
      ...previousSettings,
      minPayoutThresholdKes: durableThreshold
    });

    const fresh = await affiliateStore.getSettingsFresh();

    expect(fresh.minPayoutThresholdKes).toBe(durableThreshold);
    expect(affiliateStore.getSettings().minPayoutThresholdKes).toBe(durableThreshold);

    await affiliateStore.saveSettings(previousSettings, 'Fresh Settings Test Cleanup');
  });

  it('keeps the existing payout threshold when durable settings persistence fails', async () => {
    const before = affiliateStore.getSettings();
    const attemptedThreshold = before.minPayoutThresholdKes === 5555 ? 5556 : 5555;
    firestore.setDoc.mockRejectedValueOnce(new Error('simulated settings write failure'));

    await expect(affiliateStore.saveSettings({
      minPayoutThresholdKes: attemptedThreshold
    }, 'Threshold Failure Test')).rejects.toThrow('simulated settings write failure');

    expect(affiliateStore.getSettings()).toEqual(before);
    expect(firestore.documents.get('site_configs/affiliate_settings')).toMatchObject({
      minPayoutThresholdKes: before.minPayoutThresholdKes
    });
  });

  it('rejects an invalid payout threshold without attempting persistence', async () => {
    const before = affiliateStore.getSettings();

    await expect(affiliateStore.saveSettings({
      minPayoutThresholdKes: 0
    }, 'Threshold Validation Test')).rejects.toThrow(/Minimum payout threshold.*between 1 and 10000000/i);

    expect(affiliateStore.getSettings()).toEqual(before);
    expect(firestore.setDoc).not.toHaveBeenCalled();
  });

  it('enforces the configured payout minimum and prevents duplicate active requests', async () => {
    const previousThreshold = affiliateStore.getSettings().minPayoutThresholdKes;
    const threshold = 750;
    await affiliateStore.saveSettings({ minPayoutThresholdKes: threshold }, 'Payout Enforcement Test');

    const affiliate = await affiliateStore.createAffiliate({
      name: 'Payout Enforcement Affiliate',
      email: 'payout-enforcement@example.test',
      phone: '254700000010',
      passwordHash: TEST_HASH
    });
    firestore.documents.set(`affiliates/${affiliate.id}`, {
      ...firestore.documents.get(`affiliates/${affiliate.id}`), balanceAvailableKes: 2_000, totalCommissionEarnedKes: 2_000,
    });
    for (const index of [1, 2]) firestore.documents.set(`affiliate_commissions/security_payout_${index}`, {
      id: `security_payout_${index}`, affiliateId: affiliate.id, affiliateCode: affiliate.affiliateCode,
      transactionId: `security_tx_${index}`, receiptNumber: `SECURITY${index}`, articleId: 'security_piece',
      articleTitle: 'Security fixture', affiliateName: affiliate.name, status: 'APPROVED',
      commissionAmountKes: 1_000, saleAmountKes: 5_000, commissionRate: 20, grossCreatorRevenueKes: 4_000,
      paymentMethod: 'mpesa', createdAt: `2026-10-0${index}T08:00:00.000Z`,
    });

    await expect(affiliateStore.requestPayout(affiliate.id, threshold - 1)).rejects.toThrow(/at least the configured minimum/i);
    await expect(affiliateStore.requestPayout(affiliate.id, 2_001)).rejects.toThrow(/cannot exceed the available balance/i);
    await expect(affiliateStore.requestPayout(affiliate.id, 0)).rejects.toThrow(/greater than zero/i);
    await expect(affiliateStore.requestPayout(affiliate.id, 1_000.5)).rejects.toThrow(/whole Kenyan-shilling amount/i);

    const payout = await affiliateStore.requestPayout(affiliate.id, 1_250);
    expect(payout.amountKes).toBe(1_250);
    await expect(affiliateStore.requestPayout(affiliate.id, 750)).rejects.toThrow(/already awaiting processing/i);

    await affiliateStore.processPayout(payout.id, 'reject', undefined, 'Test cleanup', 'Payout Enforcement Test');
    await affiliateStore.saveSettings({ minPayoutThresholdKes: previousThreshold }, 'Payout Enforcement Test Cleanup');
  });

  it('does not publish password hashes through list or audit responses', async () => {
    const created = await affiliateStore.createAffiliate({
      name: 'Security Test Affiliate',
      email: 'security-list@example.test',
      phone: '254700000001',
      passwordHash: TEST_HASH
    });

    const listed = affiliateStore.getAffiliates().find(item => item.id === created.id);
    expect(listed).toBeDefined();
    expect(listed).not.toHaveProperty('passwordHash');
    expect(listed).not.toHaveProperty('sessionVersion');

    const dashboard = affiliateStore.getAffiliateDashboard(created.id);
    expect(dashboard?.affiliate).not.toHaveProperty('passwordHash');
    expect(dashboard?.affiliate).not.toHaveProperty('sessionVersion');

    affiliateStore.recordAudit(
      'Test',
      'affiliate_updated',
      'affiliate',
      'Redaction test',
      created.id,
      { passwordHash: 'old-secret', nested: { accessToken: 'old-token', safe: 'kept' } },
      {
        password: 'new-secret',
        sessionVersion: 'private-version',
        nested: { refreshToken: 'new-token', safe: 'kept' }
      }
    );

    const [audit] = affiliateStore.getAuditLogs(1);
    expect(audit.previousValue).toEqual({ nested: { safe: 'kept' } });
    expect(audit.newValue).toEqual({ nested: { safe: 'kept' } });
  });

  it('does not mutate the cache when credential persistence fails', async () => {
    const created = await affiliateStore.createAffiliate({
      name: 'Persistence Test Affiliate',
      email: 'security-persist@example.test',
      phone: '254700000002',
      passwordHash: TEST_HASH
    });
    const replacementHash = '$argon2id$v=19$m=65536,p=1,t=3$bmV3c2FsdA$bmV3aGFzaA';
    firestore.updateDoc.mockRejectedValueOnce(new Error('simulated write failure'));

    await expect(
      affiliateStore.updateAffiliateCredential(created.id, replacementHash, 'Test')
    ).rejects.toThrow('simulated write failure');

    expect(affiliateStore.getAffiliateById(created.id)?.passwordHash).toBe(TEST_HASH);
  });

  it('preserves the account and reserved affiliate identity after reversible removal', async () => {
    const created = await affiliateStore.createAffiliate({
      name: 'Reserved Identity Affiliate',
      email: 'reserved-identity@example.test',
      phone: '254700000099',
      passwordHash: TEST_HASH,
      affiliateCode: 'RESERVED99'
    });
    expect(await affiliateStore.deleteAffiliate(created.id, 'Test')).toBe(true);
    expect(firestore.documents.get(`affiliates/${created.id}`)).toMatchObject({
      id: created.id, status: 'suspended', linksDisabled: true,
      email: created.email, affiliateCode: created.affiliateCode
    });
    expect(firestore.deleteDoc).not.toHaveBeenCalledWith('affiliates', created.id);

    await expect(affiliateStore.createAffiliate({
      name: 'Code Reassignment Attempt',
      email: 'different-reservation@example.test',
      phone: '254700000098',
      passwordHash: TEST_HASH,
      affiliateCode: 'RESERVED99'
    })).rejects.toThrow(/already in use/i);

    await expect(affiliateStore.createAffiliate({
      name: 'Email Reassignment Attempt',
      email: 'reserved-identity@example.test',
      phone: '254700000097',
      passwordHash: TEST_HASH,
      affiliateCode: 'DIFFERENT99'
    })).rejects.toThrow(/already exists/i);
  });

  it('fails closed when the affiliate directory could not be loaded', async () => {
    firestore.getAllDocs.mockRejectedValueOnce(new Error('simulated affiliate directory outage'));
    await affiliateStore.init();

    await expect(affiliateStore.createAffiliate({
      name: 'Unavailable Directory Attempt',
      email: 'directory-outage@example.test',
      phone: '254700000096',
      passwordHash: TEST_HASH,
      affiliateCode: 'OUTAGE96'
    })).rejects.toThrow(/temporarily unavailable/i);

    // Restore the shared fixture for later tests in this file.
    await affiliateStore.init();
  });

  it('persists only credential fields and re-finds the affiliate after an async write', async () => {
    const created = await affiliateStore.createAffiliate({
      name: 'Credential Merge Test Affiliate',
      email: 'security-credential-merge@example.test',
      phone: '254700000006',
      passwordHash: TEST_HASH
    });
    const replacementHash = '$argon2id$v=19$m=65536,p=1,t=3$bmV3c2FsdA$bmV3aGFzaA';
    let releaseCredentialWrite!: () => void;
    firestore.updateDoc.mockImplementationOnce((collection: string, id: string, value: any) => new Promise<void>(resolve => {
      releaseCredentialWrite = () => {
        const key = `${collection}/${id}`;
        firestore.documents.set(key, { ...firestore.documents.get(key), ...clone(value) });
        resolve();
      };
    }));

    const updatePromise = affiliateStore.updateAffiliateCredential(created.id, replacementHash, 'Test');
    await affiliateStore.createAffiliate({
      name: 'Concurrent Create Test Affiliate',
      email: 'security-concurrent-create@example.test',
      phone: '254700000007',
      passwordHash: TEST_HASH
    });
    releaseCredentialWrite();
    const updated = await updatePromise;

    const credentialWrite = firestore.updateDoc.mock.calls.find(call =>
      call[0] === 'affiliates' && call[1] === created.id && call[2]?.passwordHash === replacementHash
    );
    expect(credentialWrite?.[2]).toEqual({
      passwordHash: replacementHash,
      sessionVersion: expect.stringMatching(/^[a-f0-9]{64}$/),
      updatedAt: expect.any(String)
    });
    expect(updated.id).toBe(created.id);
    expect(affiliateStore.getAffiliateById(created.id)?.passwordHash).toBe(replacementHash);
    expect(affiliateStore.getAffiliateByEmail('security-concurrent-create@example.test')?.passwordHash).toBe(TEST_HASH);
  });

  it('ignores credential and reserved identity fields sent through the general profile updater', async () => {
    const created = await affiliateStore.createAffiliate({
      name: 'Patch Test Affiliate',
      email: 'security-patch@example.test',
      phone: '254700000003',
      passwordHash: TEST_HASH
    });

    const updated = await affiliateStore.updateAffiliate(created.id, {
      name: 'Patch Test Affiliate Updated',
      email: 'security-patch-reassigned@example.test',
      affiliateCode: 'REASSIGNED03',
      passwordHash: '$argon2id$attacker-controlled',
      sessionVersion: 'a'.repeat(64)
    });

    expect(updated.name).toBe('Patch Test Affiliate Updated');
    expect(updated.email).toBe(created.email);
    expect(updated.affiliateCode).toBe(created.affiliateCode);
    expect(updated.passwordHash).toBe(TEST_HASH);
    expect(updated.sessionVersion).toBe(created.sessionVersion);
    expect(firestore.runTransaction).toHaveBeenCalled();
    expect(firestore.setDoc).not.toHaveBeenCalledWith('affiliates', created.id, expect.anything());
    expect(firestore.documents.get(`affiliates/${created.id}`)).toMatchObject({
      name: 'Patch Test Affiliate Updated',
      email: created.email,
      affiliateCode: created.affiliateCode
    });
  });

  it('invalidates only the selected affiliate sessions on the current instance', async () => {
    const first = await affiliateStore.createAffiliate({
      name: 'Session Test One',
      email: 'security-session-one@example.test',
      phone: '254700000004',
      passwordHash: TEST_HASH
    });
    const second = await affiliateStore.createAffiliate({
      name: 'Session Test Two',
      email: 'security-session-two@example.test',
      phone: '254700000005',
      passwordHash: TEST_HASH
    });
    const firstToken = await affiliateStore.createAffiliateSession(first);
    const secondToken = await affiliateStore.createAffiliateSession(second);

    firestore.updateDoc.mockClear();
    firestore.getAllDocs.mockClear();
    expect(await affiliateStore.invalidateAffiliateSessions(first.id)).toBe(1);
    expect(firestore.updateDoc).toHaveBeenCalledTimes(1);
    expect(firestore.updateDoc).toHaveBeenCalledWith(
      'affiliates',
      first.id,
      expect.objectContaining({ sessionVersion: expect.stringMatching(/^[a-f0-9]{64}$/) })
    );
    expect(firestore.getAllDocs).not.toHaveBeenCalled();
    expect(await affiliateStore.verifyAffiliateSession(firstToken)).toBeNull();
    expect((await affiliateStore.verifyAffiliateSession(secondToken))?.id).toBe(second.id);
  });

  it('stores only a hashed session id and resolves it across a fresh runtime cache', async () => {
    const created = await affiliateStore.createAffiliate({
      name: 'Durable Session Affiliate',
      email: 'security-durable-session@example.test',
      phone: '254700000011',
      passwordHash: TEST_HASH
    });
    const token = await affiliateStore.createAffiliateSession(created);
    const documentId = getAffiliateSessionDocumentId(token)!;
    const stored = firestore.documents.get(`affiliate_sessions/${documentId}`);

    expect(documentId).toMatch(/^v2_[a-f0-9]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(stored).toMatchObject({
      storageVersion: 2,
      affiliateId: created.id,
      sessionVersion: created.sessionVersion
    });
    expect(stored).not.toHaveProperty('token');
    expect(stored).not.toHaveProperty('sessionId');

    await affiliateStore.init();
    expect(firestore.getAllDocs.mock.calls.some(call => call[0] === 'affiliate_sessions')).toBe(false);
    firestore.getDoc.mockClear();

    const verified = await affiliateStore.verifyAffiliateSession(token);
    expect(verified?.id).toBe(created.id);
    expect(firestore.getDoc.mock.calls).toEqual([
      ['affiliate_sessions', documentId],
      ['affiliates', created.id]
    ]);
  });

  it('rejects forged and legacy affiliate cookies before any database read', async () => {
    firestore.getDoc.mockClear();
    const forged = `aff_sess_v2_${'a'.repeat(64)}_${'b'.repeat(64)}`;

    expect(await affiliateStore.verifyAffiliateSession(forged)).toBeNull();
    expect(await affiliateStore.verifyAffiliateSession(`aff_sess_${Date.now()}_${'c'.repeat(48)}`)).toBeNull();
    expect(firestore.getDoc).not.toHaveBeenCalled();
  });

  it('deduplicates concurrent shared lookups and force-refreshes mutations', async () => {
    const created = await affiliateStore.createAffiliate({
      name: 'Concurrent Lookup Affiliate',
      email: 'security-session-dedupe@example.test',
      phone: '254700000012',
      passwordHash: TEST_HASH
    });
    const token = await affiliateStore.createAffiliateSession(created);
    await affiliateStore.init();
    firestore.getDoc.mockClear();

    const results = await Promise.all(Array.from({ length: 8 }, () => affiliateStore.verifyAffiliateSession(token)));
    expect(results.every(result => result?.id === created.id)).toBe(true);
    expect(firestore.getDoc).toHaveBeenCalledTimes(2);

    firestore.getDoc.mockClear();
    expect((await affiliateStore.verifyAffiliateSession(token))?.id).toBe(created.id);
    expect(firestore.getDoc).not.toHaveBeenCalled();

    expect((await affiliateStore.verifyAffiliateSession(token, { forceFresh: true }))?.id).toBe(created.id);
    expect(firestore.getDoc).toHaveBeenCalledTimes(2);
  });

  it('prevents a stale authenticated snapshot from issuing a session after rotation', async () => {
    const created = await affiliateStore.createAffiliate({
      name: 'Issuance Race Affiliate',
      email: 'security-issuance-race@example.test',
      phone: '254700000013',
      passwordHash: TEST_HASH
    });
    const accountKey = `affiliates/${created.id}`;
    firestore.documents.set(accountKey, {
      ...firestore.documents.get(accountKey),
      sessionVersion: createAffiliateSessionVersion()
    });
    const sessionCountBefore = Array.from(firestore.documents.keys())
      .filter(key => key.startsWith('affiliate_sessions/')).length;

    await expect(affiliateStore.createAffiliateSession(created)).rejects.toThrow('credentials changed');
    const sessionCountAfter = Array.from(firestore.documents.keys())
      .filter(key => key.startsWith('affiliate_sessions/')).length;
    expect(sessionCountAfter).toBe(sessionCountBefore);
  });

  it('does not cache a session when its transactional write fails', async () => {
    const created = await affiliateStore.createAffiliate({
      name: 'Session Write Failure Affiliate',
      email: 'security-session-write-failure@example.test',
      phone: '254700000016',
      passwordHash: TEST_HASH
    });
    const sessionCountBefore = Array.from(firestore.documents.keys())
      .filter(key => key.startsWith('affiliate_sessions/')).length;
    firestore.runTransaction.mockRejectedValueOnce(new Error('simulated session transaction failure'));

    await expect(affiliateStore.createAffiliateSession(created)).rejects.toThrow('simulated session transaction failure');
    const sessionCountAfter = Array.from(firestore.documents.keys())
      .filter(key => key.startsWith('affiliate_sessions/')).length;
    expect(sessionCountAfter).toBe(sessionCountBefore);
  });

  it('revalidates a cached GET session within 60 seconds and removes a remotely revoked record', async () => {
    let now = Date.now();
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const created = await affiliateStore.createAffiliate({
        name: 'Timed Revalidation Affiliate',
        email: 'security-session-revalidation@example.test',
        phone: '254700000017',
        passwordHash: TEST_HASH
      });
      const token = await affiliateStore.createAffiliateSession(created);
      const documentId = getAffiliateSessionDocumentId(token)!;

      firestore.documents.set(`affiliates/${created.id}`, {
        ...firestore.documents.get(`affiliates/${created.id}`),
        sessionVersion: createAffiliateSessionVersion()
      });
      firestore.getDoc.mockClear();
      expect((await affiliateStore.verifyAffiliateSession(token))?.id).toBe(created.id);
      expect(firestore.getDoc).not.toHaveBeenCalled();

      now += 60_001;
      firestore.deleteDoc.mockClear();
      expect(await affiliateStore.verifyAffiliateSession(token)).toBeNull();
      expect(firestore.getDoc).toHaveBeenCalledTimes(2);
      expect(firestore.deleteDoc).toHaveBeenCalledWith('affiliate_sessions', documentId);
      expect(firestore.documents.has(`affiliate_sessions/${documentId}`)).toBe(false);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('does not let an in-flight stale lookup repopulate the cache after rotation', async () => {
    const created = await affiliateStore.createAffiliate({
      name: 'Lookup Rotation Race Affiliate',
      email: 'security-lookup-race@example.test',
      phone: '254700000014',
      passwordHash: TEST_HASH
    });
    const token = await affiliateStore.createAffiliateSession(created);
    const documentId = getAffiliateSessionDocumentId(token)!;
    const sessionValue = clone(firestore.documents.get(`affiliate_sessions/${documentId}`));
    const staleAffiliate = clone(firestore.documents.get(`affiliates/${created.id}`));

    await affiliateStore.init();
    let releaseAffiliateRead!: () => void;
    let signalAffiliateRead!: () => void;
    const affiliateReadStarted = new Promise<void>(resolve => {
      signalAffiliateRead = resolve;
    });
    firestore.getDoc
      .mockImplementationOnce(async () => sessionValue)
      .mockImplementationOnce(() => new Promise(resolve => {
        releaseAffiliateRead = () => resolve(staleAffiliate);
        signalAffiliateRead();
      }));

    const lookup = affiliateStore.verifyAffiliateSession(token);
    await affiliateReadStarted;
    await affiliateStore.invalidateAffiliateSessions(created.id);
    releaseAffiliateRead();

    expect(await lookup).toBeNull();
    firestore.getDoc.mockClear();
    expect(await affiliateStore.verifyAffiliateSession(token)).toBeNull();
    expect(firestore.getDoc).not.toHaveBeenCalled();
  });

  it('fails closed in the current runtime when durable logout deletion fails', async () => {
    const created = await affiliateStore.createAffiliate({
      name: 'Logout Failure Affiliate',
      email: 'security-logout-failure@example.test',
      phone: '254700000015',
      passwordHash: TEST_HASH
    });
    const token = await affiliateStore.createAffiliateSession(created);
    firestore.deleteDoc.mockRejectedValueOnce(new Error('simulated delete failure'));

    await expect(affiliateStore.invalidateAffiliateSession(token)).rejects.toThrow('simulated delete failure');
    firestore.getDoc.mockClear();
    expect(await affiliateStore.verifyAffiliateSession(token)).toBeNull();
    expect(firestore.getDoc).not.toHaveBeenCalled();
  });

  it('updates status in the cache, rejects invalid states, and revokes non-active sessions', async () => {
    const created = await affiliateStore.createAffiliate({
      name: 'Status Test Affiliate',
      email: 'security-status@example.test',
      phone: '254700000008',
      passwordHash: TEST_HASH
    });
    const token = await affiliateStore.createAffiliateSession(created);

    await expect(affiliateStore.setAffiliateStatus(created.id, 'invalid' as any)).rejects.toThrow('Invalid affiliate status');
    const pending = await affiliateStore.setAffiliateStatus(created.id, 'pending');

    expect(pending.status).toBe('pending');
    expect(affiliateStore.getAffiliateById(created.id)?.status).toBe('pending');
    expect(await affiliateStore.verifyAffiliateSession(token)).toBeNull();
    const statusWrite = firestore.updateDoc.mock.calls.find(call =>
      call[0] === 'affiliates' && call[1] === created.id && call[2]?.status === 'pending'
    );
    expect(statusWrite?.[2]).not.toHaveProperty('passwordHash');
  });

  it('keeps an active account and session unchanged when status persistence fails', async () => {
    const created = await affiliateStore.createAffiliate({
      name: 'Status Persistence Test Affiliate',
      email: 'security-status-failure@example.test',
      phone: '254700000009',
      passwordHash: TEST_HASH
    });
    const token = await affiliateStore.createAffiliateSession(created);
    firestore.updateDoc.mockRejectedValueOnce(new Error('simulated status write failure'));

    await expect(affiliateStore.setAffiliateStatus(created.id, 'suspended')).rejects.toThrow('simulated status write failure');
    expect(affiliateStore.getAffiliateById(created.id)?.status).toBe('active');
    expect((await affiliateStore.verifyAffiliateSession(token))?.id).toBe(created.id);
  });

  it('refreshes the shared credential and status by document id before authentication', async () => {
    const created = await affiliateStore.createAffiliate({
      name: 'Fresh Credential Test Affiliate',
      email: 'security-fresh-credential@example.test',
      phone: '254700000010',
      passwordHash: TEST_HASH
    });
    const replacementHash = '$argon2id$v=19$m=65536,p=1,t=3$ZnJlc2hzYWx0$ZnJlc2hoYXNo';
    firestore.getDoc.mockResolvedValueOnce({
      ...created,
      status: 'pending',
      passwordHash: replacementHash
    });

    const refreshed = await affiliateStore.getAffiliateByIdFresh(created.id);

    expect(refreshed?.status).toBe('pending');
    expect(refreshed?.passwordHash).toBe(replacementHash);
    expect(affiliateStore.getAffiliateById(created.id)?.passwordHash).toBe(replacementHash);
  });
});
