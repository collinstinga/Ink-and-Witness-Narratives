import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { discardEarlyPublicBootstrap, takeEarlyPublicBootstrap } from './earlyPublicBootstrap.js';

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const script = html.match(/<script id="initial-public-bootstrap">([\s\S]*?)<\/script>/)?.[1];
if (!script) throw new Error('Missing early public bootstrap script.');

function startHeadRequest(fetchMock: ReturnType<typeof vi.fn>, pathname = '/') {
  const listeners = new Map<string, () => void>();
  const target: any = {
    addEventListener: vi.fn((event: string, listener: () => void) => listeners.set(event, listener)),
    removeEventListener: vi.fn((event: string) => listeners.delete(event)),
  };
  vi.stubGlobal('window', target);
  vi.stubGlobal('fetch', fetchMock);
  runInNewContext(script!, { window: target, location: { pathname, search: '?ref=never-forwarded', hash: '#home' },
    fetch: fetchMock, AbortController, Date, setTimeout, clearTimeout });
  return { target, listeners };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-26T12:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('one-use head bootstrap handoff', () => {
  it('starts a fixed same-origin uncached credentialed request before the application, and consumes it once', async () => {
    const response = new Response('{}', { headers: { 'content-type': 'application/json' } });
    const fetchMock = vi.fn().mockResolvedValue(response);
    const { target, listeners } = startHeadRequest(fetchMock);
    expect(fetchMock).toHaveBeenCalledWith('/api/public/bootstrap', expect.objectContaining({
      cache: 'no-store', credentials: 'include', signal: expect.any(AbortSignal),
    }));
    expect(html.indexOf('id="initial-public-bootstrap"')).toBeLessThan(html.indexOf('src="/src/main.tsx"'));
    await expect(takeEarlyPublicBootstrap()).resolves.toBe(response);
    expect(takeEarlyPublicBootstrap()).toBeUndefined();
    expect(target.__IW_INITIAL_BOOTSTRAP__).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('expires an unused handoff instead of retaining old publishing data', () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}'));
    const { target } = startHeadRequest(fetchMock);
    const signal = fetchMock.mock.calls[0][1].signal;
    vi.advanceTimersByTime(15_000);
    expect(target.__IW_INITIAL_BOOTSTRAP__).toBeUndefined();
    expect(signal.aborted).toBe(true);
    expect(takeEarlyPublicBootstrap()).toBeUndefined();
  });

  it('rejects old or future-dated handoffs even if backgrounding delayed the timer', () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}'));
    startHeadRequest(fetchMock);
    vi.setSystemTime(Date.now() + 15_001);
    expect(takeEarlyPublicBootstrap()).toBeUndefined();
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    const { target } = startHeadRequest(fetchMock);
    target.__IW_INITIAL_BOOTSTRAP__.startedAt = Date.now() + 1;
    expect(takeEarlyPublicBootstrap()).toBeUndefined();
    expect(target.__IW_INITIAL_BOOTSTRAP__).toBeUndefined();
  });

  it('discards on page exit/BFCache entry and on explicit authentication invalidation', () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}'));
    const { target, listeners } = startHeadRequest(fetchMock);
    listeners.get('pagehide')!();
    expect(target.__IW_INITIAL_BOOTSTRAP__).toBeUndefined();
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    startHeadRequest(fetchMock);
    discardEarlyPublicBootstrap();
    expect(takeEarlyPublicBootstrap()).toBeUndefined();
    expect(fetchMock.mock.calls[1][1].signal.aborted).toBe(true);
  });

  it('handles an early network rejection and retries through a fresh ordinary request', async () => {
    const response = new Response('{}');
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('Offline')).mockResolvedValueOnce(response);
    startHeadRequest(fetchMock);
    await expect(takeEarlyPublicBootstrap()).resolves.toBe(response);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith('/api/public/bootstrap', { cache: 'no-store', credentials: 'include' });
  });

  it('does not preload a different pathname or depend on browser globals during SSR', () => {
    const fetchMock = vi.fn();
    startHeadRequest(fetchMock, '/not-home');
    expect(fetchMock).not.toHaveBeenCalled();
    vi.stubGlobal('window', undefined);
    expect(takeEarlyPublicBootstrap()).toBeUndefined();
    expect(() => discardEarlyPublicBootstrap()).not.toThrow();
  });
});
