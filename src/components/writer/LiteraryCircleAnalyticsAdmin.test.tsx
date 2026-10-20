import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { AffiliateAnalyticsReport } from '../../types.js';
import { AffiliateAnalyticsReportView } from './LiteraryCircleAnalyticsAdmin.js';

function reportFixture(
  overrides: Partial<AffiliateAnalyticsReport> = {},
): AffiliateAnalyticsReport {
  return {
    generatedAt: '2026-10-20T09:00:00.000Z',
    window: {
      startDate: '2026-10-01',
      endDate: '2026-10-20',
      startsAt: '2026-09-30T21:00:00.000Z',
      endsAt: '2026-10-20T20:59:59.999Z',
      days: 20,
      timeZone: 'Africa/Nairobi',
    },
    filters: {},
    accounts: {
      registered: 9,
      active: 8,
      pending: 1,
      suspended: 0,
      withLifetimeVerifiedSales: 4,
      withoutLifetimeVerifiedSales: 5,
      withVerifiedSalesInWindow: 2,
    },
    totals: {
      verifiedSales: 3,
      pieceSales: 2,
      bundleSales: 0,
      subscriptionSales: 1,
      grossSalesKes: 2500,
      commissionsRecordedKes: 375,
      commissionsPaidKes: 150,
      retainedRevenueKes: 2125,
    },
    buyerMetrics: {
      coverage: 'unavailable',
      identifiedSales: 0,
      unidentifiedSales: 3,
      uniquePayingReaders: null,
      newAffiliateAcquiredReaders: null,
      repeatPurchases: null,
      repeatPayingReaders: null,
    },
    referralTraffic: {
      coverage: 'partial',
      reason: 'incomplete_history',
      clicks: 14,
      knownUniqueVisitors: 10,
      clicksWithoutVisitorKey: 2,
      conversionRate: null,
    },
    monthly: [{
      periodKey: '2026-10',
      verifiedSales: 3,
      grossSalesKes: 2500,
      commissionsRecordedKes: 375,
      retainedRevenueKes: 2125,
    }],
    topAffiliates: [{
      affiliateId: 'affiliate-1',
      affiliateCode: 'PARTNER1',
      affiliateName: 'Literary Partner One',
      verifiedSales: 3,
      grossSalesKes: 2500,
      commissionsRecordedKes: 375,
      retainedRevenueKes: 2125,
    }],
    topOffers: [{
      purchaseKind: 'piece',
      offerId: 'piece-1',
      title: 'A Verified Piece',
      verifiedSales: 2,
      grossSalesKes: 1500,
    }],
    integrity: {
      invalidRecordsExcluded: 1,
      unverifiedRecordsExcluded: 2,
      duplicateRecordsExcluded: 1,
    },
    ...overrides,
  };
}

describe('LiteraryCircleAnalyticsAdmin report view', () => {
  it('labels incomplete coverage and excludes private buyer material', () => {
    const markup = renderToStaticMarkup(<AffiliateAnalyticsReportView report={reportFixture()} />);

    expect(markup).toContain('Partial retained click history');
    expect(markup).toContain('conversion is withheld');
    expect(markup).toContain('Buyer identity projection is deliberately disabled');
    expect(markup).toContain('No customer identifiers were loaded');
    expect(markup).not.toContain('reader@example.test');
    expect(markup).not.toContain('254700000000');
    expect(markup).not.toContain('abk1_');
  });

  it('renders complete conversion as a percentage without multiplying it twice', () => {
    const source = reportFixture();
    const markup = renderToStaticMarkup(<AffiliateAnalyticsReportView report={{
      ...source,
      referralTraffic: {
        coverage: 'complete',
        reason: 'complete',
        clicks: 30,
        knownUniqueVisitors: 25,
        clicksWithoutVisitorKey: 0,
        conversionRate: 10,
      },
      buyerMetrics: {
        coverage: 'complete',
        identifiedSales: 3,
        unidentifiedSales: 0,
        uniquePayingReaders: 2,
        newAffiliateAcquiredReaders: 2,
        repeatPurchases: 1,
        repeatPayingReaders: 1,
      },
    }} />);

    expect(markup).toContain('10.0%');
    expect(markup).not.toContain('1000.0%');
    expect(markup).toContain('Complete pseudonymous coverage');
  });

  it('includes accessible table names and column scopes', () => {
    const markup = renderToStaticMarkup(<AffiliateAnalyticsReportView report={reportFixture()} />);

    expect(markup).toContain('Monthly affiliate performance table');
    expect(markup).toContain('<caption class="sr-only">');
    expect(markup).toContain('scope="col"');
    expect(markup).toContain('tabindex="0"');
  });
});
