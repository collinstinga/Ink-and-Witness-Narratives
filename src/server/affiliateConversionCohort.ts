import crypto from 'crypto';
import type { AffiliateAnalyticsFilters, AffiliateSaleCommission, PaymentTransaction } from '../types.js';
import {
  AFFILIATE_CLICK_DEDUPE_WINDOW_MS,
  createDurableAffiliateClickDedupeIdentity,
  deriveAffiliateClickAnalyticsKeyFingerprint,
  normalizeDurableAffiliateClickEventV2,
  type DurableAffiliateClickEventV2,
} from './affiliateClickLedger.js';
import { isVerifiedAffiliateCommission } from './literaryCircle.js';

export const MAX_AFFILIATE_CONVERSION_CLICKS = 1_000;
export const MAX_AFFILIATE_CONVERSION_COMMISSIONS = 5_000;
const CLOCK_SKEW_MS = 30_000;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const HASH = /^[a-f0-9]{64}$/;
const PROOF = /^acp1_[A-Za-z0-9_-]{43}$/;

/** Private immutable evidence. Never return this object, IDs or its proof in a response. */
export interface AffiliateConversionEvidenceV1 {
  schemaVersion: 1;
  clickEventId: string;
  keyFingerprint: string;
  clickedAt: string;
  claimDocumentId: string;
  attributionIssuedAt: string;
  attributionExpiresAt: string;
  proof: string;
export interface AffiliateConversionCohortAggregate {
  coverage: 'complete' | 'partial' | 'unavailable';
  reason: 'complete' | 'not_enabled' | 'invalid_range' | 'unsupported_filter' | 'incomplete_history'
    | 'settling_window' | 'truncated' | 'invalid_events' | 'invalid_evidence' | 'no_eligible_clicks';
  windowStartsAt: string;
  windowEndsAt: string;
  asOf?: string;
  eligibleClicks: number | null;
  convertedClicks: number | null;
  conversionRate: number | null;
  unmatchedLegacySales: number;
  invalidEvidenceSales: number;
}

type ConversionCommission = AffiliateSaleCommission & { affiliateConversionEvidence?: AffiliateConversionEvidenceV1 };
export interface AffiliateConversionSourceClick {
  sourceClickEventId: string;
  /** Existing ack1_ HMAC key commitment; the name is retained for the persisted claim contract. */
  sourceClickKeySha256: string;
  sourceClickAt: string;
}

/** All-or-nothing shape validation. Authenticity comes from the signed cookie and persisted event. */
export function normalizeAffiliateConversionSourceClick(value: unknown): AffiliateConversionSourceClick | null {
  if (!record(value) || typeof value.sourceClickEventId !== 'string'
    || !/^aclk2_[a-f0-9]{64}$/.test(value.sourceClickEventId)
    || typeof value.sourceClickKeySha256 !== 'string' || !/^ack1_[A-Za-z0-9_-]{43}$/.test(value.sourceClickKeySha256)
    || !timestamp(value.sourceClickAt)) return null;
  return { sourceClickEventId: value.sourceClickEventId,
    sourceClickKeySha256: value.sourceClickKeySha256, sourceClickAt: value.sourceClickAt };
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function timestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function secretValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length >= 32 ? value.trim() : null;
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => record(item)
    ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right))) : item);
}

