import crypto from 'crypto';

import type {
  AffiliateAccount,
  AffiliateAnalyticsFilters,
  AffiliateAnalyticsReport,
  AffiliateAnalyticsWindow,
  AffiliateClickEvent,
  AffiliateSaleCommission,
  PaymentTransaction,
} from '../types.js';
import { isVerifiedAffiliateCommission, literaryCirclePeriodKey } from './literaryCircle.js';
import { isSettledTransactionStatus, recordedAffiliateCommissionPaidKes } from './salesLedger.js';
import type { DurableAffiliateClickCoverageAssessment } from './affiliateClickLedger.js';

const DAY_MS = 86_400_000;
const NAIROBI_TIME_ZONE = 'Africa/Nairobi';
const BUYER_KEY_PREFIX = 'abk1_';
const BUYER_KEY_PATTERN = /^abk1_[A-Za-z0-9_-]{43}$/;

export const MAX_AFFILIATE_ANALYTICS_WINDOW_DAYS = 366;

export class AffiliateAnalyticsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AffiliateAnalyticsValidationError';
  }
}

export type { AffiliateAnalyticsFilters, AffiliateAnalyticsReport, AffiliateAnalyticsWindow } from '../types.js';

export interface AffiliateBuyerKeyProjection {
  keysByCommissionId: Record<string, string>;
  matchedCount: number;
  unmatchedCount: number;
  ambiguousCount: number;
}

function nairobiDay(value: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: NAIROBI_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function parseNairobiDay(value: unknown): { day: string; startMs: number } | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const startMs = Date.parse(`${value}T00:00:00+03:00`);
  if (!Number.isFinite(startMs) || nairobiDay(new Date(startMs)) !== value) return null;
  return { day: value, startMs };
}

function addDays(day: string, amount: number): string {
  const parsed = parseNairobiDay(day);
  if (!parsed) throw new AffiliateAnalyticsValidationError('Analytics dates must use YYYY-MM-DD.');
  return nairobiDay(new Date(parsed.startMs + amount * DAY_MS));
}

export function resolveAffiliateAnalyticsWindow(options: {
  startDate?: string;
  endDate?: string;
  now?: Date;
} = {}): AffiliateAnalyticsWindow {
  const now = options.now && Number.isFinite(options.now.getTime()) ? options.now : new Date();
  const today = nairobiDay(now);
  const hasCustomDate = Boolean(options.startDate || options.endDate);
  if (hasCustomDate && (!options.startDate || !options.endDate)) {
    throw new AffiliateAnalyticsValidationError('Choose both a start date and an end date.');
  }
  const startDate = options.startDate || addDays(today, -89);
  const endDate = options.endDate || today;
  const start = parseNairobiDay(startDate);
  const end = parseNairobiDay(endDate);
  if (!start || !end) {
    throw new AffiliateAnalyticsValidationError('Analytics dates must be real calendar dates in YYYY-MM-DD format.');
  }
  if (start.startMs > end.startMs) {
    throw new AffiliateAnalyticsValidationError('The analytics start date must not be after the end date.');
  }
  const days = Math.floor((end.startMs - start.startMs) / DAY_MS) + 1;
  if (days > MAX_AFFILIATE_ANALYTICS_WINDOW_DAYS) {
    throw new AffiliateAnalyticsValidationError(
      `Affiliate analytics windows cannot exceed ${MAX_AFFILIATE_ANALYTICS_WINDOW_DAYS} days.`,
    );
  }
  return {
    startDate,
    endDate,
    startsAt: new Date(start.startMs).toISOString(),
    endsAt: new Date(end.startMs + DAY_MS - 1).toISOString(),
    days,
    timeZone: NAIROBI_TIME_ZONE,
  };
}

function resolveBuyerIdentity(input: { readerId?: unknown; phoneNumber?: unknown }): string | null {
  const readerId = typeof input.readerId === 'string' ? input.readerId.trim() : '';
  if (readerId && readerId.length <= 256 && !/[\u0000-\u001f\u007f]/.test(readerId)) {
    return `reader:${readerId}`;
  }

  const digits = typeof input.phoneNumber === 'string' ? input.phoneNumber.replace(/\D/g, '') : '';
  let phone = digits;
  if (phone.startsWith('2540')) phone = `254${phone.slice(4)}`;
  else if (/^0[17]\d{8}$/.test(phone)) phone = `254${phone.slice(1)}`;
  else if (/^[17]\d{8}$/.test(phone)) phone = `254${phone}`;
  if (/^254[17]\d{8}$/.test(phone)) return `mpesa:${phone}`;
  return null;
}

