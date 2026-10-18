import http, { Server } from 'http';
import { AddressInfo } from 'net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_IMAGE_TRANSPORT_BYTES } from './src/shared/imageLimits.js';

vi.hoisted(() => {
  process.env.VERCEL = '1';
  process.env.NODE_ENV = 'test';
});

const storeMocks = vi.hoisted(() => {
  const known = {
    init: vi.fn(async () => undefined),
    getUploadedAsset: vi.fn(async () => ({
      dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlGQAAAAASUVORK5CYII='
    })),
    saveUploadedImage: vi.fn(async () => ({
      success: true,
      url: '/api/assets/test-image_jpg',
      filename: 'test-image.jpg'
    })),
    updateAuthorPhoto: vi.fn(async () => ({ avatarUrl: '/api/assets/test-image_jpg' })),
    updatePieceCoverPhoto: vi.fn(async () => undefined),
    getAuthSession: vi.fn(),
    getArticles: vi.fn(() => []),
    getAllUsers: vi.fn(() => []),
    ensureUsersHydrated: vi.fn(async () => undefined),
    ensureAffiliateStoreInitialized: vi.fn(async () => undefined),
    affiliates: {}
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

vi.mock('./src/server/store.js', () => ({
  store: storeMocks,
  HomepageSaveConflictError: class HomepageSaveConflictError extends Error {
    readonly code = 'HOMEPAGE_SAVE_CONFLICT';
  }
}));
vi.mock('./src/server/affiliateStore.js', () => ({
  AffiliateSettingsValidationError: class AffiliateSettingsValidationError extends Error {},
  LiteraryCircleSettingsConflictError: class LiteraryCircleSettingsConflictError extends Error {},
  sanitizeAffiliateForResponse: (value: unknown) => value
}));
vi.mock('./src/server/publicWriteSecurity.js', () => ({
  publicWriteValidators: new Proxy({}, {
    get: () => (_req: unknown, _res: unknown, next: () => void) => next()
  })
}));
vi.mock('./src/server/mpesa.js', () => ({
  initiateStkPush: vi.fn(),
  handleDarajaCallback: vi.fn(),
  queryPaymentStatus: vi.fn(),
  verifyManualReceipt: vi.fn(),
  getDarajaAccessToken: vi.fn(),
  formatKenyanPhone: vi.fn((value: unknown) => String(value || '')),
  maskPhone: vi.fn(() => '254700***001')
}));

import { createApp } from './server.js';

describe('persistent asset delivery', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = await createApp();
    server = http.createServer(app);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('serves immutable images without initializing the full store or resolving a session', async () => {
    const response = await fetch(`${baseUrl}/api/assets/piece_cover-test_png`, {
      headers: { cookie: 'iw_session=session-that-must-not-be-read' }
    });
    const legacyResponse = await fetch(`${baseUrl}/uploads/legacy-cover.png`, {
      headers: { cookie: 'iw_session=session-that-must-not-be-read' }
    });

    expect(response.status).toBe(200);
    expect(legacyResponse.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('image/png');
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(Buffer.from(await response.arrayBuffer()).length).toBeGreaterThan(0);
    expect(Buffer.from(await legacyResponse.arrayBuffer()).length).toBeGreaterThan(0);
    expect(storeMocks.getUploadedAsset).toHaveBeenCalledWith('piece_cover-test_png');
    expect(storeMocks.getUploadedAsset).toHaveBeenCalledWith('legacy-cover_png');
    expect(storeMocks.init).not.toHaveBeenCalled();
    expect(storeMocks.getAuthSession).not.toHaveBeenCalled();
  });

  it('does not expose private Literary Circle draft artwork through public asset URLs', async () => {
    storeMocks.getUploadedAsset.mockResolvedValueOnce({
      accessScope: 'literary_circle_private',
      dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlGQAAAAASUVORK5CYII='
    });

    const response = await fetch(`${baseUrl}/api/assets/private-resource-image`);

    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('vercel-cdn-cache-control')).toBe('no-store');
  });

  it('rejects malformed asset identifiers instead of aliasing them to another record', async () => {
    const response = await fetch(`${baseUrl}/api/assets/unsafe%2Epng`);

    expect(response.status).toBe(404);
    expect(storeMocks.getUploadedAsset).not.toHaveBeenCalled();
  });

  it('returns a non-cacheable 503 and allows initialization to be retried', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    storeMocks.init.mockRejectedValueOnce(new Error('temporary Firestore outage'));

    const response = await fetch(`${baseUrl}/api/health`);

    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('vercel-cdn-cache-control')).toBe('no-store');
    expect(storeMocks.init).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it('coalesces concurrent data-backed requests behind one initialization barrier', async () => {
    let finishInitialization: (() => void) | undefined;
    storeMocks.init.mockImplementationOnce(() => new Promise<void>(resolve => {
      finishInitialization = resolve;
    }));

    let firstSettled = false;
    let secondSettled = false;
    const first = fetch(`${baseUrl}/api/health`).finally(() => { firstSettled = true; });
    const second = fetch(`${baseUrl}/api/health`).finally(() => { secondSettled = true; });

    await vi.waitFor(() => expect(storeMocks.init).toHaveBeenCalledTimes(1));
    expect(firstSettled).toBe(false);
    expect(secondSettled).toBe(false);

    finishInitialization?.();
    const [firstResponse, secondResponse] = await Promise.all([first, second]);

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(storeMocks.init).toHaveBeenCalledTimes(1);
    expect(storeMocks.getArticles).toHaveBeenCalledTimes(2);
    expect(storeMocks.getArticles).toHaveBeenCalledWith(false);
  });

  it('hydrates users only for account-directory routes', async () => {
    const publicResponse = await fetch(`${baseUrl}/api/health`);

    expect(publicResponse.status).toBe(200);
    expect(storeMocks.ensureUsersHydrated).not.toHaveBeenCalled();

    const accountResponse = await fetch(`${baseUrl}/api/auth/status`);

    expect(accountResponse.status).toBe(200);
    expect(await accountResponse.json()).toEqual({ hasAdmin: false, totalUsers: 0 });
    expect(storeMocks.ensureUsersHydrated).toHaveBeenCalledTimes(1);
  });

  it('does not let anonymous library requests force a user-directory scan', async () => {
    const response = await fetch(`${baseUrl}/api/user/library`);

    expect(response.status).toBe(401);
    expect(storeMocks.ensureUsersHydrated).not.toHaveBeenCalled();
  });

  it('fails account requests closed when deferred user hydration is unavailable', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    storeMocks.ensureUsersHydrated.mockRejectedValueOnce(new Error('temporary user directory outage'));

    const response = await fetch(`${baseUrl}/api/auth/status`);

    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('vercel-cdn-cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      error: 'Account services are temporarily unavailable. Please retry.'
    });
    errorSpy.mockRestore();
  });

  it('authenticates image routes before attempting to parse their larger JSON bodies', async () => {
    const response = await fetch(`${baseUrl}/api/admin/upload-image`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{malformed-json'
    });

    expect(response.status).toBe(401);
    expect(storeMocks.saveUploadedImage).not.toHaveBeenCalled();
  });

  it('authenticates the permanent-image route before parsing its larger JSON body', async () => {
    const response = await fetch(`${baseUrl}/api/admin/save-permanent-image`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{malformed-json'
    });

    expect(response.status).toBe(401);
  });

  it('does not report a successful assignment when durable image metadata persistence fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    storeMocks.getAuthSession.mockResolvedValueOnce({
      userId: 'writer-1',
      email: 'writer@example.test',
      role: 'admin',
      name: 'Writer',
      expiresAt: Date.now() + 60_000
    });
    storeMocks.updateAuthorPhoto.mockRejectedValueOnce(new Error('Firestore unavailable'));

    const response = await fetch(`${baseUrl}/api/admin/upload-image`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'iw_session=image-upload-session',
        origin: baseUrl,
        'sec-fetch-site': 'same-origin'
      },
      body: JSON.stringify({
        target: 'author_avatar',
        dataUrl: 'data:image/jpeg;base64,QUJD'
      })
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Failed to upload image.' });
    errorSpy.mockRestore();
  });

  it('fails closed when a cover is assigned to a missing piece', async () => {
    storeMocks.getAuthSession.mockResolvedValueOnce({
      userId: 'writer-1',
      email: 'writer@example.test',
      role: 'admin',
      name: 'Writer',
      expiresAt: Date.now() + 60_000
    });

    const response = await fetch(`${baseUrl}/api/admin/upload-image`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'iw_session=image-upload-session',
        origin: baseUrl,
        'sec-fetch-site': 'same-origin'
      },
      body: JSON.stringify({
        target: 'piece_cover',
        articleId: 'missing-piece',
        dataUrl: 'data:image/jpeg;base64,QUJD'
      })
    });

    expect(response.status).toBe(404);
  });

  it('accepts a production-safe Base64 transport for a 5 MB writer source after client optimization', async () => {
    storeMocks.getAuthSession.mockResolvedValueOnce({
      userId: 'writer-1',
      email: 'writer@example.test',
      role: 'admin',
      name: 'Writer',
      expiresAt: Date.now() + 60_000
    });
    const encodedSource = 'A'.repeat(Math.ceil(MAX_IMAGE_TRANSPORT_BYTES / 3) * 4);
    const body = JSON.stringify({
      target: 'piece_cover',
      dataUrl: `data:image/jpeg;base64,${encodedSource}`
    });
    expect(Buffer.byteLength(body)).toBeGreaterThan(1 * 1024 * 1024);
    expect(Buffer.byteLength(body)).toBeLessThan(4.5 * 1024 * 1024);

    const response = await fetch(`${baseUrl}/api/admin/upload-image`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'iw_session=image-upload-session',
        origin: baseUrl,
        'sec-fetch-site': 'same-origin'
      },
      body
    });

    expect(response.status).toBe(200);
    expect(storeMocks.saveUploadedImage).toHaveBeenCalledTimes(1);
  });
});