function commissionIdentity(commission: AffiliateSaleCommission): Record<string, unknown> | null {
  if (![commission.id, commission.checkoutRequestId, commission.transactionId, commission.affiliateId,
    commission.affiliateCode, commission.articleId].every(value => typeof value === 'string' && IDENTIFIER.test(value))
    || !timestamp(commission.createdAt) || !Number.isFinite(commission.saleAmountKes)
    || commission.saleAmountKes <= 0 || commission.saleAmountKes > 1_000_000
    || (commission.currency !== undefined && commission.currency !== 'KES')
    || !['mpesa', 'bank'].includes(commission.paymentMethod)
    || !['piece', 'bundle', 'subscription'].includes(commission.purchaseKind || 'piece')) return null;
  const expectedId = `com_tx_${crypto.createHash('sha256').update(commission.checkoutRequestId!).digest('hex').slice(0, 40)}`;
  if (commission.id !== expectedId) return null;
  return {
    id: commission.id, checkoutRequestId: commission.checkoutRequestId, transactionId: commission.transactionId,
    affiliateId: commission.affiliateId, affiliateCode: commission.affiliateCode, articleId: commission.articleId,
    saleAmountKes: commission.saleAmountKes, currency: commission.currency || 'KES', paymentMethod: commission.paymentMethod,
    purchaseKind: commission.purchaseKind || 'piece', subscriptionPlanId: commission.subscriptionPlanId || null,
    subscriptionRenewal: commission.subscriptionRenewal === true, campaignCode: commission.campaignCode || null,
    createdAt: commission.createdAt,
  };
}

function evidenceProof(commission: AffiliateSaleCommission, evidence: Omit<AffiliateConversionEvidenceV1, 'proof'>, secret: string): string | null {
  const identity = commissionIdentity(commission);
  return identity ? `acp1_${crypto.createHmac('sha256', secret)
    .update(`ink-witness:affiliate-conversion-evidence:v1\u0000${canonical({ identity, evidence })}`, 'utf8')
    .digest('base64url')}` : null;
}

function eligibleCommission(commission: AffiliateSaleCommission): boolean {
  return isVerifiedAffiliateCommission(commission) && !commission.fraudFlag?.flagged
    && Number.isFinite(commission.saleAmountKes) && commission.saleAmountKes > 0;
}

function authenticEvent(event: DurableAffiliateClickEventV2, secret: string): boolean {
  if (!event.visitorKey || !event.dedupeWindowStartedAt
    || event.keyFingerprint !== deriveAffiliateClickAnalyticsKeyFingerprint(secret)) return false;
  const identity = createDurableAffiliateClickDedupeIdentity({
    affiliateCode: event.affiliateCode, articleId: event.articleId, campaignCode: event.campaignCode,
    visitorKey: event.visitorKey, occurredAtMs: Date.parse(event.timestamp), signingSecret: secret,
  });
  return identity?.documentId === event.id && identity.dedupeWindowStartedAt === event.dedupeWindowStartedAt;
}

/**
 * Call only with a click read from Firestore and the consumed claim read in the
 * existing settlement transaction. A browser-supplied click ID is not proof.
 * This best-effort enrichment must never alter payment or commission decisions.
 */
