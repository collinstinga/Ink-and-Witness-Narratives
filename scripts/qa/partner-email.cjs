'use strict';
// Local synthetic endpoints only. Never sends email or contacts real customers.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { launchFixtureBrowser, recordFixtureFailure } = require('./browser-runtime.cjs');
const app = path.resolve(__dirname, '../..');
const output = path.join(app, 'data/partner-email-qa');
let phase = 'setup';
(async () => {
  fs.mkdirSync(output, { recursive: true });
  await require('esbuild').build({ entryPoints: [path.join(__dirname, 'partner-email.fixture.tsx')],
    outfile: path.join(output, 'lab.js'), bundle: true, format: 'esm', platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' } });
  const css = fs.readdirSync(path.join(app, 'dist/assets')).find(name => /^index-[A-Za-z0-9_-]+\.css$/.test(name));
  assert.ok(css, 'Build the design CSS before browser QA');
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
    if (url.pathname === '/') { res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body style="background:#080f20"><div id="root"></div><script type="module" src="/lab.js"></script></body></html>'); return; }
    const file = url.pathname === '/lab.js' ? path.join(output, 'lab.js')
      : url.pathname === '/style.css' ? path.join(app, 'dist/assets', css)
        : /^\/fonts\/[a-z0-9-]+\.woff2$/.test(url.pathname) ? path.join(app, 'dist', url.pathname) : null;
    if (!file || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', url.pathname.endsWith('.js') ? 'application/javascript' : url.pathname.endsWith('.css') ? 'text/css' : 'font/woff2');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  const results = [];
  try {
    phase = 'launch'; browser = await launchFixtureBrowser(output);
    for (const width of [390, 1280]) {
      phase = `${width}:compose`;
      const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: 'block' });
      const page = await context.newPage(); page.setDefaultTimeout(12000);
      const errors = [], unexpected = [], creates = [], previews = [], sends = [];
      const campaigns = new Map(); let reads = 0, uncertain = false;
      let releaseCreate, captureCreate;
      const createGate = new Promise(resolve => { releaseCreate = resolve; });
      const createCaptured = new Promise(resolve => { captureCreate = resolve; });
      page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
      await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== origin) { unexpected.push('external'); return route.abort(); }
        if (!url.pathname.startsWith('/api/')) return route.continue();
        const send = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
        const root = '/api/admin/affiliates/email';
        if (request.method() === 'GET' && url.pathname === root) { reads++;
          return send({ providerConfigured: true, campaigns: [...campaigns.values()], recipients: [
            { id: 'partner-one', name: 'Synthetic Partner One', email: 'one@example.invalid', eligible: true },
            { id: 'partner-two', name: 'Synthetic Partner Two', email: 'two@example.invalid', eligible: false, reason: 'Announcements declined' },
            { id: 'partner-three', name: 'Synthetic Partner Three', email: 'three@example.invalid', eligible: true },
          ] }); }
        if (request.method() === 'POST' && url.pathname === `${root}/preview`) {
          const body = request.postDataJSON(); previews.push(body);
          assert.deepEqual(Object.keys(body).sort(), ['affiliateIds', 'audience', 'body', 'subject']);
          return send({ eligible: body.audience === 'all' ? 2 : 1, excluded: body.audience === 'all' ? 1 : 0,
            total: body.audience === 'all' ? 3 : 1 });
        }
        if (request.method() === 'POST' && url.pathname === `${root}/campaigns`) {
          const body = request.postDataJSON(); creates.push(body);
          assert.match(body.requestId, /^[a-zA-Z0-9_-]{16,80}$/);
          assert.equal(Object.hasOwn(body, 'recipientEmail'), false);
          const id = `synthetic-email-${creates.length}`;
          const campaign = { ...body, id, status: 'draft', eligibleCount: 2, remainingCount: 2,
            sentCount: 0, failedCount: 0, createdAt: '2026-10-29T00:00:00.000Z' };
          campaigns.set(id, campaign);
          if (creates.length === 1) { captureCreate(); await createGate; }
          return send({ campaign });
        }
        const match = url.pathname.match(/^\/api\/admin\/affiliates\/email\/campaigns\/([^/]+)\/send$/);
        if (request.method() === 'POST' && match) {
          sends.push(match[1]); assert.deepEqual(request.postDataJSON(), {});
          const current = campaigns.get(match[1]); assert.ok(current);
          if (uncertain) {
            uncertain = false;
            Object.assign(current, { status: 'sending', uncertainCount: 1, remainingCount: 1 });
            return send({ error: 'Synthetic uncertain email response' }, 503);
          }
          current.sentCount++; current.remainingCount--;
          const complete = current.remainingCount === 0;
          current.status = complete ? (current.uncertainCount ? 'partially_sent' : 'sent') : 'sending';
          return send({ campaign: current, complete });
        }
        unexpected.push(`${request.method()} ${url.pathname}`); return route.abort();
      });
      await page.goto(origin, { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: 'Email your partners' }).waitFor();
      await page.waitForFunction(() => !document.querySelector('select').disabled);
      assert.equal(await page.getByRole('button', { name: 'Send partner email' }).isDisabled(), true);
      await page.getByLabel('Send to').selectOption('selected');
      assert.equal(await page.getByRole('checkbox', { name: /Synthetic Partner Two/ }).isDisabled(), true);
      await page.getByRole('checkbox', { name: /Synthetic Partner One/ }).check();
      await page.getByLabel('Subject', { exact: true }).fill('A synthetic partner update');
      await page.getByLabel('Message', { exact: true }).fill('Synthetic message <script>window.compromised=true</script>');
      await page.getByRole('button', { name: 'Preview recipients' }).click();
      await page.getByText('1 will receive this email', { exact: false }).waitFor();
      assert.equal(creates.length, 0); assert.equal(sends.length, 0);
      assert.deepEqual(previews[0].affiliateIds, ['partner-one']);
      phase = `${width}:message-revision`;
      assert.equal(await page.getByLabel('Message', { exact: true }).count(), 1, 'The message label must remain stable after editing');
      await page.getByLabel('Message', { exact: true }).fill('A revised synthetic message.');
      assert.equal(await page.getByRole('button', { name: 'Send partner email' }).isDisabled(), true);
      await page.getByLabel('Send to').selectOption('all');
      await page.getByRole('button', { name: 'Preview recipients' }).click();
      await page.getByText('2 will receive this email', { exact: false }).waitFor();
      assert.equal(await page.evaluate(() => window.compromised), undefined);
      phase = `${width}:duplicate-click`;
      await page.getByRole('button', { name: 'Send partner email' }).evaluate(button => { button.click(); button.click(); });
      await createCaptured; assert.equal(creates.length, 1); releaseCreate();
      await page.getByText('Email sending finished.', { exact: false }).waitFor();
      assert.equal(sends.length, 2); assert.equal(creates.length, 1);
      await page.getByText('2 accepted by email provider', { exact: false }).waitFor();
      phase = `${width}:uncertain-send`;
      await page.getByLabel('Subject', { exact: true }).fill('Second synthetic update');
      await page.getByLabel('Message', { exact: true }).fill('A second synthetic message.');
      await page.getByRole('button', { name: 'Preview recipients' }).click();
      await page.getByText('2 will receive this email', { exact: false }).waitFor();
      uncertain = true;
      await page.getByRole('button', { name: 'Send partner email' }).click();
      await page.getByRole('alert').filter({ hasText: 'Synthetic uncertain email response' }).waitFor();
      await page.waitForFunction(() => !document.querySelector('button').disabled);
      assert.equal(sends.length, 3, 'An uncertain send must not be retried automatically');
      assert.equal(creates.length, 2); assert.ok(reads >= 3);
      await page.getByRole('button', { name: 'Continue sending' }).click();
      await page.getByText('Email sending finished.', { exact: false }).waitFor();
      assert.equal(sends.length, 4); assert.equal(creates.length, 2);
      assert.equal(campaigns.get('synthetic-email-1').sentCount, 2);
      assert.equal(await page.getByRole('button', { name: 'Continue sending' }).count(), 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth <= 2), true);
      assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
      await page.screenshot({ path: path.join(output, `partner-email-${width}.png`), fullPage: true });
      results.push({ width, previewOnlyBeforeConfirm: true, changedDraftRequiresPreview: true, optedOutExcluded: true,
        doubleClickSingleCampaign: true, boundedSequentialSending: true, uncertainResponseNoRetry: true,
        explicitContinue: true, noRealEmail: true, noPageErrors: true, noOverflow: true });
      await context.close();
    }
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ syntheticOnly: true, results }, null, 2));
    console.log(JSON.stringify({ syntheticOnly: true, results }));
  } catch (error) {
    recordFixtureFailure(output, { phase, message: error.message }); throw error;
  } finally {
    if (browser) await browser.close(); await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
