import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getActiveReferral, initReferralTracking } from './affiliateReferral.js';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, String(value));
  }
}

describe('affiliate referral tracking', () => {
  let local: MemoryStorage;
  let session: MemoryStorage;
  let fetchMock: ReturnType<typeof vi.fn>;
  let location: { search: string };

  beforeEach(() => {
    local = new MemoryStorage();
    session = new MemoryStorage();
    location = { search: '' };
    fetchMock = vi.fn(async () => ({ ok: true }));

    vi.stubGlobal('window', { location });
    vi.stubGlobal('localStorage', local);
    vi.stubGlobal('sessionStorage', session);
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('stores attribution and does not trust a forgeable iw_ref_tracked query marker', () => {
    location.search = '?ref=Partner_7&c=Launch_2026&iw_ref_tracked=1';

    const referral = initReferralTracking();

    expect(referral).toMatchObject({
      code: 'partner_7',
      timestamp: 1_800_000_000_000
    });
    expect(local.getItem('ink_witness_affiliate_ref')).toBe('partner_7');
    expect(local.getItem('ink_witness_affiliate_time')).toBe('1800000000000');
    expect(local.getItem('ink_witness_affiliate_campaign')).toBe('launch_2026');
    expect(session.getItem('ink_witness_affiliate_ref')).toBe('partner_7');
    expect(session.getItem('ink_witness_affiliate_campaign')).toBe('launch_2026');
    expect(getActiveReferral()).toEqual({
      code: 'partner_7',
      campaign: 'launch_2026',
      timestamp: 1_800_000_000_000
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/affiliate/click', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ref: 'partner_7',
        articleId: undefined,
        campaign: 'Launch_2026'
      })
    });
  });

  it('submits exactly one click for a direct ref link while storing its attribution', () => {
    location.search = '?ref=Partner_7&article=piece_42&campaign=launch_2026';

    const referral = initReferralTracking();

    expect(referral).toMatchObject({
      code: 'partner_7',
      campaign: 'launch_2026'
    });
    expect(local.getItem('ink_witness_affiliate_ref')).toBe('partner_7');
    expect(local.getItem('ink_witness_affiliate_campaign')).toBe('launch_2026');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/affiliate/click', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ref: 'partner_7',
        articleId: 'piece_42',
        campaign: 'launch_2026'
      })
    });
  });
});
