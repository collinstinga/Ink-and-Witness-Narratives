import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BLOCKED_REQUESTS, PUBLIC_HOME, entrypointFromHtml, lighthouseArgs, median, summarizeReport } from './public-mobile-audit.mjs';

test('audit target is fixed, anonymous and read-only, without persisted browser storage', () => {
  const args = lighthouseArgs('/tmp/report.json');
  assert.equal(PUBLIC_HOME, 'https://www.inkandwitness-narratives.co.ke/');
  assert.ok(args.includes('--package=lighthouse@13.5.0'));
  assert.ok(args.includes('--only-categories=performance'));
  assert.ok(args.includes('--form-factor=mobile'));
  assert.ok(!args.some(arg => /extra-headers|cookies|user-data-dir|disable-storage-reset|save-assets/.test(arg)));
  for (const pattern of BLOCKED_REQUESTS) assert.ok(args.includes(`--blocked-url-patterns=${pattern}`));
  assert.ok(BLOCKED_REQUESTS.includes('*/api/analytics*'));
  assert.ok(BLOCKED_REQUESTS.includes('*/api/mpesa/*'));
  assert.ok(BLOCKED_REQUESTS.includes('*/api/newsletter/*'));
});

test('version fence accepts only a hashed first-party module, not arbitrary scripts', () => {
  assert.equal(entrypointFromHtml('<script type="module" crossorigin src="/assets/index-CAdGzYgS.js"></script>'), '/assets/index-CAdGzYgS.js');
  assert.throws(() => entrypointFromHtml('<script src="https://example.com/app.js"></script>'));
  assert.throws(() => entrypointFromHtml('<script type="module" src="https://example.com/assets/index-abc.js"></script>'));
});

test('numeric medians are stable and reject incomplete measurements', () => {
  assert.equal(median([9, 2, 4]), 4);
  assert.equal(median([6, 2]), 4);
  assert.throws(() => median([]));
  assert.throws(() => median([1, NaN]));
});

test('summary rejects runtime failures, redirects and missing metrics', () => {
  assert.throws(() => summarizeReport({ runtimeError: { code: 'NO_FCP' } }));
  assert.throws(() => summarizeReport({ requestedUrl: PUBLIC_HOME, finalDisplayedUrl: 'https://example.com/' }));
  assert.throws(() => summarizeReport({ requestedUrl: PUBLIC_HOME, finalDisplayedUrl: PUBLIC_HOME, categories: { performance: { score: 0.9 } } }));
  const audits = Object.fromEntries(['first-contentful-paint', 'largest-contentful-paint', 'cumulative-layout-shift', 'total-blocking-time', 'speed-index', 'total-byte-weight']
    .map(id => [id, { numericValue: id === 'cumulative-layout-shift' ? 0.01 : 123 }]));
  const result = summarizeReport({ requestedUrl: PUBLIC_HOME, finalDisplayedUrl: PUBLIC_HOME,
    categories: { performance: { score: 0.91 } }, audits });
  assert.equal(result.score, 91);
  assert.equal(result.lcpMs, 123);
  assert.equal(result.cls, 0.01);
  const report = { requestedUrl: PUBLIC_HOME, finalDisplayedUrl: PUBLIC_HOME,
    categories: { performance: { score: 0.91 } }, audits: { ...audits,
      'network-requests': { details: { items: [{ url: `${PUBLIC_HOME}assets/index-version.js`, statusCode: 200,
        rendererStartTime: 10, networkRequestTime: 11, networkEndTime: 20 }] } } } };
  const fenced = summarizeReport(report, '/assets/index-version.js');
  assert.equal(fenced.networkRequests[0].networkEndTime, 20);
  assert.equal(fenced.networkRequests[0].rendererStartTime, 10);
  assert.throws(() => summarizeReport(report, '/assets/index-other.js'));
  report.audits['network-requests'].details.items[0].statusCode = 404;
  assert.throws(() => summarizeReport(report, '/assets/index-version.js'));
});
