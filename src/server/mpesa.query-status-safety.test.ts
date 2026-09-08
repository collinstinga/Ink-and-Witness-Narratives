import crypto from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const storeMocks = vi.hoisted(() => ({
  loadTransaction: vi.fn(),
  getMpesaSettings: vi.fn(),
  recordMpesaTerminalFailure: vi.fn(),
  settleMpesaTransaction: vi.fn()
}));

vi.mock('./store.js', () => ({ store: storeMocks }));

const fetchMock = vi.fn();

function jsonResponse(status: number, body: Record<string, unknown>) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn(async () => body),
    text: vi.fn(async () => JSON.stringify(body))
  };
}

function pendingTransaction(checkoutRequestId: string) {
  return {
    id: `tx_${checkoutRequestId}`,
    checkoutRequestId,
    merchantRequestId: `merchant_${checkoutRequestId}`,
    articleId: 'article_1',
    articleTitle: 'Test article',
    phoneNumber: '254712345678',
    amount: 300,
    paymentMethod: 'mpesa',
    type: 'PURCHASE',
    status: 'PENDING',
    createdAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    shortcodeUsed: '600111',
    callbackCapabilityHash: 'b'.repeat(64),
    paymentCapabilityHash: 'a'.repeat(64)
  };
}

async function queryWithProviderResponse(
  checkoutRequestId: string,
  providerBody: Record<string, unknown>
) {
  fetchMock
    .mockResolvedValueOnce(jsonResponse(200, { access_token: 'oauth-token', expires_in: 3599 }))
    .mockResolvedValueOnce(jsonResponse(200, providerBody));
  storeMocks.loadTransaction.mockResolvedValue(pendingTransaction(checkoutRequestId));
  vi.resetModules();
  const { queryPaymentStatus } = await import('./mpesa.js');
  return queryPaymentStatus(checkoutRequestId);
}

describe('M-Pesa status-query terminality', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    process.env.MPESA_CONSUMER_KEY = `query-test-key-${crypto.randomUUID()}`;
    process.env.MPESA_CONSUMER_SECRET = 'query-test-secret';
    process.env.MPESA_PASSKEY = 'query-test-passkey';
    storeMocks.getMpesaSettings.mockReturnValue({});
    storeMocks.recordMpesaTerminalFailure.mockResolvedValue({ outcome: 'committed' });
  });

  it('does not synthesize a terminal timeout from the age of an explicitly in-progress response', async () => {
    const result = await queryWithProviderResponse('ws_CO_in_progress', {
      ResponseCode: '0',
      ResultCode: 5001,
      ResultDesc: 'The transaction is still processing'
    });

    expect(result).toMatchObject({ status: 'PENDING' });
    expect(storeMocks.recordMpesaTerminalFailure).not.toHaveBeenCalled();
    expect(storeMocks.settleMpesaTransaction).not.toHaveBeenCalled();
  });

  it.each([
    ['an unclassified non-zero result', { ResponseCode: '0', ResultCode: 4999, ResultDesc: 'Outcome not classified' }],
    ['a success envelope missing ResultCode', { ResponseCode: '0', ResultDesc: 'Request received' }]
  ])('keeps %s non-terminal', async (_description, providerBody) => {
    const checkoutRequestId = `ws_CO_${crypto.randomBytes(6).toString('hex')}`;
    const result = await queryWithProviderResponse(checkoutRequestId, providerBody);

    expect(result).toMatchObject({ status: 'PENDING' });
    expect(storeMocks.recordMpesaTerminalFailure).not.toHaveBeenCalled();
    expect(storeMocks.settleMpesaTransaction).not.toHaveBeenCalled();
  });
});