export function buildCommittedAffiliateConversionEvidence(input: {
  commission: AffiliateSaleCommission;
  transaction: PaymentTransaction;
  clickEvent: unknown;
  claimDocumentId: string;
  claimValue: unknown;
  secret: unknown;
}): AffiliateConversionEvidenceV1 | undefined {
  try {
    const secret = secretValue(input.secret);
    const event = normalizeDurableAffiliateClickEventV2(input.clickEvent);
    const claim = input.claimValue;
    const { commission, transaction } = input;
    const sourceTransaction = transaction as PaymentTransaction & Partial<AffiliateConversionSourceClick>;
    if (!secret || !event || !event.visitorKey || !event.dedupeWindowStartedAt || !record(claim)
      || !HASH.test(input.claimDocumentId) || !eligibleCommission(commission) || !commissionIdentity(commission)
      || !authenticEvent(event, secret)
      || event.affiliateId !== commission.affiliateId || event.affiliateCode !== commission.affiliateCode.toUpperCase()
      || (event.campaignCode || '') !== (commission.campaignCode || '').toLowerCase()
      || transaction.type !== 'PURCHASE' || !['CONFIRMED', 'SUCCESS', 'PAID'].includes(transaction.status)
      || transaction.saleChannel === 'DIRECT' || transaction.id !== commission.transactionId
      || transaction.checkoutRequestId !== commission.checkoutRequestId || transaction.articleId !== commission.articleId
      || transaction.amount !== commission.saleAmountKes || (transaction.currency !== undefined && transaction.currency !== 'KES')
      || (transaction.paymentMethod || 'mpesa') !== commission.paymentMethod
      || transaction.affiliateCode?.toUpperCase() !== commission.affiliateCode.toUpperCase()
      || (transaction.purchaseKind || 'piece') !== (commission.purchaseKind || 'piece')
      || transaction.subscriptionPlanId !== commission.subscriptionPlanId
      || (transaction.subscriptionRenewal === true) !== (commission.subscriptionRenewal === true)
      || transaction.affiliateAttributionVersion !== 2 || transaction.affiliateAttributionClaimId !== input.claimDocumentId
      || claim.version !== 1 || claim.status !== 'consumed' || claim.checkoutRequestId !== commission.checkoutRequestId
      || claim.checkoutArticleId !== commission.articleId || claim.affiliateCode !== commission.affiliateCode.toLowerCase()
      || (claim.campaignCode || '') !== (event.campaignCode || '') || claim.channel !== commission.paymentMethod
      || (claim.originArticleId || '') !== (event.articleId || '')
      || claim.sourceClickEventId !== event.id || claim.sourceClickKeySha256 !== event.keyFingerprint
      || claim.sourceClickAt !== event.timestamp
      || sourceTransaction.sourceClickEventId !== event.id || sourceTransaction.sourceClickKeySha256 !== event.keyFingerprint
      || sourceTransaction.sourceClickAt !== event.timestamp
      || !Number.isSafeInteger(claim.issuedAt) || !Number.isSafeInteger(claim.expiresAt)
      || !Number.isSafeInteger(claim.consumedAt)) return undefined;
    const issuedAt = Number(claim.issuedAt);
    const expiresAt = Number(claim.expiresAt);
    const consumedAt = Number(claim.consumedAt);
    const clickedAt = Date.parse(event.timestamp);
    if (issuedAt < 0 || expiresAt <= issuedAt || expiresAt - issuedAt > 90 * 86_400_000
      || clickedAt > issuedAt + CLOCK_SKEW_MS || issuedAt - clickedAt > AFFILIATE_CLICK_DEDUPE_WINDOW_MS + CLOCK_SKEW_MS
      || consumedAt < issuedAt - CLOCK_SKEW_MS || consumedAt > expiresAt + CLOCK_SKEW_MS
      || Date.parse(commission.createdAt) < consumedAt - CLOCK_SKEW_MS
      || transaction.affiliateAttributionAt !== new Date(issuedAt).toISOString()
      || transaction.affiliateAttributionExpiresAt !== new Date(expiresAt).toISOString()) return undefined;
    const settledAt = [transaction.confirmedAt, transaction.settledAt, transaction.completedAt, transaction.createdAt]
      .find(value => typeof value === 'string' && Number.isFinite(Date.parse(value)));
    if (settledAt !== commission.createdAt) return undefined;
    const unsigned: Omit<AffiliateConversionEvidenceV1, 'proof'> = {
      schemaVersion: 1, clickEventId: event.id, keyFingerprint: event.keyFingerprint, clickedAt: event.timestamp,
      claimDocumentId: input.claimDocumentId, attributionIssuedAt: new Date(issuedAt).toISOString(),
      attributionExpiresAt: new Date(expiresAt).toISOString(),
    };
    const proof = evidenceProof(commission, unsigned, secret);
    return proof ? { ...unsigned, proof } : undefined;
  } catch { return undefined; }
}

