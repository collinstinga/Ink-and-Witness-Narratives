import crypto from 'crypto';
import { describe, expect, it } from 'vitest';
import type { AffiliateSaleCommission, PaymentTransaction } from '../types.js';
import { createDurableAffiliateClickDedupeIdentity, deriveAffiliateClickAnalyticsKeyFingerprint } from './affiliateClickLedger.js';
import {
  buildCommittedAffiliateConversionEvidence, projectAffiliateConversionCohort, withoutAffiliateConversionEvidence,
  MAX_AFFILIATE_CONVERSION_CLICKS, type AffiliateConversionEvidenceV1, type AffiliateConversionSourceClick,
} from './affiliateConversionCohort.js';

const SECRET = 'conversion-unit-test-only-key-not-a-production-secret';
const CLICKED_AT = '2026-10-01T08:00:00.000Z';
const START = '2026-10-01T00:00:00.000Z';
const END = '2026-10-01T23:59:59.999Z';
const AS_OF = '2026-10-03T00:00:00.000Z';

function fixture(index = 1, options: { homepage?: boolean; clickedAt?: string; settledAt?: string } = {}) {
  const clickedAt = options.clickedAt || CLICKED_AT;
  const visitorKey = `acv1_${Buffer.alloc(32, index).toString('base64url')}`;
  const identity = createDurableAffiliateClickDedupeIdentity({ affiliateCode: 'PARTNER1',
    articleId: options.homepage ? undefined : 'piece_1', visitorKey, occurredAtMs: Date.parse(clickedAt), signingSecret: SECRET })!;
  const event = { schemaVersion: 2 as const, id: identity.documentId,
    keyFingerprint: deriveAffiliateClickAnalyticsKeyFingerprint(SECRET)!, affiliateCode: 'PARTNER1', affiliateId: 'affiliate_1',
    ...(options.homepage ? {} : { articleId: 'piece_1' }), visitorKey, timestamp: clickedAt,
    dedupeWindowStartedAt: identity.dedupeWindowStartedAt };
  const source: AffiliateConversionSourceClick = { sourceClickEventId: event.id,
    sourceClickKeySha256: event.keyFingerprint, sourceClickAt: event.timestamp };
  const claimDocumentId = crypto.createHash('sha256').update(`claim_${index}`).digest('hex');
  const issuedAt = Date.parse(clickedAt) + 1_000;
  const claimValue = { version: 1, status: 'consumed', affiliateCode: 'partner1', checkoutArticleId: 'piece_1', channel: 'mpesa',
    issuedAt, expiresAt: issuedAt + 86_400_000, consumedAt: issuedAt + 1_000, claimedAt: issuedAt,
    checkoutRequestId: `checkout_${index}`, ...(!options.homepage ? { originArticleId: 'piece_1' } : {}), ...source };
  const settledAt = options.settledAt || '2026-10-01T08:03:00.000Z';
  const transaction: PaymentTransaction & AffiliateConversionSourceClick = {
    id: `transaction_${index}`, checkoutRequestId: `checkout_${index}`, articleId: 'piece_1',
    amount: 500, currency: 'KES', type: 'PURCHASE', paymentMethod: 'mpesa', status: 'CONFIRMED', saleChannel: 'AFFILIATE',
    affiliateCode: 'PARTNER1', createdAt: settledAt, affiliateAttributionVersion: 2,
    affiliateAttributionClaimId: claimDocumentId, affiliateAttributionAt: new Date(issuedAt).toISOString(),
    affiliateAttributionExpiresAt: new Date(claimValue.expiresAt).toISOString(), ...source,
  };
  const commission: AffiliateSaleCommission & { affiliateConversionEvidence?: AffiliateConversionEvidenceV1 } = {
    id: `com_tx_${crypto.createHash('sha256').update(transaction.checkoutRequestId).digest('hex').slice(0, 40)}`,
    checkoutRequestId: transaction.checkoutRequestId, transactionId: transaction.id,
    affiliateId: 'affiliate_1', affiliateCode: 'PARTNER1', affiliateName: 'Partner',
    receiptNumber: `receipt_${index}`, articleId: 'piece_1', articleTitle: 'A piece',
    saleAmountKes: 500, currency: 'KES', commissionRate: 15, commissionAmountKes: 75,
    grossCreatorRevenueKes: 425, paymentMethod: 'mpesa', status: 'APPROVED', createdAt: settledAt,
  };
  return { event, transaction, commission, claimValue, claimDocumentId, secret: SECRET };
}

