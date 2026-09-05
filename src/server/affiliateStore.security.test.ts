import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => ({
  setDoc: vi.fn(),
  getDoc: vi.fn(),
  getAllDocs: vi.fn(),
  deleteDoc: vi.fn()
}));

vi.mock('./db.js', () => ({
  getDb: vi.fn(),
  setFirestoreDoc: firestore.setDoc,
  getFirestoreDoc: firestore.getDoc,
  getAllFirestoreDocs: firestore.getAllDocs,
  deleteFirestoreDoc: firestore.deleteDoc
}));

import { affiliateStore } from './affiliateStore.js';

const TEST_HASH = '$argon2id$v=19$m=65536,p=1,t=3$c2FsdA$aGFzaA';
const originalVercelEnvironment = process.env.VERCEL;

describe('affiliate store credential boundaries', () => {
  beforeAll(async () => {
    process.env.VERCEL = '1';
    firestore.getDoc.mockResolvedValue({
      defaultCommissionRate: 15,
      minPayoutThresholdKes: 1000,
      defaultAttributionDays: 30,
      allowSelfRegistration: true,
      pieceCommissionOverrides: {}
    });
    firestore.getAllDocs.mockResolvedValue([]);
    firestore.setDoc.mockResolvedValue(undefined);
    firestore.deleteDoc.mockResolvedValue(undefined);
    await affiliateStore.init();
  });

  beforeEach(() => {
    firestore.setDoc.mockClear();
    firestore.setDoc.mockResolvedValue(undefined);
  });

  afterAll(() => {
    if (originalVercelEnvironment === undefined) {
      delete process.env.VERCEL;
    } else {
      process.env.VERCEL = originalVercelEnvironment;
    }
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

    affiliateStore.recordAudit(
      'Test',
      'affiliate_updated',
      'affiliate',
      'Redaction test',
      created.id,
      { passwordHash: 'old-secret', nested: { accessToken: 'old-token', safe: 'kept' } },
      { password: 'new-secret', nested: { refreshToken: 'new-token', safe: 'kept' } }
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
    firestore.setDoc.mockRejectedValueOnce(new Error('simulated write failure'));

    await expect(
      affiliateStore.updateAffiliateCredential(created.id, replacementHash, 'Test')
    ).rejects.toThrow('simulated write failure');

    expect(affiliateStore.getAffiliateById(created.id)?.passwordHash).toBe(TEST_HASH);
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
    firestore.setDoc.mockImplementationOnce(() => new Promise<void>(resolve => {
      releaseCredentialWrite = resolve;
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

    const credentialWrite = firestore.setDoc.mock.calls.find(call =>
      call[0] === 'affiliates' && call[1] === created.id && call[2]?.passwordHash === replacementHash
    );
    expect(credentialWrite?.[2]).toEqual({
      passwordHash: replacementHash,
      updatedAt: expect.any(String)
    });
    expect(updated.id).toBe(created.id);
    expect(affiliateStore.getAffiliateById(created.id)?.passwordHash).toBe(replacementHash);
    expect(affiliateStore.getAffiliateByEmail('security-concurrent-create@example.test')?.passwordHash).toBe(TEST_HASH);
  });

  it('ignores credential fields sent through the general profile updater', async () => {
    const created = await affiliateStore.createAffiliate({
      name: 'Patch Test Affiliate',
      email: 'security-patch@example.test',
      phone: '254700000003',
      passwordHash: TEST_HASH
    });

    const updated = affiliateStore.updateAffiliate(created.id, {
      name: 'Patch Test Affiliate Updated',
      passwordHash: '$argon2id$attacker-controlled'
    });

    expect(updated.name).toBe('Patch Test Affiliate Updated');
    expect(updated.passwordHash).toBe(TEST_HASH);
    const profileWrite = firestore.setDoc.mock.calls.find(call =>
      call[0] === 'affiliates' && call[1] === created.id && call[2]?.name === updated.name
    );
    expect(profileWrite?.[2]).not.toHaveProperty('passwordHash');
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
    const firstToken = affiliateStore.createAffiliateSession(first.id);
    const secondToken = affiliateStore.createAffiliateSession(second.id);

    expect(affiliateStore.invalidateAffiliateSessions(first.id)).toBe(1);
    expect(affiliateStore.verifyAffiliateSession(firstToken)).toBeNull();
    expect(affiliateStore.verifyAffiliateSession(secondToken)?.id).toBe(second.id);
  });

  it('updates status in the cache, rejects invalid states, and revokes non-active sessions', async () => {
    const created = await affiliateStore.createAffiliate({
      name: 'Status Test Affiliate',
      email: 'security-status@example.test',
      phone: '254700000008',
      passwordHash: TEST_HASH
    });
    const token = affiliateStore.createAffiliateSession(created.id);

    await expect(affiliateStore.setAffiliateStatus(created.id, 'invalid' as any)).rejects.toThrow('Invalid affiliate status');
    const pending = await affiliateStore.setAffiliateStatus(created.id, 'pending');

    expect(pending.status).toBe('pending');
    expect(affiliateStore.getAffiliateById(created.id)?.status).toBe('pending');
    expect(affiliateStore.verifyAffiliateSession(token)).toBeNull();
    const statusWrite = firestore.setDoc.mock.calls.find(call =>
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
    const token = affiliateStore.createAffiliateSession(created.id);
    firestore.setDoc.mockRejectedValueOnce(new Error('simulated status write failure'));

    await expect(affiliateStore.setAffiliateStatus(created.id, 'suspended')).rejects.toThrow('simulated status write failure');
    expect(affiliateStore.getAffiliateById(created.id)?.status).toBe('active');
    expect(affiliateStore.verifyAffiliateSession(token)?.id).toBe(created.id);
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
