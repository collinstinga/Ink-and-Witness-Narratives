import { describe, expect, it } from 'vitest';
import type { AffiliateAccount, AffiliateSaleCommission } from '../types.js';
import {
  DEFAULT_LITERARY_CIRCLE_SETTINGS,
  buildLiteraryCircleDashboardSummary,
  countVerifiedSalesForPeriod,
  createLiteraryCircleCommissionPolicySnapshot,
  createLiteraryCircleMembership,
  isAffiliateComplimentaryAccessActive,
  isLiteraryCircleCommissionPolicyChange,
  literaryCirclePeriodKey,
  normalizeLiteraryCircleSettings,
  resolveAffiliateCommissionRate,
  resolveLiteraryCircleSettingsForTransaction,
  resolveLiteraryCircleTier,
  shouldApplyLiteraryCircleCommissionPolicy,
  validateLiteraryCircleSettings
} from './literaryCircle.js';

function affiliate(overrides: Partial<AffiliateAccount> = {}): AffiliateAccount {
  return {
    id: 'affiliate-1',
    affiliateCode: 'CIRCLE1',
    name: 'Circle Partner',
    email: 'circle@example.test',
    phone: '254700000001',
    status: 'active',
    payoutMethod: 'mpesa',
    payoutDetails: {},
    totalClicks: 0,
    uniqueVisitors: 0,
    totalSalesCount: 0,
    totalRevenueKes: 0,
    totalCommissionEarnedKes: 0,
    totalCommissionPaidKes: 0,
    balanceAvailableKes: 0,
    balancePendingKes: 0,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides
  };
}

function commission(
  id: string,
  createdAt: string,
  status: AffiliateSaleCommission['status'] = 'APPROVED'
): AffiliateSaleCommission {
  return {
    id,
    affiliateId: 'affiliate-1',
    affiliateCode: 'CIRCLE1',
    affiliateName: 'Circle Partner',
    transactionId: `transaction-${id}`,
    receiptNumber: `RECEIPT-${id}`,
    articleId: 'piece-1',
    articleTitle: 'A Piece',
    saleAmountKes: 100,
    commissionRate: 15,
    commissionAmountKes: 15,
    grossCreatorRevenueKes: 85,
    paymentMethod: 'mpesa',
    status,
    createdAt
  };
}

