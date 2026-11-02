'use strict';
// Real WriterDashboard -> WriterEditor -> API, using synthetic loopback data only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { launchFixtureBrowser, recordFixtureFailure } = require('./browser-runtime.cjs');
const app = path.resolve(__dirname, '../..');
const output = path.join(app, 'data/writer-header-save-qa');
let phase = 'setup';

(async () => {
  fs.mkdirSync(output, { recursive: true });
  await require('esbuild').build({ entryPoints: [path.join(__dirname, 'writer-header-save.fixture.tsx')],
    outfile: path.join(output, 'lab.js'), bundle: true, format: 'esm', platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' } });
  const css = fs.readdirSync(path.join(app, 'dist/assets')).find(name => /^index-[A-Za-z0-9_-]+\.css$/.test(name));
  assert.ok(css, 'Build current design CSS first');
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
    if (url.pathname === '/') {
      res.setHeader('Content-Type', 'text/html');
      return res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body style="background:#050811"><div id="root"></div><script type="module" src="/lab.js"></script></body></html>');
    }
    if (url.pathname === '/synthetic-cover.svg') {
      res.setHeader('Content-Type', 'image/svg+xml');
      return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="#083344"/></svg>');
    }
    const file = url.pathname === '/lab.js' ? path.join(output, 'lab.js')
      : url.pathname === '/style.css' ? path.join(app, 'dist/assets', css)
        : /^\/fonts\/[a-z0-9-]+\.woff2$/.test(url.pathname) ? path.join(app, 'dist/fonts', path.basename(url.pathname)) : null;
    if (!file || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.setHeader('Content-Type', url.pathname.endsWith('.js') ? 'application/javascript' : url.pathname.endsWith('.css') ? 'text/css' : 'font/woff2');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  let releasePendingSave = () => {};
  const results = [];
  try {
    phase = 'launch';
    browser = await launchFixtureBrowser(output);
    for (const width of [390, 1280]) {
      phase = `portal-${width}`;
      const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: 'block' });
      const page = await context.newPage();
      page.setDefaultTimeout(12000);
      const errors = [], unexpected = [], writes = [];
      const revision = '2026-11-02T00:00:00.000Z';
      let stored = { id: 'synthetic-piece', title: 'Synthetic piece', subtitle: '', excerpt: 'Public synthetic preview', content: 'Original synthetic text.',
        slug: 'synthetic-piece', category: 'Narratives', status: 'published', isPaid: true, priceKes: 100, prices: {}, tags: [],
        coverImage: '/synthetic-cover.svg', coverImageOriginal: '/synthetic-cover.svg', readTimeMinutes: 1,
        createdAt: revision, publishedAt: revision, updatedAt: revision, downloadsCount: 0, previewParagraphs: [] };
      let mode = 'hold', releaseSave, saveHeld;
      const held = new Promise(resolve => { saveHeld = resolve; });
      page.on('pageerror', error => errors.push(error.message));
      await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        // Reject all external traffic before it leaves the fixture browser.
        if (url.origin !== origin) { if (url.pathname.startsWith('/api/')) unexpected.push(url.href); return route.abort(); }
        if (!url.pathname.startsWith('/api/')) return route.continue();
        const send = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
        if (request.method() === 'PUT' && url.pathname === '/api/admin/articles/synthetic-piece') {
          const payload = request.postDataJSON(); writes.push({ kind: 'piece', payload });
          assert.equal(request.headers()['content-type'], 'application/json');
          if (mode === 'hold') {
            saveHeld();
            await new Promise(resolve => { releaseSave = releasePendingSave = resolve; });
          }
          if (mode === 'conflict') return send({ error: 'Synthetic revision conflict. Your edits are still available.' }, 409);
          stored = { ...stored, ...payload, updatedAt: '2026-11-02T00:01:00.000Z' };
          return send({ success: true, article: stored });
        }
        if (request.method() === 'POST' && url.pathname === '/api/admin/save-permanently') {
          writes.push({ kind: 'snapshot', payload: request.postDataJSON() });
          return send({ success: true, piecesCount: 1, timestamp: revision, snapshotFilename: 'synthetic.json' });
        }
        if (request.method() === 'GET') {
          if (url.pathname === '/api/admin/articles') return send([stored]);
          if (url.pathname === '/api/admin/stats') return send({});
          if (url.pathname === '/api/admin/transactions') return send({ transactions: [], count: 0, totalRevenueKes: 0 });
          if (url.pathname === '/api/admin/tips') return send({ tips: [], count: 0, totalTipsKes: 0 });
          if (url.pathname === '/api/mpesa/config') return send({});
          if (url.pathname === '/api/topics') return send([]);
          if (url.pathname === '/api/exchange-rates') return send({ kesRates: { KES: 1, USD: 130 } });
          if (url.pathname === '/api/public/bootstrap') return send({ generatedAt: revision, author: {}, articles: [], categories: [], topics: [],
            session: { authenticated: false, user: null }, homepage: { config: {}, bundles: [], collections: [], pieces: [], mostSellingPieces: [], subscriptionPlans: [] },
            newsletter: { enabled: false, doubleOptIn: true, consentVersion: 'synthetic' } });
        }
        unexpected.push(`${request.method()} ${url.pathname}`);
        return send({ error: 'Unexpected synthetic endpoint' }, 500);
      });
      await page.goto(origin);
      await page.locator('#piece-row-synthetic-piece').getByText('Synthetic piece', { exact: true }).click();
      const content = page.getByRole('textbox', { name: 'Piece content', exact: true });
      await content.waitFor();
      const headerSave = page.getByRole('button', { name: 'Save piece', exact: true });
      assert.equal(await headerSave.count(), 1, 'Only one visible header Save at this breakpoint');
      assert.equal(await page.locator('#writer-editor-bar').count(), 0, 'No footer save or reserved sticky space');
      assert.equal(await page.getByRole('button', { name: /Save Draft|Update Published|Publish Live/, exact: true }).count(), 0);
      assert.equal(writes.length, 0, 'Mount must not save or snapshot');
      const guide = page.locator(width < 768 ? '#mobile-writer-guide-btn' : '#desktop-writer-guide-btn');
      const guideBox = await guide.boundingBox(), saveBox = await headerSave.boundingBox();
      assert.ok(guideBox.height <= 38 && guideBox.height >= 32 && saveBox.height <= 38);
      if (width < 768) {
        const header = await page.locator('#writer-dashboard-root > header').boundingBox();
        assert.ok(header.height <= 56, 'Mobile header must stay on one compact row');
        await page.setViewportSize({ width: 320, height: 1000 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await page.setViewportSize({ width, height: 1000 });
      }
      const title = page.getByPlaceholder('e.g. The Architecture of Unspoken Leverage', { exact: true });
      await title.fill('Edited synthetic piece');
      await content.fill('## Header saved text\nA synthetic revision.');
      await page.getByRole('spinbutton', { name: 'Piece price (KES)', exact: true }).fill('500');
      await guide.click();
      await page.getByRole('dialog').waitFor();
      await page.getByRole('button', { name: 'Close guide and return to your dashboard', exact: true }).click();
      assert.equal(await content.inputValue(), '## Header saved text\nA synthetic revision.');
      assert.equal(writes.length, 0, 'Guide never saves or resets edits');

      // Two native clicks in the same browser task exercise the synchronous
      // guard before React has time to disable the control.
      await headerSave.evaluate(button => { button.click(); button.click(); });
      let heldTimer;
      try {
        await Promise.race([held, new Promise((_, reject) => {
          heldTimer = setTimeout(() => reject(new Error('Header save did not reach the synthetic API within 12 seconds')), 12000);
        })]);
      } finally { clearTimeout(heldTimer); }
      await page.waitForFunction(() => document.querySelector('button[aria-label="Save piece"][aria-busy="true"]'));
      assert.equal(writes.length, 1, 'Repeated immediate clicks produce one save');
      assert.deepEqual({ title: writes[0].payload.title, content: writes[0].payload.content, priceKes: writes[0].payload.priceKes,
        status: writes[0].payload.status, notify: writes[0].payload.notifyNewsletterSubscribers },
      { title: 'Edited synthetic piece', content: '## Header saved text\nA synthetic revision.', priceKes: 500, status: 'published', notify: false });
      await content.fill('Newer edit made while the save is in flight.');
      mode = 'normal'; releaseSave();
      await page.waitForFunction(() => document.querySelector('button[aria-label="Save piece"][aria-busy="false"]'));
      assert.equal(await content.inputValue(), 'Newer edit made while the save is in flight.');
      assert.equal(await headerSave.textContent(), 'Save', 'A newer edit must not be labeled Saved');
      await page.getByText('Unsaved changes', { exact: true }).waitFor();

      mode = 'conflict'; await headerSave.click();
      await page.getByText('Synthetic revision conflict. Your edits are still available.', { exact: true }).waitFor();
      assert.equal(await content.inputValue(), 'Newer edit made while the save is in flight.');
      assert.equal(await headerSave.textContent(), 'Save');
      mode = 'normal'; await headerSave.click();
      await page.waitForFunction(() => [...document.querySelectorAll('button[aria-label="Save piece"]')].some(button => getComputedStyle(button).display !== 'none' && button.textContent === 'Saved'));
      assert.equal(stored.content, 'Newer edit made while the save is in flight.');

      // Validation is still owned by the editor and cannot be replaced by a snapshot.
      const beforeValidation = writes.length;
      await title.fill(''); await headerSave.click();
      await page.getByText('Please provide a piece title.', { exact: true }).waitFor();
      assert.equal(writes.length, beforeValidation);
      await title.fill('Edited synthetic piece');
      await page.getByRole('button', { name: 'Draft', exact: true }).click();
      await headerSave.click();
      await page.waitForFunction(() => [...document.querySelectorAll('button[aria-label="Save piece"]')].some(button => getComputedStyle(button).display !== 'none' && button.textContent === 'Saved'));
      assert.equal(stored.status, 'draft', 'Header respects selected publishing state');
      await page.screenshot({ path: path.join(output, `editor-${width}.png`), fullPage: true });

      // Use the editor's visible Back button; the mobile sidebar is off canvas.
      await page.locator('#writer-editor-container').getByRole('button', { name: 'All Pieces', exact: true }).click();
      assert.equal(writes.filter(write => write.kind === 'snapshot').length, 0, 'Piece save never invokes workspace snapshot');
      await page.getByRole('button', { name: 'Save workspace snapshot', exact: true }).click();
      await page.waitForFunction(() => [...document.querySelectorAll('button[aria-label="Save workspace snapshot"]')].some(button => getComputedStyle(button).display !== 'none' && button.textContent === 'Saved'));
      assert.equal(writes.filter(write => write.kind === 'snapshot').length, 1);
      await page.reload();
      await page.locator('#piece-row-synthetic-piece').getByText('Edited synthetic piece', { exact: true }).click();
      assert.equal(await page.getByRole('spinbutton', { name: 'Piece price (KES)', exact: true }).inputValue(), '500');
      assert.equal(await content.inputValue(), 'Newer edit made while the save is in flight.');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
      results.push({ width, oneCompactHeaderSave: true, footerRemoved: true, currentPayloadPersisted: true,
        duplicateClicksFenced: true, inFlightEditsPreserved: true, validationAndConflictRetry: true,
        selectedVisibilitySaved: true, reloadVerified: true, guidePreservesDraft: true, noOverflow: true, browserErrors: 0 });
      await context.close();
    }
  } finally { releasePendingSave(); await browser?.close(); await new Promise(resolve => server.close(resolve)); }
  const report = { status: 'verified', results, cloudWrites: 0, realProviderCalls: 0, realSessions: 0, fixtureApiOnly: true,
    scope: 'Actual WriterDashboard and WriterEditor header save, validation, error handling and compact layout; synthetic API only.' };
  fs.writeFileSync(path.join(output, 'proof.json'), JSON.stringify(report, null, 2));
  process.stdout.write(JSON.stringify(report) + '\n');
})().catch(error => { recordFixtureFailure(output, { status: 'failed', phase, error: error.message, fixtureApiOnly: true }); process.exitCode = 1; });
