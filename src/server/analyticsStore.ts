import crypto from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import type {
  AnalyticsTimePeriod,
  Article,
  DetailedAnalytics,
  PiecePerformanceItem,
  TrafficAnalyticsSnapshot,
  TrafficDayAggregate,
  TrafficPeriodAggregate,
  TrafficPieceAggregate
} from '../types.js';
import { getDb } from './db.js';

const DAILY_COLLECTION = 'analytics_daily';
const TRAFFIC_CACHE_TTL_MS = 30_000;
const MAX_DAILY_DOCUMENTS = 800;

type DurableTrafficEvent =
  | 'site_visit'
  | 'piece_view'
  | 'preview_view'
  | 'unlock_select'
  | 'payment_init';

type DailyDocument = {
  date?: unknown;
  siteVisits?: unknown;
  uniqueVisitors?: unknown;
  pieceViews?: unknown;
  previewViews?: unknown;
  unlockStarts?: unknown;
  paymentStarts?: unknown;
  pieces?: unknown;
};

type PeriodRange = {
  currentStart: string;
  currentEnd: string;
  previousStart?: string;
  previousEnd?: string;
};

let trafficCache = new Map<string, { expiresAt: number; value: TrafficAnalyticsSnapshot }>();

function safeCount(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 0;
}

function formatNairobiDay(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function isDay(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function addDays(day: string, amount: number): string {
  const [year, month, date] = day.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, date));
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function daysBetweenInclusive(start: string, end: string): number {
  const startMs = Date.parse(`${start}T00:00:00.000Z`);
  const endMs = Date.parse(`${end}T00:00:00.000Z`);
  return Math.max(1, Math.floor((endMs - startMs) / 86_400_000) + 1);
}

export function resolveTrafficPeriodRange(options: {
  period?: AnalyticsTimePeriod | string;
  startDate?: string;
  endDate?: string;
  now?: Date;
} = {}): PeriodRange {
  const today = formatNairobiDay(options.now || new Date());
  const period = options.period || '30d';

  if (period === 'today') {
    return {
      currentStart: today,
      currentEnd: today,
      previousStart: addDays(today, -1),
      previousEnd: addDays(today, -1)
    };
  }

  if (period === '7d' || period === '30d' || period === '90d') {
    const days = Number(period.slice(0, -1));
    const currentStart = addDays(today, -(days - 1));
    const previousEnd = addDays(currentStart, -1);
    return {
      currentStart,
      currentEnd: today,
      previousStart: addDays(previousEnd, -(days - 1)),
      previousEnd
    };
  }

  if (period === 'this_year') {
    const year = Number(today.slice(0, 4));
    const monthDay = today.slice(4);
    return {
      currentStart: `${year}-01-01`,
      currentEnd: today,
      previousStart: `${year - 1}-01-01`,
      previousEnd: `${year - 1}${monthDay}`
    };
  }

  if (period === 'custom' && isDay(options.startDate)) {
    const requestedEnd = isDay(options.endDate) ? options.endDate : today;
    const currentStart = options.startDate <= requestedEnd ? options.startDate : requestedEnd;
    const currentEnd = requestedEnd >= options.startDate ? requestedEnd : options.startDate;
    const durationDays = daysBetweenInclusive(currentStart, currentEnd);
    const previousEnd = addDays(currentStart, -1);
    return {
      currentStart,
      currentEnd,
      previousStart: addDays(previousEnd, -(durationDays - 1)),
      previousEnd
    };
  }

  return { currentStart: '1970-01-01', currentEnd: today };
}

function pieceMapKey(articleId: string): string {
  return `p_${crypto.createHash('sha256').update(articleId).digest('hex').slice(0, 24)}`;
}

export function normalizeTrafficEventType(
  eventType: unknown,
  articleId?: unknown,
  metadata?: unknown
): string {
  const type = typeof eventType === 'string' ? eventType.trim() : '';
  const meta = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? metadata as Record<string, unknown>
    : {};
  if (meta.type === 'topic_click') return 'topic_click';
  if (type === 'view') return typeof articleId === 'string' && articleId ? 'piece_view' : 'site_visit';
  if (type === 'preview_read') return 'preview_view';
  if (type === 'unlock_start') return 'unlock_select';
  if (type === 'site_page_view') return 'site_visit';
  return type;
}

export async function recordDurableTrafficEvent(input: {
  eventType: string;
  articleId?: string;
  metadata?: Record<string, unknown>;
  now?: Date;
}): Promise<void> {
  const eventType = input.eventType as DurableTrafficEvent;
  if (!['site_visit', 'piece_view', 'preview_view', 'unlock_select', 'payment_init'].includes(eventType)) {
    return;
  }

  const articleId = typeof input.articleId === 'string' ? input.articleId.trim() : '';
  if (eventType !== 'site_visit' && !articleId) return;

  const day = formatNairobiDay(input.now || new Date());
  const increment = FieldValue.increment(1);
  const update: Record<string, unknown> = {
    schemaVersion: 1,
    date: day,
    updatedAt: new Date().toISOString()
  };

  if (eventType === 'site_visit') {
    update.siteVisits = increment;
    if (input.metadata?.firstVisitToday === true) update.uniqueVisitors = FieldValue.increment(1);
  } else {
    const pieceCounters: Record<string, unknown> = { articleId };
    if (eventType === 'piece_view') {
      update.pieceViews = increment;
      pieceCounters.views = FieldValue.increment(1);
    } else if (eventType === 'preview_view') {
      update.previewViews = increment;
      pieceCounters.previews = FieldValue.increment(1);
    } else if (eventType === 'unlock_select') {
      update.unlockStarts = increment;
      pieceCounters.unlockStarts = FieldValue.increment(1);
    } else if (eventType === 'payment_init') {
      update.paymentStarts = increment;
      pieceCounters.paymentStarts = FieldValue.increment(1);
    }
    update.pieces = { [pieceMapKey(articleId)]: pieceCounters };
  }

  await getDb().collection(DAILY_COLLECTION).doc(day).set(update, { merge: true });
  trafficCache.clear();
}

function emptyPiece(articleId: string): TrafficPieceAggregate {
  return { articleId, views: 0, previews: 0, unlockStarts: 0, paymentStarts: 0 };
}

function normalizeDayDocument(id: string, raw: DailyDocument): TrafficDayAggregate {
  const pieces: Record<string, TrafficPieceAggregate> = {};
  const rawPieces = raw.pieces && typeof raw.pieces === 'object' && !Array.isArray(raw.pieces)
    ? raw.pieces as Record<string, unknown>
    : {};

  for (const candidate of Object.values(rawPieces)) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const value = candidate as Record<string, unknown>;
    const articleId = typeof value.articleId === 'string' ? value.articleId.trim() : '';
    if (!articleId) continue;
    const current = pieces[articleId] || emptyPiece(articleId);
    pieces[articleId] = {
      articleId,
      views: current.views + safeCount(value.views),
      previews: current.previews + safeCount(value.previews),
      unlockStarts: current.unlockStarts + safeCount(value.unlockStarts),
      paymentStarts: current.paymentStarts + safeCount(value.paymentStarts)
    };
  }

  return {
    date: isDay(raw.date) ? raw.date : id,
    siteVisits: safeCount(raw.siteVisits),
    uniqueVisitors: safeCount(raw.uniqueVisitors),
    pieceViews: safeCount(raw.pieceViews),
    previewViews: safeCount(raw.previewViews),
    unlockStarts: safeCount(raw.unlockStarts),
    paymentStarts: safeCount(raw.paymentStarts),
    pieces
  };
}