describe('Literary Circle policy helpers', () => {
  it('keeps the proposed tier structure in draft until the writer activates it', () => {
    const settings = normalizeLiteraryCircleSettings(undefined);

    expect(settings.tiers.map(tier => [tier.name, tier.monthlyVerifiedSalesThreshold, tier.proposedCommissionRate])).toEqual([
      ['Literary Partner', 0, 15],
      ['Literary Ambassador', 10, 20],
      ['Literary Patron', 30, 25]
    ]);
    expect(settings.commissionPolicy.status).toBe('draft');
    expect(shouldApplyLiteraryCircleCommissionPolicy(settings, '2026-10-16T09:00:00.000Z')).toBe(false);
  });

  it('requires an explicit effective date before tier commissions can activate', () => {
    expect(() => validateLiteraryCircleSettings({
      ...DEFAULT_LITERARY_CIRCLE_SETTINGS,
      commissionPolicy: {
        ...DEFAULT_LITERARY_CIRCLE_SETTINGS.commissionPolicy,
        status: 'active'
      }
    })).toThrow(/effective date/i);

    const active = validateLiteraryCircleSettings({
      ...DEFAULT_LITERARY_CIRCLE_SETTINGS,
      commissionPolicy: {
        ...DEFAULT_LITERARY_CIRCLE_SETTINGS.commissionPolicy,
        status: 'active',
        effectiveAt: '2026-11-01T00:00:00.000Z'
      }
    });
    expect(shouldApplyLiteraryCircleCommissionPolicy(active, '2026-10-31T23:59:59.999Z')).toBe(false);
    expect(shouldApplyLiteraryCircleCommissionPolicy(active, '2026-11-01T00:00:00.000Z')).toBe(true);
  });

  it('detects financial policy edits without treating community copy as a commission change', () => {
    const active = normalizeLiteraryCircleSettings({
      ...DEFAULT_LITERARY_CIRCLE_SETTINGS,
      commissionPolicy: {
        ...DEFAULT_LITERARY_CIRCLE_SETTINGS.commissionPolicy,
        status: 'active',
        effectiveAt: '2026-11-01T00:00:00.000Z'
      }
    });
    expect(isLiteraryCircleCommissionPolicyChange(active, {
      ...active,
      community: { ...active.community, description: 'Updated community copy.' }
    })).toBe(false);
    expect(isLiteraryCircleCommissionPolicyChange(active, {
      ...active,
      tiers: active.tiers.map((tier, index) => index === 0
        ? { ...tier, proposedCommissionRate: 16 }
        : tier)
    })).toBe(true);
  });

  it('resolves delayed settlements against the immutable policy effective at transaction time', () => {
    const firstPolicy = normalizeLiteraryCircleSettings({
      ...DEFAULT_LITERARY_CIRCLE_SETTINGS,
      commissionPolicy: {
        status: 'active',
        version: 2,
        effectiveAt: '2026-10-01T00:00:00.000Z',
        subscriptionRenewalsEligible: false
      }
    });
    const firstSnapshot = createLiteraryCircleCommissionPolicySnapshot(firstPolicy, {
      effectiveAt: firstPolicy.commissionPolicy.effectiveAt!,
      confirmedAt: '2026-09-30T12:00:00.000Z',
      confirmedBy: 'Writer'
    });
    const secondPolicy = normalizeLiteraryCircleSettings({
      ...firstPolicy,
      tiers: firstPolicy.tiers.map((tier, index) => index === 0
        ? { ...tier, proposedCommissionRate: 18 }
        : tier),
      commissionPolicy: {
        status: 'active',
        version: 3,
        effectiveAt: '2026-11-01T00:00:00.000Z',
        subscriptionRenewalsEligible: true
      },
      commissionPolicyHistory: [firstSnapshot]
    });

    const october = resolveLiteraryCircleSettingsForTransaction(
      secondPolicy,
      '2026-10-20T00:00:00.000Z'
    );
    const november = resolveLiteraryCircleSettingsForTransaction(
      secondPolicy,
      '2026-11-02T00:00:00.000Z'
    );
    expect(october.commissionPolicy.version).toBe(2);
    expect(october.tiers[0].proposedCommissionRate).toBe(15);
    expect(october.commissionPolicy.subscriptionRenewalsEligible).toBe(false);
    expect(november.commissionPolicy.version).toBe(3);
    expect(november.tiers[0].proposedCommissionRate).toBe(18);
    expect(november.commissionPolicy.subscriptionRenewalsEligible).toBe(true);
  });

  it('uses Africa/Nairobi calendar months at the UTC month boundary', () => {
    expect(literaryCirclePeriodKey('2026-09-30T20:59:59.999Z')).toBe('2026-09');
    expect(literaryCirclePeriodKey('2026-09-30T21:00:00.000Z')).toBe('2026-10');
  });

  it('uses campaign, piece, affiliate, active tier, then global commission precedence', () => {
    const membership = createLiteraryCircleMembership({
      now: '2026-10-01T00:00:00.000Z',
      foundingMember: true,
      audience: 'existing_upgrade',
      actor: 'test'
    });
    const activeSettings = validateLiteraryCircleSettings({
      ...DEFAULT_LITERARY_CIRCLE_SETTINGS,
      commissionPolicy: {
        ...DEFAULT_LITERARY_CIRCLE_SETTINGS.commissionPolicy,
        status: 'active',
        effectiveAt: '2026-10-01T00:00:00.000Z'
      }
    });
    const baseAffiliateSettings = {
      defaultCommissionRate: 15,
      minPayoutThresholdKes: 1000,
      defaultAttributionDays: 30,
      allowTipsCommission: false,
      autoApproveCommissions: true,
      autoApproveDelayHours: 0,
      enablePublicLeaderboard: false,
      allowSelfRegistration: true,
      pieceCommissionOverrides: {}
    };
    const baseOptions = {
      affiliate: affiliate({ literaryCircle: membership }),
      articleId: 'piece-1',
      affiliateSettings: baseAffiliateSettings,
      literaryCircleSettings: activeSettings,
      monthlyVerifiedSales: 10,
      transactionAt: '2026-10-16T08:00:00.000Z'
    };

    expect(resolveAffiliateCommissionRate(baseOptions)).toMatchObject({
      rate: 20,
      source: 'literary_circle_tier',
      literaryCircleTierId: 'literary-ambassador'
    });
    expect(resolveAffiliateCommissionRate({
      ...baseOptions,
      affiliate: { ...baseOptions.affiliate, customCommissionRate: 22 }
    })).toMatchObject({ rate: 22, source: 'affiliate_override' });
    expect(resolveAffiliateCommissionRate({
      ...baseOptions,
      affiliateSettings: { ...baseAffiliateSettings, pieceCommissionOverrides: { 'piece-1': 25 } }
    })).toMatchObject({ rate: 25, source: 'piece_override' });
    expect(resolveAffiliateCommissionRate({
      ...baseOptions,
      campaign: {
        id: 'campaign-1',
        code: 'CIRCLE',
        name: 'Circle Campaign',
        commissionRate: 30,
        attributionDays: 30,
        eligiblePieceIds: [],
        startDate: '2026-10-01T00:00:00.000Z',
        endDate: '2026-11-01T00:00:00.000Z',
        isActive: true,
        clicksCount: 0,
        salesCount: 0,
        revenueKes: 0,
        commissionsKes: 0,
        createdAt: '2026-10-01T00:00:00.000Z'
      }
    })).toMatchObject({ rate: 30, source: 'campaign' });
    expect(resolveAffiliateCommissionRate({
      ...baseOptions,
      literaryCircleSettings: DEFAULT_LITERARY_CIRCLE_SETTINGS
    })).toMatchObject({ rate: 15, source: 'global_default' });
  });

  it('counts only verified commission states for monthly tier qualification', () => {
    const commissions = [
      commission('pending', '2026-10-01T00:00:00.000Z', 'PENDING'),
      commission('approved', '2026-10-02T00:00:00.000Z', 'APPROVED'),
      commission('paid', '2026-10-03T00:00:00.000Z', 'PAID'),
      commission('rejected', '2026-10-04T00:00:00.000Z', 'REJECTED'),
      commission('reversed', '2026-10-05T00:00:00.000Z', 'REVERSED'),
      commission('september', '2026-09-30T20:59:59.000Z', 'APPROVED')
    ];

    expect(countVerifiedSalesForPeriod(commissions, '2026-10')).toBe(3);
    expect(resolveLiteraryCircleTier(DEFAULT_LITERARY_CIRCLE_SETTINGS, 9).id).toBe('literary-partner');
    expect(resolveLiteraryCircleTier(DEFAULT_LITERARY_CIRCLE_SETTINGS, 10).id).toBe('literary-ambassador');
    expect(resolveLiteraryCircleTier(DEFAULT_LITERARY_CIRCLE_SETTINGS, 30).id).toBe('literary-patron');
  });
});