function verifiedEvidence(commission: ConversionCommission, secret: string): AffiliateConversionEvidenceV1 | null {
  const evidence: unknown = commission.affiliateConversionEvidence;
  if (!eligibleCommission(commission) || !record(evidence)
    || Object.keys(evidence).sort().join(',') !== 'attributionExpiresAt,attributionIssuedAt,claimDocumentId,clickEventId,clickedAt,keyFingerprint,proof,schemaVersion'
    || evidence.schemaVersion !== 1 || typeof evidence.clickEventId !== 'string' || !/^aclk2_[a-f0-9]{64}$/.test(evidence.clickEventId)
    || evidence.keyFingerprint !== deriveAffiliateClickAnalyticsKeyFingerprint(secret)
    || typeof evidence.claimDocumentId !== 'string' || !HASH.test(evidence.claimDocumentId)
    || !timestamp(evidence.clickedAt) || !timestamp(evidence.attributionIssuedAt) || !timestamp(evidence.attributionExpiresAt)
    || typeof evidence.proof !== 'string' || !PROOF.test(evidence.proof)) return null;
  const { proof, ...unsigned } = evidence;
  const expected = evidenceProof(commission, unsigned as unknown as Omit<AffiliateConversionEvidenceV1, 'proof'>, secret);
  if (!expected || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(proof))) return null;
  return evidence as unknown as AffiliateConversionEvidenceV1;
}

/** Strip evidence from every outward ledger projection, including writer views. */
export function withoutAffiliateConversionEvidence<T extends AffiliateSaleCommission>(commission: T): Omit<T, 'affiliateConversionEvidence'> {
  const { affiliateConversionEvidence: _evidence, ...safe } = commission as T & { affiliateConversionEvidence?: unknown };
  return safe;
}

