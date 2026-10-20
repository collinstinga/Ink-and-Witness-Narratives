import { describe, expect, it } from 'vitest';

import type {
  AffiliateAccount,
  AffiliateClickEvent,
  AffiliateSaleCommission,
  PaymentTransaction,
} from '../types.js';
import {
  AffiliateAnalyticsValidationError,
  buildAffiliateAnalyticsReport,
  deriveAffiliateBuyerAnalyticsKey,
  projectAffiliateBuyerAnalyticsKeys,
  resolveAffiliateAnalyticsWindow,
} from './affiliateAnalytics.js';

const TEST_SECRET = 'affiliate-analytics-test-secret-with-more-than-32-bytes';

function affiliate(id: string, code: string, overrides: Partial<AffiliateAccount> = {}): AffiliateAccount {
  return {
    id,
    affiliateCode: code,
    name: `Partner ${code}`,
    email: `${code.toLowerCase()}@example.test`,
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
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function commission(
  id: string,
  createdAt: string,
  overrides: Partial<AffiliateSaleCommission> = {},
): AffiliateSaleCommission {
  return {
    id,
    orderId: `ord_${id}`,
    affiliateId: 'affiliate-1',
    affiliateCode: 'PARTNER1',
    affiliateName: 'Partner One',
    transactionId: `transaction-${id}`,
    checkoutRequestId: `checkout-${id}`,
    receiptNumber: `RECEIPT-${id}`,
    articleId: 'piece-1',
    articleTitle: 'A Piece',
    saleAmountKes: 100,
    commissionRate: 15,
    commissionAmountKes: 15,
    grossCreatorRevenueKes: 85,
    paymentMethod: 'mpesa',
    status: 'APPROVED',
    createdAt,
    ...overrides,
  };
}

function transaction(
  id: string,
  overrides: Partial<PaymentTransaction> = {},
): PaymentTransaction {
  return {
    id,
    checkoutRequestId: `checkout-${id}`,
    orderId: `ord_${id}`,
    articleId: 'piece-1',
    articleTitle: 'A Piece',
    amount: 100,
    type: 'PURCHASE',
    status: 'PAID',
    mpesaReceiptNumber: `RECEIPT-${id}`,
    affiliateCode: 'PARTNER1',
    createdAt: '2026-10-10T08:00:00.000Z',
    buyer: { userId: `reader-${id}`, phoneNumber: '254700000001' },
    ...overrides,
  };
}

describe('affiliate analytics privacy and range primitives', () => {
  it('uses inclusive Nairobi calendar days and rejects unsafe reporting windows', () => {
    const window = resolveAffiliateAnalyticsWindow({
      startDate: '2026-10-01',
      endDate: '2026-10-31',
    });

    expect(window).toEqual({
      startDate: '2026-10-01',
      endDate: '2026-10-31',
      startsAt: '2026-09-30T21:00:00.000Z',
      endsAt: '2026-10-31T20:59:59.999Z',
      days: 31,
      timeZone: 'Africa/Nairobi',
    });
    expect(resolveAffiliateAnalyticsWindow({ now: new Date('2026-10-19T12:00:00.000Z') }).days).toBe(90);
    expect(resolveAffiliateAnalyticsWindow({ now: new Date('invalid') }).days).toBe(90);
    expect(() => resolveAffiliateAnalyticsWindow({ startDate: '2026-10-01' })).toThrow(AffiliateAnalyticsValidationError);
    expect(() => resolveAffiliateAnalyticsWindow({ startDate: '2026-02-30', endDate: '2026-03-01' })).toThrow(/real calendar/i);
    expect(() => resolveAffiliateAnalyticsWindow({ startDate: '2025-01-01', endDate: '2026-10-01' })).toThrow(/366 days/i);
  });

  it('creates stable domain-separated HMAC identifiers without exposing buyer data', () => {
    const first = deriveAffiliateBuyerAnalyticsKey({ phoneNumber: '+254 712 345 678' }, TEST_SECRET);
    const equivalent = deriveAffiliateBuyerAnalyticsKey({ phoneNumber: '0712345678' }, TEST_SECRET);
    const account = deriveAffiliateBuyerAnalyticsKey({
      readerId: 'reader-123',
      phoneNumber: '0712345678',
    }, TEST_SECRET);

    expect(first).toBe(equivalent);
    expect(first).toMatch(/^abk1_[A-Za-z0-9_-]{43}$/);
    expect(first).not.toContain('254712345678');
    expect(account).not.toBe(first);
    expect(deriveAffiliateBuyerAnalyticsKey(
      { phoneNumber: '0712345678' },
      'rotated-affiliate-analytics-secret-with-32-plus-bytes',
    )).not.toBe(first);
    expect(deriveAffiliateBuyerAnalyticsKey({ phoneNumber: 'not-a-phone' }, TEST_SECRET)).toBeNull();
    expect(() => deriveAffiliateBuyerAnalyticsKey({ readerId: 'reader-123' }, 'too-short')).toThrow(/32 bytes/i);
  });

  it('joins only settled, amount-matched and unambiguous transaction identities', () => {
    const matched = commission('matched', '2026-10-10T08:00:00.000Z');
    const ambiguous = commission('ambiguous', '2026-10-11T08:00:00.000Z', {
      orderId: undefined,
      checkoutRequestId: undefined,
      transactionId: '',
      receiptNumber: 'SHARED-RECEIPT',
    });
    const amountMismatch = commission('mismatch', '2026-10-12T08:00:00.000Z');
    const direct = commission('direct', '2026-10-12T09:00:00.000Z');
    const ignored = commission('ignored', '2026-10-13T08:00:00.000Z', { status: 'REVERSED' });

    const projection = projectAffiliateBuyerAnalyticsKeys({
      commissions: [matched, ambiguous, amountMismatch, direct, ignored],
      transactions: [
        transaction('matched'),
        transaction('shared-a', { mpesaReceiptNumber: 'SHARED-RECEIPT' }),
        transaction('shared-b', { mpesaReceiptNumber: 'SHARED-RECEIPT' }),
        transaction('shared-c', { mpesaReceiptNumber: 'SHARED-RECEIPT' }),
        transaction('mismatch', { amount: 999 }),
        transaction('direct', { saleChannel: 'DIRECT' }),
      ],
      secret: TEST_SECRET,
    });

    expect(projection.matchedCount).toBe(1);
    expect(projection.ambiguousCount).toBe(1);
    expect(projection.unmatchedCount).toBe(2);
    expect(projection.keysByCommissionId.matched).toMatch(/^abk1_/);
    expect(projection.keysByCommissionId.ambiguous).toBeUndefined();
    expect(projection.keysByCommissionId.mismatch).toBeUndefined();
    expect(projection.keysByCommissionId.direct).toBeUndefined();
    expect(projection.keysByCommissionId.ignored).toBeUndefined();
    expect(() => projectAffiliateBuyerAnalyticsKeys({
      commissions: [],
      transactions: [],
      secret: 'too-short',
    })).toThrow(/32 bytes/i);
  });
});

describe('affiliate analytics aggregate report', () => {
  it('deduplicates verified sales and reports only privacy-bounded aggregates', () => {
    const buyerA = deriveAffiliateBuyerAnalyticsKey({ readerId: 'reader-a' }, TEST_SECRET)!;
    const buyerB = deriveAffiliateBuyerAnalyticsKey({ readerId: 'reader-b' }, TEST_SECRET)!;
    const commissions = [
      commission('older-a', '2026-08-10T08:00:00.000Z'),
      commission('piece-a', '2026-10-02T08:00:00.000Z'),
      commission('bundle-b', '2026-10-03T08:00:00.000Z', {
        affiliateId: 'affiliate-2',
        affiliateCode: 'PARTNER2',
        affiliateName: 'Partner Two',
        articleId: 'bundle-1',
        articleTitle: 'Two-Piece Bundle',
        purchaseKind: 'bundle',
        saleAmountKes: 300,
        commissionAmountKes: 60,
        grossCreatorRevenueKes: 240,
        status: 'PAID',
      }),
      commission('pass-b', '2026-10-04T08:00:00.000Z', {
        affiliateId: 'affiliate-2',
        affiliateCode: 'PARTNER2',
        affiliateName: 'Partner Two',
        articleId: 'reader-pass',
        articleTitle: 'Six Month Reader Pass',
        purchaseKind: 'subscription',
        subscriptionPlanId: 'six-month',
        saleAmountKes: 600,
        commissionAmountKes: 120,
        grossCreatorRevenueKes: 480,
        status: 'PENDING',
        receiptNumber: 'PASS-RECEIPT',
      }),
      commission('pass-b-duplicate', '2026-10-04T08:00:01.000Z', {
        affiliateId: 'affiliate-2',
        affiliateCode: 'PARTNER2',
        affiliateName: 'Partner Two',
        articleId: 'reader-pass',
        articleTitle: 'Six Month Reader Pass',
        purchaseKind: 'subscription',
        subscriptionPlanId: 'six-month',
        saleAmountKes: 600,
        commissionAmountKes: 120,
        grossCreatorRevenueKes: 480,
        status: 'PAID',
        receiptNumber: 'PASS-RECEIPT',
      }),
      commission('reversed', '2026-10-05T08:00:00.000Z', { status: 'REVERSED', saleAmountKes: 900 }),
      commission('invalid', '2026-10-06T08:00:00.000Z', { saleAmountKes: -100 }),
    ];
    const clicks: AffiliateClickEvent[] = [
      { id: 'click-1', affiliateCode: 'PARTNER1', affiliateId: 'affiliate-1', ipHash: 'visitor-a', timestamp: '2026-10-01T08:00:00.000Z' },
      { id: 'click-2', affiliateCode: 'PARTNER2', affiliateId: 'affiliate-2', ipHash: 'visitor-b', timestamp: '2026-10-02T08:00:00.000Z' },
      { id: 'click-3', affiliateCode: 'PARTNER2', affiliateId: 'affiliate-2', ipHash: 'visitor-b', timestamp: '2026-10-03T08:00:00.000Z' },
    ];
    const commissionsBefore = JSON.parse(JSON.stringify(commissions));
    const clicksBefore = JSON.parse(JSON.stringify(clicks));

    const report = buildAffiliateAnalyticsReport({
      affiliates: [affiliate('affiliate-1', 'PARTNER1'), affiliate('affiliate-2', 'PARTNER2')],
      commissions,
      buyerKeysByCommissionId: {
        'older-a': buyerA,
        'piece-a': buyerA,
        'bundle-b': buyerB,
        'pass-b': buyerB,
        'pass-b-duplicate': buyerB,
      },
      clickEvents: clicks,
      clickHistoryCompleteForWindow: true,
      startDate: '2026-10-01',
      endDate: '2026-10-31',
      now: new Date('2026-10-19T12:00:00.000Z'),
    });

    expect(report.totals).toEqual({
      verifiedSales: 3,
      pieceSales: 1,
      bundleSales: 1,
      subscriptionSales: 1,
      grossSalesKes: 1000,
      commissionsRecordedKes: 195,
      commissionsPaidKes: 180,
      retainedRevenueKes: 805,
    });
    expect(report.accounts).toMatchObject({
      registered: 2,
      active: 2,
      withLifetimeVerifiedSales: 2,
      withoutLifetimeVerifiedSales: 0,
      withVerifiedSalesInWindow: 2,
    });
    expect(report.buyerMetrics).toEqual({
      coverage: 'complete',
      identifiedSales: 3,
      unidentifiedSales: 0,
      uniquePayingReaders: 2,
      newAffiliateAcquiredReaders: 1,
      repeatPurchases: 2,
      repeatPayingReaders: 2,
    });
    expect(report.referralTraffic).toEqual({
      coverage: 'complete',
      reason: 'complete',
      clicks: 3,
      knownUniqueVisitors: 2,
      clicksWithoutVisitorKey: 0,
      conversionRate: 100,
    });
    expect(report.integrity).toEqual({
      invalidRecordsExcluded: 1,
      unverifiedRecordsExcluded: 1,
      duplicateRecordsExcluded: 1,
    });
    expect(report.monthly).toEqual([{
      periodKey: '2026-10',
      verifiedSales: 3,
      grossSalesKes: 1000,
      commissionsRecordedKes: 195,
      retainedRevenueKes: 805,
    }]);
    expect(report.topAffiliates.map(item => item.affiliateId)).toEqual(['affiliate-2', 'affiliate-1']);
    expect(report.topOffers.map(item => item.offerId)).toEqual(['six-month', 'bundle-1', 'piece-1']);
    expect(JSON.stringify(report)).not.toContain('reader-a');
    expect(JSON.stringify(report)).not.toContain('reader-b');
    expect(JSON.stringify(report)).not.toContain(buyerA);
    expect(commissions).toEqual(commissionsBefore);
    expect(clicks).toEqual(clicksBefore);
  });

  it('counts a reader as newly acquired only for the filter owning their first affiliate purchase', () => {
    const buyer = deriveAffiliateBuyerAnalyticsKey({ readerId: 'reader-cross-affiliate' }, TEST_SECRET)!;
    const report = buildAffiliateAnalyticsReport({
      affiliates: [affiliate('affiliate-1', 'PARTNER1'), affiliate('affiliate-2', 'PARTNER2')],
      commissions: [
        commission('first-other', '2026-10-02T08:00:00.000Z', {
          affiliateId: 'affiliate-2',
          affiliateCode: 'PARTNER2',
          affiliateName: 'Partner Two',
        }),
        commission('later-selected', '2026-10-03T08:00:00.000Z'),
      ],
      buyerKeysByCommissionId: {
        'first-other': buyer,
        'later-selected': buyer,
      },
      startDate: '2026-10-01',
      endDate: '2026-10-31',
      filters: { affiliateId: 'affiliate-1' },
    });

    expect(report.totals.verifiedSales).toBe(1);
    expect(report.buyerMetrics).toMatchObject({
      uniquePayingReaders: 1,
      newAffiliateAcquiredReaders: 0,
      repeatPurchases: 1,
      repeatPayingReaders: 1,
    });
  });

  it('fails closed when identity or compatible click coverage is unavailable', () => {
    const unsafeFilters = {
      purchaseKind: 'subscription' as const,
      subscriptionPlanId: 'three-month',
      customerEmail: 'must-not-be-reflected@example.test',
    };
    const report = buildAffiliateAnalyticsReport({
      affiliates: [affiliate('affiliate-1', 'PARTNER1')],
      commissions: [commission('subscription', '2026-10-10T08:00:00.000Z', {
        purchaseKind: 'subscription',
        subscriptionPlanId: 'three-month',
      })],
      clickEvents: [],
      clickHistoryCompleteForWindow: true,
      startDate: '2026-10-01',
      endDate: '2026-10-31',
      filters: unsafeFilters,
    });

    expect(report.buyerMetrics).toMatchObject({
      coverage: 'unavailable',
      uniquePayingReaders: null,
      newAffiliateAcquiredReaders: null,
      repeatPurchases: null,
    });
    expect(report.referralTraffic).toEqual({
      coverage: 'unavailable',
      reason: 'unsupported_filter',
      clicks: null,
      knownUniqueVisitors: null,
      clicksWithoutVisitorKey: null,
      conversionRate: null,
    });
    expect(JSON.stringify(report)).not.toContain('must-not-be-reflected@example.test');

    const emptyWithoutProjection = buildAffiliateAnalyticsReport({
      affiliates: [affiliate('affiliate-1', 'PARTNER1')],
      commissions: [],
      startDate: '2026-10-01',
      endDate: '2026-10-31',
    });
    expect(emptyWithoutProjection.buyerMetrics).toMatchObject({
      coverage: 'unavailable',
      uniquePayingReaders: null,
      newAffiliateAcquiredReaders: null,
      repeatPurchases: null,
      repeatPayingReaders: null,
    });
  });
});
