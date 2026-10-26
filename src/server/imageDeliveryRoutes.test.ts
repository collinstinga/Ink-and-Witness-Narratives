import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import sharp from 'sharp';
import { beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import * as imageDelivery from './imageDelivery.js';
import * as imageSecurity from './imageSecurity.js';
import { createPersistentAssetHandler } from './persistentAssetDelivery.js';

let original: Buffer;
let dataUrl: string;
beforeAll(async () => {
  original = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#123456' } }).jpeg({ quality: 90 }).toBuffer();
  dataUrl = `data:image/jpeg;base64,${original.toString('base64')}`;
});

async function withAssetRoute(
  test: (harness: {
    request: (route: string) => Promise<Response>;
    getUploadedAsset: ReturnType<typeof vi.fn>;
    derive: MockInstance<typeof imageDelivery.renderResponsiveImage>;
    validate: MockInstance<typeof imageSecurity.validateImageDataUrl>;
    asset: { dataUrl: string; accessScope?: string };
  }) => Promise<void>
) {
  const asset: { dataUrl: string; accessScope?: string } = { dataUrl };
  const getUploadedAsset = vi.fn(async (_id: string) => asset);
  const derive = vi.spyOn(imageDelivery, 'renderResponsiveImage');
  const validate = vi.spyOn(imageSecurity, 'validateImageDataUrl');
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const handler = createPersistentAssetHandler(getUploadedAsset);
  const app = express();
  app.use((req, res, next) => {
    if (req.path === '/api/assets/throw_send') {
      const send = res.send.bind(res);
      let failedOnce = false;
      res.send = body => {
        if (!failedOnce) { failedOnce = true; throw new Error('Simulated late write failure before headers were sent.'); }
        return send(body);
      };
    }
    next();
  });
  app.get('/api/assets/:assetId', handler);
  app.get('/uploads/:filename', handler);
  const server: Server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await test({ request: route => fetch(`${origin}${route}`, { redirect: 'error' }), getUploadedAsset, derive, validate, asset });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    vi.restoreAllMocks();
  }
}

function expectNoStore(response: Response) {
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(response.headers.get('cdn-cache-control')).toBe('no-store');
  expect(response.headers.get('vercel-cdn-cache-control')).toBe('no-store');
}

