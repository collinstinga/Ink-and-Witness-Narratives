import http, { Server } from 'http';
import { AddressInfo } from 'net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.VERCEL = '1';
  process.env.NODE_ENV = 'test';
});

const storeMocks = vi.hoisted(() => {
  const known = {
    init: vi.fn(async () => undefined),
    loadTransaction: vi.fn(),
    refreshTransaction: vi.fn(),
    loadPurchasedToken: vi.fn(),
    findTransactionByReceipt: vi.fn(),
    confirmTransaction: vi.fn(),
    savePurchasedToken: vi.fn(async () => undefined),
    saveTransaction: vi.fn(async (transaction: unknown) => transaction),
    getArticleById: vi.fn(() => ({ id: 'article_1', title: 'Test article' })),
    getMpesaSettings: vi.fn(() => ({ defaultPriceKes: 300, minTipKes: 300, tippingEnabled: true })),
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
  formatKenyanPhone: vi.fn((value: unknown) => {
    const digits = String(value || '').replace(/\D/g, '');
    if (digits.startsWith('0')) return `254${digits.slice(1)}`;
    if (digits.startsWith('254')) return digits;
    return digits;
  }),
  maskPhone: vi.fn((value: unknown) => String(value || ''))
}));

vi.mock('./src/server/mpesa.js', () => mpesaMocks);

import { createApp } from './server.js';
import { generatePaymentCapability, hashPaymentCapability } from './src/server/paymentSecurity.js';

