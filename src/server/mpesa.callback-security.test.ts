import { beforeEach, describe, expect, it, vi } from 'vitest';

const storeMocks = vi.hoisted(() => ({
  loadTransaction: vi.fn(),
  settleMpesaTransaction: vi.fn(),
  recordMpesaTerminalFailure: vi.fn()
}));

vi.mock('./store.js', () => ({ store: storeMocks }));

import { handleDarajaCallback, parseDarajaCallback } from './mpesa.js';
import { generatePaymentCapability, hashPaymentCapability } from './paymentSecurity.js';

const callbackCapability = generatePaymentCapability();

function pendingTransaction(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tx_1',
    checkoutRequestId: 'ws_CO_123456789',
    merchantRequestId: 'merchant_123456789',
    articleId: 'article_1',
    articleTitle: 'Test article',
    phoneNumber: '254712345678',
    amount: 300,
    paymentMethod: 'mpesa',
    type: 'PURCHASE',
    status: 'PENDING',
    createdAt: '2026-09-05T10:00:00.000Z',
    callbackCapabilityHash: hashPaymentCapability(callbackCapability),
    paymentCapabilityHash: 'a'.repeat(64),
    ...overrides
  };
}

function successCallback(overrides: Record<string, unknown> = {}) {
  return {
    Body: {
      stkCallback: {
        MerchantRequestID: 'merchant_123456789',
        CheckoutRequestID: 'ws_CO_123456789',
        ResultCode: 0,
        ResultDesc: 'The service request is processed successfully.',
        CallbackMetadata: {
          Item: [
            { Name: 'Amount', Value: 300 },
            { Name: 'MpesaReceiptNumber', Value: 'SIA1234567' },
            { Name: 'Balance' },
            { Name: 'TransactionDate', Value: 20260905130500 },
            { Name: 'PhoneNumber', Value: 254712345678 }
          ]
        },
        ...overrides
      }
    }
  };
}

describe('Daraja callback security', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeMocks.loadTransaction.mockResolvedValue(pendingTransaction());
    storeMocks.settleMpesaTransaction.mockResolvedValue({ outcome: 'committed' });
    storeMocks.recordMpesaTerminalFailure.mockResolvedValue({ outcome: 'committed' });
  });

  it('rejects minimal forged success and non-numeric result codes before a database read', async () => {
    expect(parseDarajaCallback({ Body: { stkCallback: {
      MerchantRequestID: 'merchant_123456789',
      CheckoutRequestID: 'ws_CO_123456789',
      ResultCode: 0,
      ResultDesc: 'ok'
    } } })).toBeNull();
    expect(parseDarajaCallback(successCallback({ ResultCode: null }))).toBeNull();

    await expect(handleDarajaCallback(successCallback({ ResultCode: null }), callbackCapability))
      .resolves.toMatchObject({ outcome: 'rejected' });
    expect(storeMocks.loadTransaction).not.toHaveBeenCalled();
  });

  it('rejects duplicate required metadata names', () => {
    const payload = successCallback();
    payload.Body.stkCallback.CallbackMetadata.Item.push({ Name: 'Amount', Value: 300 });
    expect(parseDarajaCallback(payload)).toBeNull();
  });

  it('requires the server-only callback capability', async () => {
    await expect(handleDarajaCallback(successCallback(), generatePaymentCapability()))
      .resolves.toMatchObject({ outcome: 'rejected' });
    expect(storeMocks.settleMpesaTransaction).not.toHaveBeenCalled();
  });

  it('rejects merchant, amount, phone, and payment-method mismatches without settlement', async () => {
    storeMocks.loadTransaction
      .mockResolvedValueOnce(pendingTransaction({ merchantRequestId: 'merchant_other' }))
      .mockResolvedValueOnce(pendingTransaction())
      .mockResolvedValueOnce(pendingTransaction())
      .mockResolvedValueOnce(pendingTransaction({ paymentMethod: 'bank' }));

    await handleDarajaCallback(successCallback(), callbackCapability);
    await handleDarajaCallback(successCallback({
      CallbackMetadata: {
        Item: [
          { Name: 'Amount', Value: 301 },
          { Name: 'MpesaReceiptNumber', Value: 'SIA1234567' },
          { Name: 'TransactionDate', Value: 20260905130500 },
          { Name: 'PhoneNumber', Value: 254712345678 }
        ]
      }
    }), callbackCapability);
    await handleDarajaCallback(successCallback({
      CallbackMetadata: {
        Item: [
          { Name: 'Amount', Value: 300 },
          { Name: 'MpesaReceiptNumber', Value: 'SIA1234567' },
          { Name: 'TransactionDate', Value: 20260905130500 },
          { Name: 'PhoneNumber', Value: 254700000000 }
        ]
      }
    }), callbackCapability);
    await handleDarajaCallback(successCallback(), callbackCapability);

    expect(storeMocks.settleMpesaTransaction).not.toHaveBeenCalled();
    expect(storeMocks.recordMpesaTerminalFailure).not.toHaveBeenCalled();
  });

  it('passes one fully correlated success to atomic settlement', async () => {
    const result = await handleDarajaCallback(successCallback(), callbackCapability);

    expect(result).toMatchObject({ success: true, outcome: 'committed' });
    expect(storeMocks.settleMpesaTransaction).toHaveBeenCalledTimes(1);
    expect(storeMocks.settleMpesaTransaction).toHaveBeenCalledWith('ws_CO_123456789', expect.objectContaining({
      merchantRequestId: 'merchant_123456789',
      receiptNumber: 'SIA1234567',
      amount: 300,
      phoneNumber: '254712345678',
      expectedCallbackCapabilityHash: hashPaymentCapability(callbackCapability)
    }));
  });

  it('accepts official failure shape without success metadata and records it atomically', async () => {
    const payload = successCallback({
      ResultCode: 1032,
      ResultDesc: 'Request cancelled by user.',
      CallbackMetadata: undefined
    });
    const result = await handleDarajaCallback(payload, callbackCapability);

    expect(result).toMatchObject({ success: true, outcome: 'committed' });
    expect(storeMocks.recordMpesaTerminalFailure).toHaveBeenCalledWith('ws_CO_123456789', expect.objectContaining({
      resultCode: 1032,
      status: 'CANCELLED'
    }));
    expect(storeMocks.settleMpesaTransaction).not.toHaveBeenCalled();
  });

  it('surfaces persistence failures as retryable without reporting success', async () => {
    storeMocks.settleMpesaTransaction.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(handleDarajaCallback(successCallback(), callbackCapability))
      .resolves.toMatchObject({ success: false, outcome: 'retryable_error' });
  });
});
