'use strict';
// Isolated component checks only: all APIs are fixtures, no real users or transfers.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { launchFixtureBrowser, recordFixtureFailure } = require('./browser-runtime.cjs');
const app = path.resolve(__dirname, '../..');
const output = path.join(app, 'data/reader-controls-qa');
let phase = 'setup';

(async () => {
  fs.mkdirSync(output, { recursive: true });
  await require('esbuild').build({ entryPoints: [path.join(__dirname, 'reader-controls.fixture.tsx')],
    outfile: path.join(output, 'lab.js'), bundle: true, format: 'esm', platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' } });
  const css = fs.readdirSync(path.join(app, 'dist/assets')).find(name => /^index-[A-Za-z0-9_-]+\.css$/.test(name));
  assert.ok(css, 'Build the current design CSS before synthetic browser QA');
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
  let browser;
  const results = [];
  try {
    phase = 'launch';
    browser = await launchFixtureBrowser(output);
    for (const width of [390, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: 'block' });
      const page = await context.newPage();
      const errors = [], unexpected = [], readerWrites = [], commentWrites = [], moderationWrites = [], payoutWrites = [];
      const readers = [
        { id: 'synthetic-reader', name: 'Synthetic Reader One', email: 'reader-one@example.invalid', createdAt: '2026-10-01T12:00:00.000Z', status: 'active', revision: 0 },
        { id: 'synthetic-reader-two', name: 'Synthetic Reader Two', email: 'reader-two@example.invalid', createdAt: '2026-10-02T12:00:00.000Z', status: 'active', revision: 0 },
      ];
      const comments = [];
      let releasePayout;
      const payoutGate = new Promise(resolve => { releasePayout = resolve; });
      let capturePayout;
      const payoutCaptured = new Promise(resolve => { capturePayout = resolve; });
      page.setDefaultTimeout(12000);
      page.on('pageerror', error => errors.push(error.message));
      await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== origin) { unexpected.push('external'); return route.abort(); }
        if (!url.pathname.startsWith('/api/')) return route.continue();
        const send = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
        if (request.method() === 'GET' && url.pathname === '/api/admin/readers') {
          const filtered = url.searchParams.has('email') ? readers.filter(reader => reader.email === url.searchParams.get('email')) : readers;
          return send({ success: true, directory: { totalReaderAccounts: readers.length, matchingReaderAccounts: filtered.length, readers: filtered, pageSize: 25 } });
        }
        if (request.method() === 'PATCH' && url.pathname === '/api/admin/readers/synthetic-reader/status') {
          const body = request.postDataJSON(); readerWrites.push(body);
          assert.equal(body.expectedRevision, readers[0].revision);
          assert.ok(['suspended', 'active'].includes(body.status));
          Object.assign(readers[0], { status: body.status, revision: readers[0].revision + 1 });
          return send({ success: true, reader: readers[0], changed: true });
        }
        if (request.method() === 'GET' && url.pathname === '/api/articles/synthetic-piece/comments') return send(comments.filter(comment => comment.status === 'approved'));
        if (request.method() === 'GET' && url.pathname === '/api/articles/synthetic-piece/comments/mine') return send(comments);
        if (request.method() === 'POST' && url.pathname === '/api/articles/synthetic-piece/comments') {
          const body = request.postDataJSON(); commentWrites.push(body);
          assert.deepEqual(Object.keys(body).sort(), ['content', 'submissionId']);
          assert.match(body.submissionId, /^[A-Za-z0-9_-]{16,80}$/);
          const comment = { id: `comm_synthetic_${comments.length + 1}`, articleId: 'synthetic-piece', articleTitle: 'Synthetic Reader Piece',
            readerName: 'Synthetic Reader One', content: body.content, status: 'pending', createdAt: `2026-10-28T12:00:0${comments.length}.000Z` };
          comments.push(comment);
          return send({ success: true, comment }, 201);
        }
        if (request.method() === 'GET' && url.pathname === '/api/admin/comments') return send({ count: comments.length, comments, hasMore: false, nextCursor: null });
        if (request.method() === 'PUT' && /^\/api\/admin\/comments\/comm_synthetic_[12]$/.test(url.pathname)) {
          const body = request.postDataJSON(); moderationWrites.push(body);
          assert.deepEqual(body, { status: 'approved' });
          const comment = comments.find(item => item.id === url.pathname.split('/').at(-1));
          Object.assign(comment, { status: 'approved' });
          return send({ success: true, comment });
        }
        if (request.method() === 'POST' && url.pathname === '/api/admin/affiliates/payouts/synthetic-payout/process') {
          const body = request.postDataJSON(); payoutWrites.push(body);
          assert.equal(body.action, 'pay'); assert.equal(body.paymentReference, 'SYNTHETIC-NO-TRANSFER-01');
          capturePayout();
          await payoutGate;
          return send({ success: true, message: 'Synthetic payment record saved. No transfer performed.', payout: {
            id: 'synthetic-payout', affiliateId: 'synthetic-partner', affiliateCode: 'SYNTHETIC', affiliateName: 'Synthetic Partner',
            amountKes: 500, salesCount: 2, commissionIds: ['synthetic-commission'], payoutMethod: 'mpesa', payoutDetails: { mpesaPhone: '0700000000' },
            status: 'PAID', requestedAt: '2026-10-28T12:00:00.000Z', paidAt: '2026-10-28T12:30:00.000Z',
            confirmationMethod: 'writer_confirmed', paymentReference: body.paymentReference,
          } });
        }
        unexpected.push(`${request.method()} ${url.pathname}`); return route.abort();
      });

      phase = `reader_directory_${width}`;
      await page.goto(origin, { waitUntil: 'networkidle', timeout: 30000 });
      const directory = page.getByTestId('directory-lab');
      await directory.getByText('Synthetic Reader One', { exact: true }).waitFor();
      assert.equal(await directory.locator('strong').textContent(), '2');
      assert.ok(await directory.getByText('reader-one@example.invalid', { exact: true }).isVisible());
      assert.ok(await directory.getByText('reader-two@example.invalid', { exact: true }).isVisible());
      await directory.getByRole('button', { name: 'Suspend account', exact: true }).first().click();
      let dialog = page.getByRole('dialog');
      assert.equal(readerWrites.length, 0);
      assert.equal(await dialog.getByRole('button', { name: 'Confirm status change', exact: true }).isDisabled(), true);
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click(); assert.equal(readerWrites.length, 0);
      await directory.getByRole('button', { name: 'Suspend account', exact: true }).first().click();
      dialog = page.getByRole('dialog');
      await dialog.getByRole('checkbox').check();
      await dialog.getByRole('button', { name: 'Confirm status change', exact: true }).click();
      await directory.getByRole('status').filter({ hasText: 'Reader suspended' }).waitFor();
      assert.equal(readerWrites.length, 1); assert.equal(readerWrites[0].status, 'suspended');
      await directory.getByRole('button', { name: 'Reactivate account', exact: true }).click();
      dialog = page.getByRole('dialog'); await dialog.getByRole('checkbox').check();
      await dialog.getByRole('button', { name: 'Confirm status change', exact: true }).click();
      await directory.getByRole('status').filter({ hasText: 'They must sign in again' }).waitFor();
      assert.equal(readerWrites.length, 2); assert.equal(readerWrites[1].expectedRevision, 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: path.join(output, `directory-${width}.png`), fullPage: true });

      phase = `multiple_pending_comments_${width}`;
      await page.getByRole('button', { name: 'Reader comments lab', exact: true }).click();
      let reader = page.getByTestId('reader-comments-lab');
      for (let index = 0; index < 2; index++) {
        await reader.getByLabel('Add a comment', { exact: true }).fill('A repeated but intentional synthetic thought.');
        await reader.getByRole('button', { name: 'Submit for approval', exact: true }).click();
        await reader.getByRole('status').filter({ hasText: 'Comment submitted for writer approval' }).waitFor();
        await page.waitForFunction(expected => document.querySelectorAll('[data-testid="reader-comments-lab"] article').length === expected, index + 1);
      }
      assert.equal(commentWrites.length, 2);
      assert.notEqual(commentWrites[0].submissionId, commentWrites[1].submissionId);
      assert.equal(await reader.getByText('No published reader comments yet.', { exact: true }).isVisible(), true);
      assert.equal(await reader.getByText(/Awaiting writer approval/).count(), 2);

      phase = `explicit_comment_publication_${width}`;
      await page.getByRole('button', { name: 'Writer comments lab', exact: true }).click();
      const writer = page.getByTestId('writer-comments-lab');
      const firstCard = writer.locator('#comment-card-comm_synthetic_1');
      await firstCard.getByRole('button', { name: 'Review & publish', exact: true }).click();
      assert.equal(moderationWrites.length, 0);
      await writer.getByRole('button', { name: 'Cancel publication', exact: true }).click(); assert.equal(moderationWrites.length, 0);
      await firstCard.getByRole('button', { name: 'Review & publish', exact: true }).click();
      await writer.getByRole('button', { name: 'Confirm public publication', exact: true }).click();
      await writer.getByText('Comment published publicly.', { exact: true }).waitFor();
      assert.equal(moderationWrites.length, 1); assert.equal(comments[1].status, 'pending');
      const publicResult = await page.evaluate(() => fetch('/api/articles/synthetic-piece/comments').then(response => response.json()));
      assert.equal(publicResult.length, 1); assert.equal(publicResult[0].id, 'comm_synthetic_1');
      await page.getByRole('button', { name: 'Reader comments lab', exact: true }).click();
      reader = page.getByTestId('reader-comments-lab');
      await reader.getByText(/Awaiting writer approval/).waitFor();
      assert.equal(await reader.locator('article').count(), 2);
      assert.equal(await reader.getByText(/Awaiting writer approval/).count(), 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: path.join(output, `comments-${width}.png`), fullPage: true });

      phase = `offsite_payout_confirmation_${width}`;
      await page.getByRole('button', { name: 'Off-site payout lab', exact: true }).click();
      const payout = page.getByTestId('payout-lab');
      let confirmPaid = payout.getByRole('button', { name: 'Confirm off-site payment', exact: true });
      assert.equal(await confirmPaid.isDisabled(), true); assert.equal(payoutWrites.length, 0);
      await payout.getByLabel('M-Pesa transaction code', { exact: true }).fill('synthetic-no-transfer-01');
      assert.equal(await confirmPaid.isDisabled(), true); assert.equal(payoutWrites.length, 0);
      await payout.getByRole('checkbox').check();
      assert.equal(await confirmPaid.isEnabled(), true);
      // Two synchronous submit events exercise the ref fence before React paints
      // disabled controls. The held fixture response proves an in-flight duplicate
      // cannot send another payment-record request.
      await payout.getByRole('form', { name: 'Record an off-site affiliate payout', exact: true }).evaluate(form => {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
      await payout.getByRole('button', { name: 'Saving payment record...', exact: true }).waitFor();
      let captureTimer;
      await Promise.race([payoutCaptured, new Promise((_, reject) => {
        captureTimer = setTimeout(() => reject(new Error('Synthetic payout request was not captured')), 12000);
      })]).finally(() => clearTimeout(captureTimer));
      assert.equal(payoutWrites.length, 1);
      assert.equal(await payout.getByRole('button', { name: 'Saving payment record...', exact: true }).isDisabled(), true);
      releasePayout();
      const receipt = payout.getByRole('region', { name: 'Affiliate dashboard payment receipt', exact: true });
      await receipt.getByText('Payment confirmed by writer (off-site)', { exact: true }).waitFor();
      assert.ok(await receipt.getByText('SYNTHETIC-NO-TRANSFER-01', { exact: true }).isVisible());
      assert.ok(await receipt.getByText('KES 500 paid', { exact: true }).isVisible());
      assert.equal(payoutWrites.length, 1);
      assert.equal(await payout.getByText(/provider verified|Safaricom verified/i).count(), 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: path.join(output, `payout-${width}.png`), fullPage: true });
      assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
      results.push({ width, exactReaderCount: 2, explicitSuspendAndReactivate: true, cancelDoesNotWrite: true,
        sameReaderMultipleComments: true, distinctIntentionalSubmissionIds: true, privatePendingOnly: true,
        explicitWriterPublication: true, secondCommentStillPending: true, payoutCodeAndAcknowledgementRequired: true,
        oneInflightPayoutWrite: true, writerConfirmedReceipt: true, noOverflow: true, errors: 0 });
      await context.close();
    }
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
  const report = { status: 'verified', results, cloudWrites: 0, realProviderCalls: 0, realSessions: 0, fixtureApiOnly: true };
  fs.writeFileSync(path.join(output, 'proof.json'), JSON.stringify(report, null, 2));
  process.stdout.write(JSON.stringify(report) + '\n');
})().catch(error => { recordFixtureFailure(output, { status: 'failed', phase, error: error.message, fixtureApiOnly: true }); process.exitCode = 1; });
