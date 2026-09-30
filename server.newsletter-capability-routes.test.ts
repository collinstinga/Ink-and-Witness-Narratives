import { readFileSync } from 'fs';
import http, { Server } from 'http';
import { AddressInfo } from 'net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.NODE_ENV = 'test';
  process.env.SESSION_SIGNING_SECRET = 'newsletter-route-test-secret-with-32-plus-characters';
});

const storeMocks = vi.hoisted(() => {
  const known = {
    init: vi.fn(async () => undefined)
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

vi.mock('./src/server/store.js', () => ({ store: storeMocks }));
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

describe('newsletter capability routes', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = await createApp();
    server = http.createServer(app);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  }, 60_000);

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });

  const token = 'newsletter-confirm-token-1234567890';

  it.each([
    '/newsletter/confirm',
    '/api/newsletter/confirm'
  ])('renders the confirmation form at %s', async path => {
    const response = await fetch(`${baseUrl}${path}?token=${token}`);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(body).toContain('Confirm your subscription');
    expect(body).toContain('action="/api/newsletter/confirm"');
    expect(body).toContain(`value="${token}"`);
  });

  it.each([
    '/newsletter/unsubscribe',
    '/api/newsletter/unsubscribe'
  ])('renders the unsubscribe form at %s', async path => {
    const response = await fetch(`${baseUrl}${path}?token=${token}`);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(body).toContain('Manage your subscription');
    expect(body).toContain('action="/api/newsletter/unsubscribe"');
    expect(body).toContain(`value="${token}"`);
  });

  it('forwards the friendly production links into the API function', () => {
    const config = JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url), 'utf8')) as {
      rewrites?: Array<{ source: string; destination: string }>;
    };

    expect(config.rewrites).toEqual(expect.arrayContaining([
      {
        source: '/newsletter/confirm',
        destination: '/api/index?path=newsletter/confirm'
      },
      {
        source: '/newsletter/unsubscribe',
        destination: '/api/index?path=newsletter/unsubscribe'
      }
    ]));
  });
});
