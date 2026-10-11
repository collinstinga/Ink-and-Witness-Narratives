import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './api.js';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
}

describe('checkout affiliate attribution consumption', () => {
  let localStorage: MemoryStorage;
  let sessionStorage: MemoryStorage;

  beforeEach(() => {
    localStorage = new MemoryStorage();
    sessionStorage = new MemoryStorage();
    sessionStorage.setItem('ink_witness_affiliate_ref', 'partner_7');
    sessionStorage.setItem('ink_witness_affiliate_time', '1800000000000');
    sessionStorage.setItem('ink_witness_affiliate_campaign', 'launch');
    vi.stubGlobal('window', {});
    vi.stubGlobal('localStorage', localStorage);
    vi.stubGlobal('sessionStorage', sessionStorage);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('clears current-session referral context after an attributed M-Pesa checkout starts', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        success: true,
        checkoutRequestId: 'checkout_1',
        paymentCapability: 'capability',
        affiliateAttributionConsumed: true
      })
    }));
    vi.stubGlobal('fetch', fetchMock);

    await api.initiateStkPush('piece_1', '254700000000', 500);

    const request = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(request[1].body as string)).toMatchObject({
      affiliateCode: 'partner_7',
      campaignCode: 'launch'
    });
    expect(sessionStorage.getItem('ink_witness_affiliate_ref')).toBeNull();
    expect(sessionStorage.getItem('ink_witness_affiliate_time')).toBeNull();
    expect(sessionStorage.getItem('ink_witness_affiliate_campaign')).toBeNull();
  });

  it('clears current-session referral context after an attributed bank order starts', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        success: true,
        checkoutRequestId: 'bank_1',
        bankReference: 'BW-123456',
        paymentCapability: 'capability',
        affiliateAttributionConsumed: true,
        bankDetails: {},
        message: 'Created'
      })
    }));
    vi.stubGlobal('fetch', fetchMock);

    await api.createBankOrder({ articleId: 'piece_1' });

    const request = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(request[1].body as string)).toMatchObject({
      affiliateCode: 'partner_7',
      campaignCode: 'launch'
    });
    expect(sessionStorage.getItem('ink_witness_affiliate_ref')).toBeNull();
  });

  it('clears replayed referral context even when the server rejects an in-flight duplicate', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      json: async () => ({
        success: false,
        code: 'AFFILIATE_CHECKOUT_IN_PROGRESS',
        error: 'Referral checkout already started.',
        affiliateAttributionConsumed: true
      })
    })));

    await expect(api.initiateStkPush('piece_1', '254700000000', 500))
      .rejects.toThrow('Referral checkout already started.');
    expect(sessionStorage.getItem('ink_witness_affiliate_ref')).toBeNull();
    expect(sessionStorage.getItem('ink_witness_affiliate_campaign')).toBeNull();
  });
});
