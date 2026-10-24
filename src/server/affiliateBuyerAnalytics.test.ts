import crypto from 'crypto';
import { describe, expect, it } from 'vitest';
import type { AffiliateSaleCommission, PaymentTransaction } from '../types.js';
import {
  buildCommittedAffiliateBuyerAnalyticsEvidence,
  projectStoredAffiliateBuyerAnalytics,
  resolveAffiliateBuyerAnalyticsRuntime,
} from './affiliateBuyerAnalytics.js';
import { buildAffiliateAnalyticsReport } from './affiliateAnalytics.js';
import { toAffiliateSaleCommission } from './salesLedger.js';

const KEYS = { first: Buffer.alloc(32, 17).toString('base64'), second: Buffer.alloc(32, 29).toString('base64') };
function runtime(keys: Record<string, string> = { first: KEYS.first }, activeKeyId = 'first') {
  return resolveAffiliateBuyerAnalyticsRuntime({ AFFILIATE_BUYER_ANALYTICS_MODE: 'enabled',
    AFFILIATE_BUYER_ANALYTICS_ACTIVE_KEY_ID: activeKeyId, AFFILIATE_BUYER_ANALYTICS_KEYS_JSON: JSON.stringify(keys) });
}
function purchase(index = 1, readerId: string | null = 'reader-private-1') {
  const transaction: PaymentTransaction = {
    id: `transaction_${index}`, checkoutRequestId: `checkout_${index}`, articleId: 'piece_1',
    amount: 500, currency: 'KES', type: 'PURCHASE', paymentMethod: 'mpesa', status: 'CONFIRMED',
    affiliateCode: 'PARTNER1', createdAt: `2026-10-${String(index).padStart(2, '0')}T08:00:00.000Z`,
    phoneNumber: '254712345678', ...(readerId ? { buyer: { userId: readerId } } : {}),
  };
  const commission: AffiliateSaleCommission = {
    id: `com_tx_${crypto.createHash('sha256').update(transaction.checkoutRequestId).digest('hex').slice(0, 40)}`,
    checkoutRequestId: transaction.checkoutRequestId, transactionId: transaction.id,
    affiliateId: 'affiliate_1', affiliateCode: 'PARTNER1', affiliateName: 'Partner',
    articleId: transaction.articleId, articleTitle: 'Piece', saleAmountKes: 500, currency: 'KES',
    commissionRate: 15, commissionAmountKes: 75, grossCreatorRevenueKes: 425,
    paymentMethod: 'mpesa', status: 'APPROVED', receiptNumber: `RECEIPT${index}`, createdAt: transaction.createdAt,
  };
  return { transaction, commission };
}
function attach(index = 1, selectedRuntime = runtime(), readerId: string | null = 'reader-private-1') {
  const { transaction, commission } = purchase(index, readerId);
  commission.affiliateBuyerAnalytics = buildCommittedAffiliateBuyerAnalyticsEvidence({ transaction, commission, runtime: selectedRuntime });
  return commission;
}

