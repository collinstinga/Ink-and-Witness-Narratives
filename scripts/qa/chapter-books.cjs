'use strict';
// Fixed loopback component QA. Every API response is synthetic; no app backend.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { launchFixtureBrowser, recordFixtureFailure } = require('./browser-runtime.cjs');
const app = path.resolve(__dirname, '../..');
const output = path.join(app, 'data/chapter-books-qa');
const revision = '2026-10-28T12:00:00.000Z';
let phase = 'setup';

(async () => {
  fs.mkdirSync(output, { recursive: true });
  await require('esbuild').build({ entryPoints: [path.join(__dirname, 'chapter-books.fixture.tsx')],
    outfile: path.join(output, 'lab.js'), bundle: true, format: 'esm', platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' } });
  const css = fs.readdirSync(path.join(app, 'dist/assets')).find(name => /^index-[A-Za-z0-9_-]+\.css$/.test(name));
  assert.ok(css, 'Build current design CSS first');
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
    if (url.pathname === '/') {
      res.setHeader('Content-Type', 'text/html');
      return res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body style="background:#080f20"><div id="root"></div><script type="module" src="/lab.js"></script></body></html>');
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
  const results = [];
  try {
    phase = 'launch';
    browser = await launchFixtureBrowser(output);
    for (const width of [390, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: 'block' });
      const page = await context.newPage();
      const errors = [], unexpected = [], writes = [], editorSaves = [], quoteReads = [];
      let quoteMode = 'credit', conflict = false;
      let savedBook = { id: 'synthetic-book', kind: 'book', name: 'Synthetic Story', slug: 'synthetic-story', description: '',
        pieceIds: ['synthetic-one', 'synthetic-two'], priceKes: 600, isPublished: true, showChaptersSeparately: false,
        existingOwnerPricing: 'remaining_chapters', createdAt: revision, updatedAt: revision };
      page.setDefaultTimeout(12000);
      page.on('pageerror', error => errors.push(error.message));
      await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        // Abort before any external network traffic, including unused preset images.
        if (url.origin !== origin) return route.abort();
        if (!url.pathname.startsWith('/api/')) return route.continue();
        const send = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
        if (request.method() === 'GET' && url.pathname === '/api/books/synthetic-book/quote') {
          quoteReads.push(quoteMode);
          if (quoteMode === 'error') return send({ error: 'Synthetic quote unavailable' }, 503);
          const owned = quoteMode === 'owned';
          return send({ bookId: savedBook.id, bookUpdatedAt: quoteMode === 'stale' ? '2026-10-27T12:00:00.000Z' : revision,
            listPriceKes: 600, amountKes: owned ? 0 : 400, creditKes: owned ? 600 : 200,
            ownedPieceIds: owned ? ['synthetic-one', 'synthetic-two'] : ['synthetic-one'],
            remainingPieceIds: owned ? [] : ['synthetic-two'], alreadyOwned: owned, pricingPolicy: 'remaining_chapters' });
        }
        if (request.method() === 'GET' && url.pathname === '/api/admin/reader-experience') return send({ collections: [], bundles: [savedBook], reviews: [] });
        if (request.method() === 'PUT' && url.pathname === '/api/admin/bundles/synthetic-book') {
          const body = request.postDataJSON(); writes.push(body);
          if (conflict) return send({ error: 'Synthetic conflict: book changed elsewhere. Reload before saving.' }, 409);
          assert.equal(body.updatedAt, savedBook.updatedAt, 'Uses current compare-and-set revision');
          savedBook = { ...savedBook, ...body, updatedAt: '2026-10-28T12:01:00.000Z' };
          return send({ success: true, bundle: savedBook });
        }
        if (request.method() === 'GET' && url.pathname === '/api/public/bootstrap') return send({ generatedAt: revision,
          session: { authenticated: false, user: null }, author: {}, articles: [], categories: [], topics: [],
          homepage: { config: {}, bundles: [], collections: [], pieces: [], mostSellingPieces: [], subscriptionPlans: [] },
          newsletter: { enabled: false, consentVersion: 'synthetic', doubleOptIn: true } });
        if (request.method() === 'GET' && url.pathname === '/api/topics') return send([]);
        if (request.method() === 'GET' && url.pathname === '/api/exchange-rates') return send({ kesRates: { KES: 1, USD: 130 }, updatedAt: revision });
        if (request.method() === 'POST' && /\/api\/admin\/articles\/synthetic-one\/autosave$/.test(url.pathname)) return send({ success: true });
        if (request.method() === 'POST' && url.pathname === '/api/qa/editor-save') {
          const body = request.postDataJSON(); editorSaves.push(body); return send({ article: body, success: true });
        }
        unexpected.push(`${request.method()} ${url.pathname}`); return route.abort();
      });
      phase = `reader_credit_${width}`;
      await page.goto(origin, { waitUntil: 'networkidle', timeout: 30000 });
      const openBook = () => page.getByRole('button', { name: 'Read or buy Synthetic Story', exact: true }).click();
      await openBook();
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('status').filter({ hasText: 'Your price:' }).waitFor();
      assert.ok(await dialog.getByText('Already in your library', { exact: true }).isVisible());
      assert.ok(await dialog.getByRole('button', { name: 'Buy complete book · KSh 400', exact: true }).isEnabled());
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: path.join(output, `book-price-${width}.png`), fullPage: true });
      await dialog.getByRole('button', { name: 'Buy complete book · KSh 400', exact: true }).click();
      assert.equal(await page.getByTestId('checkout-result').textContent(), `Checkout amount 400; revision ${revision}`);
      await openBook(); await dialog.getByRole('status').filter({ hasText: 'Your price:' }).waitFor();
      await dialog.getByRole('button', { name: 'Read The Story — Chapter One', exact: true }).click();
      const preview = page.getByTestId('chapter-preview');
      await preview.getByRole('heading', { name: 'The Story — Chapter One', exact: true }).waitFor();
      await preview.getByRole('button', { name: 'Next chapter: The Story — Chapter Two', exact: true }).click();
      await preview.getByRole('heading', { name: 'The Story — Chapter Two', exact: true }).waitFor();
      assert.ok(await preview.getByText('Chapter 2 of 2', { exact: true }).isVisible());
      assert.equal(await page.getByText('PRIVATE PAID TEXT MUST NEVER APPEAR', { exact: true }).count(), 0);
      phase = `reader_owned_failure_and_revision_${width}`;
      quoteMode = 'owned'; await openBook();
      await dialog.getByRole('status').filter({ hasText: 'No further purchase' }).waitFor();
      assert.equal(await dialog.getByRole('button', { name: 'All chapters are already available', exact: true }).isDisabled(), true);
      await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
      assert.equal(await page.evaluate(() => document.body.style.overflow), '');
      for (const mode of ['error', 'stale']) {
        quoteMode = mode; await openBook();
        await dialog.getByRole('button', { name: 'Retry price check', exact: true }).waitFor();
        assert.equal(await dialog.getByRole('button', { name: 'Buy complete book · KSh 600', exact: true }).isDisabled(), true);
        await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
      }
      phase = `manager_order_save_and_conflict_${width}`;
      await page.getByRole('button', { name: 'Manager lab', exact: true }).click();
      await page.getByRole('button', { name: /Synthetic Story.*2 ordered chapters/ }).click();
      await page.getByRole('button', { name: 'Move chapter 2 up', exact: true }).click();
      await page.getByLabel('Complete book price (KES) *', { exact: true }).fill('450');
      await page.getByLabel('Also show chapters as separate pieces in the catalogue', { exact: true }).check();
      await page.getByRole('button', { name: 'Save book', exact: true }).click();
      await page.getByText(/Book saved\. Original chapter/).waitFor();
      assert.equal(writes.length, 1); assert.deepEqual(writes[0].pieceIds, ['synthetic-two', 'synthetic-one']);
      assert.equal(writes[0].kind, 'book'); assert.equal(writes[0].priceKes, 450); assert.equal(writes[0].showChaptersSeparately, true);
      assert.equal(writes[0].existingOwnerPricing, 'remaining_chapters'); assert.equal(writes[0].updatedAt, revision);
      conflict = true;
      await page.getByRole('button', { name: /Synthetic Story.*2 ordered chapters/ }).click();
      await page.getByLabel('Complete book price (KES) *', { exact: true }).fill('333');
      await page.getByRole('button', { name: 'Save book', exact: true }).click();
      await page.getByText(/^Synthetic conflict: book changed elsewhere\. Reload before saving\./).waitFor();
      assert.ok(await page.getByText(/Your book draft has been kept\..*refresh the list and reopen it before saving again\./).isVisible());
      assert.equal(writes.length, 2); assert.equal(writes[1].updatedAt, savedBook.updatedAt);
      assert.equal(await page.getByLabel('Complete book price (KES) *', { exact: true }).inputValue(), '333', 'Conflict preserves writer draft');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: path.join(output, `book-manager-${width}.png`), fullPage: true });
      phase = `editor_formatting_${width}`;
      await page.getByRole('button', { name: 'Editor lab', exact: true }).click();
      const content = page.getByRole('textbox', { name: 'Piece content', exact: true }); await content.waitFor();
      await content.fill('A brave beginning.\nA quiet line.');
      phase = `editor_bold_${width}`;
      await content.evaluate(element => { element.focus(); element.setSelectionRange(2, 7); });
      await page.getByRole('button', { name: 'Bold selected text', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('textarea[aria-label="Piece content"]')?.value.includes('**brave**'));
      assert.equal(await content.inputValue(), 'A **brave** beginning.\nA quiet line.');
      assert.equal(await content.evaluate(element => element.value.slice(element.selectionStart, element.selectionEnd)), 'brave', 'Formatting selection is restored with the DOM commit, not a later timer');
      phase = `editor_italic_${width}`;
      await content.evaluate(element => { const start = element.value.indexOf('quiet'); element.focus(); element.setSelectionRange(start, start + 5); });
      await page.getByRole('button', { name: 'Italicize selected text', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('textarea[aria-label="Piece content"]')?.value.includes('*quiet*'));
      assert.equal(await content.inputValue(), 'A **brave** beginning.\nA *quiet* line.');
      assert.equal(await content.evaluate(element => element.value.slice(element.selectionStart, element.selectionEnd)), 'quiet');
      phase = `editor_heading_${width}`;
      await content.evaluate(element => { element.focus(); element.setSelectionRange(0, 0); });
      await page.getByRole('combobox', { name: 'Heading label', exact: true }).selectOption('2');
      await page.waitForFunction(() => document.querySelector('textarea[aria-label="Piece content"]')?.value.startsWith('## '));
      await page.getByRole('radio', { name: 'Book chapter', exact: true }).check();
      await page.getByRole('button', { name: 'Preview formatting', exact: true }).click();
      // SafeMarkdown reserves the piece title above its content hierarchy:
      // authored Markdown H2 is rendered as semantic HTML H3.
      assert.ok(await page.getByRole('heading', { name: 'A brave beginning.', exact: true, level: 3 }).isVisible());
      assert.equal(await page.locator('strong').filter({ hasText: /^brave$/ }).count(), 1);
      assert.equal(await page.locator('em').filter({ hasText: /^quiet$/ }).count(), 1);
      assert.equal(await page.getByRole('button', { name: 'Bold selected text', exact: true }).isDisabled(), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: path.join(output, `editor-format-${width}.png`), fullPage: true });
      await page.getByRole('button', { name: 'Markdown Editor', exact: true }).click();
      assert.equal(await content.inputValue(), '## A **brave** beginning.\nA *quiet* line.');
      assert.deepEqual(errors, []); assert.deepEqual(unexpected, []); assert.equal(editorSaves.length, 0);
      results.push({ width, quoteReads: quoteReads.length, validCredit: true, ownedNoCharge: true, failedAndStaleQuotesBlocked: true,
        orderedSaveAndCas: true, conflictDraftPreserved: true, headingBoldItalic: true, chapterFormatChoice: true,
        nextChapterNavigation: true, noPaidText: true, noOverflow: true, browserErrors: 0 });
      await context.close();
    }
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
  const report = { status: 'verified', results, cloudWrites: 0, realProviderCalls: 0, realSessions: 0, fixtureApiOnly: true,
    scope: 'Actual isolated writer editor, book manager, book detail/quote and chapter navigation; not production payment settlement.' };
  fs.writeFileSync(path.join(output, 'proof.json'), JSON.stringify(report, null, 2));
  process.stdout.write(JSON.stringify(report) + '\n');
})().catch(error => { recordFixtureFailure(output, { status: 'failed', phase, error: error.message, fixtureApiOnly: true }); process.exitCode = 1; });