function aggregateDays(days: TrafficDayAggregate[]): TrafficPeriodAggregate {
  const result: TrafficPeriodAggregate = {
    siteVisits: 0,
    uniqueVisitors: 0,
    pieceViews: 0,
    previewViews: 0,
    unlockStarts: 0,
    paymentStarts: 0,
    pieces: {},
    days
  };

  for (const day of days) {
    result.siteVisits += day.siteVisits;
    result.uniqueVisitors += day.uniqueVisitors;
    result.pieceViews += day.pieceViews;
    result.previewViews += day.previewViews;
    result.unlockStarts += day.unlockStarts;
    result.paymentStarts += day.paymentStarts;
    for (const piece of Object.values(day.pieces)) {
      const current = result.pieces[piece.articleId] || emptyPiece(piece.articleId);
      result.pieces[piece.articleId] = {
        articleId: piece.articleId,
        views: current.views + piece.views,
        previews: current.previews + piece.previews,
        unlockStarts: current.unlockStarts + piece.unlockStarts,
        paymentStarts: current.paymentStarts + piece.paymentStarts
      };
    }
  }
  return result;
}

function within(day: TrafficDayAggregate, start?: string, end?: string): boolean {
  return Boolean(start && end && day.date >= start && day.date <= end);
}

export async function getDurableTrafficAnalytics(options: {
  period?: AnalyticsTimePeriod | string;
  startDate?: string;
  endDate?: string;
} = {}): Promise<TrafficAnalyticsSnapshot> {
  const range = resolveTrafficPeriodRange(options);
  const cacheKey = JSON.stringify(range);
  const cached = trafficCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const queryStart = range.previousStart || range.currentStart;
  const snapshot = await getDb()
    .collection(DAILY_COLLECTION)
    .where('date', '>=', queryStart)
    .where('date', '<=', range.currentEnd)
    .orderBy('date', 'asc')
    .limit(MAX_DAILY_DOCUMENTS)
    .get();

  const days = snapshot.docs.map(document => normalizeDayDocument(document.id, document.data()));
  const currentDays = days.filter(day => within(day, range.currentStart, range.currentEnd));
  const previousDays = days.filter(day => within(day, range.previousStart, range.previousEnd));
  let trackingSince = days[0]?.date;

  if (!trackingSince || range.currentStart !== '1970-01-01') {
    const earliest = await getDb().collection(DAILY_COLLECTION).orderBy('date', 'asc').limit(1).get();
    const earliestRaw = earliest.docs[0];
    if (earliestRaw) trackingSince = normalizeDayDocument(earliestRaw.id, earliestRaw.data()).date;
  }

  const value: TrafficAnalyticsSnapshot = {
    trackingSince,
    current: aggregateDays(currentDays),
    previous: aggregateDays(previousDays)
  };
  trafficCache.set(cacheKey, { expiresAt: Date.now() + TRAFFIC_CACHE_TTL_MS, value });
  return value;
}

