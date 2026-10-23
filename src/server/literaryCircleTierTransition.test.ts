import crypto from 'crypto';
import { describe, expect, it } from 'vitest';
import type { AffiliateAccount, AffiliateSaleCommission, LiteraryCircleSettings } from '../types.js';
import { createLiteraryCircleMembership, DEFAULT_LITERARY_CIRCLE_SETTINGS } from './literaryCircle.js';
import {
  buildLiteraryCircleTierTransition,
  MAX_TIER_TRANSITION_PRIOR_COMMISSIONS,
  validateStoredLiteraryCircleTierTransition,
} from './literaryCircleTierTransition.js';

const occurredAt = '2026-10-20T08:00:00.000Z';

function policy(): LiteraryCircleSettings {
  return {
    ...structuredClone(DEFAULT_LITERARY_CIRCLE_SETTINGS),
    qualificationEffectiveFrom: '2026-10-01T00:00:00.000Z',
    tiers: DEFAULT_LITERARY_CIRCLE_SETTINGS.tiers.map(tier => ({
      ...tier,
      monthlyVerifiedSalesThreshold: tier.rank === 2 ? 2 : tier.rank === 3 ? 4 : 0,
    })),
    commissionPolicy: {
      status: 'active', version: 7, effectiveAt: '2026-10-01T00:00:00.000Z', subscriptionRenewalsEligible: false,
    },
  };
}

function affiliate(): AffiliateAccount {
  return {
    id: 'affiliate_1', affiliateCode: 'PARTNER1', name: 'Partner', status: 'active',
    literaryCircle: createLiteraryCircleMembership({
      now: '2026-10-01T00:00:00.000Z', settings: policy(), foundingMember: true,
      audience: 'existing_upgrade', actor: 'test',
    }),
  } as AffiliateAccount;
}

function commission(checkout: string, overrides: Partial<AffiliateSaleCommission> = {}): AffiliateSaleCommission {
  return {
    id: `com_tx_${crypto.createHash('sha256').update(checkout).digest('hex').slice(0, 40)}`,
    affiliateId: 'affiliate_1', affiliateCode: 'PARTNER1', affiliateName: 'Partner',
    transactionId: `tx_${checkout}`, checkoutRequestId: checkout, receiptNumber: `RECEIPT-${checkout}`,
    articleId: 'piece_1', articleTitle: 'Piece', saleAmountKes: 500, commissionRate: 15,
    commissionAmountKes: 75, grossCreatorRevenueKes: 425, paymentMethod: 'mpesa',
    status: 'APPROVED', createdAt: '2026-10-19T08:00:00.000Z', ...overrides,
  };
}

function fixture() {
  return {
    commission: commission('checkout_current', {
      commissionRate: 20, commissionAmountKes: 100, grossCreatorRevenueKes: 400,
      commissionRateSource: 'literary_circle_tier', literaryCircleTierId: 'literary-ambassador',
      literaryCirclePolicyVersion: 7, createdAt: occurredAt,
    }),
    affiliate: affiliate(), settings: policy(), history: [commission('checkout_prior')],
    monthlyVerifiedSalesAfter: 2, historyComplete: true, paymentType: 'PURCHASE',
  };
}

