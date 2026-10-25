import type { Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSocialPreviewHandler } from '../../api/social-preview.js';
import { createSocialImageHandler } from '../../api/social-image.js';
import { SOCIAL_ORIGIN, pieceSocialMetadata, siteSocialMetadata } from './socialPreview.js';

vi.mock('./db.js', () => ({ getDb: vi.fn(() => { throw new Error('Live database forbidden in tests'); }) }));
const template = '<!doctype html><html><head><title>Old</title></head><body><div id="root"></div><script type="module" src="/assets/app-built.js"></script></body></html>';
function response() {
  const result = {
    statusCode: 200, headers: {} as Record<string, string>, body: undefined as unknown,
    setHeader(name: string, value: string) { this.headers[name.toLowerCase()] = value; return this; },
    status(code: number) { this.statusCode = code; return this; },
    send(value: unknown) {
      // Model Express's send() length recalculation so HEAD tests catch an
      // accidental send('') overwriting the real image/HTML Content-Length.
      if (typeof value === 'string' || Buffer.isBuffer(value)) this.headers['content-length'] = String(Buffer.byteLength(value));
      this.body = value; return this;
    },
    end() { this.body = ''; return this; },
    json(value: unknown) { this.body = value; return this; },
  };
  return { value: result, res: result as unknown as Response };
}
const req = (url = '/', method = 'GET', headers = {}) => ({ url, method, headers } as Request);
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('public social HTML handler', () => {
  it('renders metadata into the built SPA for all visitors without host or cookie trust', async () => {
    const metadata = pieceSocialMetadata('fixed-id', { title: 'A published title', excerpt: 'Public excerpt', coverImage: '/uploads/piece.jpg' }, siteSocialMetadata());
    const loadMetadata = vi.fn().mockResolvedValue(metadata);
    const handler = createSocialPreviewHandler({ readTemplate: async () => template, loadMetadata });
    for (const headers of [{ host: 'evil.example', 'x-forwarded-host': 'evil.example' }, { cookie: 'admin=untrusted', 'user-agent': 'SocialBot' }]) {
      const { res, value } = response();
      await handler(req('/?monograph=fixed-id&ref=affiliate&token=private', 'GET', headers), res);
      expect(value.statusCode).toBe(200);
      expect(value.headers['content-type']).toBe('text/html; charset=utf-8');
      expect(value.headers['cache-control']).toContain('no-store');
      expect(value.headers['cdn-cache-control']).toBe('no-store');
      expect(value.headers['vercel-cdn-cache-control']).toBe('no-store');
      expect(value.body).toContain('A published title');
      expect(value.body).toContain(`${SOCIAL_ORIGIN}/?monograph=fixed-id`);
      expect(value.body).not.toMatch(/evil\.example|affiliate|token=private/);
      expect(value.body).toContain('/assets/app-built.js');
      expect(value.body).toContain('<div id="root"></div>');
    }
    expect(loadMetadata).toHaveBeenCalledWith({ kind: 'piece', identifier: 'fixed-id' });
  });
  it('rejects invalid selectors without initializing or querying Firestore', async () => {
    const loadMetadata = vi.fn();
    const handler = createSocialPreviewHandler({ readTemplate: async () => template, loadMetadata });
    const { res, value } = response();
    await handler(req('/?article=one&article=two'), res);
    expect(value.statusCode).toBe(400);
    expect(value.headers['x-robots-tag']).toBe('noindex, follow');
    expect(value.body).not.toContain('monograph=one');
    expect(loadMetadata).not.toHaveBeenCalled();
  });
  it('serves generic, non-indexed SPA HTML for unknown and draft records', async () => {
    const handler = createSocialPreviewHandler({ readTemplate: async () => template, loadMetadata: async () => siteSocialMetadata(null, 404) });
    const { res, value } = response();
    await handler(req('/?article=private-draft'), res);
    expect(value.statusCode).toBe(404);
    expect(value.headers['x-robots-tag']).toBe('noindex, follow');
    expect(value.body).not.toContain('private-draft');
    expect(value.body).toContain('<div id="root"></div>');
  });
  it('preserves the public app with safe non-indexed metadata on database failure', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const handler = createSocialPreviewHandler({ readTemplate: async () => template, loadMetadata: async () => { throw new Error('PRIVATE CREDENTIAL DETAILS'); } });
    const { res, value } = response();
    await handler(req('/?monograph=piece'), res);
    expect(value.statusCode).toBe(503);
    expect(value.headers['retry-after']).toBe('30');
    expect(value.body).toContain('<div id="root"></div>');
    expect(value.body).not.toContain('PRIVATE CREDENTIAL');
    expect(value.headers['x-robots-tag']).toBe('noindex, follow');
  });
  it('bounds metadata waiting and does not blank the app during a network stall', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const handler = createSocialPreviewHandler({ readTemplate: async () => template, loadMetadata: () => new Promise(() => {}) });
    const { res, value } = response();
    const pending = handler(req('/'), res);
    await vi.advanceTimersByTimeAsync(8_001);
    await pending;
    expect(value.statusCode).toBe(200);
    expect(value.body).toContain('<div id="root"></div>');
  });
  it('supports HEAD without returning the HTML body', async () => {
    const handler = createSocialPreviewHandler({ readTemplate: async () => template, loadMetadata: async () => siteSocialMetadata() });
    const { res, value } = response();
    await handler(req('/', 'HEAD'), res);
    expect(value.statusCode).toBe(200);
    expect(value.body).toBe('');
    expect(Number(value.headers['content-length'])).toBeGreaterThan(0);
  });
  it.each(['POST', 'PUT', 'DELETE'])('rejects %s without reading metadata', async method => {
    const loadMetadata = vi.fn();
    const readTemplate = vi.fn();
    const handler = createSocialPreviewHandler({ readTemplate, loadMetadata });
    const { res, value } = response();
    await handler(req('/', method), res);
    expect(value.statusCode).toBe(405);
    expect(value.headers.allow).toBe('GET, HEAD');
    expect(loadMetadata).not.toHaveBeenCalled();
    expect(readTemplate).not.toHaveBeenCalled();
  });
  it('fails visibly when the traced built template is unavailable; never sends unbuilt source', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const handler = createSocialPreviewHandler({ readTemplate: async () => { throw new Error('PRIVATE PATH'); }, loadMetadata: vi.fn() });
    const { res, value } = response();
    await handler(req('/'), res);
    expect(value.statusCode).toBe(503);
    expect(value.body).not.toMatch(/src\/main|PRIVATE PATH/);
  });
});