function resolveAffiliateAnalyticsSecret(secret: string | Buffer): Buffer {
  const secretBuffer = Buffer.isBuffer(secret) ? secret : Buffer.from(secret || '', 'utf8');
  if (secretBuffer.length < 32) {
    throw new AffiliateAnalyticsValidationError('Affiliate analytics requires a dedicated secret of at least 32 bytes.');
  }
  return secretBuffer;
}

export function deriveAffiliateBuyerAnalyticsKey(
  input: { readerId?: unknown; phoneNumber?: unknown },
  secret: string | Buffer,
): string | null {
  const secretBuffer = resolveAffiliateAnalyticsSecret(secret);
  const identity = resolveBuyerIdentity(input);
  if (!identity) return null;
  const digest = crypto
    .createHmac('sha256', secretBuffer)
    .update(`ink-witness:affiliate-buyer:v1\u0000${identity}`, 'utf8')
    .digest('base64url');
  return `${BUYER_KEY_PREFIX}${digest}`;
}

function safeIdentifier(value: unknown): string {
  return typeof value === 'string' && value.trim().length <= 256 ? value.trim() : '';
}

function normalizeFilters(value: AffiliateAnalyticsFilters | undefined): AffiliateAnalyticsFilters {
  const affiliateId = safeIdentifier(value?.affiliateId);
  const articleId = safeIdentifier(value?.articleId);
  const subscriptionPlanId = safeIdentifier(value?.subscriptionPlanId);
  const literaryCircleTierId = safeIdentifier(value?.literaryCircleTierId);
  const purchaseKind = value?.purchaseKind === 'piece'
    || value?.purchaseKind === 'bundle'
    || value?.purchaseKind === 'subscription'
    ? value.purchaseKind
    : undefined;
  return {
    ...(affiliateId ? { affiliateId } : {}),
    ...(articleId ? { articleId } : {}),
    ...(purchaseKind ? { purchaseKind } : {}),
    ...(subscriptionPlanId ? { subscriptionPlanId } : {}),
    ...(literaryCircleTierId ? { literaryCircleTierId } : {}),
  };
}

function transactionIndexKeys(transaction: PaymentTransaction): string[] {
  const keys = [
    ['order', transaction.orderId],
    ['checkout', transaction.checkoutRequestId],
    ['transaction', transaction.id],
    ['receipt', transaction.mpesaReceiptNumber || transaction.receiptNumber || transaction.bankReference],
  ] as const;
  return keys.flatMap(([namespace, value]) => {
    const clean = safeIdentifier(value);
    return clean ? [`${namespace}:${clean}`] : [];
  });
}

function commissionIndexKeys(commission: AffiliateSaleCommission): string[] {
  const keys: string[] = [];
  const orderId = safeIdentifier(commission.orderId);
  const checkoutRequestId = safeIdentifier(commission.checkoutRequestId);
  const transactionId = safeIdentifier(commission.transactionId);
  const receiptNumber = safeIdentifier(commission.receiptNumber);
  if (orderId) keys.push(`order:${orderId}`);
  if (checkoutRequestId) keys.push(`checkout:${checkoutRequestId}`);
  if (transactionId) {
    keys.push(`transaction:${transactionId}`);
    keys.push(`checkout:${transactionId}`);
  }
  if (receiptNumber) keys.push(`receipt:${receiptNumber}`);
  return [...new Set(keys)];
}

function paymentAmountsMatch(commission: AffiliateSaleCommission, transaction: PaymentTransaction): boolean {
  const commissionAmount = Number(commission.saleAmountKes);
  const transactionAmount = Number(transaction.amount);
  return Number.isFinite(commissionAmount)
    && Number.isFinite(transactionAmount)
    && commissionAmount > 0
    && transactionAmount > 0
    && Math.abs(commissionAmount - transactionAmount) < 0.01;
}

