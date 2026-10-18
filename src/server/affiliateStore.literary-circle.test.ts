import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => ({
  documents: new Map<string, any>(),
  getDb: vi.fn(),
  replaceDoc: vi.fn(),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  getDoc: vi.fn(),
  getAllDocs: vi.fn(),
  deleteDoc: vi.fn(),
  runTransaction: vi.fn()
}));

vi.mock('./db.js', () => ({
  getDb: firestore.getDb,
  replaceFirestoreDoc: firestore.replaceDoc,
  setFirestoreDoc: firestore.setDoc,
  updateFirestoreDoc: firestore.updateDoc,
  getFirestoreDoc: firestore.getDoc,
  getAllFirestoreDocs: firestore.getAllDocs,
  deleteFirestoreDoc: firestore.deleteDoc
}));

import { affiliateStore, LiteraryCircleSettingsConflictError } from './affiliateStore.js';
import { DEFAULT_LITERARY_CIRCLE_SETTINGS } from './literaryCircle.js';
import type { AffiliateAccount, AffiliateSaleCommission, LiteraryCircleSettings } from '../types.js';

const TEST_HASH = '$argon2id$v=19$m=65536,p=1,t=3$c2FsdA$aGFzaA';
const originalVercelEnvironment = process.env.VERCEL;

function clone<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function commission(
  id: string,
  affiliate: AffiliateAccount,
  status: AffiliateSaleCommission['status'] = 'APPROVED'
): AffiliateSaleCommission {
  return {
    id,
    orderId: `order-${id}`,
    affiliateId: affiliate.id,
    affiliateCode: affiliate.affiliateCode,
    affiliateName: affiliate.name,
    transactionId: `transaction-${id}`,
    receiptNumber: `receipt-${id}`,
    articleId: `piece-${id}`,
    articleTitle: `Piece ${id}`,
    saleAmountKes: 500,
    commissionRate: 15,
    commissionAmountKes: 75,
    grossCreatorRevenueKes: 425,
    paymentMethod: 'mpesa',
    status,
    createdAt: new Date().toISOString()
  };
}

