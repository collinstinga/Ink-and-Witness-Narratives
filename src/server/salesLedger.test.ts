import { describe, expect, it } from 'vitest';
import type { AffiliateSaleCommission, PaymentTransaction } from '../types.js';
import {
  buildBuyerSnapshot,
  createStableOrderId,
  isFailedTransactionStatus,
  isSettledTransactionStatus,
  normalizePaymentMethod,
  resolveOrderId,
  resolveSaleChannel,
  toAdminSalesTransaction,
  toAffiliateSaleCommission
} from './salesLedger.js';

function transaction(overrides: Partial<PaymentTransaction> = {}): PaymentTransaction {
  return {
    id: 'tx_123',
    checkoutRequestId: 'ws_CO_123',
    articleId: 'article-1',
    articleTitle: 'A Piece',
    amount: 300,
    paymentMethod: 'mpesa',
    type: 'PURCHASE',
    status: 'CONFIRMED',
    createdAt: '2026-09-23T10:00:00.000Z',
    ...overrides
  };
}

describe('sales ledger normalization', () => {
  it.each(['CONFIRMED', 'SUCCESS', 'PAID', 'confirmed'])('%s is settled', status => {
    expect(isSettledTransactionStatus(status)).toBe(true);
  });

  it.each(['PENDING', 'INITIATED', 'FAILED', undefined])('%s is not settled', status => {
    expect(isSettledTransactionStatus(status)).toBe(false);
  });

  it('groups all terminal failure spellings', () => {
    for (const status of ['FAILED', 'CANCELLED', 'TIMEOUT', 'TIMED_OUT', 'EXPIRED']) {
      expect(isFailedTransactionStatus(status)).toBe(true);
    }
    expect(isFailedTransactionStatus('PENDING')).toBe(false);
  });

  it('normalizes current and legacy payment method shapes', () => {
    expect(normalizePaymentMethod(transaction({ paymentMethod: 'bank' }))).toBe('bank');
    expect(normalizePaymentMethod({ checkoutRequestId: 'bank_123', method: 'bank' })).toBe('bank');
    expect(normalizePaymentMethod({ checkoutRequestId: 'legacy', type: 'MANUAL' })).toBe('manual');
    expect(normalizePaymentMethod({ checkoutRequestId: 'ws_CO_123' })).toBe('mpesa');
  });

  it('derives a stable order id and direct/affiliate channel without using a phone number', () => {
    const direct = transaction({ phoneNumber: '254700000000' });
    const affiliate = transaction({ affiliateCode: 'PARTNER1' });
    expect(createStableOrderId(direct.checkoutRequestId)).toBe('ord_ws_CO_123');
    expect(resolveOrderId(direct)).toBe('ord_tx_123');
    expect(resolveSaleChannel(direct)).toBe('DIRECT');
    expect(resolveSaleChannel(affiliate)).toBe('AFFILIATE');
  });

  it('normalizes an optional buyer snapshot', () => {
    expect(buildBuyerSnapshot({
      userId: ' reader-1 ',
      email: ' READER@EXAMPLE.COM ',
      phoneNumber: '254700000000',
      name: ' Reader One '
    })).toEqual({
      userId: 'reader-1',
      email: 'reader@example.com',
      phoneNumber: '254700000000',
      phoneVerifiedAt: undefined,
      name: 'Reader One'
    });
  });
});

describe('sales ledger privacy projections', () => {
  it('removes provider capabilities and bearer access tokens from writer responses', () => {
    const safe = toAdminSalesTransaction(transaction({
      paymentCapabilityHash: 'payment-secret-hash',
      callbackCapabilityHash: 'callback-secret-hash',
      downloadToken: 'bearer-reader-token',
      affiliateCode: 'PARTNER1'
    }));
    expect(safe.orderId).toBe('ord_tx_123');
    expect(safe.saleChannel).toBe('AFFILIATE');
    expect(safe).not.toHaveProperty('paymentCapabilityHash');
    expect(safe).not.toHaveProperty('callbackCapabilityHash');
    expect(safe).not.toHaveProperty('downloadToken');
  });

  it('uses an explicit affiliate allow-list with an order identifier and no buyer PII', () => {
    const source = {
      id: 'commission-1',
      affiliateId: 'affiliate-1',
      affiliateCode: 'PARTNER1',
      affiliateName: 'Partner',
      transactionId: 'tx_123',
      receiptNumber: 'RCPT123',
      articleId: 'article-1',
      articleTitle: 'A Piece',
      saleAmountKes: 300,
      commissionRate: 15,
      commissionAmountKes: 45,
      grossCreatorRevenueKes: 255,
      paymentMethod: 'mpesa',
      status: 'APPROVED',
      createdAt: '2026-09-23T10:00:00.000Z',
      buyerEmail: 'private@example.com',
      buyerPhone: '254700000000'
    } as AffiliateSaleCommission & { buyerEmail: string; buyerPhone: string };
    const safe = toAffiliateSaleCommission(source);
    expect(safe.orderId).toBe('ord_tx_123');
    expect(safe).not.toHaveProperty('buyerEmail');
    expect(safe).not.toHaveProperty('buyerPhone');
  });
});