describe('public responsive image HTTP delivery', () => {
  it('wires both existing aliases before deferred store and session hydration', () => {
    const source = readFileSync(new URL('../../server.ts', import.meta.url), 'utf8');
    const factory = source.indexOf('createPersistentAssetHandler(assetId => store.getUploadedAsset(assetId))');
    const publicRoute = source.indexOf("app.get('/api/assets/:assetId', servePersistentAsset)");
    const legacyRoute = source.indexOf("app.get('/uploads/:filename', servePersistentAsset)");
    expect(factory).toBeGreaterThan(0);
    expect(publicRoute).toBeGreaterThan(factory);
    expect(legacyRoute).toBeGreaterThan(publicRoute);
    expect(source.indexOf('await ensureStoreInitialized();', legacyRoute)).toBeGreaterThan(legacyRoute);
    expect(source.indexOf('app.use(loadSessionUser)', legacyRoute)).toBeGreaterThan(legacyRoute);
  });

  it('preserves original bytes, type and long-lived browser caching without running Sharp', async () => {
    await withAssetRoute(async h => {
      const response = await h.request('/api/assets/cover_jpg');
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('image/jpeg');
      expect(Buffer.from(await response.arrayBuffer())).toEqual(original);
      expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
      expect(response.headers.get('cdn-cache-control')).toBeNull();
      expect(response.headers.get('vercel-cdn-cache-control')).toBeNull();
      expect(h.getUploadedAsset).toHaveBeenCalledExactlyOnceWith('cover_jpg');
      expect(h.derive).not.toHaveBeenCalled();
      expect(h.asset.dataUrl).toBe(dataUrl);
    });
  });

  it('serves a bounded WebP derivative with byte validators and explicit CDN caching', async () => {
    await withAssetRoute(async h => {
      const response = await h.request('/api/assets/cover_jpg?w=320&format=webp');
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('image/webp');
      expect(response.headers.get('content-disposition')).toBe('inline; filename="cover_jpg.webp"');
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
      expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
      expect(response.headers.get('cdn-cache-control')).toBe('public, s-maxage=31536000');
      expect(response.headers.get('vercel-cdn-cache-control')).toBe('public, s-maxage=31536000');
      expect(response.headers.get('etag')).toMatch(/^"[a-f0-9]{64}"$/);
      const bytes = Buffer.from(await response.arrayBuffer());
      expect(bytes.length).toBeLessThan(original.length);
      expect(response.headers.get('content-length')).toBe(String(bytes.length));
      expect(await sharp(bytes).metadata()).toMatchObject({ format: 'webp', width: 320, height: 213 });
      expect(h.derive).toHaveBeenCalledExactlyOnceWith(dataUrl, { width: 320, format: 'webp' });
      expect(h.asset.dataUrl).toBe(dataUrl);
    });
  });

  it.each(['/api/assets/private_cover', '/api/assets/private_cover?w=320&format=webp'])('rejects private draft artwork before decoding: %s', async route => {
    await withAssetRoute(async h => {
      h.asset.accessScope = 'literary_circle_private';
      h.asset.dataUrl = 'deliberately not a valid raster';
      const response = await h.request(route);
      expect(response.status).toBe(404);
      expectNoStore(response);
      expect(h.derive).not.toHaveBeenCalled();
      expect(h.validate).not.toHaveBeenCalled();
      expect(await response.json()).toEqual({ error: 'Image not found.' });
    });
  });

  it.each([
    '?w=400&format=webp', '?w=320', '?format=webp', '?w=0320&format=webp',
    '?w=320&format=svg', '?w=320&w=640&format=webp', '?w=320&format=webp&format=webp'
  ])('rejects invalid image options before database or decoder access: %s', async query => {
    await withAssetRoute(async h => {
      const response = await h.request(`/api/assets/cover_jpg${query}`);
      expect(response.status).toBe(400);
      expectNoStore(response);
      expect(h.getUploadedAsset).not.toHaveBeenCalled();
      expect(h.derive).not.toHaveBeenCalled();
      expect(h.validate).not.toHaveBeenCalled();
    });
  });

  it.each(['/api/assets/not-approved.svg', '/api/assets/%2fprivate'])('rejects invalid identifiers before database access: %s', async route => {
    await withAssetRoute(async h => {
      const response = await h.request(route);
      expect(response.status).toBe(404);
      expectNoStore(response);
      expect(h.getUploadedAsset).not.toHaveBeenCalled();
    });
  });

  it.each(['/api/assets/broken', '/api/assets/broken?w=320&format=webp'])('returns a non-cacheable 415 for malformed stored pixels: %s', async route => {
    await withAssetRoute(async h => {
      h.asset.dataUrl = 'data:image/svg+xml;base64,PHN2Zz4=';
      const response = await h.request(route);
      expect(response.status).toBe(415);
      expectNoStore(response);
      expect(await response.json()).toEqual({ error: 'Stored image is not an approved image type.' });
    });
  });

  it('keeps a missing asset non-cacheable and avoids processing', async () => {
    await withAssetRoute(async h => {
      h.getUploadedAsset.mockResolvedValueOnce(null);
      const response = await h.request('/api/assets/missing?w=320&format=webp');
      expect(response.status).toBe(404);
      expectNoStore(response);
      expect(h.derive).not.toHaveBeenCalled();
    });
  });

  it('keeps legacy /uploads filenames and their rewritten /api alias byte-compatible', async () => {
    await withAssetRoute(async h => {
      for (const route of ['/uploads/legacy-cover.jpg', '/api/assets/legacy-cover.jpg']) {
        const response = await h.request(route);
        expect(response.status).toBe(200);
        expect(Buffer.from(await response.arrayBuffer())).toEqual(original);
      }
      expect(h.getUploadedAsset.mock.calls).toEqual([['legacy-cover_jpg'], ['legacy-cover_jpg']]);
      expect(h.derive).not.toHaveBeenCalled();
    });
  });

  it('keeps storage failures non-cacheable without leaking internal messages', async () => {
    await withAssetRoute(async h => {
      h.getUploadedAsset.mockRejectedValueOnce(new Error('private provider credential details'));
      const response = await h.request('/api/assets/cover_jpg?w=320&format=webp');
      expect(response.status).toBe(503);
      expectNoStore(response);
      expect(await response.json()).toEqual({ error: 'Image storage is temporarily unavailable.' });
      expect(h.derive).not.toHaveBeenCalled();
    });
  });

  it('clears successful cache, image and validator headers after a late pre-send failure', async () => {
    await withAssetRoute(async h => {
      const response = await h.request('/api/assets/throw_send?w=320&format=webp');
      expect(response.status).toBe(503);
      expectNoStore(response);
      expect(response.headers.get('content-type')).toContain('application/json');
      expect(response.headers.get('content-disposition')).toBeNull();
      expect(response.headers.get('etag')).not.toMatch(/^"[a-f0-9]{64}"$/);
      const body = await response.text();
      expect(Number(response.headers.get('content-length'))).toBe(Buffer.byteLength(body));
      expect(JSON.parse(body)).toEqual({ error: 'Image storage is temporarily unavailable.' });
    });
  });
});
