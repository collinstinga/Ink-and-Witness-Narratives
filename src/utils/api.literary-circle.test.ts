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

describe('Literary Circle onboarding API client', () => {
  beforeEach(() => {
    const localStorage = new MemoryStorage();
    localStorage.setItem('ink_affiliate_session_active', '1');
    localStorage.setItem('ink_writer_session_active', '1');
    vi.stubGlobal('localStorage', localStorage);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('saves a completed step and onboarding status with the affiliate session', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ success: true }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await api.updateAffiliateLiteraryCircleOnboarding({
      completedStepId: 'welcome',
      status: 'in_progress',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/affiliate/literary-circle/onboarding');
    expect(init.method).toBe('PUT');
    expect(init.headers).toMatchObject({
      'Content-Type': 'application/json',
      'x-affiliate-token': 'cookie-session',
    });
    expect(JSON.parse(init.body as string)).toEqual({
      completedStepId: 'welcome',
      status: 'in_progress',
    });
  });

  it('loads the private community through a no-store affiliate request', async () => {
    const literaryCircle = {
      enabled: true,
      community: {
        enabled: true,
        title: 'Private Circle Desk',
        description: 'Current partner guidance.',
        posts: [],
      },
    };
    const fetchMock = vi.fn(async () => ({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ success: true, literaryCircle }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await api.getAffiliateLiteraryCircleCommunity();

    expect(result.literaryCircle).toEqual(literaryCircle);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/affiliate/literary-circle/community');
    expect(init.cache).toBe('no-store');
    expect(init.headers).toMatchObject({
      'x-affiliate-token': 'cookie-session',
    });
  });

  it('loads promotional resources only through a no-store affiliate request', async () => {
    const library = {
      schemaVersion: 1,
      revision: 1,
      enabled: true,
      title: 'Partner toolkit',
      description: 'Approved materials.',
      items: [],
    };
    const fetchMock = vi.fn(async () => ({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ success: true, library }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.getAffiliateLiteraryCircleResources()).resolves.toMatchObject({ library });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/affiliate/literary-circle/resources');
    expect(init.cache).toBe('no-store');
    expect(init.headers).toMatchObject({ 'x-affiliate-token': 'cookie-session' });
  });

  it('sends the writer resource revision with an atomic artwork association request', async () => {
    const library = {
      schemaVersion: 1,
      revision: 4,
      enabled: true,
      title: 'Partner toolkit',
      description: 'Approved materials.',
      items: [],
    };
    const fetchMock = vi.fn(async () => ({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ success: true, library }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await api.uploadAdminLiteraryCircleResourceImage({
      resourceId: 'resource-one',
      dataUrl: 'data:image/png;base64,AAAA',
      assetAlt: 'Indigo cover with gold lettering',
      expectedRevision: 3,
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/admin/affiliates/literary-circle/resource-image');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toMatchObject({
      resourceId: 'resource-one',
      expectedRevision: 3,
    });
  });
});
