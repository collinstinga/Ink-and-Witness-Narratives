import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_AFFILIATE_NOTIFICATION_SETTINGS } from '../server/affiliateNotifications.js';
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

describe('affiliate notification admin API client', () => {
  beforeEach(() => {
    const localStorage = new MemoryStorage();
    localStorage.setItem('ink_writer_session_active', '1');
    localStorage.setItem('ink_affiliate_session_active', '1');
    vi.stubGlobal('localStorage', localStorage);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('loads the isolated preview settings with no-store writer authentication', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ success: true, settings: DEFAULT_AFFILIATE_NOTIFICATION_SETTINGS }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await api.getAdminAffiliateNotificationSettings();

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/admin/affiliates/notifications');
    expect(init.cache).toBe('no-store');
    expect(init.headers).toMatchObject({ 'x-admin-token': 'cookie-session' });
  });

  it('sends the exact expected revision and cannot request a delivery', async () => {
    const current = JSON.parse(JSON.stringify(DEFAULT_AFFILIATE_NOTIFICATION_SETTINGS));
    current.revision = 8;
    const fetchMock = vi.fn(async () => ({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ success: true, settings: { ...current, revision: 9 } }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await api.updateAdminAffiliateNotificationSettings(current);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/admin/affiliates/notifications');
    expect(init.method).toBe('PUT');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ settings: current, expectedRevision: 8 });
    expect(JSON.stringify(body)).not.toMatch(/recipient|send|enqueue/i);
  });

  it('checks only aggregate eligibility for an event and an optional unsaved draft', async () => {
    const current = JSON.parse(JSON.stringify(DEFAULT_AFFILIATE_NOTIFICATION_SETTINGS));
    const fetchMock = vi.fn(async () => ({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({
        success: true,
        summary: { eventType: 'new_release', total: 9, eligible: 0, excluded: 9, reasons: {} },
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await api.getAdminAffiliateNotificationEligibility('new_release', current);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/admin/affiliates/notifications/eligibility');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ eventType: 'new_release', settings: current });
  });

  it('loads affiliate-owned preferences through the signed affiliate session', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({
        success: true,
        preferences: { schemaVersion: 1, revision: 0, marketingConsent: 'unknown' },
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await api.getAffiliateNotificationPreferences();

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/affiliate/notifications/preferences');
    expect(init.cache).toBe('no-store');
    expect(init.headers).toMatchObject({ 'x-affiliate-token': 'cookie-session' });
  });

  it('saves only consent and preference choices with the expected revision', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ success: true, preferences: { schemaVersion: 1, revision: 3 } }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const input = {
      expectedRevision: 2,
      marketingConsent: true,
      releaseUpdates: true,
      campaignUpdates: false,
      inactivityReminders: false,
      exclusiveOpportunities: true,
      commissionAlerts: true,
      tierAlerts: true,
    };

    await api.updateAffiliateNotificationPreferences(input);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/affiliate/notifications/preferences');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual(input);
    expect(JSON.stringify(input)).not.toMatch(/affiliateId|recipient|source|timestamp/i);
  });

  it('uses an empty body for explicit writer approval', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ success: true, affiliate: { id: 'aff-one', approvedAt: 'now' } }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await api.approveAdminAffiliate('aff-one');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/admin/affiliates/aff-one/approval');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({});
  });

  it('does not create a local affiliate session marker for a pending self-registration', async () => {
    localStorage.removeItem('ink_affiliate_session_active');
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 202,
      headers: { get: () => 'application/json' },
      json: async () => ({
        success: true,
        pendingApproval: true,
        affiliate: { id: 'aff-pending', status: 'pending' },
        message: 'Awaiting approval',
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await api.affiliateRegister({
      name: 'Pending Partner',
      email: 'pending@example.com',
      phone: '+254700000000',
      password: 'StrongPassword!2',
      payoutMethod: 'mpesa',
      payoutDetails: {},
      acceptedTerms: true,
    });

    expect(localStorage.getItem('ink_affiliate_session_active')).toBeNull();
  });
});