function committed(index = 1, options: Parameters<typeof fixture>[1] = {}) {
  const input = fixture(index, options);
  input.commission.affiliateConversionEvidence = buildCommittedAffiliateConversionEvidence({ ...input, clickEvent: input.event });
  expect(input.commission.affiliateConversionEvidence).toBeDefined();
  return input;
}

function report(input: ReturnType<typeof fixture>, overrides: Partial<Parameters<typeof projectAffiliateConversionCohort>[0]> = {}) {
  return projectAffiliateConversionCohort({ events: [input.event], commissions: [input.commission], secret: SECRET,
    rangeStartsAt: START, rangeEndsAt: END, completeFrom: '2026-09-30T00:00:00.000Z',
    clickObservedThrough: AS_OF, salesObservedThrough: AS_OF, clickHistoryComplete: true, financialHistoryComplete: true,
    ...overrides });
}

describe('server-verified prospective affiliate conversion evidence', () => {
  it('binds an actual click, consumed claim and immutable confirmed purchase without mutating inputs or exposing identities', () => {
    const input = fixture();
    const before = structuredClone(input);
    const evidence = buildCommittedAffiliateConversionEvidence({ ...input, clickEvent: input.event });
    expect(input).toEqual(before);
    expect(evidence).toMatchObject({ schemaVersion: 1, clickEventId: input.event.id, claimDocumentId: input.claimDocumentId });
    expect(evidence?.proof).toMatch(/^acp1_/);
    const serialized = JSON.stringify(evidence);
    for (const value of [SECRET, 'visitorKey', 'PARTNER1', 'transaction_1', 'checkout_1', 'receipt_1']) expect(serialized).not.toContain(value);
    expect(withoutAffiliateConversionEvidence({ ...input.commission, affiliateConversionEvidence: evidence })).not.toHaveProperty('affiliateConversionEvidence');
  });

  it('rejects client-shaped click identifiers, altered event identity and unsupported keys', () => {
    const input = fixture();
    for (const clickEvent of [{ id: input.event.id }, { ...input.event, id: `aclk2_${'a'.repeat(64)}` },
      { ...input.event, visitorKey: `acv1_${'A'.repeat(43)}` }, { ...input.event, phoneNumber: 'private' }]) {
      expect(buildCommittedAffiliateConversionEvidence({ ...input, clickEvent })).toBeUndefined();
    }
    expect(buildCommittedAffiliateConversionEvidence({ ...input, clickEvent: input.event, secret: 'short' })).toBeUndefined();
    expect(buildCommittedAffiliateConversionEvidence({ ...input, clickEvent: input.event, secret: `${SECRET}-rotated` })).toBeUndefined();
  });

  it('requires every source, consumed claim, attribution and checkout binding to match', () => {
    const input = fixture();
    const patches: Array<Record<string, unknown>> = [
      { status: 'claimed' }, { version: 2 }, { checkoutRequestId: 'different' }, { checkoutArticleId: 'other' },
      { affiliateCode: 'other' }, { campaignCode: 'other' }, { originArticleId: 'other' }, { channel: 'bank' },
      { sourceClickEventId: `aclk2_${'a'.repeat(64)}` }, { sourceClickKeySha256: 'other' }, { sourceClickAt: START },
      { issuedAt: Date.parse(CLICKED_AT) - 31_000 }, { expiresAt: input.claimValue.issuedAt },
      { consumedAt: input.claimValue.expiresAt + 31_000 }, { consumedAt: input.claimValue.issuedAt - 31_000 },
    ];
    for (const patch of patches) expect(buildCommittedAffiliateConversionEvidence({ ...input,
      clickEvent: input.event, claimValue: { ...input.claimValue, ...patch } })).toBeUndefined();
    expect(buildCommittedAffiliateConversionEvidence({ ...input, clickEvent: input.event, claimDocumentId: 'not-a-hash' })).toBeUndefined();
  });

  it('does not enrich tips, unconfirmed/direct/mismatched payments, fraudulent or reversed sales', () => {
    const input = fixture();
    const patches: Array<Partial<PaymentTransaction>> = [
      { type: 'TIP' }, { status: 'PENDING' }, { saleChannel: 'DIRECT' }, { amount: 501 }, { currency: 'USD' },
      { checkoutRequestId: 'other' }, { id: 'other' }, { articleId: 'other' }, { affiliateCode: 'OTHER' },
      { affiliateAttributionClaimId: 'a'.repeat(64) }, { affiliateAttributionAt: START }, { affiliateAttributionExpiresAt: AS_OF },
      { subscriptionPlanId: 'other' }, { subscriptionRenewal: true }, { purchaseKind: 'bundle' },
    ];
    for (const patch of patches) expect(buildCommittedAffiliateConversionEvidence({ ...input, clickEvent: input.event,
      transaction: { ...input.transaction, ...patch } })).toBeUndefined();
    for (const patch of [{ status: 'REVERSED' as const }, { fraudFlag: { flagged: true } }, { id: 'legacy-id' }]) {
      expect(buildCommittedAffiliateConversionEvidence({ ...input, clickEvent: input.event,
        commission: { ...input.commission, ...patch } })).toBeUndefined();
    }
  });

  it('supports an explicitly bound homepage referral purchasing a piece, bundle or subscription without demanding identical offers', () => {
    for (const purchaseKind of ['piece', 'bundle', 'subscription'] as const) {
      const input = fixture(1, { homepage: true });
      input.transaction.purchaseKind = purchaseKind;
      input.commission.purchaseKind = purchaseKind;
      if (purchaseKind === 'subscription') {
        input.transaction.subscriptionPlanId = 'reader-pass'; input.commission.subscriptionPlanId = 'reader-pass';
      }
      expect(buildCommittedAffiliateConversionEvidence({ ...input, clickEvent: input.event })).toBeDefined();
    }
  });
});

