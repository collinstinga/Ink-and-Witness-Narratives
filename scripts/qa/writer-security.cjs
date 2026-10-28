'use strict';
// CI-only: actual panel + reset routes, synthetic service/email/hash, HTTP loopback.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { launchFixtureBrowser, recordFixtureFailure } = require('./browser-runtime.cjs');
const app = path.resolve(__dirname, '../..');
const output = path.join(app, 'data/writer-security-qa');
const capability = '/api/auth/writer-password-reset';
const token = 'wcr1_' + 'a'.repeat(43);
const password = 'SyntheticNewPassword1!';
let phase = 'setup';
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const build = require('esbuild').build;
  await build({ entryPoints: [path.join(__dirname, 'writer-security.fixture.tsx')], outfile: path.join(output, 'lab.js'),
    bundle: true, format: 'esm', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
  await build({ entryPoints: [path.join(__dirname, 'writer-security.server.ts')], outfile: path.join(output, 'server.cjs'),
    bundle: true, format: 'cjs', platform: 'node', packages: 'external' });
  const css = fs.readdirSync(path.join(app, 'dist/assets')).find(name => /^index-[A-Za-z0-9_-]+\.css$/.test(name));
  assert.ok(css, 'Build current design CSS first.');
  const lab = require(path.join(output, 'server.cjs')).createWriterSecurityQaApp({ script: path.join(output, 'lab.js'), css: path.join(app, 'dist/assets', css), fonts: path.join(app, 'dist/fonts') });
  const server = http.createServer(lab.app);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  const results = [];
  try {
    // Negative checks hit the same real parser/guard/route composition, never DB.
    for (const rejectedOrigin of ['null', 'https://untrusted.invalid']) {
      const rejected = await fetch(origin + capability, { method: 'POST', headers: { Origin: rejectedOrigin, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token, password, confirmPassword: password }) });
      assert.equal(rejected.status, 403);
    }
    assert.equal(lab.snapshot().consumes, 0); assert.equal(lab.snapshot().hashes, 0);
    phase = 'launch';
    browser = await launchFixtureBrowser(output);
    for (const width of [390, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: 'block' });
      const page = await context.newPage(), errors = [], unexpected = [];
      page.setDefaultTimeout(10000);
      page.on('pageerror', () => errors.push('browser-error'));
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) { unexpected.push('external-request'); return route.abort(); }
        if (url.pathname === `${capability}/form.js` && route.request().headers().referer) unexpected.push('script-referrer-present');
        return route.continue();
      });
      lab.reset('review_required');
      phase = `panel_readiness_${width}`;
      await page.goto(origin, { waitUntil: 'networkidle', timeout: 30000 });
      const send = page.getByRole('button', { name: 'Send one-use recovery email', exact: true });
      await page.getByRole('status').filter({ hasText: 'fresh reviewed backup' }).waitFor();
      assert.equal(await send.isDisabled(), true); assert.equal(await page.getByRole('checkbox').isDisabled(), true);
      assert.equal(lab.snapshot().issues, 0); assert.equal(lab.snapshot().emails, 0);
      await page.locator('#unsaved-note').fill('Keep this changed unsaved draft');
      lab.ready();
      await page.getByRole('button', { name: 'Refresh security status', exact: true }).click();
      await page.getByRole('status').filter({ hasText: 'The required backup' }).waitFor();
      assert.equal(await send.isDisabled(), true); assert.equal(lab.snapshot().issues, 0);
      await page.getByRole('checkbox').check();
      // Two synchronous DOM clicks exercise the actual ref fence, before render.
      await send.evaluate(button => { button.click(); button.click(); });
      await page.getByRole('status').filter({ hasText: 'Email delivery could not be confirmed' }).waitFor();
      assert.equal(lab.snapshot().issues, 1); assert.equal(lab.snapshot().emails, 1);
      await page.getByRole('button', { name: 'Refresh security status', exact: true }).click();
      await page.getByRole('status').filter({ hasText: 'A recovery link is already pending' }).waitFor();
      assert.equal(await send.isDisabled(), true);
      await page.getByRole('button', { name: 'Close security', exact: true }).click();
      await page.getByRole('button', { name: 'Toggle account security', exact: true }).click();
      await page.getByRole('status').filter({ hasText: 'A recovery link is already pending' }).waitFor();
      assert.equal(lab.snapshot().issues, 1); assert.equal(lab.snapshot().emails, 1);
      assert.equal(await page.locator('#unsaved-note').inputValue(), 'Keep this changed unsaved draft');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: path.join(output, `panel-${width}.png`), fullPage: true });

      phase = `form_submission_${width}`;
      lab.reset('ready');
      await context.addCookies([{ name: 'writer_qa', value: 'synthetic-only', url: origin, httpOnly: true, sameSite: 'Lax' }]);
      const response = await page.goto(`${origin}${capability}?token=${token}`, { waitUntil: 'networkidle', timeout: 30000 });
      assert.equal(response.status(), 200); assert.equal(response.headers()['referrer-policy'], 'no-referrer');
      assert.match(response.headers()['cache-control'], /no-store/);
      assert.equal(lab.snapshot().consumes, 0); assert.equal(lab.snapshot().hashes, 0); assert.equal(lab.snapshot().issues, 0); assert.equal(lab.snapshot().emails, 0);
      const submit = page.getByRole('button', { name: 'Update Writer Studio password', exact: true });
      await submit.waitFor(); assert.equal(await submit.isDisabled(), false);
      await page.getByLabel('New password', { exact: true }).fill(password);
      await page.getByLabel('Confirm new password', { exact: true }).fill(password);
      await page.screenshot({ path: path.join(output, `form-${width}.png`), fullPage: true });
      await submit.evaluate(button => { button.click(); button.click(); });
      await page.getByRole('status').filter({ hasText: 'Writer Studio password updated' }).waitFor();
      const proof = lab.snapshot();
      assert.equal(proof.consumes, 1); assert.equal(proof.hashes, 1); assert.equal(proof.cookieClears, 1);
      assert.equal(proof.issues, 0); assert.equal(proof.emails, 0); assert.equal(proof.databaseAccesses, 0);
      assert.equal(proof.postMetadata.origin, origin); assert.equal(proof.postMetadata.referer, '');
      assert.match(proof.postMetadata.contentType, /^application\/x-www-form-urlencoded/);
      assert.deepEqual(proof.postMetadata.keys, ['confirmPassword', 'password', 'token']);
      assert.equal(await page.locator('input[type=password]').count(), 0); assert.equal(new URL(page.url()).search, '');
      assert.equal((await context.cookies()).some(cookie => cookie.name === 'writer_qa'), false);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
      results.push({ width, backupReadinessGate: true, explicitApproval: true, ambiguousEmailNoResend: true, draftPreserved: true,
        getDidNotConsume: true, urlencodedFormParsed: true, realOriginPreserved: true, noReferer: true, oneConsume: true,
        cookieCleared: true, noAutoLogin: true, noOverflow: true, errors: 0 });
      await context.close();
    }
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
  const report = { status: 'verified', results, cloudWrites: 0, realProviderCalls: 0, realSessions: 0, syntheticServicesOnly: true };
  fs.writeFileSync(path.join(output, 'proof.json'), JSON.stringify(report, null, 2));
  process.stdout.write(JSON.stringify(report) + '\n');
})().catch(error => {
  const message = String(error.message).replace(/wcr1_[A-Za-z0-9_-]+/g, '[capability]').replaceAll(password, '[password]');
  recordFixtureFailure(output, { status: 'failed', phase, error: message, syntheticServicesOnly: true }); process.exitCode = 1;
});
