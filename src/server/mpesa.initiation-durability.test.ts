import crypto from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const storeMocks = vi.hoisted(() => ({
  getMpesaSettings: vi.fn(),
  findRecentPendingTransaction: vi.fn(),
  saveMpesaCallbackIntent: vi.fn(),
  attachMpesaCallbackIntent: vi.fn(),
  discardMpesaCallbackIntent: vi.fn(),
  getMpesaRequestLockId: vi.fn(() => 'e'.repeat(64))
}));

vi.mock('./store.js', () => ({
  store: storeMocks,
  getMpesaRequestLockId: storeMocks.getMpesaRequestLockId
}));

const fetchMock = vi.fn();

function jsonResponse(status: number, body: Record<string, unknown>) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn(async () => body),
    text: vi.fn(async () => JSON.stringify(body))
  };
}

function acceptedStkResponse() {
  return jsonResponse(200, {
    ResponseCode: '0',
    MerchantRequestID: 'merchant_123456789',
    CheckoutRequestID: 'ws_CO_123456789',
    CustomerMessage: 'Success. Request accepted for processing'
  });
}

async function loadInitiator() {
  vi.resetModules();
  return (await import('./mpesa.js')).initiateStkPush;
}

describe('M-Pesa initiation durability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    process.env.MPESA_CONSUMER_KEY = `test-key-${crypto.randomUUID()}`;
    process.env.MPESA_CONSUMER_SECRET = 'test-secret';
    process.env.MPESA_PASSKEY = 'test-passkey';
    process.env.MPESA_PAYMENT_TYPE = 'till';
    process.env.MPESA_TRANSACTION_TYPE = 'CustomerBuyGoodsOnline';
    process.env.MPESA_STORE_NUMBER = '600111';
    process.env.MPESA_TILL_NUMBER = '600222';
    process.env.MPESA_CALLBACK_URL = 'https://www.inkandwitness-narratives.co.ke/api/mpesa/callback';
    storeMocks.getMpesaSettings.mockReturnValue({});
    storeMocks.findRecentPendingTransaction.mockResolvedValue(undefined);
    storeMocks.saveMpesaCallbackIntent.mockImplementation(async intent => intent);
    storeMocks.attachMpesaCallbackIntent.mockImplementation(async (_hash, checkoutRequestId, merchantRequestId) => ({
      checkoutRequestId,
      merchantRequestId,
      articleId: 'article_1',
      articleTitle: 'Test article',
      phoneNumber: '254712345678',
      amount: 300,
      paymentMethod: 'mpesa',
      type: 'PURCHASE',
      status: 'PENDING'
    }));
    storeMocks.discardMpesaCallbackIntent.mockResolvedValue(undefined);
  });

  it('never sends an STK request when the durable intent cannot be written', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { access_token: 'oauth-token', expires_in: 3599 }));
    storeMocks.saveMpesaCallbackIntent.mockRejectedValueOnce(new Error('database unavailable'));
    const initiateStkPush = await loadInitiator();

    const result = await initiateStkPush({
      phoneNumber: '0712345678',
      amount: 300,
      articleId: 'article_1',
      articleTitle: 'Test article'
    });

    expect(result).toMatchObject({ success: false });
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/mpesa/stkpush/'))).toHaveLength(0);
  });

  it('returns the stored attempt handle when response-side attachment throws after provider acceptance', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'oauth-token', expires_in: 3599 }))
      .mockResolvedValueOnce(acceptedStkResponse());
    storeMocks.attachMpesaCallbackIntent.mockRejectedValueOnce(new Error('temporary commit failure'));
    const initiateStkPush = await loadInitiator();

    const result = await initiateStkPush({
      phoneNumber: '0712345678',
      amount: 300,
      articleId: 'article_1',
      articleTitle: 'Test article'
    });

    const intent = storeMocks.saveMpesaCallbackIntent.mock.calls[0][0];
    expect(result).toMatchObject({
      success: true,
      checkoutRequestId: intent.paymentAttemptId
    });
    expect(result).not.toHaveProperty('merchantRequestId');
    expect(result.paymentCapability).toMatch(/^[A-Za-z0-9_-]{32,128}$/);

    const stkRequest = fetchMock.mock.calls.find(([url]) => String(url).includes('/mpesa/stkpush/'));
    const stkBody = JSON.parse(String(stkRequest?.[1]?.body));
    const callbackCapability = new URL(stkBody.CallBackURL).searchParams.get('cb_auth');

    expect(intent.paymentAttemptId).toMatch(/^attempt_[A-Za-z0-9_-]{16,}$/);
    expect(intent.paymentAttemptId).not.toBe('ws_CO_123456789');
    expect(intent.paymentCapabilityHash).toBe(
      crypto.createHash('sha256').update(result.paymentCapability).digest('hex')
    );
    expect(intent.callbackCapabilityHash).toBe(
      crypto.createHash('sha256').update(callbackCapability).digest('hex')
    );
    expect(JSON.stringify(intent)).not.toContain(result.paymentCapability);
    expect(JSON.stringify(intent)).not.toContain(callbackCapability);
  });

  it('returns the stored attempt handle when response-side attachment returns no transaction', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'oauth-token', expires_in: 3599 }))
      .mockResolvedValueOnce(acceptedStkResponse());
    storeMocks.attachMpesaCallbackIntent.mockResolvedValueOnce(undefined);
    const initiateStkPush = await loadInitiator();

    const result = await initiateStkPush({
      phoneNumber: '0712345678',
      amount: 300,
      articleId: 'article_1',
      articleTitle: 'Test article'
    });

    const intent = storeMocks.saveMpesaCallbackIntent.mock.calls[0][0];
    expect(result).toMatchObject({
      success: true,
      checkoutRequestId: intent.paymentAttemptId,
      paymentCapability: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/)
    });
    expect(result).not.toHaveProperty('merchantRequestId');
    expect(intent).not.toHaveProperty('checkoutRequestId');
  });

  it('returns the stored attempt handle when Safaricom omits MerchantRequestID', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'oauth-token', expires_in: 3599 }))
      .mockResolvedValueOnce(jsonResponse(200, {
        ResponseCode: '0',
        CheckoutRequestID: 'ws_CO_123456789',
        CustomerMessage: 'Request accepted for processing'
      }));
    const initiateStkPush = await loadInitiator();

    const result = await initiateStkPush({
      phoneNumber: '0712345678',
      amount: 300,
      articleId: 'article_1',
      articleTitle: 'Test article'
    });

    const intent = storeMocks.saveMpesaCallbackIntent.mock.calls[0][0];
    expect(result).toMatchObject({
      success: true,
      checkoutRequestId: intent.paymentAttemptId,
      paymentCapability: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/)
    });
    expect(result.checkoutRequestId).not.toBe('ws_CO_123456789');
    expect(result).not.toHaveProperty('merchantRequestId');
    expect(storeMocks.attachMpesaCallbackIntent).not.toHaveBeenCalled();
  });

  it('discards an intent after an explicit provider rejection', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'oauth-token', expires_in: 3599 }))
      .mockResolvedValueOnce(jsonResponse(400, {
        ResponseCode: '1',
        errorMessage: 'Request rejected'
      }));
    const initiateStkPush = await loadInitiator();

    const result = await initiateStkPush({
      phoneNumber: '0712345678',
      amount: 300,
      articleId: 'article_1'
    });

    expect(result).toMatchObject({ success: false, error: 'Request rejected' });
    const intent = storeMocks.saveMpesaCallbackIntent.mock.calls[0][0];
    expect(storeMocks.discardMpesaCallbackIntent).toHaveBeenCalledWith(
      intent.callbackCapabilityHash,
      intent.paymentCapabilityHash,
      intent.requestLockId
    );
  });

  it.each([
    ['an HTTP 5xx response', jsonResponse(503, { errorMessage: 'Upstream unavailable' })],
    ['a malformed HTTP 200 response', jsonResponse(200, { unexpected: 'response shape' })]
  ])('returns a durable anonymous polling handle after %s', async (_description, providerResponse) => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'oauth-token', expires_in: 3599 }))
      .mockResolvedValueOnce(providerResponse);
    const initiateStkPush = await loadInitiator();

    const result = await initiateStkPush({
      phoneNumber: '0712345678',
      amount: 300,
      articleId: 'article_1'
    });

    expect(result).toMatchObject({ success: true });
    expect(result.checkoutRequestId).toMatch(/^attempt_[A-Za-z0-9_-]{16,}$/);
    expect(result.paymentCapability).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(storeMocks.saveMpesaCallbackIntent).toHaveBeenCalledTimes(1);
    expect(storeMocks.discardMpesaCallbackIntent).not.toHaveBeenCalled();

    const intent = storeMocks.saveMpesaCallbackIntent.mock.calls[0][0];
    expect(intent).toMatchObject({
      paymentAttemptId: result.checkoutRequestId,
      status: 'PREPARED'
    });
    expect(intent).not.toHaveProperty('checkoutRequestId');
    expect(intent.paymentCapabilityHash).toBe(
      crypto.createHash('sha256').update(result.paymentCapability).digest('hex')
    );
    expect(JSON.stringify(intent)).not.toContain(result.paymentCapability);
  });

  it('returns the same durable anonymous polling handle stored before an ambiguous network failure', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'oauth-token', expires_in: 3599 }))
      .mockRejectedValueOnce(new Error('fetch failed'));
    const initiateStkPush = await loadInitiator();

    const result = await initiateStkPush({
      phoneNumber: '0712345678',
      amount: 300,
      articleId: 'article_1'
    });

    expect(result).toMatchObject({ success: true });
    expect(result.checkoutRequestId).toMatch(/^attempt_[A-Za-z0-9_-]{16,}$/);
    expect(result.paymentCapability).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(storeMocks.saveMpesaCallbackIntent).toHaveBeenCalledTimes(1);
    expect(storeMocks.discardMpesaCallbackIntent).not.toHaveBeenCalled();

    const intent = storeMocks.saveMpesaCallbackIntent.mock.calls[0][0];
    expect(intent.paymentAttemptId).toBe(result.checkoutRequestId);
    expect(intent.status).toBe('PREPARED');
    expect(intent).not.toHaveProperty('checkoutRequestId');
    expect(intent.paymentCapabilityHash).toBe(
      crypto.createHash('sha256').update(result.paymentCapability).digest('hex')
    );
  });

  it('persists tips as tips so a successful tip cannot create an article license', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'oauth-token', expires_in: 3599 }))
      .mockResolvedValueOnce(acceptedStkResponse());
    const initiateStkPush = await loadInitiator();

    await initiateStkPush({
      phoneNumber: '0712345678',
      amount: 300,
      articleId: 'general_tip',
      articleTitle: 'Tip',
      type: 'TIP'
    });

    expect(storeMocks.saveMpesaCallbackIntent.mock.calls[0][0]).toMatchObject({
      articleId: 'general_tip',
      type: 'TIP'
    });
  });
});