describe('affiliate store Literary Circle integration', () => {
  beforeEach(async () => {
    process.env.VERCEL = '1';
    firestore.documents.clear();
    firestore.documents.set('site_configs/affiliate_settings', {
      defaultCommissionRate: 15,
      minPayoutThresholdKes: 1000,
      defaultAttributionDays: 30,
      allowTipsCommission: false,
      autoApproveCommissions: true,
      autoApproveDelayHours: 0,
      enablePublicLeaderboard: false,
      allowSelfRegistration: true,
      pieceCommissionOverrides: {}
    });
    firestore.documents.set(
      'site_configs/affiliate_literary_circle',
      clone(DEFAULT_LITERARY_CIRCLE_SETTINGS)
    );

    firestore.setDoc.mockReset();
    firestore.replaceDoc.mockReset();
    firestore.updateDoc.mockReset();
    firestore.getDoc.mockReset();
    firestore.getAllDocs.mockReset();
    firestore.deleteDoc.mockReset();
    firestore.runTransaction.mockReset();

    firestore.setDoc.mockImplementation(async (collection: string, id: string, value: any) => {
      const key = `${collection}/${id}`;
      firestore.documents.set(key, { ...(firestore.documents.get(key) || {}), ...clone(value) });
    });
    firestore.replaceDoc.mockImplementation(async (collection: string, id: string, value: any) => {
      firestore.documents.set(`${collection}/${id}`, clone(value));
    });
    firestore.updateDoc.mockImplementation(async (collection: string, id: string, value: any) => {
      const key = `${collection}/${id}`;
      if (!firestore.documents.has(key)) throw new Error('document not found');
      firestore.documents.set(key, { ...firestore.documents.get(key), ...clone(value) });
    });
    firestore.getDoc.mockImplementation(async (collection: string, id: string) => (
      clone(firestore.documents.get(`${collection}/${id}`) ?? null)
    ));
    firestore.getAllDocs.mockImplementation(async (collection: string) => {
      const prefix = `${collection}/`;
      return Array.from(firestore.documents.entries())
        .filter(([key]) => key.startsWith(prefix))
        .map(([, value]) => clone(value));
    });
    firestore.deleteDoc.mockImplementation(async (collection: string, id: string) => {
      firestore.documents.delete(`${collection}/${id}`);
    });

    const db = {
      collection: (collection: string) => ({
        doc: (id: string) => ({ collection, id })
      }),
      runTransaction: firestore.runTransaction
    };
    firestore.runTransaction.mockImplementation(async (operation: (transaction: any) => Promise<any>) => {
      const writes: Array<{
        reference: { collection: string; id: string };
        value: any;
        merge: boolean;
      }> = [];
      const transaction = {
        get: async (reference: { collection: string; id: string }) => {
          const value = firestore.documents.get(`${reference.collection}/${reference.id}`);
          return {
            exists: value !== undefined,
            data: () => clone(value)
          };
        },
        set: (
          reference: { collection: string; id: string },
          value: any,
          options?: { merge?: boolean }
        ) => {
          writes.push({ reference, value: clone(value), merge: options?.merge === true });
        },
        update: (reference: { collection: string; id: string }, value: any) => {
          writes.push({ reference, value: clone(value), merge: true });
        }
      };
      const result = await operation(transaction);
      for (const write of writes) {
        const key = `${write.reference.collection}/${write.reference.id}`;
        firestore.documents.set(
          key,
          write.merge ? { ...(firestore.documents.get(key) || {}), ...write.value } : write.value
        );
      }
      return result;
    });
    firestore.getDb.mockReturnValue(db);
    await affiliateStore.init();
  });

  afterAll(() => {
    if (originalVercelEnvironment === undefined) {
      delete process.env.VERCEL;
    } else {
      process.env.VERCEL = originalVercelEnvironment;
    }
  });

  it('loads, refreshes and persist-first saves a separately validated policy document', async () => {
    expect(affiliateStore.getLiteraryCircleSettings().defaultTierId).toBe('literary-partner');

    const durable = clone(DEFAULT_LITERARY_CIRCLE_SETTINGS);
    durable.introductoryPeriodDays = 45;
    firestore.documents.set('site_configs/affiliate_literary_circle', durable);
    expect((await affiliateStore.getLiteraryCircleSettingsFresh()).introductoryPeriodDays).toBe(45);

    const beforeFailure = affiliateStore.getLiteraryCircleSettings();
    firestore.runTransaction.mockRejectedValueOnce(new Error('simulated Literary Circle write failure'));
    await expect(affiliateStore.saveLiteraryCircleSettings({
      ...beforeFailure,
      introductoryPeriodDays: 60
    }, 'Circle Settings Test')).rejects.toThrow('simulated Literary Circle write failure');
    expect(affiliateStore.getLiteraryCircleSettings()).toEqual(beforeFailure);

    const versioned = await affiliateStore.saveLiteraryCircleSettings({
      ...beforeFailure,
      tiers: beforeFailure.tiers.map((tier, index) => index === 0
        ? { ...tier, proposedCommissionRate: 16 }
        : tier)
    }, 'Circle Settings Test');
    expect(versioned.commissionPolicy.version).toBe(beforeFailure.commissionPolicy.version + 1);
    expect(versioned.commissionPolicy.status).toBe('draft');

    const withInvite = await affiliateStore.saveLiteraryCircleSettings({
      ...versioned,
      community: {
        ...versioned.community,
        enabled: true,
        whatsappInviteUrl: 'https://whatsapp.com/channel/0029Vexample',
        posts: [{
          id: 'launch-note',
          type: 'announcement',
          title: 'Welcome note',
          body: 'Private guidance for approved affiliates.',
          isPublished: true,
          order: 0
        }]
      }
    }, 'Circle Settings Test');
    expect(firestore.documents.get('site_configs/affiliate_literary_circle').community.whatsappInviteUrl)
      .toContain('whatsapp.com');
    expect(firestore.documents.get('site_configs/affiliate_literary_circle').community.posts)
      .toMatchObject([{ id: 'launch-note', isPublished: true }]);
    await affiliateStore.saveLiteraryCircleSettings({
      ...withInvite,
      community: {
        ...withInvite.community,
        enabled: false,
        whatsappInviteUrl: undefined
      }
    }, 'Circle Settings Test');
    expect(firestore.documents.get('site_configs/affiliate_literary_circle').community)
      .not.toHaveProperty('whatsappInviteUrl');
    expect(firestore.documents.get('site_configs/affiliate_literary_circle').community.posts)
      .toMatchObject([{ id: 'launch-note' }]);

    await expect(affiliateStore.saveLiteraryCircleSettings({
      ...beforeFailure,
      tiers: []
    } as LiteraryCircleSettings, 'Circle Settings Test')).rejects.toThrow(/between 1 and 12/i);
  });

  it('atomically rejects a stale full-document save so removed private posts cannot return', async () => {
    const initial = await affiliateStore.getLiteraryCircleSettingsFresh();
    const first = await affiliateStore.saveLiteraryCircleSettings({
      ...initial,
      community: {
        ...initial.community,
        enabled: true,
        posts: [{
          id: 'private-note',
          type: 'announcement',
          title: 'Private note',
          body: 'Approved affiliate guidance.',
          isPublished: true,
          order: 0
        }]
      }
    }, 'First Writer Tab');
    const second = await affiliateStore.saveLiteraryCircleSettings({
      ...first,
      community: {
        ...first.community,
        posts: []
      }
    }, 'Second Writer Tab');

    expect(second.revision).toBe((first.revision || 0) + 1);
    await expect(affiliateStore.saveLiteraryCircleSettings({
      ...first,
      community: {
        ...first.community,
        description: 'A stale tab must not restore the deleted post.'
      }
    }, 'Stale Writer Tab')).rejects.toBeInstanceOf(LiteraryCircleSettingsConflictError);
    expect(firestore.documents.get('site_configs/affiliate_literary_circle').community.posts).toEqual([]);
    expect(affiliateStore.getLiteraryCircleSettings().community.posts).toEqual([]);
  });

  it('does not let a delayed older Firestore read regress the cache after a writer save', async () => {
    const staleSnapshot = clone(await affiliateStore.getLiteraryCircleSettingsFresh());
    let finishStaleRead!: (value: LiteraryCircleSettings) => void;
    const staleRead = new Promise<LiteraryCircleSettings>(resolve => {
      finishStaleRead = resolve;
    });
    firestore.getDoc.mockImplementationOnce(() => staleRead);

    const pendingRefresh = affiliateStore.getLiteraryCircleSettingsFresh();
    const saved = await affiliateStore.saveLiteraryCircleSettings({
      ...staleSnapshot,
      community: {
        ...staleSnapshot.community,
        enabled: true,
        posts: [{
          id: 'newer-note',
          type: 'announcement',
          title: 'Newer note',
          body: 'This revision must remain authoritative.',
          isPublished: true,
          order: 0
        }]
      }
    }, 'Concurrent Writer Save');

    finishStaleRead(staleSnapshot);
    const refreshed = await pendingRefresh;

    expect(refreshed.revision).toBe(saved.revision);
    expect(refreshed.community.posts).toMatchObject([{ id: 'newer-note' }]);
    expect(affiliateStore.getLiteraryCircleSettings()).toEqual(refreshed);
  });

  it('preserves bulletin posts for compatible legacy saves that omit the new posts field', async () => {
    const initial = await affiliateStore.getLiteraryCircleSettingsFresh();
    const withPost = await affiliateStore.saveLiteraryCircleSettings({
      ...initial,
      community: {
        ...initial.community,
        posts: [{
          id: 'preserved-note',
          type: 'announcement',
          title: 'Preserve me',
          body: 'An older editor must not erase this post.',
          isPublished: false,
          order: 0
        }]
      }
    }, 'Current Writer Client');
    const { posts: _posts, ...legacyCommunity } = withPost.community;

    const legacySaved = await affiliateStore.saveLiteraryCircleSettings({
      ...withPost,
      community: {
        ...legacyCommunity,
        description: 'Updated by a compatible older editor.'
      }
    }, 'Legacy Writer Client');

    expect(legacySaved.community.description).toContain('compatible older editor');
    expect(legacySaved.community.posts).toMatchObject([{ id: 'preserved-note' }]);
    await expect(affiliateStore.saveLiteraryCircleSettings({
      ...legacySaved,
      community: null
    } as unknown as LiteraryCircleSettings, 'Malformed Writer Client')).rejects.toThrow(/community settings must be provided as an object/i);
    expect(firestore.documents.get('site_configs/affiliate_literary_circle').community.posts)
      .toMatchObject([{ id: 'preserved-note' }]);
  });

  it('appends immutable effective-dated snapshots for each confirmed active policy lifecycle change', async () => {
    const current = affiliateStore.getLiteraryCircleSettings();
    const firstEffectiveAt = new Date(Date.now() + 60 * 60_000).toISOString();
    const first = await affiliateStore.saveLiteraryCircleSettings({
      ...current,
      commissionPolicy: {
        ...current.commissionPolicy,
        status: 'active',
        effectiveAt: firstEffectiveAt
      }
    }, 'Circle Policy Test');
    expect(first.commissionPolicyHistory).toMatchObject([{
      version: current.commissionPolicy.version + 1,
      status: 'active',
      effectiveAt: firstEffectiveAt,
      confirmedBy: 'Circle Policy Test'
    }]);

    const secondEffectiveAt = new Date(Date.now() + 2 * 60 * 60_000).toISOString();
    const second = await affiliateStore.saveLiteraryCircleSettings({
      ...first,
      tiers: first.tiers.map((tier, index) => index === 0
        ? { ...tier, proposedCommissionRate: 17 }
        : tier),
      commissionPolicy: {
        ...first.commissionPolicy,
        effectiveAt: secondEffectiveAt
      }
    }, 'Circle Policy Test');
    expect(second.commissionPolicyHistory?.map(snapshot => snapshot.version)).toEqual([
      first.commissionPolicy.version,
      second.commissionPolicy.version
    ]);
    expect(second.commissionPolicyHistory?.[0].tiers[0].proposedCommissionRate).toBe(15);
    expect(second.commissionPolicyHistory?.[1].tiers[0].proposedCommissionRate).toBe(17);

    const deactivated = await affiliateStore.saveLiteraryCircleSettings({
      ...second,
      commissionPolicy: {
        status: 'draft',
        version: second.commissionPolicy.version,
        subscriptionRenewalsEligible: false
      }
    }, 'Circle Policy Test');
    expect(deactivated.commissionPolicyHistory?.at(-1)).toMatchObject({
      version: deactivated.commissionPolicy.version,
      status: 'draft',
      confirmedBy: 'Circle Policy Test'
    });
  });

  it('refuses to publish a newly changed active policy with a retroactive effective date', async () => {
    const current = affiliateStore.getLiteraryCircleSettings();
    await expect(affiliateStore.saveLiteraryCircleSettings({
      ...current,
      commissionPolicy: {
        ...current.commissionPolicy,
        status: 'active',
        effectiveAt: new Date(Date.now() - 24 * 60 * 60_000).toISOString()
      }
    }, 'Circle Policy Test')).rejects.toThrow(/current or future effective date/i);
    expect(affiliateStore.getLiteraryCircleSettings().commissionPolicy.status).toBe('draft');
  });

  it('provisions new affiliates and keeps each dashboard summary scoped to its own verified sales', async () => {
    const first = await affiliateStore.createAffiliate({
      name: 'First Circle Affiliate',
      email: 'circle-first@example.test',
      phone: '254700000101',
      passwordHash: TEST_HASH
    });
    const second = await affiliateStore.createAffiliate({
      name: 'Second Circle Affiliate',
      email: 'circle-second@example.test',
      phone: '254700000102',
      passwordHash: TEST_HASH
    });

    expect(first.literaryCircle).toMatchObject({
      foundingMember: false,
      complimentaryAccess: { status: 'active', scope: 'all_published' },
      onboarding: { audience: 'new_affiliate', status: 'not_started' }
    });

    firestore.documents.set('affiliate_commissions/first-sale', commission('first-sale', first));
    firestore.documents.set('affiliate_commissions/second-sale', commission('second-sale', second));
    await affiliateStore.init();

    expect(affiliateStore.getAffiliateDashboard(first.id)?.literaryCircle).toMatchObject({
      monthlyVerifiedSales: 1,
      lifetimeVerifiedSales: 1
    });
    expect(affiliateStore.getAffiliateDashboard(second.id)?.literaryCircle).toMatchObject({
      monthlyVerifiedSales: 1,
      lifetimeVerifiedSales: 1
    });

    const summary = affiliateStore.getAdminAffiliatesSummary();
    expect(summary.affiliatesWithLifetimeSales).toBe(2);
    expect(summary.affiliatesWithoutSales).toBe(0);
    expect(summary.literaryCircleSettings?.defaultTierId).toBe('literary-partner');
  });

  it('atomically updates access, manual tier and additive founding recognition', async () => {
    const created = await affiliateStore.createAffiliate({
      name: 'Managed Circle Affiliate',
      email: 'circle-managed@example.test',
      phone: '254700000103',
      passwordHash: TEST_HASH
    });

    const updated = await affiliateStore.updateLiteraryCircleMembership(created.id, {
      complimentaryAccessStatus: 'suspended',
      complimentaryAccessReason: 'Writer review',
      manualTierId: 'literary-ambassador',
      foundingMember: true
    }, 'Circle Admin');
    expect(updated.literaryCircle).toMatchObject({
      foundingMember: true,
      complimentaryAccess: { status: 'suspended', reason: 'Writer review' },
      tier: { id: 'literary-ambassador', source: 'manual' }
    });
    expect(firestore.documents.get(`affiliates/${created.id}`).literaryCircle).toMatchObject({
      foundingMember: true,
      complimentaryAccess: { status: 'suspended' }
    });

    await affiliateStore.updateLiteraryCircleMembership(created.id, {
      complimentaryAccessStatus: 'active',
      complimentaryAccessReason: ''
    }, 'Circle Admin');
    expect(firestore.documents.get(`affiliates/${created.id}`).literaryCircle.complimentaryAccess)
      .not.toHaveProperty('reason');

    await affiliateStore.updateLiteraryCircleMembership(
      created.id,
      { foundingMember: false } as any,
      'Untrusted Legacy Client'
    );
    expect(affiliateStore.getAffiliateById(created.id)?.literaryCircle?.foundingMember).toBe(true);

    const beforeFailure = affiliateStore.getAffiliateById(created.id);
    firestore.runTransaction.mockRejectedValueOnce(new Error('simulated membership write failure'));
    await expect(affiliateStore.updateLiteraryCircleMembership(created.id, {
      complimentaryAccessStatus: 'revoked'
    }, 'Circle Admin')).rejects.toThrow('simulated membership write failure');
    expect(affiliateStore.getAffiliateById(created.id)?.literaryCircle).toEqual(beforeFailure?.literaryCircle);
  });

  it('persists onboarding progress and force-refreshes access revocation checks', async () => {
    const created = await affiliateStore.createAffiliate({
      name: 'Onboarding Circle Affiliate',
      email: 'circle-onboarding@example.test',
      phone: '254700000104',
      passwordHash: TEST_HASH
    });

    const progressed = await affiliateStore.updateLiteraryCircleOnboarding(created.id, {
      completedStepId: 'welcome'
    }, 'Affiliate');
    expect(progressed.literaryCircle?.onboarding).toMatchObject({
      status: 'in_progress',
      completedStepIds: ['welcome'],
      welcomeRequired: false
    });
    expect(firestore.documents.get(`affiliates/${created.id}`).literaryCircle.onboarding.completedStepIds)
      .toEqual(['welcome']);

    await affiliateStore.updateLiteraryCircleOnboarding(created.id, {
      status: 'completed'
    }, 'Affiliate');
    expect(firestore.documents.get(`affiliates/${created.id}`).literaryCircle.onboarding.completedAt)
      .toBeTruthy();
    await affiliateStore.updateLiteraryCircleOnboarding(created.id, {
      status: 'in_progress'
    }, 'Affiliate');
    expect(firestore.documents.get(`affiliates/${created.id}`).literaryCircle.onboarding)
      .not.toHaveProperty('completedAt');

    expect(await affiliateStore.hasComplimentaryCatalogueAccess(created.id)).toBe(true);
    const durable = clone(firestore.documents.get(`affiliates/${created.id}`));
    durable.literaryCircle.complimentaryAccess.status = 'revoked';
    firestore.documents.set(`affiliates/${created.id}`, durable);
    expect(await affiliateStore.hasComplimentaryCatalogueAccess(created.id)).toBe(true);
    expect(await affiliateStore.hasComplimentaryCatalogueAccess(created.id, { forceFresh: true })).toBe(false);

    firestore.documents.delete('site_configs/affiliate_literary_circle');
    expect((await affiliateStore.getLiteraryCircleSettingsFresh()).enabled).toBe(false);
    expect(await affiliateStore.hasComplimentaryCatalogueAccess(created.id)).toBe(false);
  });
});
