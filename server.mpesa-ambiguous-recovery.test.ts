import http, { Server } from 'http';
import { AddressInfo } from 'net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.VERCEL = '1';
  process.env.NODE_ENV = 'test';
  process.env.SESSION_SIGNING_SECRET = 'mpesa-ambiguous-recovery-test-secret-with-32-characters';
});

const storeMocks = vi.hoisted(() => {
  const known = {
    init: vi.fn(async () => undefined),
    refreshTransaction: vi.fn(),
    refreshTransactionByPaymentAttemptId: vi.fn(),
    loadTransaction: vi.fn(),
    loadMpesaCallbackIntentByPaymentHash: vi.fn(),
    attachMpesaCallbackIntent: vi.fn(),
    ensureAffiliateCommissionForTransaction: vi.fn(async () => undefined),
    getArticles: vi.fn(() => [])
  };
  const fallback = new Map<PropertyKey, ReturnType<typeof vi.fn>>();
  return new Proxy(known as Record<PropertyKey, any>, {
    get(target, property) {
      if (property in target) return target[property];
      if (!fallback.has(property)) fallback.set(property, vi.fn());
      return fallback.get(property);
    }
  });
});

vi.mock('./src/server/store.js', () => ({ store: storeMocks }));
vi.mock('./src/server/affiliateStore.js', () => ({
  affiliateStore: {},
  sanitizeAffiliateForResponse: (value: unknown) => value
}));

const mpesaMocks = vi.hoisted(() => ({
  handleDarajaCallback: vi.fn(),
  queryPaymentStatus: vi.fn(),
  initiateStkPush: vi.fn(),
  verifyManualReceipt: vi.fn(),
  getDarajaAccessToken: vi.fn(),
  formatKenyanPhone: vi.fn((value: unknown) => String(value || '')),
  maskPhone: vi.fn((value: unknown) => String(value || ''))
}));

vi.mock('./src/server/mpesa.js', () => mpesaMocks);

import { createApp } from './server.js';
import { generatePaymentCapability, hashPaymentCapability } from './src/server/paymentSecurity.js';

