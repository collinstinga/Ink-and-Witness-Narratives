import type {
  AffiliateAnalyticsFilters,
  AffiliateClickEvent,
} from '../types.js';
import {
  assessDurableAffiliateClickCoverage,
  normalizeAffiliateClickAnalyticsActivationV1,
  normalizeDurableAffiliateClickEventV2,
  unavailableDurableAffiliateClickCoverage,
  type AffiliateClickAnalyticsActivationV1,
  type DurableAffiliateClickCoverageAssessment,
} from './affiliateClickLedger.js';
import { getDb } from './db.js';

export const AFFILIATE_CLICK_ANALYTICS_ACTIVATION_DOCUMENT_ID = 'affiliate_click_analytics';
export const MAX_DURABLE_AFFILIATE_CLICK_EVENTS = 1_000;
export const DURABLE_CLICK_INGESTION_SAFETY_LAG_MS = 10 * 60 * 1_000;
const QUERY_LIMIT_WITH_TRUNCATION_SENTINEL = MAX_DURABLE_AFFILIATE_CLICK_EVENTS + 1;

export type DurableAffiliateClickQuerySource =
  | 'legacy'
  | 'durable'
  | 'unavailable'
  | 'unsupported_filter';

export interface DurableAffiliateClickWindowResult {
  source: DurableAffiliateClickQuerySource;
  events: AffiliateClickEvent[];
  coverage?: DurableAffiliateClickCoverageAssessment;
  activation?: AffiliateClickAnalyticsActivationV1;
  queriedThrough?: string;
}

interface DurableAffiliateClickWindowInput {
  rangeStartsAt: string;
  rangeEndsAt: string;
  filters?: AffiliateAnalyticsFilters;
  now: Date;
  runtimeMode: 'off' | 'shadow' | 'required';
  keyFingerprint?: string | null;
}

const inFlightQueries = new Map<string, Promise<DurableAffiliateClickWindowResult>>();

function hasUnsupportedClickFilter(filters: AffiliateAnalyticsFilters | undefined): boolean {
  return Boolean(
    filters?.purchaseKind
    || filters?.subscriptionPlanId
    || filters?.literaryCircleTierId,
  );
}

function validTimestamp(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function firestoreTimestampMillis(value: unknown): number | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value === 'string') return validTimestamp(value);
  if (!value || typeof value !== 'object') return null;
  const timestamp = value as {
    seconds?: unknown;
    nanoseconds?: unknown;
    toMillis?: () => unknown;
    toDate?: () => unknown;
  };
  try {
    if (typeof timestamp.toMillis === 'function') {
      const millis = Number(timestamp.toMillis());
      if (Number.isFinite(millis)) return millis;
    }
    if (typeof timestamp.toDate === 'function') {
      const date = timestamp.toDate();
      if (date instanceof Date && Number.isFinite(date.getTime())) return date.getTime();
    }
  } catch {
    return null;
  }
  const seconds = Number(timestamp.seconds);
  const nanoseconds = Number(timestamp.nanoseconds || 0);
  if (!Number.isFinite(seconds) || !Number.isFinite(nanoseconds)) return null;
  return seconds * 1_000 + Math.floor(nanoseconds / 1_000_000);
}

function sameFirestoreVersion(left: unknown, right: unknown): boolean {
  if (!left || !right) return false;
  const leftRecord = left as { isEqual?: (value: unknown) => boolean; seconds?: unknown; nanoseconds?: unknown };
  try {
    if (typeof leftRecord.isEqual === 'function') return leftRecord.isEqual(right);
  } catch {
    return false;
  }
  const rightRecord = right as { seconds?: unknown; nanoseconds?: unknown };
  if (leftRecord.seconds !== undefined || rightRecord.seconds !== undefined) {
    return Number(leftRecord.seconds) === Number(rightRecord.seconds)
      && Number(leftRecord.nanoseconds || 0) === Number(rightRecord.nanoseconds || 0);
  }
  const leftMillis = firestoreTimestampMillis(left);
  const rightMillis = firestoreTimestampMillis(right);
  return leftMillis !== null && rightMillis !== null && leftMillis === rightMillis;
}

function hasImmutableActivationMetadata(
  snapshot: any,
  activation: AffiliateClickAnalyticsActivationV1,
): boolean {
  const createdAtMs = firestoreTimestampMillis(snapshot?.createTime);
  return createdAtMs !== null
    && createdAtMs < Date.parse(activation.completeFrom)
    && sameFirestoreVersion(snapshot?.createTime, snapshot?.updateTime);
}

function unavailable(
  reason: Parameters<typeof unavailableDurableAffiliateClickCoverage>[0],
  activation?: AffiliateClickAnalyticsActivationV1,
  queriedThrough?: string,
): DurableAffiliateClickWindowResult {
  return {
    source: 'unavailable',
    events: [],
    coverage: unavailableDurableAffiliateClickCoverage(reason),
    ...(activation ? { activation } : {}),
    ...(queriedThrough ? { queriedThrough } : {}),
  };
}

function queryKey(input: DurableAffiliateClickWindowInput): string {
  return JSON.stringify({
    rangeStartsAt: input.rangeStartsAt,
    rangeEndsAt: input.rangeEndsAt,
    affiliateId: input.filters?.affiliateId || '',
    articleId: input.filters?.articleId || '',
    runtimeMode: input.runtimeMode,
    keyFingerprint: input.keyFingerprint || '',
  });
}

