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
    getUploadedAsset: vi.fn(async () => ({
      dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlGQAAAAASUVORK5CYII='
    })),
    getAuthSession: vi.fn(),
    getArticles: vi.fn(() => []),
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
});