export function projectAffiliateBuyerAnalyticsKeys(options: {
  commissions: AffiliateSaleCommission[];
  transactions: PaymentTransaction[];
  secret: string | Buffer;
}): AffiliateBuyerKeyProjection {
  const secret = resolveAffiliateAnalyticsSecret(options.secret);
  const index = new Map<string, PaymentTransaction | null>();
  for (const transaction of options.transactions) {
    if (!isSettledTransactionStatus(transaction.status)) continue;
    for (const key of transactionIndexKeys(transaction)) {
      if (!index.has(key)) {
        index.set(key, transaction);
      } else if (index.get(key) !== transaction) {
        index.set(key, null);
      }
    }
  }

  const result: AffiliateBuyerKeyProjection = {
    keysByCommissionId: {},
    matchedCount: 0,
    unmatchedCount: 0,
    ambiguousCount: 0,
  };
  for (const commission of options.commissions) {
    if (!isVerifiedAffiliateCommission(commission)) continue;
    const matches = new Set<PaymentTransaction>();
    let hasAmbiguousIndex = false;
    for (const key of commissionIndexKeys(commission)) {
      if (!index.has(key)) continue;
      const transaction = index.get(key);
      if (!transaction) hasAmbiguousIndex = true;
      else matches.add(transaction);
    }
    if (hasAmbiguousIndex || matches.size > 1) {
      result.ambiguousCount += 1;
      continue;
    }
    const transaction = [...matches][0];
    if (
      !transaction
      || !paymentAmountsMatch(commission, transaction)
      || transaction.saleChannel === 'DIRECT'
      || (transaction.affiliateCode
        && safeIdentifier(transaction.affiliateCode).toUpperCase()
          !== safeIdentifier(commission.affiliateCode).toUpperCase())
    ) {
      result.unmatchedCount += 1;
      continue;
    }
    const key = deriveAffiliateBuyerAnalyticsKey({
      readerId: transaction.buyer?.userId || transaction.userId,
      phoneNumber: transaction.buyer?.phoneNumber || transaction.phoneNumber,
    }, secret);
    if (!key) {
      result.unmatchedCount += 1;
      continue;
    }
    result.keysByCommissionId[commission.id] = key;
    result.matchedCount += 1;
  }
  return result;
}