/** Aggregate only. Neither event IDs, claim IDs, fingerprints nor proofs leave this function. */
export function projectAffiliateConversionCohort(input: {
  events: readonly unknown[];
  commissions: readonly AffiliateSaleCommission[];
  secret: unknown;
  rangeStartsAt: string;
  rangeEndsAt: string;
  clickObservedThrough?: string;
  salesObservedThrough?: string;
  completeFrom?: string;
  clickHistoryComplete: boolean;
  financialHistoryComplete: boolean;
  filters?: AffiliateAnalyticsFilters;
}): AffiliateConversionCohortAggregate {
  const result: AffiliateConversionCohortAggregate = {
    coverage: 'unavailable', reason: 'not_enabled', windowStartsAt: input.rangeStartsAt, windowEndsAt: input.rangeEndsAt,
    eligibleClicks: null, convertedClicks: null, conversionRate: null, unmatchedLegacySales: 0, invalidEvidenceSales: 0,
  };
  const secret = secretValue(input.secret);
  if (!secret) return result;
  if (!timestamp(input.rangeStartsAt) || !timestamp(input.rangeEndsAt) || input.rangeStartsAt > input.rangeEndsAt) {
    return { ...result, reason: 'invalid_range' };
  }
  const filters = input.filters || {};
  // A click's destination is not necessarily the subsequently purchased offer.
  // Reusing the sales article filter would silently discard valid conversions.
  if (filters.articleId || filters.purchaseKind || filters.subscriptionPlanId || filters.literaryCircleTierId) {
    return { ...result, reason: 'unsupported_filter' };
  }
  if (input.events.length > MAX_AFFILIATE_CONVERSION_CLICKS || input.commissions.length > MAX_AFFILIATE_CONVERSION_COMMISSIONS) {
    return { ...result, reason: 'truncated' };
  }
  if (!timestamp(input.clickObservedThrough) || !timestamp(input.salesObservedThrough)
    || !timestamp(input.completeFrom) || input.rangeStartsAt < input.completeFrom
    || !input.clickHistoryComplete || !input.financialHistoryComplete) return { ...result, reason: 'incomplete_history' };
  // Click membership closes at rangeEndsAt; subsequent confirmed purchases can
  // still convert those visits. Do not clamp the purchase cutoff to the click
  // query's range-end watermark or silently discard delayed settlement.
  const asOf = input.salesObservedThrough;
  result.asOf = asOf;
  if (input.clickObservedThrough < input.rangeEndsAt || asOf < input.rangeEndsAt) return { ...result, reason: 'settling_window' };
  const events = new Map<string, DurableAffiliateClickEventV2>();
  const keyFingerprint = deriveAffiliateClickAnalyticsKeyFingerprint(secret);
  for (const value of input.events) {
    const event = normalizeDurableAffiliateClickEventV2(value);
    if (!event || !authenticEvent(event, secret) || event.keyFingerprint !== keyFingerprint
      || event.timestamp < input.rangeStartsAt || event.timestamp > input.rangeEndsAt) return { ...result, reason: 'invalid_events' };
    const existing = events.get(event.id);
    if (existing && canonical(existing) !== canonical(event)) return { ...result, reason: 'invalid_events' };
    if ((!filters.affiliateId || event.affiliateId === filters.affiliateId) && (!filters.articleId || event.articleId === filters.articleId)) {
      events.set(event.id, event);
    }
  }
  const converted = new Set<string>();
  const seenSales = new Map<string, string>();
  const claimedSaleIdentities = new Map<string, { commissionId: string; eventId: string }>();
  const ambiguousClicks = new Set<string>();
  let ambiguous = false;
  for (const commission of input.commissions as readonly ConversionCommission[]) {
    if (!eligibleCommission(commission) || !timestamp(commission.createdAt) || commission.createdAt > asOf) continue;
    if ((filters.affiliateId && commission.affiliateId !== filters.affiliateId)
      || (filters.articleId && commission.articleId !== filters.articleId)) continue;
    const previousSale = seenSales.get(commission.id);
    const saleValue = canonical(commission);
    if (previousSale !== undefined) {
      if (previousSale !== saleValue) {
        result.invalidEvidenceSales += 1;
        ambiguous = true;
      }
      continue;
    }
    seenSales.set(commission.id, saleValue);
    // A visit near the end of the cohort can settle later. Unknown evidence
    // through the financial cutoff may hide its conversion and must hold the
    // rate too; older, pre-cohort legacy sales do not affect this cohort.
    const inFinancialWindow = commission.createdAt >= input.rangeStartsAt && commission.createdAt <= asOf;
    const evidence = verifiedEvidence(commission, secret);
    if (!evidence) {
      if (inFinancialWindow) {
        if (commission.affiliateConversionEvidence === undefined) result.unmatchedLegacySales += 1;
        else result.invalidEvidenceSales += 1;
      }
      continue;
    }
    const event = events.get(evidence.clickEventId);
    if (!event) continue; // A verified sale from another click cohort is not this cohort's conversion.
    if (event.timestamp !== evidence.clickedAt || event.affiliateId !== commission.affiliateId
      || event.affiliateCode !== commission.affiliateCode.toUpperCase()
      || (event.campaignCode || '') !== (commission.campaignCode || '').toLowerCase()
      || commission.createdAt < event.timestamp) {
      result.invalidEvidenceSales += 1;
      continue;
    }
    const saleIdentities = [`checkout:${commission.checkoutRequestId}`, `transaction:${commission.transactionId}`,
      ...(commission.receiptNumber ? [`receipt:${commission.receiptNumber}`] : [])];
    for (const identity of saleIdentities) {
      const previous = claimedSaleIdentities.get(identity);
      if (previous && previous.commissionId !== commission.id) {
        ambiguous = true;
        ambiguousClicks.add(previous.eventId);
        ambiguousClicks.add(event.id);
      }
      claimedSaleIdentities.set(identity, { commissionId: commission.id, eventId: event.id });
    }
    converted.add(event.id);
  }
  result.eligibleClicks = events.size;
  for (const eventId of ambiguousClicks) converted.delete(eventId);
  result.convertedClicks = converted.size;
  if (ambiguous || result.invalidEvidenceSales > 0) return { ...result, coverage: 'partial', reason: 'invalid_evidence' };
  if (result.unmatchedLegacySales > 0) return { ...result, coverage: 'partial', reason: 'incomplete_history' };
  return { ...result, coverage: 'complete', reason: events.size ? 'complete' : 'no_eligible_clicks',
    conversionRate: events.size ? Math.round(converted.size / events.size * 10_000) / 100 : null };
}