describe('embedded public branding image endpoint', () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nsgAAAAASUVORK5CYII=';
  it('serves only the validated public branding raster, without session or original assets', async () => {
    const handler = createSocialImageHandler(async () => ({ coverPhotoUrl: png, coverPhotoOriginal: 'PRIVATE', password: 'PRIVATE' }));
    const { res, value } = response();
    await handler(req('/social-preview-image'), res);
    expect(value.statusCode).toBe(200);
    expect(value.headers['content-type']).toBe('image/png');
    expect(value.headers['content-security-policy']).toContain('sandbox');
    expect(value.headers['cache-control']).toContain('no-store');
    expect(Buffer.isBuffer(value.body)).toBe(true);
    expect((value.body as Buffer).toString()).not.toContain('PRIVATE');
  });
  it('keeps the real raster length on HEAD without sending an empty replacement body', async () => {
    const { res, value } = response();
    await createSocialImageHandler(async () => ({ coverPhotoUrl: png }))(req('/social-preview-image', 'HEAD'), res);
    expect(value.statusCode).toBe(200);
    expect(value.body).toBe('');
    expect(Number(value.headers['content-length'])).toBe(Buffer.from(png.split(',')[1], 'base64').length);
  });
  it.each(['?url=https://evil.example/image', '?path=private', '?target=other'])('rejects arbitrary image parameters: %s', query => {
    const readAuthor = vi.fn();
    const { res, value } = response();
    const result = createSocialImageHandler(readAuthor)(req('/social-preview-image' + query), res);
    return result.then(() => {
      expect(value.statusCode).toBe(400);
      expect(readAuthor).not.toHaveBeenCalled();
    });
  });
  it('redirects only to a fixed-canonical existing public asset path', async () => {
    const { res, value } = response();
    await createSocialImageHandler(async () => ({ coverPhotoUrl: '/api/assets/author-cover.jpg' }))(req('/social-preview-image'), res);
    expect(value.statusCode).toBe(302);
    expect(value.headers.location).toBe(`${SOCIAL_ORIGIN}/api/assets/author-cover.jpg`);
    expect(value.body).toBe('');
  });
  it('redirects a saved validated public HTTPS cover without fetching or proxying it', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { res, value } = response();
    await createSocialImageHandler(async () => ({ coverPhotoUrl: 'https://images.example/cover.jpg' }))(req('/social-preview-image'), res);
    expect(value.statusCode).toBe(302);
    expect(value.headers.location).toBe('https://images.example/cover.jpg');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('does not loop back to its own endpoint and can use a later valid logo', async () => {
    const { res, value } = response();
    await createSocialImageHandler(async () => ({ coverPhotoUrl: `${SOCIAL_ORIGIN}/social-preview-image`, logoUrl: '/uploads/logo.png' }))(req('/social-preview-image'), res);
    expect(value.statusCode).toBe(302);
    expect(value.headers.location).toBe(`${SOCIAL_ORIGIN}/uploads/logo.png`);
  });
  it('does not redirect credentialed/private stored URLs and can use a later public logo', async () => {
    const { res, value } = response();
    await createSocialImageHandler(async () => ({ coverPhotoUrl: 'https://127.0.0.1/private', logoUrl: '/api/assets/logo.png' }))(req('/social-preview-image'), res);
    expect(value.statusCode).toBe(302);
    expect(value.headers.location).toBe(`${SOCIAL_ORIGIN}/api/assets/logo.png`);
  });
  it.each(['data:image/png;base64,AAAA', 'data:image/svg+xml;base64,PHN2Zz4='])('does not serve invalid or executable image data: %s', source => {
    const { res, value } = response();
    return createSocialImageHandler(async () => ({ coverPhotoUrl: source }))(req('/social-preview-image'), res).then(() => {
      expect([404, 503]).toContain(value.statusCode);
      expect(Buffer.isBuffer(value.body)).toBe(false);
    });
  });
  it('rejects decoded images exceeding the safe function response limit', async () => {
    const oversized = `data:image/png;base64,${Buffer.alloc(4 * 1024 * 1024 + 1).toString('base64')}`;
    const { res, value } = response();
    await createSocialImageHandler(async () => ({ coverPhotoUrl: oversized }))(req('/social-preview-image'), res);
    expect(value.statusCode).toBe(503);
    expect(Buffer.isBuffer(value.body)).toBe(false);
  });
  it('rejects writes before reading any author data', async () => {
    const readAuthor = vi.fn();
    const { res, value } = response();
    await createSocialImageHandler(readAuthor)(req('/social-preview-image', 'POST'), res);
    expect(value.statusCode).toBe(405);
    expect(readAuthor).not.toHaveBeenCalled();
  });
});
