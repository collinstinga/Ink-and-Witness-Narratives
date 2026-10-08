import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Article, DetailedAnalytics, TrafficAnalyticsSnapshot } from '../types.js';

vi.mock('./db.js', () => ({
  getDb: vi.fn()
}));

import {
  mergeDurableTrafficIntoAnalytics,
  normalizeTrafficEventType,
  resetAnalyticsStoreCacheForTests,
  resolveTrafficPeriodRange
} from './analyticsStore.js';

const article = {
  id: 'piece-1',
  title: 'Piece One',
  subtitle: '',
  slug: 'piece-one',
  excerpt: '',
  content: '',
  category: 'Essays',
  categories: ['Essays'],
  status: 'published',
  isPaid: true,
  priceKes: 100,
  readTimeMinutes: 5,
  publishedAt: '2026-10-01',
  createdAt: '2026-10-01',
  updatedAt: '2026-10-01',
  downloadsCount: 0,
  viewsCount: 999,
  previewParagraphs: [],
  tags: []
} satisfies Article;

function baseAnalytics(): DetailedAnalytics {
  return {
    period: '30d',
    startDate: '2026-09-09',
    endDate: '2026-10-08',
    overview: {
      confirmedRevenueKes: 200,
      pendingRevenueKes: 0,
      pendingCount: 0,
      failedPaymentsCount: 0,
      failedPaymentsValueKes: 0,
      confirmedPurchasesCount: 2,
      uniqueReadersCount: 3,
      totalViewsCount: 999,
      conversionRate: 0,
      averagePurchaseKes: 100
    },
    growth: { revenueGrowth: 0, purchasesGrowth: 0, readersGrowth: 0, conversionGrowth: 0 },
    revenue: { totalConfirmedKes: 200, salesRevenueKes: 200, tipsRevenueKes: 0 },
    purchases: { confirmedCount: 2, averageOrderValueKes: 100, mpesaConfirmedCount: 2, bankConfirmedCount: 0 },
    readers: { uniqueReadersCount: 3, totalArticleViews: 999, totalPreviewReads: 499, averageViewsPerReader: 333 },
    conversion: { overallConversionRate: 0, previewToPurchaseRate: 0, checkoutToPurchaseRate: 0 },
    pendingPayments: { count: 0, totalAmountKes: 0 },
    tips: { totalTipsKes: 0, verifiedTipsCount: 0, averageTipKes: 0, currencyBreakdown: {} },
    cashFlow: {
      confirmedInflowKes: 200,
      pendingInflowKes: 0,
      failedInflowKes: 0,
      totalTransactionAttempts: 2,
      confirmedTransactionCount: 2,
      pendingTransactionCount: 0,
      failedTransactionCount: 0,
      paymentMethodBreakdown: {
        mpesa: { count: 2, amountKes: 200 },
        bank: { count: 0, amountKes: 0 },
        manual: { count: 0, amountKes: 0 }
      }
    },
    timeSeries: [{ date: '2026-10-08', revenueKes: 200, purchasesCount: 2, viewsCount: 999 }],
    conversionFunnel: { viewsToPurchaseRate: 0, previewToCheckoutRate: 0, checkoutToPurchaseRate: 0, overallRate: 0, stages: [] },
    editorialInsights: [],
    homepagePerformance: { mostSellingPieces: [] },
    pieceAnalytics: [{
      articleId: article.id,
      title: article.title,
      slug: article.slug,
      category: article.category,
      status: article.status,
      isPaid: article.isPaid,
      priceKes: article.priceKes,
      viewsCount: 999,
      previewCount: 499,
      confirmedPurchases: 2,
      purchasesCount: 2,
      directPurchases: 1,
      bundlePurchases: 1,
      conversionRate: 0,
      revenueKes: 100,
      tipsCount: 0,
      tipsTotalKes: 0,
      totalGrossKes: 100
    }],
    content: { totalPieces: 1, publishedPieces: 1, draftPieces: 0, scheduledPieces: 0, totalViews: 999, totalWords: 0, topViewedPieces: [article] }
  };
}