function safeMoney(value: unknown): number {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function roundKes(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function purchaseKind(commission: AffiliateSaleCommission): 'piece' | 'bundle' | 'subscription' {
  return commission.purchaseKind === 'bundle' || commission.purchaseKind === 'subscription'
    ? commission.purchaseKind
    : 'piece';
}

function commissionDeduplicationKey(commission: AffiliateSaleCommission): string {
  const candidates = [
    ['receipt', commission.receiptNumber],
    ['order', commission.orderId],
    ['checkout', commission.checkoutRequestId],
    ['transaction', commission.transactionId],
  ] as const;
  for (const [namespace, value] of candidates) {
    const clean = safeIdentifier(value);
    if (clean) return `${namespace}:${clean}`;
  }
  return `commission:${commission.id}`;
}

function commissionStatusRank(status: AffiliateSaleCommission['status']): number {
  if (status === 'PAID') return 3;
  if (status === 'APPROVED') return 2;
  if (status === 'PENDING') return 1;
  return 0;
}

function selectCanonicalCommissions(commissions: AffiliateSaleCommission[]): {
  commissions: AffiliateSaleCommission[];
  duplicates: number;
} {
  const selected = new Map<string, AffiliateSaleCommission>();
  let duplicates = 0;
  for (const commission of [...commissions].sort((left, right) => (
    Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.id.localeCompare(right.id)
  ))) {
    const key = commissionDeduplicationKey(commission);
    const existing = selected.get(key);
    if (!existing) {
      selected.set(key, commission);
      continue;
    }
    duplicates += 1;
    if (commissionStatusRank(commission.status) > commissionStatusRank(existing.status)) {
      selected.set(key, commission);
    }
  }
  return { commissions: [...selected.values()], duplicates };
}

function matchesFilters(commission: AffiliateSaleCommission, filters: AffiliateAnalyticsFilters): boolean {
  return (!filters.affiliateId || commission.affiliateId === filters.affiliateId)
    && (!filters.articleId || commission.articleId === filters.articleId)
    && (!filters.purchaseKind || purchaseKind(commission) === filters.purchaseKind)
    && (!filters.subscriptionPlanId || commission.subscriptionPlanId === filters.subscriptionPlanId)
    && (!filters.literaryCircleTierId || commission.literaryCircleTierId === filters.literaryCircleTierId);
}

function monthKeys(startDate: string, endDate: string): string[] {
  const start = /^([0-9]{4})-([0-9]{2})/.exec(startDate);
  const end = /^([0-9]{4})-([0-9]{2})/.exec(endDate);
  if (!start || !end) return [];
  let year = Number(start[1]);
  let month = Number(start[2]);
  const endValue = Number(end[1]) * 12 + Number(end[2]);
  const keys: string[] = [];
  while (year * 12 + month <= endValue && keys.length <= 13) {
    keys.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return keys;
}

function offerKey(commission: AffiliateSaleCommission): string {
  const kind = purchaseKind(commission);
  const id = kind === 'subscription'
    ? safeIdentifier(commission.subscriptionPlanId) || safeIdentifier(commission.articleId)
    : safeIdentifier(commission.articleId);
  return `${kind}:${id || 'unknown'}`;
}

export function buildAffiliateAnalyticsReport(options: {
  affiliates: AffiliateAccount[];
  commissions: AffiliateSaleCommission[];
  buyerKeysByCommissionId?: Readonly<Record<string, string>>;
  /** Explicit runtime proof, never inferred from selected-window coverage. */
  buyerHistoryComplete?: boolean;
  buyerHistoryReason?: AffiliateAnalyticsReport['buyerMetrics']['reason'];
  clickEvents?: AffiliateClickEvent[];
  clickHistoryCompleteForWindow?: boolean;
  clickCoverageAssessment?: DurableAffiliateClickCoverageAssessment;
  clickHistoryQueriedThrough?: string;
  startDate?: string;
  endDate?: string;
  now?: Date;
  filters?: AffiliateAnalyticsFilters;
}): AffiliateAnalyticsReport {
  const now = options.now && Number.isFinite(options.now.getTime()) ? options.now : new Date();
  const generatedAt = now.toISOString();
  const window = resolveAffiliateAnalyticsWindow({
    startDate: options.startDate,
    endDate: options.endDate,
    now,
  });
  const filters = normalizeFilters(options.filters);
  const startsAtMs = Date.parse(window.startsAt);
  const endsAtMs = Date.parse(window.endsAt);
  let invalidRecordsExcluded = 0;
  let unverifiedRecordsExcluded = 0;
  const eligibleInWindow: AffiliateSaleCommission[] = [];

  for (const commission of options.commissions) {
    const createdAt = Date.parse(commission.createdAt);
    if (!Number.isFinite(createdAt)) {
      invalidRecordsExcluded += 1;
      continue;
    }
    if (createdAt < startsAtMs || createdAt > endsAtMs) continue;
    if (!isVerifiedAffiliateCommission(commission)) {
      unverifiedRecordsExcluded += 1;
      continue;
    }
    if (!safeMoney(commission.saleAmountKes)) {
      invalidRecordsExcluded += 1;
      continue;
    }
    eligibleInWindow.push(commission);
  }

  const canonicalWindow = selectCanonicalCommissions(eligibleInWindow);
  const selected = canonicalWindow.commissions.filter(commission => matchesFilters(commission, filters));
  const lifetimeEligible = options.commissions.filter(commission => (
    isVerifiedAffiliateCommission(commission)
    && Number.isFinite(Date.parse(commission.createdAt))
    && safeMoney(commission.saleAmountKes) > 0
  ));
  const lifetimeCanonical = selectCanonicalCommissions(lifetimeEligible).commissions;
  const affiliatesWithLifetimeSales = new Set(lifetimeCanonical.map(commission => commission.affiliateId));
  const affiliatesWithWindowSales = new Set(selected.map(commission => commission.affiliateId));

  const totals = selected.reduce<AffiliateAnalyticsReport['totals']>((result, commission) => {
    const kind = purchaseKind(commission);
    const gross = safeMoney(commission.saleAmountKes);
    const recordedCommission = safeMoney(commission.commissionAmountKes);
    const retained = safeMoney(commission.grossCreatorRevenueKes) || Math.max(0, gross - recordedCommission);
    result.verifiedSales += 1;
    result.pieceSales += kind === 'piece' ? 1 : 0;
    result.bundleSales += kind === 'bundle' ? 1 : 0;
    result.subscriptionSales += kind === 'subscription' ? 1 : 0;
    result.grossSalesKes += gross;
    result.commissionsRecordedKes += recordedCommission;
    result.commissionsPaidKes += recordedAffiliateCommissionPaidKes(commission);
    result.retainedRevenueKes += retained;
    return result;
  }, {
    verifiedSales: 0,
    pieceSales: 0,
    bundleSales: 0,
    subscriptionSales: 0,
    grossSalesKes: 0,
    commissionsRecordedKes: 0,
    commissionsPaidKes: 0,
    retainedRevenueKes: 0,
  });
  totals.grossSalesKes = roundKes(totals.grossSalesKes);
  totals.commissionsRecordedKes = roundKes(totals.commissionsRecordedKes);
  totals.commissionsPaidKes = roundKes(totals.commissionsPaidKes);
  totals.retainedRevenueKes = roundKes(totals.retainedRevenueKes);

  const buyerProjectionProvided = options.buyerKeysByCommissionId !== undefined;
  const buyerKeys = options.buyerKeysByCommissionId || {};
  const selectedIdentities = selected.flatMap(commission => {
    const key = buyerKeys[commission.id];
    return typeof key === 'string' && BUYER_KEY_PATTERN.test(key) ? [{ commission, key }] : [];
  });
  const earliestAffiliatePurchase = new Map<string, { createdAt: number; commissionId: string }>();
  for (const commission of lifetimeCanonical) {
    const key = buyerKeys[commission.id];
    const createdAt = Date.parse(commission.createdAt);
    if (!key || !BUYER_KEY_PATTERN.test(key) || !Number.isFinite(createdAt)) continue;
    const current = earliestAffiliatePurchase.get(key);
    if (!current || createdAt < current.createdAt) {
      earliestAffiliatePurchase.set(key, { createdAt, commissionId: commission.id });
    }
  }
  const uniqueIdentities = new Set(selectedIdentities.map(item => item.key));
  const newIdentities = new Set(selectedIdentities
    .filter(item => {
      const first = earliestAffiliatePurchase.get(item.key);
      return first !== undefined
        && first.commissionId === item.commission.id
        && first.createdAt >= startsAtMs
        && first.createdAt <= endsAtMs;
    })
    .map(item => item.key));
  const repeatSales = selectedIdentities.filter(item => {
    const first = earliestAffiliatePurchase.get(item.key);
    return first !== undefined && Date.parse(item.commission.createdAt) > first.createdAt;
  });
  const buyerCoverage = !buyerProjectionProvided
    ? 'unavailable' as const
    : selected.length === 0 || selectedIdentities.length === selected.length
      ? 'complete' as const
      : selectedIdentities.length > 0
        ? 'partial' as const
        : 'unavailable' as const;
  const buyerHistoryComplete = options.buyerHistoryComplete !== false
    && lifetimeCanonical.every(commission => BUYER_KEY_PATTERN.test(buyerKeys[commission.id] || ''));

  let referralTraffic: AffiliateAnalyticsReport['referralTraffic'];
  const clickFilterUnsupported = Boolean(filters.purchaseKind || filters.subscriptionPlanId || filters.literaryCircleTierId);
  if (clickFilterUnsupported) {
    referralTraffic = {
      coverage: 'unavailable',
      reason: 'unsupported_filter',
      clicks: null,
      knownUniqueVisitors: null,
      clicksWithoutVisitorKey: null,
      conversionRate: null,
    };
  } else if (!options.clickEvents) {
    referralTraffic = {
      coverage: 'unavailable',
      reason: 'not_provided',
      clicks: null,
      knownUniqueVisitors: null,
      clicksWithoutVisitorKey: null,
      conversionRate: null,
    };
  } else if (options.clickCoverageAssessment?.eventCoverage === 'unavailable') {
    referralTraffic = {
      coverage: 'unavailable',
      reason: options.clickCoverageAssessment.reasons[0] || 'query_failed',
      coverageReasons: options.clickCoverageAssessment.reasons,
      ...(options.clickHistoryQueriedThrough
        ? { queriedThrough: options.clickHistoryQueriedThrough }
        : {}),
      clicks: null,
      knownUniqueVisitors: null,
      clicksWithoutVisitorKey: null,
      conversionRate: null,
    };
  } else {
    const affiliateCodes = filters.affiliateId
      ? new Set(options.affiliates
        .filter(affiliate => affiliate.id === filters.affiliateId)
        .map(affiliate => safeIdentifier(affiliate.affiliateCode).toUpperCase())
        .filter(Boolean))
      : null;
    const seenClickIds = new Set<string>();
    const clicks = options.clickEvents.filter(click => {
      if (!click.id || seenClickIds.has(click.id)) return false;
      seenClickIds.add(click.id);
      const timestamp = Date.parse(click.timestamp);
      return Number.isFinite(timestamp)
        && timestamp >= startsAtMs
        && timestamp <= endsAtMs
        && (!filters.articleId || click.articleId === filters.articleId)
        && (!filters.affiliateId || click.affiliateId === filters.affiliateId
          || Boolean(affiliateCodes?.has(safeIdentifier(click.affiliateCode).toUpperCase())));
    });
    const visitorKeys = new Set(clicks.flatMap(click => {
      const key = click.visitorKey || click.ipHash;
      return key ? [key] : [];
    }));
    const withoutVisitorKey = clicks.filter(click => !(click.visitorKey || click.ipHash)).length;
    const complete = options.clickCoverageAssessment
      ? options.clickCoverageAssessment.eventCoverage === 'complete'
        && options.clickCoverageAssessment.uniqueVisitorCoverage === 'complete'
        && withoutVisitorKey === 0
      : options.clickHistoryCompleteForWindow === true && withoutVisitorKey === 0;
    const coverage = complete ? 'complete' as const : 'partial' as const;
    const reason = complete
      ? 'complete' as const
      : (options.clickCoverageAssessment?.reasons.find(value => value !== 'complete')
        || 'incomplete_history' as const);
    referralTraffic = {
      coverage,
      reason,
      ...(options.clickCoverageAssessment
        ? { coverageReasons: options.clickCoverageAssessment.reasons }
        : {}),
      ...(options.clickHistoryQueriedThrough
        ? { queriedThrough: options.clickHistoryQueriedThrough }
        : {}),
      clicks: clicks.length,
      knownUniqueVisitors: visitorKeys.size,
      clicksWithoutVisitorKey: withoutVisitorKey,
      conversionRate: complete
        && !options.clickCoverageAssessment
        && clicks.length > 0
        ? Math.round((selected.length / clicks.length) * 10_000) / 100
        : null,
    };
  }

  const monthly = monthKeys(window.startDate, window.endDate).map(periodKey => {
    const periodSales = selected.filter(commission => literaryCirclePeriodKey(commission.createdAt) === periodKey);
    return periodSales.reduce<AffiliateAnalyticsReport['monthly'][number]>((result, commission) => {
      const gross = safeMoney(commission.saleAmountKes);
      const recordedCommission = safeMoney(commission.commissionAmountKes);
      result.verifiedSales += 1;
      result.grossSalesKes = roundKes(result.grossSalesKes + gross);
      result.commissionsRecordedKes = roundKes(result.commissionsRecordedKes + recordedCommission);
      result.retainedRevenueKes = roundKes(result.retainedRevenueKes
        + (safeMoney(commission.grossCreatorRevenueKes) || Math.max(0, gross - recordedCommission)));
      return result;
    }, { periodKey, verifiedSales: 0, grossSalesKes: 0, commissionsRecordedKes: 0, retainedRevenueKes: 0 });
  });

  const affiliateGroups = new Map<string, AffiliateAnalyticsReport['topAffiliates'][number]>();
  const offerGroups = new Map<string, AffiliateAnalyticsReport['topOffers'][number]>();
  for (const commission of selected) {
    const gross = safeMoney(commission.saleAmountKes);
    const recordedCommission = safeMoney(commission.commissionAmountKes);
    const retained = safeMoney(commission.grossCreatorRevenueKes) || Math.max(0, gross - recordedCommission);
    const affiliate = affiliateGroups.get(commission.affiliateId) || {
      affiliateId: commission.affiliateId,
      affiliateCode: commission.affiliateCode,
      affiliateName: commission.affiliateName,
      verifiedSales: 0,
      grossSalesKes: 0,
      commissionsRecordedKes: 0,
      retainedRevenueKes: 0,
    };
    affiliate.verifiedSales += 1;
    affiliate.grossSalesKes = roundKes(affiliate.grossSalesKes + gross);
    affiliate.commissionsRecordedKes = roundKes(affiliate.commissionsRecordedKes + recordedCommission);
    affiliate.retainedRevenueKes = roundKes(affiliate.retainedRevenueKes + retained);
    affiliateGroups.set(commission.affiliateId, affiliate);

    const key = offerKey(commission);
    const kind = purchaseKind(commission);
    const offer = offerGroups.get(key) || {
      purchaseKind: kind,
      offerId: key.slice(kind.length + 1),
      title: commission.articleTitle || (kind === 'subscription' ? 'Reader Pass' : 'Untitled offer'),
      verifiedSales: 0,
      grossSalesKes: 0,
    };
    offer.verifiedSales += 1;
    offer.grossSalesKes = roundKes(offer.grossSalesKes + gross);
    offerGroups.set(key, offer);
  }

  return {
    generatedAt,
    window,
    filters,
    accounts: {
      registered: options.affiliates.length,
      active: options.affiliates.filter(affiliate => affiliate.status === 'active').length,
      pending: options.affiliates.filter(affiliate => affiliate.status === 'pending').length,
      suspended: options.affiliates.filter(affiliate => affiliate.status === 'suspended').length,
      withLifetimeVerifiedSales: options.affiliates.filter(affiliate => affiliatesWithLifetimeSales.has(affiliate.id)).length,
      withoutLifetimeVerifiedSales: options.affiliates.filter(affiliate => !affiliatesWithLifetimeSales.has(affiliate.id)).length,
      withVerifiedSalesInWindow: options.affiliates.filter(affiliate => affiliatesWithWindowSales.has(affiliate.id)).length,
    },
    totals,
    buyerMetrics: {
      coverage: buyerCoverage,
      ...(options.buyerHistoryComplete !== undefined ? {
        historyCoverage: buyerHistoryComplete ? 'complete' as const : buyerCoverage === 'unavailable' ? 'unavailable' as const : 'partial' as const,
        reason: options.buyerHistoryReason || (buyerHistoryComplete ? 'complete' as const : 'incomplete_history' as const),
      } : {}),
      identifiedSales: selectedIdentities.length,
      unidentifiedSales: selected.length - selectedIdentities.length,
      uniquePayingReaders: buyerCoverage === 'unavailable' ? null : uniqueIdentities.size,
      newAffiliateAcquiredReaders: buyerCoverage === 'unavailable' || !buyerHistoryComplete ? null : newIdentities.size,
      repeatPurchases: buyerCoverage === 'unavailable' || !buyerHistoryComplete ? null : repeatSales.length,
      repeatPayingReaders: buyerCoverage === 'unavailable' || !buyerHistoryComplete ? null : new Set(repeatSales.map(item => item.key)).size,
    },
    referralTraffic,
    monthly,
    topAffiliates: [...affiliateGroups.values()]
      .sort((left, right) => right.grossSalesKes - left.grossSalesKes
        || right.verifiedSales - left.verifiedSales
        || left.affiliateName.localeCompare(right.affiliateName))
      .slice(0, 10),
    topOffers: [...offerGroups.values()]
      .sort((left, right) => right.grossSalesKes - left.grossSalesKes
        || right.verifiedSales - left.verifiedSales
        || left.title.localeCompare(right.title))
      .slice(0, 10),
    integrity: {
      invalidRecordsExcluded,
      unverifiedRecordsExcluded,
      duplicateRecordsExcluded: canonicalWindow.duplicates,
    },
  };
}
