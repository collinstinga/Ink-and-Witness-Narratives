import { afterEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  getMpesaSettings: vi.fn(),
  loadTransaction: vi.fn(),
  recordMpesaTerminalFailure: vi.fn(),
}));

vi.mock('./store.js', () => ({ store: fixture }));

import { getDarajaAccessToken, initiateStkPush, queryPaymentStatus } from './mpesa.js';
import { mpesaNetworkBlockReason } from './mpesaNetworkPolicy.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('M-Pesa outbound network policy', () => {
  it.each([
    {},
    { VERCEL_ENV: 'production' },
    { VERCEL_ENV: 'production', MPESA_ENV: 'production' },
    { VERCEL_ENV: 'preview', MPESA_NETWORK_MODE: 'live', MPESA_ENV: 'production' },
  ])('preserves live behavior only in an enabled configuration: %j', environment => {
    expect(mpesaNetworkBlockReason(environment)).toBeNull();
  });

  it.each([
    { VERCEL_ENV: 'preview' },
    { VERCEL_ENV: 'development' },
    { VERCEL_ENV: 'staging' },
    { VERCEL_ENV: 'production', MPESA_NETWORK_MODE: 'disabled' },
    { MPESA_NETWORK_MODE: 'invalid' },
    { MPESA_NETWORK_MODE: 'live', MPESA_ENV: 'sandbox' },
    { MPESA_ENV: 'unknown' },
  ])('fails closed for an unsafe or disabled configuration: %j', environment => {
    expect(mpesaNetworkBlockReason(environment)).toBeTypeOf('string');
  });

  it('blocks OAuth and STK before credentials, intent writes, or provider requests', async () => {
    vi.stubEnv('MPESA_NETWORK_MODE', 'disabled');
    const fetchSpy = vi.fn(() => { throw new Error('Unexpected outbound request'); });
    vi.stubGlobal('fetch', fetchSpy);
    expect(await getDarajaAccessToken()).toEqual({
      token: null, error: 'M-Pesa network requests are disabled in this environment.',
    });
    expect(await initiateStkPush({ phoneNumber: '0712345678', amount: 1 })).toEqual({
      success: false, error: 'M-Pesa network requests are disabled in this environment.',
    });
    expect(fixture.getMpesaSettings).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not turn a pending transaction into a terminal failure when networking is disabled', async () => {
    vi.stubEnv('MPESA_NETWORK_MODE', 'disabled');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    fixture.loadTransaction.mockResolvedValue({
      status: 'PENDING', createdAt: '2020-01-01T00:00:00Z', paymentMethod: 'mpesa',
    });
    expect(await queryPaymentStatus('controlled-checkout')).toEqual({
      status: 'PENDING', resultDesc: 'M-Pesa network requests are disabled in this environment.',
    });
    expect(fixture.recordMpesaTerminalFailure).not.toHaveBeenCalled();
    expect(fixture.getMpesaSettings).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses a previously cached OAuth token after the network switch is disabled', async () => {
    vi.stubEnv('MPESA_NETWORK_MODE', 'live');
    vi.stubEnv('MPESA_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('MPESA_CONSUMER_KEY', 'network-policy-test-key');
    vi.stubEnv('MPESA_CONSUMER_SECRET', 'network-policy-test-secret');
    fixture.getMpesaSettings.mockReturnValue({});
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ access_token: 'network-policy-test-token', expires_in: 3600 }),
    });
    vi.stubGlobal('fetch', fetchSpy);
    expect((await getDarajaAccessToken()).token).toBe('network-policy-test-token');
    vi.stubEnv('MPESA_NETWORK_MODE', 'disabled');
    expect((await getDarajaAccessToken()).token).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('still reports already-confirmed access from stored payment evidence', async () => {
    vi.stubEnv('MPESA_NETWORK_MODE', 'disabled');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    fixture.loadTransaction.mockResolvedValue({ status: 'CONFIRMED', articleId: 'owned-piece', amount: 500 });
    expect(await queryPaymentStatus('controlled-checkout')).toMatchObject({
      status: 'SUCCESS', resultCode: 0, articleId: 'owned-piece', isUnlocked: true,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