describe('committed private buyer analytics', () => {
  it('is disabled by default and fails closed on malformed configuration without logging secrets', () => {
    expect(resolveAffiliateBuyerAnalyticsRuntime({})).toMatchObject({ enabled: false, reason: 'not_enabled', keys: [] });
    for (const env of [
      { AFFILIATE_BUYER_ANALYTICS_MODE: 'true' },
      { AFFILIATE_BUYER_ANALYTICS_MODE: 'enabled' },
      { AFFILIATE_BUYER_ANALYTICS_MODE: 'enabled', AFFILIATE_BUYER_ANALYTICS_ACTIVE_KEY_ID: 'first', AFFILIATE_BUYER_ANALYTICS_KEYS_JSON: 'private malformed string' },
    ]) expect(resolveAffiliateBuyerAnalyticsRuntime(env)).toEqual({ enabled: false, reason: 'invalid_configuration', keys: [] });
    expect(runtime({ first: Buffer.alloc(31).toString('base64') }).enabled).toBe(false);
    expect(runtime({ first: Buffer.alloc(65).toString('base64') }).enabled).toBe(false);
    expect(runtime({ first: '!' }).enabled).toBe(false);
    expect(runtime({ first: KEYS.first, second: KEYS.first }).enabled).toBe(false);
    expect(runtime({ first: KEYS.first }, 'missing').enabled).toBe(false);
    expect(runtime({ First: KEYS.first }, 'First').enabled).toBe(false);
    expect(runtime({ a: KEYS.first, b: KEYS.second, c: Buffer.alloc(32, 3).toString('base64'), d: Buffer.alloc(32, 4).toString('base64') }, 'a').enabled).toBe(false);
  });

  it('writes only domain-separated pseudonyms and proof, preserves inputs and strips evidence from affiliate projection', () => {
    const input = purchase();
    const before = structuredClone(input);
    const evidence = buildCommittedAffiliateBuyerAnalyticsEvidence({ ...input, runtime: runtime() });
    expect(evidence).toMatchObject({ schemaVersion: 1, identitySource: 'reader_account',
      capturedAt: input.commission.createdAt, proofKeyId: 'first' });
    expect(evidence?.keys[0]).toMatchObject({ keyId: 'first', buyerKey: expect.stringMatching(/^abk1_/), keyFingerprint: expect.stringMatching(/^abf1_/) });
    expect(evidence?.proof).toMatch(/^abp1_/);
    expect(input).toEqual(before);
    const serialized = JSON.stringify(evidence);
    for (const privateValue of ['reader-private-1', '254712345678', KEYS.first, 'reader:', 'mpesa:']) expect(serialized).not.toContain(privateValue);
    expect(toAffiliateSaleCommission({ ...input.commission, affiliateBuyerAnalytics: evidence })).not.toHaveProperty('affiliateBuyerAnalytics');
    expect(attach(1, runtime(), null).affiliateBuyerAnalytics?.identitySource).toBe('verified_payment_phone');
  });

  it('refuses unverified, direct, tip, rejected and mismatched purchase evidence without blocking settlement', () => {
    const attempts: Array<Partial<PaymentTransaction>> = [
      { type: 'TIP' }, { status: 'PENDING' }, { status: 'FAILED' }, { saleChannel: 'DIRECT' },
      { checkoutRequestId: 'other' }, { id: 'other' }, { articleId: 'other' }, { amount: 501 },
      { currency: 'USD' }, { affiliateCode: 'OTHER' }, { paymentMethod: 'bank' },
      { purchaseKind: 'bundle' }, { subscriptionPlanId: 'unbound' },
      { createdAt: '2026-10-02T08:00:00.000Z' }, { buyer: { userId: '\u0000' } },
    ];
    for (const patch of attempts) {
      const input = purchase();
      Object.assign(input.transaction, patch);
      expect(buildCommittedAffiliateBuyerAnalyticsEvidence({ ...input, runtime: runtime() })).toBeUndefined();
    }
    const input = purchase();
    input.commission.status = 'REJECTED';
    expect(buildCommittedAffiliateBuyerAnalyticsEvidence({ ...input, runtime: runtime() })).toBeUndefined();
    expect(buildCommittedAffiliateBuyerAnalyticsEvidence({ ...purchase(), runtime: resolveAffiliateBuyerAnalyticsRuntime({}) })).toBeUndefined();
  });

  it('supports verified bundle and first/renewal subscription evidence without changing eligibility', () => {
    for (const kind of ['bundle', 'subscription'] as const) {
      const input = purchase();
      input.commission.purchaseKind = input.transaction.purchaseKind = kind;
      if (kind === 'subscription') {
        input.commission.subscriptionPlanId = input.transaction.subscriptionPlanId = 'six-month';
        input.commission.subscriptionRenewal = input.transaction.subscriptionRenewal = true;
      }
      expect(buildCommittedAffiliateBuyerAnalyticsEvidence({ ...input, runtime: runtime() })).toBeDefined();
    }
  });

  it('authenticates immutable purchase binding but allows later approved-to-paid state changes and Firestore map ordering', () => {
    const commission = attach();
    const reordered = JSON.parse(JSON.stringify(commission, (_field, value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
      return Object.fromEntries(Object.entries(value).sort(([left], [right]) => right.localeCompare(left)));
    })) as AffiliateSaleCommission;
    reordered.status = 'PAID';
    const projection = projectStoredAffiliateBuyerAnalytics({ commissions: [reordered], runtime: runtime(), historyComplete: true });
    expect(projection).toMatchObject({ historyComplete: true, reason: 'complete' });
    expect(projection.keysByCommissionId?.[commission.id]).toMatch(/^abk1_/);
    for (const field of ['articleId', 'affiliateId', 'transactionId', 'checkoutRequestId', 'createdAt'] as const) {
      const altered = structuredClone(commission);
      altered[field] = 'other';
      expect(projectStoredAffiliateBuyerAnalytics({ commissions: [altered], runtime: runtime(), historyComplete: true }).reason).toBe('invalid_evidence');
    }
    const altered = structuredClone(commission);
    altered.affiliateBuyerAnalytics!.keys[0].buyerKey = `abk1_${'A'.repeat(43)}`;
    expect(projectStoredAffiliateBuyerAnalytics({ commissions: [altered], runtime: runtime(), historyComplete: true }).reason).toBe('invalid_evidence');
    expect(projectStoredAffiliateBuyerAnalytics({ commissions: [commission], runtime: runtime({ first: KEYS.second }), historyComplete: true }).reason).toBe('invalid_evidence');
  });

  it('links overlapping rotation keys without new identities or exposing aliases, and labels retired evidence unavailable', () => {
    const old = attach(1);
    const rotatedRuntime = runtime(KEYS, 'second');
    const bridge = attach(2, rotatedRuntime);
    const newest = attach(3, runtime({ second: KEYS.second }, 'second'));
    const projection = projectStoredAffiliateBuyerAnalytics({ commissions: [old, bridge, newest], runtime: rotatedRuntime, historyComplete: true });
    expect(projection.historyComplete).toBe(true);
    expect(new Set(Object.values(projection.keysByCommissionId!)).size).toBe(1);
    const report = buildAffiliateAnalyticsReport({ affiliates: [], commissions: [old, bridge, newest],
      buyerKeysByCommissionId: projection.keysByCommissionId, buyerHistoryComplete: projection.historyComplete,
      buyerHistoryReason: projection.reason, startDate: '2026-10-01', endDate: '2026-10-31' });
    expect(report.buyerMetrics).toMatchObject({ uniquePayingReaders: 1, newAffiliateAcquiredReaders: 1, repeatPurchases: 2, historyCoverage: 'complete' });
    expect(JSON.stringify(report)).not.toContain('abk1_');
    const retired = projectStoredAffiliateBuyerAnalytics({ commissions: [old, bridge, newest], runtime: runtime({ second: KEYS.second }, 'second'), historyComplete: true });
    expect(retired.historyComplete).toBe(false);
    expect(retired.reason).toBe('invalid_evidence');
  });

  it('does not label a reader newly acquired or returning when legacy, truncated or mixed identity history is unsupported', () => {
    const identified = attach(2);
    const legacy = purchase(1).commission;
    for (const [commissions, historyComplete] of [
      [[legacy, identified], true], [[identified], false], [[identified, attach(3, runtime(), null)], true],
    ] as Array<[AffiliateSaleCommission[], boolean]>) {
      const projection = projectStoredAffiliateBuyerAnalytics({ commissions, runtime: runtime(), historyComplete });
      expect(projection.historyComplete).toBe(false);
      const report = buildAffiliateAnalyticsReport({ affiliates: [], commissions,
        buyerKeysByCommissionId: projection.keysByCommissionId, buyerHistoryComplete: projection.historyComplete,
        buyerHistoryReason: projection.reason, startDate: '2026-10-01', endDate: '2026-10-31' });
      if (projection.reason === 'mixed_identity_sources') expect(report.buyerMetrics.uniquePayingReaders).toBeNull();
      else expect(report.buyerMetrics.uniquePayingReaders).not.toBeNull();
      expect(report.buyerMetrics.newAffiliateAcquiredReaders).toBeNull();
      expect(report.buyerMetrics.repeatPurchases).toBeNull();
    }
  });

  it('ignores reversed and rejected records and rejects malformed evidence without leaking proof', () => {
    const reversed = attach(1);
    reversed.status = 'REVERSED';
    const input = attach(2);
    (input.affiliateBuyerAnalytics as any).unexpected = 'no';
    const projection = projectStoredAffiliateBuyerAnalytics({ commissions: [reversed, input], runtime: runtime(), historyComplete: true });
    expect(projection.keysByCommissionId).toEqual({});
    expect(projection.reason).toBe('invalid_evidence');
  });

  it('withholds identity counts for disconnected rotation eras that could describe the same readers', () => {
    const old = attach(1);
    const isolated = attach(2, runtime({ second: KEYS.second }, 'second'));
    const projection = projectStoredAffiliateBuyerAnalytics({ commissions: [old, isolated], runtime: runtime(KEYS, 'second'), historyComplete: true });
    expect(projection).toEqual({ historyComplete: false, reason: 'incomplete_history' });
  });
});