describe('bounded click cohort conversion aggregates', () => {
  it('counts converted click IDs, not sales, and only emits aggregate evidence with an as-of boundary', () => {
    const first = committed();
    const later = fixture(2, { settledAt: '2026-10-02T08:03:00.000Z' });
    later.event = first.event;
    later.claimValue = { ...later.claimValue, sourceClickEventId: first.event.id,
      sourceClickKeySha256: first.event.keyFingerprint, sourceClickAt: first.event.timestamp };
    Object.assign(later.transaction, { sourceClickEventId: first.event.id, sourceClickKeySha256: first.event.keyFingerprint,
      sourceClickAt: first.event.timestamp });
    later.commission.affiliateConversionEvidence = buildCommittedAffiliateConversionEvidence({ ...later, clickEvent: later.event });
    expect(later.commission.affiliateConversionEvidence).toBeDefined();
    const other = committed(3);
    const result = report(first, { events: [first.event, first.event, other.event],
      commissions: [first.commission, later.commission, first.commission], clickObservedThrough: END });
    expect(result).toMatchObject({ coverage: 'complete', eligibleClicks: 2, convertedClicks: 1, conversionRate: 50, asOf: AS_OF });
    const serialized = JSON.stringify(result);
    for (const value of [SECRET, 'aclk2_', 'acv1_', 'ack1_', 'acp1_', first.claimDocumentId, 'PARTNER1', 'receipt_1']) expect(serialized).not.toContain(value);
  });

  it('withholds rather than manufacture a global ratio for legacy or invalid evidence in the reporting window', () => {
    const input = committed();
    const legacy = fixture(2).commission;
    expect(report(input, { commissions: [input.commission, legacy] })).toMatchObject({
      coverage: 'partial', conversionRate: null, convertedClicks: 1, unmatchedLegacySales: 1 });
    legacy.createdAt = '2026-10-02T12:00:00.000Z';
    expect(report(input, { commissions: [input.commission, legacy] })).toMatchObject({
      coverage: 'partial', conversionRate: null, unmatchedLegacySales: 1 });
    const altered = structuredClone(input.commission);
    altered.saleAmountKes += 1;
    expect(report(input, { commissions: [altered] })).toMatchObject({ coverage: 'partial', conversionRate: null, invalidEvidenceSales: 1 });
    legacy.createdAt = '2026-09-29T00:00:00.000Z';
    expect(report(input, { commissions: [input.commission, legacy] })).toMatchObject({ coverage: 'complete', conversionRate: 100, unmatchedLegacySales: 0 });
  });

  it('excludes reversed/rejected/fraud records and does not mistake a verified different cohort for this cohort', () => {
    const input = committed();
    const other = committed(2);
    const reversed = { ...input.commission, status: 'REVERSED' as const };
    expect(report(input, { commissions: [reversed, other.commission] })).toMatchObject({ coverage: 'complete', convertedClicks: 0, conversionRate: 0 });
  });

  it('fails closed for incomplete, oversized, unobserved, pre-activation or unsupported filtered histories', () => {
    const input = committed();
    const cases: Array<[Partial<Parameters<typeof projectAffiliateConversionCohort>[0]>, string]> = [
      [{ secret: undefined }, 'not_enabled'], [{ rangeStartsAt: 'invalid' }, 'invalid_range'],
      [{ clickHistoryComplete: false }, 'incomplete_history'], [{ financialHistoryComplete: false }, 'incomplete_history'],
      [{ completeFrom: '2026-10-02T00:00:00.000Z' }, 'incomplete_history'], [{ salesObservedThrough: undefined }, 'incomplete_history'],
      [{ salesObservedThrough: CLICKED_AT }, 'settling_window'], [{ events: Array(MAX_AFFILIATE_CONVERSION_CLICKS + 1).fill(input.event) }, 'truncated'],
      [{ filters: { subscriptionPlanId: 'pass' } }, 'unsupported_filter'],
      [{ filters: { purchaseKind: 'piece' } }, 'unsupported_filter'], [{ filters: { literaryCircleTierId: 'patron' } }, 'unsupported_filter'],
    ];
    for (const [patch, reason] of cases) expect(report(input, patch)).toMatchObject({ coverage: 'unavailable', reason, conversionRate: null });
  });

  it('rejects malformed/conflicting/forged event inputs instead of reducing the denominator', () => {
    const input = committed();
    for (const events of [[{ ...input.event, phone: 'private' }], [{ ...input.event, visitorKey: `acv1_${'A'.repeat(43)}` }],
      [input.event, { ...input.event, timestamp: '2026-10-01T08:00:01.000Z' }]]) {
      expect(report(input, { events })).toMatchObject({ coverage: 'unavailable', reason: 'invalid_events', conversionRate: null });
    }
  });

  it('preserves numeric bounds with duplicate sales/receipts and does not count future settlement', () => {
    const input = committed();
    const other = committed(2);
    other.commission.receiptNumber = input.commission.receiptNumber;
    expect(report(input, { events: [input.event, other.event], commissions: [input.commission, other.commission] }))
      .toMatchObject({ coverage: 'partial', reason: 'invalid_evidence', convertedClicks: 0, conversionRate: null });
    expect(report(input, { salesObservedThrough: '2026-10-01T08:02:00.000Z' })).toMatchObject({ reason: 'settling_window', conversionRate: null });
  });

  it('supports affiliate filters and withholds offer filters that cannot define a click cohort', () => {
    const input = committed(1, { homepage: true });
    expect(report(input, { filters: { articleId: 'piece_1' } })).toMatchObject({
      coverage: 'unavailable', reason: 'unsupported_filter', eligibleClicks: null, conversionRate: null });
    expect(report(input, { filters: { affiliateId: 'someone_else' } })).toMatchObject({ coverage: 'complete', eligibleClicks: 0, convertedClicks: 0, conversionRate: null });
    expect(report(input, { filters: { affiliateId: 'affiliate_1' } })).toMatchObject({ coverage: 'complete', eligibleClicks: 1, convertedClicks: 1, conversionRate: 100 });
  });

  it('withholds conflicting duplicate commission IDs instead of trusting whichever record arrived first', () => {
    const input = committed();
    expect(report(input, { commissions: [input.commission, { ...input.commission, saleAmountKes: 600 }] }))
      .toMatchObject({ coverage: 'partial', reason: 'invalid_evidence', conversionRate: null });
  });
});