describe('Literary Circle membership helpers', () => {
  it('creates a founding upgrade membership without touching financial fields', () => {
    const membership = createLiteraryCircleMembership({
      now: '2026-10-16T06:00:00.000Z',
      foundingMember: true,
      audience: 'existing_upgrade',
      actor: 'migration:literary-circle-v1'
    });
    const account = affiliate({ literaryCircle: membership });

    expect(membership.foundingMember).toBe(true);
    expect(membership.complimentaryAccess.status).toBe('active');
    expect(membership.onboarding.welcomeRequired).toBe(true);
    expect(isAffiliateComplimentaryAccessActive(account)).toBe(true);
    expect(isAffiliateComplimentaryAccessActive({ ...account, status: 'suspended' })).toBe(false);
  });

  it('builds progress without counting rejected or reversed historical transactions', () => {
    const membership = createLiteraryCircleMembership({
      now: '2026-10-01T00:00:00.000Z',
      foundingMember: true,
      audience: 'existing_upgrade',
      actor: 'migration:literary-circle-v1'
    });
    const commissions = [
      ...Array.from({ length: 10 }, (_, index) => commission(`verified-${index}`, `2026-10-${String(index + 1).padStart(2, '0')}T08:00:00.000Z`)),
      commission('rejected', '2026-10-11T08:00:00.000Z', 'REJECTED')
    ];
    const summary = buildLiteraryCircleDashboardSummary({
      affiliate: affiliate({ literaryCircle: membership }),
      commissions,
      settings: DEFAULT_LITERARY_CIRCLE_SETTINGS,
      now: '2026-10-16T08:00:00.000Z'
    });

    expect(summary.foundingMember).toBe(true);
    expect(summary.monthlyVerifiedSales).toBe(10);
    expect(summary.lifetimeVerifiedSales).toBe(10);
    expect(summary.currentTier.id).toBe('literary-ambassador');
    expect(summary.salesToNextTier).toBe(20);
  });

  it('never presents an unmigrated legacy affiliate as having complimentary access', () => {
    const summary = buildLiteraryCircleDashboardSummary({
      affiliate: affiliate(),
      commissions: [],
      settings: DEFAULT_LITERARY_CIRCLE_SETTINGS,
      now: '2026-10-16T08:00:00.000Z'
    });

    expect(summary.complimentaryAccessStatus).toBe('revoked');
    expect(isAffiliateComplimentaryAccessActive(affiliate())).toBe(false);
  });

  it('does not disclose private community details while the programme or community is disabled', () => {
    const membership = createLiteraryCircleMembership({
      now: '2026-10-16T06:00:00.000Z',
      foundingMember: true,
      audience: 'existing_upgrade',
      actor: 'test'
    });
    const settings = normalizeLiteraryCircleSettings({
      ...DEFAULT_LITERARY_CIRCLE_SETTINGS,
      community: {
        enabled: false,
        title: 'Private title',
        description: 'Private details',
        whatsappInviteUrl: 'https://whatsapp.com/channel/0029Vprivate'
      }
    });
    const summary = buildLiteraryCircleDashboardSummary({
      affiliate: affiliate({ literaryCircle: membership }),
      commissions: [],
      settings,
      now: '2026-10-16T08:00:00.000Z'
    });

    expect(summary.community).toEqual({ enabled: false, title: '', description: '' });
  });
});