/**
 * Reads at most 1,001 server-only v2 documents for one writer-requested range.
 * The extra document is a truncation sentinel. Only identical concurrent work
 * is coalesced; completed results are never cached.
 */
export async function readDurableAffiliateClickWindow(
  input: DurableAffiliateClickWindowInput,
): Promise<DurableAffiliateClickWindowResult> {
  if (hasUnsupportedClickFilter(input.filters)) {
    return { source: 'unsupported_filter', events: [] };
  }
  const key = queryKey(input);
  const existing = inFlightQueries.get(key);
  if (existing) return existing;
  const pending = readDurableAffiliateClickWindowUncoalesced(input);
  inFlightQueries.set(key, pending);
  try {
    return await pending;
  } finally {
    if (inFlightQueries.get(key) === pending) inFlightQueries.delete(key);
  }
}

async function readDurableAffiliateClickWindowUncoalesced(
  input: DurableAffiliateClickWindowInput,
): Promise<DurableAffiliateClickWindowResult> {
  const startsAtMs = validTimestamp(input.rangeStartsAt);
  const endsAtMs = validTimestamp(input.rangeEndsAt);
  const nowMs = input.now instanceof Date ? input.now.getTime() : Number.NaN;
  if (
    startsAtMs === null
    || endsAtMs === null
    || !Number.isFinite(nowMs)
    || startsAtMs > endsAtMs
  ) {
    return unavailable('invalid_range');
  }

  let db: ReturnType<typeof getDb>;
  let markerSnapshot: any;
  let markerValue: unknown;
  try {
    db = getDb();
    markerSnapshot = await db
      .collection('site_configs')
      .doc(AFFILIATE_CLICK_ANALYTICS_ACTIVATION_DOCUMENT_ID)
      .get();
    markerValue = markerSnapshot?.exists ? markerSnapshot.data() : undefined;
  } catch {
    return unavailable('query_failed');
  }
  if (!markerSnapshot?.exists) {
    // No marker means the existing capped local ledger remains the explicitly
    // partial pre-activation fallback. Do not query the click collection.
    return { source: 'legacy', events: [] };
  }
  const activation = normalizeAffiliateClickAnalyticsActivationV1(markerValue);
  if (!activation || !hasImmutableActivationMetadata(markerSnapshot, activation)) {
    return unavailable('invalid_activation_marker');
  }

  const completeFromMs = Date.parse(activation.completeFrom);
  const safeThroughMs = Math.min(
    endsAtMs,
    nowMs - DURABLE_CLICK_INGESTION_SAFETY_LAG_MS,
  );
  const safeThrough = safeThroughMs >= startsAtMs
    ? new Date(safeThroughMs).toISOString()
    : undefined;
  if (endsAtMs < completeFromMs) {
    return unavailable('predates_durable_history', activation, safeThrough);
  }
  if (input.runtimeMode !== 'required') {
    return unavailable('runtime_not_required', activation, safeThrough);
  }
  if (!input.keyFingerprint) {
    return unavailable('missing_secret', activation, safeThrough);
  }
  if (input.keyFingerprint !== activation.keyFingerprint) {
    return unavailable('key_mismatch', activation, safeThrough);
  }
  if (safeThroughMs < startsAtMs || safeThroughMs < completeFromMs) {
    return unavailable('settling_window', activation, safeThrough);
  }

  const queryStartsAt = new Date(Math.max(startsAtMs, completeFromMs)).toISOString();
  let querySnapshot: any;
  try {
    querySnapshot = await db
      .collection('affiliate_clicks')
      .where('timestamp', '>=', queryStartsAt)
      .where('timestamp', '<=', safeThrough)
      .orderBy('timestamp', 'asc')
      .limit(QUERY_LIMIT_WITH_TRUNCATION_SENTINEL)
      .get();
  } catch {
    return unavailable('query_failed', activation, safeThrough);
  }

  const documents = Array.isArray(querySnapshot?.docs) ? querySnapshot.docs : [];
  const truncated = documents.length > MAX_DURABLE_AFFILIATE_CLICK_EVENTS;
  const boundedDocuments = documents.slice(0, MAX_DURABLE_AFFILIATE_CLICK_EVENTS);
  const assessmentEvents: unknown[] = [];
  const events: AffiliateClickEvent[] = [];
  for (const document of boundedDocuments) {
    const value = typeof document?.data === 'function' ? document.data() : undefined;
    const bodyId = value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>).id
      : undefined;
    const event = normalizeDurableAffiliateClickEventV2(value);
    if (
      typeof document?.id !== 'string'
      || bodyId !== document.id
      || !event
      || event.keyFingerprint !== activation.keyFingerprint
    ) {
      assessmentEvents.push(
        value && typeof value === 'object' && !Array.isArray(value)
          ? { ...(value as Record<string, unknown>), __durableValidationFailed: true }
          : value,
      );
      continue;
    }
    assessmentEvents.push(event);
    events.push(event);
  }

  const coverage = assessDurableAffiliateClickCoverage({
    rangeStartsAt: input.rangeStartsAt,
    rangeEndsAt: input.rangeEndsAt,
    durableHistoryStartsAt: activation.completeFrom,
    historyObservedThrough: safeThrough,
    querySucceeded: true,
    truncated,
    events: assessmentEvents,
  });
  return {
    source: 'durable',
    events,
    coverage,
    activation,
    queriedThrough: safeThrough,
  };
}