describe('committed Literary Circle tier transition evidence', () => {
  it('records the exact automatic crossing without mutating any source', () => {
    const input = fixture();
    const before = structuredClone(input);
    expect(buildLiteraryCircleTierTransition(input)).toEqual({
      schemaVersion: 1, periodKey: '2026-10', policyVersion: 7,
      fromTierId: 'literary-partner', toTierId: 'literary-ambassador', fromRank: 1, toRank: 2,
      threshold: 2, verifiedSalesBefore: 1, verifiedSalesAfter: 2, occurredAt,
      qualifyingCommissionIds: [input.history[0].id],
    });
    expect(input).toEqual(before);
  });

  it('supports a higher-tier crossing and sorts supporting IDs deterministically', () => {
    const input = fixture();
    input.history = ['z', 'a', 'm'].map(id => commission(`checkout_${id}`));
    input.monthlyVerifiedSalesAfter = 4;
    Object.assign(input.commission, {
      commissionRate: 25, commissionAmountKes: 125, literaryCircleTierId: 'literary-patron',
    });
    expect(buildLiteraryCircleTierTransition(input)).toMatchObject({
      fromTierId: 'literary-ambassador', toTierId: 'literary-patron', fromRank: 2, toRank: 3,
      threshold: 4, verifiedSalesBefore: 3, verifiedSalesAfter: 4,
      qualifyingCommissionIds: input.history.map(item => item.id).sort(),
    });
  });

  it('does not emit when no threshold is crossed', () => {
    const input = fixture();
    input.history = [];
    input.monthlyVerifiedSalesAfter = 1;
    expect(buildLiteraryCircleTierTransition(input)).toBeUndefined();
    input.history = [commission('one'), commission('two')];
    input.monthlyVerifiedSalesAfter = 3;
    expect(buildLiteraryCircleTierTransition(input)).toBeUndefined();
  });

  it('excludes manual memberships, unavailable memberships and inactive accounts', () => {
    for (const change of [
      (value: ReturnType<typeof fixture>) => { value.affiliate.literaryCircle!.tier.source = 'manual'; },
      (value: ReturnType<typeof fixture>) => { delete value.affiliate.literaryCircle; },
      (value: ReturnType<typeof fixture>) => { value.affiliate.status = 'suspended'; },
    ]) {
      const input = fixture();
      change(input);
      expect(buildLiteraryCircleTierTransition(input)).toBeUndefined();
    }
  });

  it('excludes tips and campaign, piece, affiliate or default rate overrides', () => {
    const input = fixture();
    input.paymentType = 'TIP';
    expect(buildLiteraryCircleTierTransition(input)).toBeUndefined();
    input.paymentType = 'PURCHASE';
    for (const source of ['campaign', 'piece_override', 'affiliate_override', 'global_default'] as const) {
      input.commission.commissionRateSource = source;
      expect(buildLiteraryCircleTierTransition(input)).toBeUndefined();
    }
  });

  it('fails closed for incomplete or query-cap-sized history', () => {
    const input = fixture();
    input.historyComplete = false;
    expect(buildLiteraryCircleTierTransition(input)).toBeUndefined();
    input.historyComplete = true;
    input.history = Array.from({ length: 10_000 }, () => input.history[0]);
    expect(buildLiteraryCircleTierTransition(input)).toBeUndefined();
  });

  it('bounds the supporting-payment evidence to 100 prior rows', () => {
    const input = fixture();
    input.settings.tiers[1].monthlyVerifiedSalesThreshold = 102;
    input.settings.tiers[2].monthlyVerifiedSalesThreshold = 200;
    input.history = Array.from({ length: MAX_TIER_TRANSITION_PRIOR_COMMISSIONS + 1 }, (_, index) => commission(`prior_${index}`));
    input.monthlyVerifiedSalesAfter = input.history.length + 1;
    expect(buildLiteraryCircleTierTransition(input)).toBeUndefined();
    input.settings.tiers[1].monthlyVerifiedSalesThreshold = 101;
    input.history.pop();
    input.monthlyVerifiedSalesAfter -= 1;
    expect(buildLiteraryCircleTierTransition(input)?.qualifyingCommissionIds).toHaveLength(100);
  });

  it('requires canonical current and prior commission identities', () => {
    for (const subject of ['commission', 'prior'] as const) {
      const input = fixture();
      const target = subject === 'commission' ? input.commission : input.history[0];
      target.id = 'forged_commission';
      expect(buildLiteraryCircleTierTransition(input)).toBeUndefined();
      target.id = commission(target.checkoutRequestId!).id;
      delete target.checkoutRequestId;
      expect(buildLiteraryCircleTierTransition(input)).toBeUndefined();
    }
  });

  it('does not let unrelated older-format history disable a current monthly crossing', () => {
    const input = fixture();
    input.history.push({ ...commission('legacy'), id: 'old-format-id', checkoutRequestId: undefined, createdAt: '2026-09-01' });
    expect(buildLiteraryCircleTierTransition(input)?.verifiedSalesAfter).toBe(2);
  });

  it('requires exact affiliate ownership and matching referral identity', () => {
    for (const subject of ['commission', 'prior'] as const) {
      const input = fixture();
      const target = subject === 'commission' ? input.commission : input.history[0];
      target.affiliateId = 'other_affiliate';
      expect(buildLiteraryCircleTierTransition(input)).toBeUndefined();
      target.affiliateId = 'affiliate_1';
      target.affiliateCode = 'OTHER';
      expect(buildLiteraryCircleTierTransition(input)).toBeUndefined();
    }
  });

  it('rejects duplicate or current commissions in the supporting history', () => {
    const input = fixture();
    input.history.push(structuredClone(input.history[0]));
    expect(buildLiteraryCircleTierTransition(input)).toBeUndefined();
    input.history = [structuredClone(input.commission)];
    expect(buildLiteraryCircleTierTransition(input)).toBeUndefined();
  });

  it('requires canonical dates and rejects history newer than the current sale', () => {
    const input = fixture();
    input.commission.createdAt = '2026-10-20';
    expect(buildLiteraryCircleTierTransition(input)).toBeUndefined();
    input.commission.createdAt = occurredAt;
    input.history[0].createdAt = '2026-10-20T08:00:00.001Z';
    expect(buildLiteraryCircleTierTransition(input)).toBeUndefined();
    input.history[0].createdAt = 'not-a-date';
    expect(buildLiteraryCircleTierTransition(input)).toBeUndefined();
  });

  it('requires the exact derived before and after counts', () => {
    for (const count of [0, 1, 3, -1, 1.5, NaN, Infinity]) {
      const input = fixture();
      input.monthlyVerifiedSalesAfter = count;
      expect(buildLiteraryCircleTierTransition(input)).toBeUndefined();
    }
  });

  it('counts pending, approved and paid; excludes rejected and reversed history', () => {
    for (const status of ['PENDING', 'APPROVED', 'PAID'] as const) {
      const input = fixture();
      input.history[0].status = status;
      input.history.push(commission('rejected', { status: 'REJECTED', commissionAmountKes: 0 }));
      input.history.push(commission('reversed', { status: 'REVERSED' }));
      expect(buildLiteraryCircleTierTransition(input)?.verifiedSalesBefore).toBe(1);
    }
    for (const status of ['REJECTED', 'REVERSED'] as const) {
      const input = fixture();
      input.commission.status = status;
      expect(buildLiteraryCircleTierTransition(input)).toBeUndefined();
    }
  });

  it('rejects suspicious verified current or supporting rows', () => {
    for (const subject of ['commission', 'prior'] as const) {
      for (const patch of [
        { fraudFlag: { flagged: true, reason: 'test', severity: 'high', reviewed: true } },
        { commissionAmountKes: 0 }, { commissionAmountKes: 501 },
        { saleAmountKes: Infinity }, { saleAmountKes: 1_000_001 }, { commissionRate: 101 },
      ]) {
        const input = fixture();
        Object.assign(subject === 'commission' ? input.commission : input.history[0], patch);
        expect(buildLiteraryCircleTierTransition(input)).toBeUndefined();
      }
    }
  });

  it('requires the persisted tier, rate and rounded commission to agree', () => {
    for (const patch of [
      { literaryCircleTierId: 'literary-patron' }, { commissionRate: 19 }, { commissionAmountKes: 99 },
    ]) {
      const input = fixture();
      Object.assign(input.commission, patch);
      expect(buildLiteraryCircleTierTransition(input)).toBeUndefined();
    }
  });

  it('rejects inactive, mismatched or not-yet-effective policies', () => {
    for (const change of [
      (input: ReturnType<typeof fixture>) => { input.settings.enabled = false; },
      (input: ReturnType<typeof fixture>) => { input.settings.commissionPolicy.status = 'draft'; },
      (input: ReturnType<typeof fixture>) => { input.settings.commissionPolicy.version = 8; },
      (input: ReturnType<typeof fixture>) => { input.settings.commissionPolicy.effectiveAt = '2026-10-21T00:00:00.000Z'; },
      (input: ReturnType<typeof fixture>) => { input.settings.qualificationEffectiveFrom = '2026-10-21T00:00:00.000Z'; },
    ]) {
      const input = fixture();
      change(input);
      expect(buildLiteraryCircleTierTransition(input)).toBeUndefined();
    }
  });

  it('rejects tied, malformed or inverted rank and threshold definitions', () => {
    for (const change of [
      (settings: LiteraryCircleSettings) => { settings.tiers[1].rank = 1; },
      (settings: LiteraryCircleSettings) => { settings.tiers[1].monthlyVerifiedSalesThreshold = 0; },
      (settings: LiteraryCircleSettings) => { settings.tiers[1].rank = 0; },
      (settings: LiteraryCircleSettings) => { settings.tiers[1].monthlyVerifiedSalesThreshold = 1.5; },
      (settings: LiteraryCircleSettings) => { settings.tiers[1].rank = 1; settings.tiers[0].rank = 2; },
      (settings: LiteraryCircleSettings) => { settings.tiers[1].id = settings.tiers[0].id; },
    ]) {
      const input = fixture();
      change(input.settings);
      expect(buildLiteraryCircleTierTransition(input)).toBeUndefined();
    }
  });

  it('uses Nairobi calendar months without counting the preceding UTC-boundary sale', () => {
    const input = fixture();
    input.settings.tiers[1].monthlyVerifiedSalesThreshold = 1;
    input.commission.createdAt = '2026-10-31T21:00:00.000Z';
    input.history[0].createdAt = '2026-10-31T20:59:59.999Z';
    input.monthlyVerifiedSalesAfter = 1;
    expect(buildLiteraryCircleTierTransition(input)).toMatchObject({
      periodKey: '2026-11', verifiedSalesBefore: 0, qualifyingCommissionIds: [],
    });
  });

  it('respects prospective qualification while retaining previous rows untouched', () => {
    const input = fixture();
    input.settings.qualificationEffectiveFrom = '2026-10-15T00:00:00.000Z';
    input.history.push(commission('before_qualification', { createdAt: '2026-10-14T08:00:00.000Z' }));
    expect(buildLiteraryCircleTierTransition(input)?.qualifyingCommissionIds).toEqual([input.history[0].id]);
    expect(input.history).toHaveLength(2);
  });

  it('suppresses repeat milestones even when the original crossing was reversed', () => {
    const input = fixture();
    const previousCrossing = buildLiteraryCircleTierTransition(input)!;
    input.history.push(commission('previous_crossing', {
      status: 'REVERSED', literaryCircleTierTransition: previousCrossing,
    }));
    expect(buildLiteraryCircleTierTransition(input)).toBeUndefined();
    input.history[1].literaryCircleTierTransition!.policyVersion = 6;
    expect(buildLiteraryCircleTierTransition(input)).toBeDefined();
  });

  it('validates stored evidence independently of object field order', () => {
    const input = fixture();
    const evidence = buildLiteraryCircleTierTransition(input)!;
    input.commission.literaryCircleTierTransition = Object.fromEntries(Object.entries(evidence).reverse()) as typeof evidence;
    expect(validateStoredLiteraryCircleTierTransition(input)).toBe(true);
  });

  it('rejects changed fields, unknown fields and reordered or missing support', () => {
    const input = fixture();
    input.history.push(commission('second_prior'), commission('third_prior'));
    input.monthlyVerifiedSalesAfter = 4;
    Object.assign(input.commission, { commissionRate: 25, commissionAmountKes: 125, literaryCircleTierId: 'literary-patron' });
    const evidence = buildLiteraryCircleTierTransition(input)!;
    for (const patch of [
      { fromRank: 50 }, { threshold: 3 }, { verifiedSalesBefore: 2 }, { source: 'forged' },
      { qualifyingCommissionIds: [...evidence.qualifyingCommissionIds].reverse() },
      { qualifyingCommissionIds: evidence.qualifyingCommissionIds.slice(1) },
    ]) {
      input.commission.literaryCircleTierTransition = { ...evidence, ...patch };
      expect(validateStoredLiteraryCircleTierTransition(input)).toBe(false);
    }
    input.commission.literaryCircleTierTransition = evidence;
    input.history.pop();
    expect(validateStoredLiteraryCircleTierTransition(input)).toBe(false);
  });

  it('returns no evidence instead of throwing on malformed input', () => {
    expect(buildLiteraryCircleTierTransition(null as any)).toBeUndefined();
    expect(validateStoredLiteraryCircleTierTransition(null as any)).toBe(false);
    const input = fixture();
    input.history = [null as any];
    expect(buildLiteraryCircleTierTransition(input)).toBeUndefined();
    input.history = [];
    input.settings.tiers = null as any;
    expect(buildLiteraryCircleTierTransition(input)).toBeUndefined();
  });
});
