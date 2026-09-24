import { describe, expect, it } from 'vitest';
import { isAllowedPublicWriteOrigin } from './publicWriteOrigin.js';

const apex = 'https://inkandwitness-narratives.co.ke';
const www = 'https://www.inkandwitness-narratives.co.ke';

describe('public write origin validation', () => {
  it('accepts the canonical www site when the configured base URL is the apex domain', () => {
    expect(isAllowedPublicWriteOrigin({
      origin: www,
      requestOrigin: www,
      configuredBaseUrl: apex,
      fetchSite: 'same-origin',
      production: true
    })).toBe(true);
    expect(isAllowedPublicWriteOrigin({
      origin: www,
      requestOrigin: 'https://WWW.INKANDWITNESS-NARRATIVES.CO.KE',
      configuredBaseUrl: `${apex}/`,
      fetchSite: 'same-origin',
      production: true
    })).toBe(true);
  });

  it('accepts only the exact apex/www pair as trusted same-site aliases', () => {
    expect(isAllowedPublicWriteOrigin({
      origin: apex,
      requestOrigin: www,
      configuredBaseUrl: apex,
      fetchSite: 'same-site',
      production: true
    })).toBe(true);
    expect(isAllowedPublicWriteOrigin({
      origin: apex,
      requestOrigin: apex,
      configuredBaseUrl: www,
      fetchSite: 'same-origin',
      production: true
    })).toBe(true);
  });

  it('falls back to an exact request-origin match when no canonical URL is configured', () => {
    expect(isAllowedPublicWriteOrigin({
      origin: 'http://localhost:3000',
      requestOrigin: 'http://localhost:3000',
      fetchSite: 'same-origin',
      production: false
    })).toBe(true);
  });

  it.each([
    'https://evil.inkandwitness-narratives.co.ke',
    'https://evilinkandwitness-narratives.co.ke',
    'https://inkandwitness-narratives.co.ke.evil.test',
    'https://www.inkandwitness-narratives.co.ke:444'
  ])('rejects an untrusted lookalike or port: %s', origin => {
    expect(isAllowedPublicWriteOrigin({
      origin,
      requestOrigin: www,
      configuredBaseUrl: apex,
      fetchSite: 'same-site',
      production: true
    })).toBe(false);
  });

  it('rejects missing, malformed, and path-shaped Origin values', () => {
    for (const origin of [undefined, 'not a url', `${www}/subscribe`]) {
      expect(isAllowedPublicWriteOrigin({
        origin,
        requestOrigin: www,
        configuredBaseUrl: apex,
        production: true
      })).toBe(false);
    }
  });

  it('rejects cross-site fetch metadata even when the host otherwise matches', () => {
    expect(isAllowedPublicWriteOrigin({
      origin: www,
      requestOrigin: www,
      configuredBaseUrl: apex,
      fetchSite: 'cross-site',
      production: true
    })).toBe(false);
  });

  it('rejects insecure origins and arbitrary deployment hosts in production', () => {
    expect(isAllowedPublicWriteOrigin({
      origin: 'http://www.inkandwitness-narratives.co.ke',
      requestOrigin: 'http://www.inkandwitness-narratives.co.ke',
      configuredBaseUrl: apex,
      fetchSite: 'same-origin',
      production: true
    })).toBe(false);
    expect(isAllowedPublicWriteOrigin({
      origin: 'https://random-preview.vercel.app',
      requestOrigin: 'https://random-preview.vercel.app',
      configuredBaseUrl: apex,
      fetchSite: 'same-origin',
      production: true
    })).toBe(false);
  });
});