function growth(current: number, previous: number): number {
  if (previous <= 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 1_000) / 10;
}

function conversion(count: number, total: number): number {
  return total > 0 ? Math.round((count / total) * 1_000) / 10 : 0;
}

export function mergeDurableTrafficIntoAnalytics(
  analytics: DetailedAnalytics,
  snapshot: TrafficAnalyticsSnapshot,
  articles: Article[]
): DetailedAnalytics {
  const current = snapshot.current;
  const previous = snapshot.previous;
  const pieceAnalytics: PiecePerformanceItem[] = analytics.pieceAnalytics.map(piece => {
    const traffic = current.pieces[piece.articleId] || emptyPiece(piece.articleId);
    const purchases = piece.purchasesCount || piece.confirmedPurchases || 0;
    return {
      ...piece,
      views: traffic.views,
      viewsCount: traffic.views,
      uniqueReaders: undefined,
      previewViews: traffic.previews,
      previewCount: traffic.previews,
      paymentAttempts: traffic.paymentStarts,
      conversionRate: conversion(purchases, traffic.views)
    };
  });
  const pieceById = new Map(pieceAnalytics.map(piece => [piece.articleId, piece]));
  const visitors = current.uniqueVisitors;
  const pieceViews = current.pieceViews;
  const purchases = analytics.purchases.confirmedCount;

  const timeSeriesDates = analytics.timeSeries.map(point => point.date.slice(0, 10));
  const hasOnePointPerDay = new Set(timeSeriesDates).size === analytics.timeSeries.length;
  const timeSeries = hasOnePointPerDay
    ? analytics.timeSeries.map(point => {
        const date = point.date.slice(0, 10);
        const matchingDays = date.length === 7
          ? current.days.filter(candidate => candidate.date.startsWith(`${date}-`))
          : current.days.filter(candidate => candidate.date === date);
        const traffic = matchingDays.reduce(
          (sum, day) => ({
            pieceViews: sum.pieceViews + day.pieceViews,
            previewViews: sum.previewViews + day.previewViews,
            siteVisits: sum.siteVisits + day.siteVisits,
            uniqueVisitors: sum.uniqueVisitors + day.uniqueVisitors
          }),
          { pieceViews: 0, previewViews: 0, siteVisits: 0, uniqueVisitors: 0 }
        );
        return {
          ...point,
          viewsCount: traffic.pieceViews,
          previewCount: traffic.previewViews,
          uniqueReaders: traffic.uniqueVisitors,
          siteVisits: traffic.siteVisits,
          uniqueVisitors: traffic.uniqueVisitors
        };
      })
    : analytics.timeSeries.length > 0
      ? (() => {
          const totals = analytics.timeSeries.reduce(
            (sum, point) => ({
              revenueKes: sum.revenueKes + point.revenueKes,
              salesRevenueKes: sum.salesRevenueKes + (point.salesRevenueKes || 0),
              tipsRevenueKes: sum.tipsRevenueKes + (point.tipsRevenueKes || 0),
              purchasesCount: sum.purchasesCount + point.purchasesCount,
              tipsCount: sum.tipsCount + (point.tipsCount || 0)
            }),
            { revenueKes: 0, salesRevenueKes: 0, tipsRevenueKes: 0, purchasesCount: 0, tipsCount: 0 }
          );
          return [{
            date: current.days[0]?.date || analytics.endDate,
            label: 'Today total',
            ...totals,
            averagePurchaseKes: totals.purchasesCount > 0
              ? Math.round((totals.salesRevenueKes / totals.purchasesCount) * 100) / 100
              : 0,
            viewsCount: current.pieceViews,
            previewCount: current.previewViews,
            uniqueReaders: current.uniqueVisitors,
            siteVisits: current.siteVisits,
            uniqueVisitors: current.uniqueVisitors
          }];
        })()
      : [];

  const topViewedArticles = articles
    .map(article => ({ ...article, viewsCount: pieceById.get(article.id)?.viewsCount || 0 }))
    .sort((left, right) => (right.viewsCount || 0) - (left.viewsCount || 0))
    .slice(0, 5);

  const funnelCounts = [pieceViews, current.previewViews, current.paymentStarts, purchases];
  const funnelLabels = ['1. Piece Views', '2. Preview Reads', '3. Checkout Initiated', '4. Confirmed Purchases'];
  const funnelStages = funnelCounts.map((count, index) => ({
    stage: ['view', 'preview', 'checkout', 'purchase'][index],
    label: funnelLabels[index],
    count,
    conversionFromPrevious: conversion(count, index === 0 ? count : funnelCounts[index - 1]),
    percentageOfTop: conversion(count, pieceViews)
  }));

  return {
    ...analytics,
    traffic: {
      siteVisits: current.siteVisits,
      uniqueVisitors: visitors,
      pieceViews,
      previewViews: current.previewViews,
      trackingSince: snapshot.trackingSince,
      collectionNote: 'Traffic uses privacy-safe first-party counters. Sales and revenue include settled payment records only.'
    },
    overview: {
      ...analytics.overview,
      uniqueReadersCount: visitors,
      totalViewsCount: pieceViews,
      conversionRate: conversion(purchases, pieceViews)
    },
    growth: {
      ...analytics.growth,
      readersGrowth: growth(current.siteVisits, previous.siteVisits),
      viewsGrowthPercent: growth(pieceViews, previous.pieceViews),
      previousPeriodViewsCount: previous.pieceViews
    },
    readers: {
      ...analytics.readers,
      uniqueReadersCount: visitors,
      totalArticleViews: pieceViews,
      totalPreviewReads: current.previewViews,
      averageViewsPerReader: visitors > 0 ? Math.round((pieceViews / visitors) * 10) / 10 : 0
    },
    conversion: {
      ...analytics.conversion,
      overallConversionRate: conversion(purchases, pieceViews),
      previewToPurchaseRate: conversion(purchases, current.previewViews),
      checkoutToPurchaseRate: conversion(purchases, current.paymentStarts),
      estimatedVisitors: current.siteVisits,
      totalArticleViews: pieceViews,
      totalUnlocks: current.unlockStarts
    },
    timeSeries,
    conversionFunnel: {
      viewsToPurchaseRate: conversion(purchases, pieceViews),
      previewToCheckoutRate: conversion(current.paymentStarts, current.previewViews),
      checkoutToPurchaseRate: conversion(purchases, current.paymentStarts),
      overallRate: conversion(purchases, pieceViews),
      stages: funnelStages
    },
    funnel: {
      stages: funnelStages.map((stage, index) => {
        const previousCount = index === 0 ? stage.count : funnelStages[index - 1].count;
        return {
          stage: stage.label,
          count: stage.count,
          conversionFromPrev: conversion(stage.count, previousCount),
          conversionFromTotal: conversion(stage.count, pieceViews),
          dropoffCount: Math.max(0, previousCount - stage.count),
          dropoffPercent: conversion(Math.max(0, previousCount - stage.count), previousCount)
        };
      }),
      pieceViews,
      previewSynopsisViews: current.previewViews,
      unlockSelected: current.unlockStarts,
      paymentInitiated: current.paymentStarts,
      paymentConfirmed: purchases
    },
    homepagePerformance: {
      ...analytics.homepagePerformance,
      pieceOfTheWeek: analytics.homepagePerformance.pieceOfTheWeek
        ? {
            ...analytics.homepagePerformance.pieceOfTheWeek,
            views: pieceById.get(analytics.homepagePerformance.pieceOfTheWeek.articleId)?.viewsCount || 0
          }
        : undefined,
      mostSellingPieces: analytics.homepagePerformance.mostSellingPieces.map(item => ({
        ...item,
        views: pieceById.get(item.articleId)?.viewsCount || 0
      }))
    },
    pieceAnalytics,
    piecePerformance: pieceAnalytics,
    categoryPerformance: analytics.categoryPerformance?.map(category => ({
      ...category,
      viewsCount: pieceAnalytics
        .filter(piece => piece.categories?.includes(category.categoryName) || piece.category === category.categoryName)
        .reduce((sum, piece) => sum + (piece.viewsCount || 0), 0)
    })),
    // Topic aggregates are retained until topic-level durable counters are available.
    // Recomputing them from only the displayed "top pieces" would undercount them.
    topicPerformance: analytics.topicPerformance,
    content: analytics.content
      ? { ...analytics.content, totalViews: pieceViews, topViewedPieces: topViewedArticles }
      : analytics.content
  };
}

export function resetAnalyticsStoreCacheForTests(): void {
  trafficCache = new Map();
}