describe('durable traffic analytics', () => {
  beforeEach(() => resetAnalyticsStoreCacheForTests());

  it('normalizes legacy client events without changing topic clicks', () => {
    expect(normalizeTrafficEventType('view', 'piece-1')).toBe('piece_view');
    expect(normalizeTrafficEventType('preview_read', 'piece-1')).toBe('preview_view');
    expect(normalizeTrafficEventType('unlock_start', 'piece-1')).toBe('unlock_select');
    expect(normalizeTrafficEventType('view', undefined, { type: 'topic_click' })).toBe('topic_click');
  });

  it('uses Nairobi calendar windows with an equally sized previous period', () => {
    expect(resolveTrafficPeriodRange({ period: '7d', now: new Date('2026-10-08T07:00:00.000Z') })).toEqual({
      currentStart: '2026-10-02',
      currentEnd: '2026-10-08',
      previousStart: '2026-09-25',
      previousEnd: '2026-10-01'
    });
  });

  it('replaces legacy estimates with durable visits and per-piece counts', () => {
    const snapshot: TrafficAnalyticsSnapshot = {
      trackingSince: '2026-10-08',
      current: {
        siteVisits: 8,
        uniqueVisitors: 5,
        pieceViews: 4,
        previewViews: 3,
        unlockStarts: 2,
        paymentStarts: 2,
        pieces: {
          [article.id]: { articleId: article.id, views: 4, previews: 3, unlockStarts: 2, paymentStarts: 2 }
        },
        days: [{
          date: '2026-10-08',
          siteVisits: 8,
          uniqueVisitors: 5,
          pieceViews: 4,
          previewViews: 3,
          unlockStarts: 2,
          paymentStarts: 2,
          pieces: {
            [article.id]: { articleId: article.id, views: 4, previews: 3, unlockStarts: 2, paymentStarts: 2 }
          }
        }]
      },
      previous: {
        siteVisits: 4,
        uniqueVisitors: 3,
        pieceViews: 2,
        previewViews: 1,
        unlockStarts: 0,
        paymentStarts: 0,
        pieces: {},
        days: []
      }
    };

    const merged = mergeDurableTrafficIntoAnalytics(baseAnalytics(), snapshot, [article]);
    expect(merged.traffic).toMatchObject({ siteVisits: 8, uniqueVisitors: 5, pieceViews: 4, previewViews: 3 });
    expect(merged.readers).toMatchObject({ uniqueReadersCount: 5, totalArticleViews: 4, totalPreviewReads: 3 });
    expect(merged.pieceAnalytics[0]).toMatchObject({
      viewsCount: 4,
      previewCount: 3,
      purchasesCount: 2,
      directPurchases: 1,
      bundlePurchases: 1,
      revenueKes: 100,
      conversionRate: 50
    });
    expect(merged.growth.readersGrowth).toBe(100);
    expect(merged.content?.totalViews).toBe(4);
  });

  it('reports honest zeros when no traffic has been collected', () => {
    const empty = {
      siteVisits: 0,
      uniqueVisitors: 0,
      pieceViews: 0,
      previewViews: 0,
      unlockStarts: 0,
      paymentStarts: 0,
      pieces: {},
      days: []
    };
    const merged = mergeDurableTrafficIntoAnalytics(baseAnalytics(), { current: empty, previous: empty }, [article]);
    expect(merged.traffic?.siteVisits).toBe(0);
    expect(merged.readers.uniqueReadersCount).toBe(0);
    expect(merged.pieceAnalytics[0].viewsCount).toBe(0);
    expect(merged.pieceAnalytics[0].previewCount).toBe(0);
  });

  it('collapses intraday sales buckets into one traffic total instead of repeating the daily count', () => {
    const analytics = baseAnalytics();
    analytics.period = 'today';
    analytics.timeSeries = [
      { date: '2026-10-08T00:00:00.000Z', revenueKes: 50, salesRevenueKes: 50, purchasesCount: 1, viewsCount: 0 },
      { date: '2026-10-08T04:00:00.000Z', revenueKes: 100, salesRevenueKes: 100, purchasesCount: 1, viewsCount: 0 }
    ];
    const day = {
      date: '2026-10-08',
      siteVisits: 9,
      uniqueVisitors: 6,
      pieceViews: 7,
      previewViews: 4,
      unlockStarts: 2,
      paymentStarts: 2,
      pieces: {}
    };
    const empty = { siteVisits: 0, uniqueVisitors: 0, pieceViews: 0, previewViews: 0, unlockStarts: 0, paymentStarts: 0, pieces: {}, days: [] };
    const merged = mergeDurableTrafficIntoAnalytics(
      analytics,
      { current: { ...day, days: [day] }, previous: empty },
      [article]
    );

    expect(merged.timeSeries).toHaveLength(1);
    expect(merged.timeSeries[0]).toMatchObject({
      label: 'Today total',
      revenueKes: 150,
      purchasesCount: 2,
      viewsCount: 7,
      siteVisits: 9,
      uniqueVisitors: 6
    });
  });

  it('sums durable daily traffic into monthly chart points', () => {
    const analytics = baseAnalytics();
    analytics.period = 'this_year';
    analytics.timeSeries = [{ date: '2026-10', label: 'Oct', revenueKes: 200, purchasesCount: 2, viewsCount: 999 }];
    const days = [
      { date: '2026-10-07', siteVisits: 3, uniqueVisitors: 2, pieceViews: 4, previewViews: 1, unlockStarts: 0, paymentStarts: 0, pieces: {} },
      { date: '2026-10-08', siteVisits: 5, uniqueVisitors: 3, pieceViews: 6, previewViews: 2, unlockStarts: 0, paymentStarts: 0, pieces: {} }
    ];
    const empty = { siteVisits: 0, uniqueVisitors: 0, pieceViews: 0, previewViews: 0, unlockStarts: 0, paymentStarts: 0, pieces: {}, days: [] };
    const merged = mergeDurableTrafficIntoAnalytics(
      analytics,
      {
        current: {
          siteVisits: 8,
          uniqueVisitors: 5,
          pieceViews: 10,
          previewViews: 3,
          unlockStarts: 0,
          paymentStarts: 0,
          pieces: {},
          days
        },
        previous: empty
      },
      [article]
    );

    expect(merged.timeSeries[0]).toMatchObject({
      date: '2026-10',
      viewsCount: 10,
      previewCount: 3,
      siteVisits: 8,
      uniqueVisitors: 5
    });
  });
});
