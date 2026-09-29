import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

interface VercelRewrite {
  source: string;
  destination: string;
}

interface VercelHeaderRule {
  source: string;
  headers: Array<{ key: string; value: string }>;
}

describe('Vercel affiliate routing', () => {
  it('rewrites /r/:code to the affiliate redirect API before the API catch-all', () => {
    const config = JSON.parse(
      readFileSync(new URL('./vercel.json', import.meta.url), 'utf8')
    ) as { rewrites?: VercelRewrite[] };
    const rewrites = config.rewrites ?? [];
    const affiliateRewriteIndex = rewrites.findIndex(rewrite => rewrite.source === '/r/:code');
    const apiCatchAllIndex = rewrites.findIndex(rewrite => rewrite.source === '/api/:path*');

    expect(affiliateRewriteIndex).toBeGreaterThanOrEqual(0);
    expect(rewrites[affiliateRewriteIndex]).toEqual({
      source: '/r/:code',
      destination: '/api/index?path=affiliate/redirect/:code'
    });
    expect(apiCatchAllIndex).toBeGreaterThan(affiliateRewriteIndex);
  });
});

describe('Vercel static asset caching', () => {
  it('caches only content-hashed Vite assets immutably in the browser', () => {
    const config = JSON.parse(
      readFileSync(new URL('./vercel.json', import.meta.url), 'utf8')
    ) as { headers?: VercelHeaderRule[] };
    const headerRules = config.headers ?? [];
    const cacheControlRules = headerRules.flatMap(rule =>
      rule.headers
        .filter(header => header.key.toLowerCase() === 'cache-control')
        .map(header => ({ source: rule.source, value: header.value }))
    );

    expect(cacheControlRules).toEqual([
      {
        source: '/assets/(.*)',
        value: 'public, max-age=31536000, immutable'
      }
    ]);
  });
});
