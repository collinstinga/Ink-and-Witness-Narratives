'use strict';
// CI-only browser check. Fixed loopback files; every API response is synthetic.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { launchFixtureBrowser, recordFixtureFailure } = require('./browser-runtime.cjs');
const app = path.resolve(__dirname, '../..');
const output = path.join(app, 'data/financial-controls-qa');
let phase = 'setup';
(async () => {
  fs.mkdirSync(output, { recursive: true });
  await require('esbuild').build({ entryPoints: [path.join(__dirname, 'financial-controls.fixture.tsx')],
    outfile: path.join(output, 'lab.js'), bundle: true, format: 'esm', platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' } });
  const css = fs.readdirSync(path.join(app, 'dist/assets')).find(name => /^index-[A-Za-z0-9_-]+\.css$/.test(name));
  assert.ok(css, 'Build current design CSS first');
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
    if (url.pathname === '/') {
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body style="background:#080f20"><div id="root"></div><script type="module" src="/lab.js"></script></body></html>'); return;
    }
    const file = url.pathname === '/lab.js' ? path.join(output, 'lab.js')
      : url.pathname === '/style.css' ? path.join(app, 'dist/assets', css)
        : /^\/fonts\/[a-z0-9-]+\.woff2$/.test(url.pathname) ? path.join(app, 'dist', url.pathname) : null;
    if (!file || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', url.pathname.endsWith('.js') ? 'application/javascript' : url.pathname.endsWith('.css') ? 'text/css' : 'font/woff2');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const root = '/api/admin/affiliates/financial-adjustments';
  let browser;
  const results = [];
  try {
    phase = 'launch';
    browser = await launchFixtureBrowser(output);
    for (const width of [390, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: 'block' });
      const page = await context.newPage(), errors = [], unexpected = [], writes = [];
      page.setDefaultTimeout(10000);
      const sale = { id: 'synthetic-paid-commission', affiliateId: 'synthetic-partner', status: 'PAID',
        affiliateName: 'Synthetic partner', articleTitle: 'Synthetic piece', transactionId: 'synthetic-transaction',
        saleAmountKes: 500, commissionAmountKes: 100 };
      const overview = { asOf: '2026-10-27T08:35:00.000Z', refundedPurchaseKes: 0, commissionClawbackKes: 0, directCosts: [], entries: [] };
      let ambiguous = true, ledgerReads = 0, commissionReads = 0;
      page.on('pageerror', error => errors.push(error.message));
      await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== origin) { unexpected.push('external'); return route.abort(); }
        if (!url.pathname.startsWith('/api/')) return route.continue();
        const send = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
        if (request.method() === 'GET' && url.pathname === root) { ledgerReads++; return send({ success: true, overview }); }
        if (request.method() === 'GET' && url.pathname === '/api/admin/affiliates/commissions') { commissionReads++; return send({ commissions: [sale] }); }
        if (request.method() === 'GET' && url.pathname === `${root}/wallet/synthetic-partner`) return send({ success: true, summary: { revision: 0 } });
        if (request.method() === 'POST' && url.pathname === `${root}/refunds`) {
          const body = request.postDataJSON(); writes.push(body);
          if (ambiguous) { ambiguous = false; return send({ success: false, error: 'Synthetic uncertain response: check saved ledger before retrying.' }, 503); }
          assert.deepEqual(body, writes[0]);
          return send({ success: true, result: { status: 'already_recorded', providerOperationPerformed: false, accessPermissionsChanged: false } });
        }
        unexpected.push(`${request.method()} ${url.pathname}`); return route.abort();
      });
      phase = `initial_${width}`;
      await page.goto(origin, { waitUntil: 'networkidle', timeout: 30000 });
      const review = page.getByRole('button', { name: 'Review current revision', exact: true });
      assert.equal(await review.isDisabled(), true); assert.equal(writes.length, 0);
      await page.getByRole('combobox').nth(1).selectOption(sale.id);
      await page.getByRole('spinbutton').fill('100');
      await page.getByLabel('External confirmation reference', { exact: true }).fill('SYNTHETIC-NO-TRANSFER-' + 'X'.repeat(100));
      await page.getByRole('checkbox').check(); await review.click();
      const confirm = page.getByRole('button', { name: 'Confirm / retry exact accounting entry', exact: true });
      await confirm.waitFor(); assert.equal(writes.length, 0);
      assert.ok(await page.getByText(/original commission KES 100/).isVisible());
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Prepared long reference fits');
      await page.screenshot({ path: path.join(output, `review-${width}.png`), fullPage: true });
      phase = `uncertain_and_replay_${width}`;
      await confirm.click(); await page.getByRole('alert').filter({ hasText: /Synthetic uncertain response/ }).waitFor();
      assert.equal(writes.length, 1); assert.match(writes[0].idempotencyKey, /^[0-9a-f-]{36}$/);
      const beforeReads = [ledgerReads, commissionReads];
      await page.getByRole('button', { name: 'Refresh saved ledger', exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('[role="status"]')?.textContent?.includes('Loading'));
      assert.equal(writes.length, 1);
      await confirm.click(); await page.getByRole('status').filter({ hasText: 'not duplicated' }).waitFor();
      assert.equal(writes.length, 2); assert.deepEqual(writes[0], writes[1]);
      assert.ok(ledgerReads > beforeReads[0] && commissionReads > beforeReads[1], 'Refresh updates ledger and source commissions');
      assert.equal(await page.locator('#unsaved-note').inputValue(), 'Keep this draft');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
      results.push({ width, reviewBeforeWrite: true, exactRetryBody: true, sourceAndLedgerRefreshed: true,
        unsavedDraftPreserved: true, noOverflow: true, errors: 0 });
      await context.close();
    }
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
  const report = { status: 'verified', results, cloudWrites: 0, realProviderCalls: 0, realSessions: 0, fixtureApiOnly: true };
  fs.writeFileSync(path.join(output, 'proof.json'), JSON.stringify(report, null, 2));
  process.stdout.write(JSON.stringify(report) + '\n');
})().catch(error => { recordFixtureFailure(output, { status: 'failed', phase, error: error.message, fixtureApiOnly: true }); process.exitCode = 1; });