describe('public payment route security', () => {
  let server: Server;
  let baseUrl: string;
  const adminSessionToken = `sess_${'a'.repeat(64)}`;
  const paymentCapability = generatePaymentCapability();
  const transaction = {
    id: 'tx_1',
    checkoutRequestId: 'checkout_123',
    merchantRequestId: 'merchant_123',
    articleId: 'article_1',
    articleTitle: 'Test article',
    phoneNumber: '254712345678',
    amount: 300,
    paymentMethod: 'mpesa',
    type: 'PURCHASE',
    status: 'CONFIRMED',
    createdAt: '2026-09-05T10:00:00.000Z',
    mpesaReceiptNumber: 'SIA1234567',
    receiptNumber: 'SIA1234567',
    downloadToken: 'ink_test_token',
    paymentCapabilityHash: hashPaymentCapability(paymentCapability),
    callbackCapabilityHash: 'b'.repeat(64)
  };

  beforeAll(async () => {
    process.env.VERCEL = '1';
    process.env.NODE_ENV = 'test';
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
    storeMocks.getAuthSession.mockResolvedValue({
      sessionId: adminSessionToken,
      userId: 'admin_1',
      email: 'admin@example.test',
      name: 'Test Admin',
      role: 'admin',
      expiresAt: Date.now() + 60_000
    });
    storeMocks.saveMpesaSettings.mockImplementation(async (settings: Record<string, unknown>) => ({
      ...settings,
      consumerKey: '',
      consumerSecret: '',
      passkey: ''
    }));
    storeMocks.loadTransaction.mockResolvedValue({ ...transaction });
    storeMocks.refreshTransaction.mockResolvedValue({ ...transaction });
    storeMocks.loadPurchasedToken.mockResolvedValue(undefined);
    storeMocks.findTransactionByReceipt.mockResolvedValue(undefined);
    mpesaMocks.queryPaymentStatus.mockResolvedValue({
      status: 'SUCCESS',
      resultCode: 0,
      mpesaReceiptNumber: 'SIA1234567',
      downloadToken: 'ink_test_token'
    });
    mpesaMocks.handleDarajaCallback.mockResolvedValue({ success: false, outcome: 'rejected', message: 'rejected' });
  });

  it('does not expose payment status or download tokens without the capability', async () => {
    const missing = await fetch(`${baseUrl}/api/payments/status/checkout_123`);
    const wrong = await fetch(`${baseUrl}/api/payments/status/checkout_123`, {
      headers: { 'x-payment-capability': generatePaymentCapability() }
    });

    expect(missing.status).toBe(404);
    expect(wrong.status).toBe(404);
    expect(mpesaMocks.queryPaymentStatus).not.toHaveBeenCalled();
  });

  it('returns a narrow, non-cacheable status view to the capability holder', async () => {
    const response = await fetch(`${baseUrl}/api/payments/status/checkout_123`, {
      headers: { 'x-payment-capability': paymentCapability }
    });
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(body).toMatchObject({ status: 'PAID', downloadToken: 'ink_test_token' });
    expect(body).not.toHaveProperty('phoneNumber');
    expect(body).not.toHaveProperty('merchantRequestId');
    expect(body).not.toHaveProperty('paymentCapabilityHash');
    expect(body).not.toHaveProperty('callbackCapabilityHash');
  });

  it('refreshes exactly one transaction before reporting a cross-instance payment confirmation', async () => {
    const stalePending = {
      ...transaction,
      status: 'PENDING',
      downloadToken: undefined,
      mpesaReceiptNumber: undefined,
      receiptNumber: undefined
    };
    storeMocks.loadTransaction.mockResolvedValueOnce(stalePending).mockResolvedValueOnce({ ...transaction });
    storeMocks.refreshTransaction.mockResolvedValueOnce({ ...transaction });

    const response = await fetch(`${baseUrl}/api/payments/status/checkout_123`, {
      headers: { 'x-payment-capability': paymentCapability }
    });
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: 'PAID', downloadToken: 'ink_test_token' });
    expect(storeMocks.refreshTransaction).toHaveBeenCalledTimes(1);
    expect(storeMocks.refreshTransaction).toHaveBeenCalledWith('checkout_123');
    expect(storeMocks.refreshTransaction.mock.invocationCallOrder[0])
      .toBeLessThan(mpesaMocks.queryPaymentStatus.mock.invocationCallOrder[0]);
  });

  it('returns a non-cacheable retry response when payment storage is unavailable', async () => {
    storeMocks.refreshTransaction.mockRejectedValueOnce(new Error('private database detail'));

    const response = await fetch(`${baseUrl}/api/payments/status/checkout_123`, {
      headers: { 'x-payment-capability': paymentCapability }
    });
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(JSON.stringify(body)).not.toContain('private database detail');
  });

  it('uses the stored reader license lookup and never unlocks a missing bearer', async () => {
    const missing = await fetch(`${baseUrl}/api/verify-access?token=ink_missing_token&articleId=article_1`);

    expect(missing.status).toBe(401);
    expect(storeMocks.loadPurchasedToken).toHaveBeenCalledWith('ink_missing_token');

    storeMocks.loadPurchasedToken.mockResolvedValueOnce({
      token: 'ink_confirmed_token',
      articleId: 'article_1',
      phone: '254700000001',
      expiresAt: Date.now() + 60_000,
      receipt: 'SIA1234567'
    });
    const confirmed = await fetch(`${baseUrl}/api/verify-access?token=ink_confirmed_token&articleId=article_1`);

    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toMatchObject({ valid: true, receipt: 'SIA1234567' });
  });

  it('fails closed without exposing storage errors during reader-license lookup', async () => {
    storeMocks.loadPurchasedToken.mockRejectedValueOnce(new Error('private database detail'));

    const response = await fetch(`${baseUrl}/api/verify-access?token=ink_missing_token&articleId=article_1`);
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(503);
    expect(JSON.stringify(body)).not.toContain('private database detail');
  });

  it('never self-confirms a pending checkout through receipt recovery', async () => {
    storeMocks.findTransactionByReceipt.mockResolvedValue({
      ...transaction,
      status: 'PENDING',
      downloadToken: undefined,
      mpesaReceiptNumber: undefined,
      receiptNumber: undefined
    });
    const response = await fetch(`${baseUrl}/api/mpesa/restore-purchase`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ transactionCode: 'SIA1234567', phoneNumber: '0712345678' })
    });

    expect(response.status).toBe(404);
    expect(storeMocks.confirmTransaction).not.toHaveBeenCalled();
    expect(storeMocks.savePurchasedToken).not.toHaveBeenCalled();
  });

  it('rejects an unknown purchase target before contacting Safaricom', async () => {
    storeMocks.getArticleById.mockReturnValueOnce(undefined);
    const response = await fetch(`${baseUrl}/api/mpesa/stkpush`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ articleId: 'missing-article', phoneNumber: '0712345678', amount: 300 })
    });

    expect(response.status).toBe(404);
    expect(mpesaMocks.initiateStkPush).not.toHaveBeenCalled();
  });

  it('requires the paying phone as second proof for confirmed receipt recovery', async () => {
    storeMocks.findTransactionByReceipt.mockResolvedValue({ ...transaction });
    const wrongPhone = await fetch(`${baseUrl}/api/mpesa/restore-purchase`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ transactionCode: 'SIA1234567', phoneNumber: '0700000000' })
    });
    const correctPhone = await fetch(`${baseUrl}/api/mpesa/restore-purchase`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ transactionCode: 'SIA1234567', phoneNumber: '0712345678' })
    });

    expect(wrongPhone.status).toBe(404);
    expect(correctPhone.status).toBe(200);
    expect(storeMocks.savePurchasedToken).toHaveBeenCalledTimes(1);
  });

  it('keeps callback responses non-enumerating and requests retry only on persistence failure', async () => {
    const rejected = await fetch(`${baseUrl}/api/mpesa/callback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ Body: { stkCallback: {} } })
    });
    expect(rejected.status).toBe(200);
    expect(await rejected.json()).toEqual({ ResultCode: 0, ResultDesc: 'Accepted' });

    mpesaMocks.handleDarajaCallback.mockResolvedValueOnce({
      success: false,
      outcome: 'retryable_error',
      message: 'temporary failure'
    });
    const retryable = await fetch(`${baseUrl}/api/mpesa/callback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ Body: { stkCallback: {} } })
    });
    expect(retryable.status).toBe(503);
    expect(await retryable.json()).toEqual({ ResultCode: 1, ResultDesc: 'Retry' });
  });

  it('rejects attempts to persist M-Pesa provider credentials through Writer Studio', async () => {
    const response = await fetch(`${baseUrl}/api/admin/mpesa/config`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `iw_session=${adminSessionToken}`,
        origin: baseUrl,
        'sec-fetch-site': 'same-origin'
      },
      body: JSON.stringify({ consumerSecret: 'attempted-secret-write' })
    });

    expect(response.status).toBe(400);
    expect(storeMocks.saveMpesaSettings).not.toHaveBeenCalled();
  });

  it('tests Daraja only with runtime credentials, never request-supplied credentials', async () => {
    const response = await fetch(`${baseUrl}/api/admin/mpesa/test-connection`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `iw_session=${adminSessionToken}`,
        origin: baseUrl,
        'sec-fetch-site': 'same-origin'
      },
      body: JSON.stringify({ consumerKey: 'attempted-request-key' })
    });

    expect(response.status).toBe(400);
    expect(mpesaMocks.getDarajaAccessToken).not.toHaveBeenCalled();
  });

  it('still permits updates to non-secret payment settings', async () => {
    const response = await fetch(`${baseUrl}/api/admin/mpesa/config`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `iw_session=${adminSessionToken}`,
        origin: baseUrl,
        'sec-fetch-site': 'same-origin'
      },
      body: JSON.stringify({ tillName: 'Safe public setting' })
    });

    expect(response.status).toBe(200);
    expect(storeMocks.saveMpesaSettings).toHaveBeenCalledWith({ tillName: 'Safe public setting' });
  });

  it('never exposes the bearer session token through admin verification', async () => {
    const response = await fetch(`${baseUrl}/api/admin/verify`, {
      headers: { cookie: `iw_session=${adminSessionToken}` }
    });
    const body = await response.json() as Record<string, any>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      valid: true,
      user: {
        id: 'admin_1',
        email: 'admin@example.test',
        name: 'Test Admin',
        role: 'admin'
      }
    });
    expect(body.user).not.toHaveProperty('sessionId');
    expect(JSON.stringify(body)).not.toContain(adminSessionToken);
  });
});
