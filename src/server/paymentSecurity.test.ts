import { describe, expect, it } from 'vitest';
import {
  PAYMENT_CALLBACK_QUERY_PARAMETER,
  attachCallbackCapability,
  canRecoverMpesaPurchase,
  generatePaymentCapability,
  hashPaymentCapability,
  redactPaymentTransaction,
  verifyPaymentCapability
} from './paymentSecurity.js';

describe('payment capabilities', () => {
  it('generates independent 256-bit base64url bearer capabilities', () => {
    const first = generatePaymentCapability();
    const second = generatePaymentCapability();

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first).not.toBe(second);
  });

  it('stores and verifies only a SHA-256 hash', () => {
    const capability = generatePaymentCapability();
    const hash = hashPaymentCapability(capability);

    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain(capability);
    expect(verifyPaymentCapability(capability, hash)).toBe(true);
    expect(verifyPaymentCapability(generatePaymentCapability(), hash)).toBe(false);
    expect(verifyPaymentCapability('', hash)).toBe(false);
  });

  it('places callback authentication in the provider-only callback URL', () => {
    const capability = generatePaymentCapability();
    const callback = attachCallbackCapability(
      'https://www.inkandwitness-narratives.co.ke/api/mpesa/callback?existing=1',
      capability
    );
    const parsed = new URL(callback);

    expect(parsed.searchParams.get(PAYMENT_CALLBACK_QUERY_PARAMETER)).toBe(capability);
    expect(parsed.searchParams.get('existing')).toBe('1');
  });

  it('redacts both server-only hashes without mutating the transaction', () => {
    const transaction = {
      id: 'tx_1',
      checkoutRequestId: 'checkout_1',
      articleId: 'article_1',
      amount: 300,
      paymentMethod: 'mpesa',
      type: 'PURCHASE',
      status: 'PENDING',
      createdAt: '2026-09-05T00:00:00.000Z',
      paymentCapabilityHash: 'a'.repeat(64),
      callbackCapabilityHash: 'b'.repeat(64)
    } as const;

    const redacted = redactPaymentTransaction(transaction);
    expect(redacted).not.toHaveProperty('paymentCapabilityHash');
    expect(redacted).not.toHaveProperty('callbackCapabilityHash');
    expect(transaction.paymentCapabilityHash).toBe('a'.repeat(64));
  });

  it('never treats a pending checkout ID as a recoverable receipt', () => {
    const transaction = {
      id: 'tx_1',
      checkoutRequestId: 'ws_CO_123456789',
      articleId: 'article_1',
      phoneNumber: '254712345678',
      amount: 300,
      paymentMethod: 'mpesa',
      type: 'PURCHASE',
      status: 'PENDING',
      createdAt: '2026-09-05T00:00:00.000Z'
    } as const;

    expect(canRecoverMpesaPurchase(transaction, transaction.checkoutRequestId, transaction.phoneNumber)).toBe(false);
  });

  it('requires confirmed state, canonical receipt, and matching phone for recovery', () => {
    const transaction = {
      id: 'tx_2',
      checkoutRequestId: 'ws_CO_987654321',
      articleId: 'article_1',
      phoneNumber: '254712345678',
      amount: 300,
      paymentMethod: 'mpesa',
      type: 'PURCHASE',
      status: 'CONFIRMED',
      mpesaReceiptNumber: 'SIA1234567',
      createdAt: '2026-09-05T00:00:00.000Z'
    } as const;

    expect(canRecoverMpesaPurchase(transaction, 'SIA1234567', '254712345678')).toBe(true);
    expect(canRecoverMpesaPurchase(transaction, 'SIA1234567', '254700000000')).toBe(false);
    expect(canRecoverMpesaPurchase(transaction, 'OTHER12345', '254712345678')).toBe(false);
  });
});