describe('ambiguous M-Pesa initiation recovery', () => {
  let server: Server;
  let baseUrl: string;
  const paymentAttemptId = 'attempt_0123456789abcdef0123456789abcdef0123';
  const checkoutRequestId = 'ws_CO_987654321';
  const paymentCapability = generatePaymentCapability();
  const paymentCapabilityHash = hashPaymentCapability(paymentCapability);
  const preparedAt = new Date();
  const pendingIntent = {
    version: 1,
    paymentAttemptId,
    callbackCapabilityHash: 'b'.repeat(64),
    paymentCapabilityHash,
    requestLockId: 'c'.repeat(64),
    articleId: 'article_1',
    articleTitle: 'Test article',
    phoneNumber: '254712345678',
    amount: 300,
    currency: 'KES',
    originalAmount: 300,
    exchangeRate: 1,
    exchangeRateTimestamp: preparedAt.toISOString(),
    type: 'PURCHASE',
    shortcodeUsed: '600111',
    createdAt: preparedAt.toISOString(),
    expiresAt: new Date(preparedAt.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    status: 'PREPARED'
  };
  const confirmedTransaction = {
    id: 'tx_confirmed',
    checkoutRequestId,
    paymentAttemptId,
    merchantRequestId: 'merchant_987654321',
    articleId: 'article_1',
    articleTitle: 'Test article',
    phoneNumber: '254712345678',
    amount: 300,
    currency: 'KES',
    paymentMethod: 'mpesa',
    type: 'PURCHASE',
    status: 'CONFIRMED',
    createdAt: '2026-09-08T10:00:00.000Z',
    mpesaReceiptNumber: 'SIA9876543',
    receiptNumber: 'SIA9876543',
    downloadToken: 'ink_verified_payment_token',
    paymentCapabilityHash
  };

  beforeAll(async () => {
    const app = await createApp();
    server = http.createServer(app);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  }, 60_000);

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    storeMocks.refreshTransaction.mockResolvedValue(undefined);
    storeMocks.refreshTransactionByPaymentAttemptId.mockResolvedValue(undefined);
    storeMocks.loadTransaction.mockResolvedValue(undefined);
    storeMocks.loadMpesaCallbackIntentByPaymentHash.mockResolvedValue({
      ...pendingIntent,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    });
    mpesaMocks.queryPaymentStatus.mockResolvedValue({ status: 'PENDING' });
  });

  it('returns pending for the capability-bound attempt without querying Daraja by a synthetic ID', async () => {
    const response = await fetch(`${baseUrl}/api/payments/status/${paymentAttemptId}`, {
      headers: { 'x-payment-capability': paymentCapability }
    });
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(body).toMatchObject({
      checkoutRequestId: paymentAttemptId,
      articleId: 'article_1',
      status: 'PENDING',
      rawStatus: 'PENDING'
    });
    expect(body).not.toHaveProperty('downloadToken');
    expect(body).not.toHaveProperty('mpesaReceiptNumber');
    expect(storeMocks.refreshTransaction).not.toHaveBeenCalledWith(paymentAttemptId);
    expect(storeMocks.refreshTransactionByPaymentAttemptId).not.toHaveBeenCalled();
    expect(mpesaMocks.queryPaymentStatus).not.toHaveBeenCalled();
  });

  it('does not accept an arbitrary identifier even when the caller has the payment capability', async () => {
    const response = await fetch(`${baseUrl}/api/payments/status/attempt_wrong_identifier`, {
      headers: { 'x-payment-capability': paymentCapability }
    });

    expect(response.status).toBe(404);
    expect(mpesaMocks.queryPaymentStatus).not.toHaveBeenCalled();
  });

  it('stops an uncorrelated attempt after the safe reconciliation window without claiming payment', async () => {
    storeMocks.loadMpesaCallbackIntentByPaymentHash.mockResolvedValueOnce({
      ...pendingIntent,
      createdAt: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    });

    const response = await fetch(`${baseUrl}/api/payments/status/${paymentAttemptId}`, {
      headers: { 'x-payment-capability': paymentCapability }
    });
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: 'TIMEOUT', rawStatus: 'TIMEOUT' });
    expect(body).not.toHaveProperty('downloadToken');
    expect(body).not.toHaveProperty('mpesaReceiptNumber');
    expect(mpesaMocks.queryPaymentStatus).not.toHaveBeenCalled();
  });

  it('follows a callback-linked intent to the real checkout and unlocks only its verified settlement', async () => {
    storeMocks.loadMpesaCallbackIntentByPaymentHash.mockResolvedValueOnce({
      ...pendingIntent,
      checkoutRequestId,
      merchantRequestId: 'merchant_987654321',
      status: 'ATTACHED',
      attachedAt: '2026-09-08T10:00:30.000Z'
    });
    storeMocks.refreshTransaction.mockImplementation(async (identifier: string) =>
      identifier === checkoutRequestId ? { ...confirmedTransaction } : undefined
    );
    storeMocks.loadTransaction.mockImplementation(async (identifier: string) =>
      identifier === checkoutRequestId ? { ...confirmedTransaction } : undefined
    );
    mpesaMocks.queryPaymentStatus.mockResolvedValueOnce({
      status: 'SUCCESS',
      resultCode: 0,
      mpesaReceiptNumber: 'SIA9876543',
      downloadToken: 'ink_verified_payment_token'
    });

    const response = await fetch(`${baseUrl}/api/payments/status/${paymentAttemptId}`, {
      headers: { 'x-payment-capability': paymentCapability }
    });
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      checkoutRequestId,
      articleId: 'article_1',
      status: 'PAID',
      mpesaReceiptNumber: 'SIA9876543',
      downloadToken: 'ink_verified_payment_token'
    });
    expect(mpesaMocks.queryPaymentStatus.mock.calls.every(([identifier]) => identifier === checkoutRequestId)).toBe(true);
    expect(mpesaMocks.queryPaymentStatus).not.toHaveBeenCalledWith(paymentAttemptId);
  });

  it('never unlocks a callback-linked transaction that is still pending', async () => {
    const pendingTransaction = {
      ...confirmedTransaction,
      status: 'PENDING',
      mpesaReceiptNumber: undefined,
      receiptNumber: undefined,
      downloadToken: undefined
    };
    storeMocks.loadMpesaCallbackIntentByPaymentHash.mockResolvedValueOnce({
      ...pendingIntent,
      checkoutRequestId,
      merchantRequestId: 'merchant_987654321',
      status: 'ATTACHED',
      attachedAt: '2026-09-08T10:00:30.000Z'
    });
    storeMocks.refreshTransaction.mockImplementation(async (identifier: string) =>
      identifier === checkoutRequestId ? { ...pendingTransaction } : undefined
    );
    storeMocks.loadTransaction.mockImplementation(async (identifier: string) =>
      identifier === checkoutRequestId ? { ...pendingTransaction } : undefined
    );
    mpesaMocks.queryPaymentStatus.mockResolvedValueOnce({ status: 'PENDING' });

    const response = await fetch(`${baseUrl}/api/payments/status/${paymentAttemptId}`, {
      headers: { 'x-payment-capability': paymentCapability }
    });
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: 'PENDING', rawStatus: 'PENDING' });
    expect(body).not.toHaveProperty('downloadToken');
    expect(body).not.toHaveProperty('mpesaReceiptNumber');
    expect(mpesaMocks.queryPaymentStatus).toHaveBeenCalledWith(checkoutRequestId);
  });

  it('finds a verified settlement by attempt ID after settlement removes the short-lived intent', async () => {
    storeMocks.loadMpesaCallbackIntentByPaymentHash.mockResolvedValueOnce(undefined);
    storeMocks.refreshTransactionByPaymentAttemptId.mockResolvedValueOnce({ ...confirmedTransaction });
    storeMocks.loadTransaction.mockImplementation(async (identifier: string) =>
      identifier === checkoutRequestId ? { ...confirmedTransaction } : undefined
    );
    mpesaMocks.queryPaymentStatus.mockResolvedValueOnce({
      status: 'SUCCESS',
      resultCode: 0,
      mpesaReceiptNumber: 'SIA9876543',
      downloadToken: 'ink_verified_payment_token'
    });

    const response = await fetch(`${baseUrl}/api/payments/status/${paymentAttemptId}`, {
      headers: { 'x-payment-capability': paymentCapability }
    });
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      checkoutRequestId,
      status: 'PAID',
      mpesaReceiptNumber: 'SIA9876543',
      downloadToken: 'ink_verified_payment_token'
    });
    expect(storeMocks.refreshTransactionByPaymentAttemptId).toHaveBeenCalledWith(paymentAttemptId);
    expect(mpesaMocks.queryPaymentStatus).toHaveBeenCalledWith(checkoutRequestId);
    expect(mpesaMocks.queryPaymentStatus).not.toHaveBeenCalledWith(paymentAttemptId);
  });
});
