'use strict';
// Actual reset HTML/script/routes on loopback, synthetic persistence/hash/session
// services only. No email, real reader, external request, cloud write or charge.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { launchFixtureBrowser, recordFixtureFailure } = require('./browser-runtime.cjs');
const app = path.resolve(__dirname, '../..'), output = path.join(app, 'data/reader-password-reset-qa');
const capability = '/api/auth/password-reset', token = 'pr1_' + 'a'.repeat(43), password = 'SyntheticReaderPassword1!';
let phase = 'setup';
(async () => {
  fs.mkdirSync(output, { recursive: true });
  await require('esbuild').build({ entryPoints: [path.join(__dirname, 'reader-password-reset.server.ts')],
    outfile: path.join(output, 'server.cjs'), bundle: true, format: 'cjs', platform: 'node', packages: 'external' });
  const lab = require(path.join(output, 'server.cjs')).createReaderPasswordResetQaApp();
  const server = http.createServer(lab.app);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const results = [];
  let browser;
  try {
    phase = 'strict_origin_negative_checks';
    for (const blocked of ['null', 'https://untrusted.invalid']) {
      const response = await fetch(origin + capability, { method: 'POST', headers: { Origin: blocked, Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token, password, confirmPassword: password }) });
      assert.equal(response.status, 403);
    }
    assert.equal(lab.snapshot().consumes, 0); assert.equal(lab.snapshot().hashes, 0);
    phase = 'launch'; browser = await launchFixtureBrowser(output);
    for (const width of [390, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: 'block' });
      const page = await context.newPage(), errors = [], unexpected = [];
      page.setDefaultTimeout(10000);
      page.on('pageerror', () => errors.push('browser-error'));
      await context.route('**/*', route => {
        if (new URL(route.request().url()).origin !== origin) { unexpected.push('external-request'); return route.abort(); }
        if (route.request().url().includes('/form.js') && route.request().headers().referer) unexpected.push('script-referrer-present');
        return route.continue();
      });
      await context.addCookies([{ name: width === 390 ? 'reader_qa' : 'writer_qa', value: 'synthetic-only', url: origin, httpOnly: true, sameSite: 'Lax' }]);
      lab.reset();
      phase = `reproduce_native_origin_failure_${width}`;
      await page.goto(origin + '/legacy-reader-password-reset', { waitUntil: 'networkidle', timeout: 30000 });
      await page.getByLabel('New password', { exact: true }).fill(password);
      await page.getByLabel('Confirm new password', { exact: true }).fill(password);
      const failedNavigation = page.waitForResponse(response => response.url() === origin + capability && response.request().method() === 'POST');
      await page.getByRole('button', { name: 'Legacy submit', exact: true }).click();
      assert.equal((await failedNavigation).status(), 403);
      assert.equal(lab.snapshot().blockedOrigin, 'null'); assert.equal(lab.snapshot().consumes, 0); assert.equal(lab.snapshot().hashes, 0);

      lab.reset();
      phase = `safe_get_and_scripted_form_${width}`;
      const response = await page.goto(`${origin}/password-reset?token=${token}`, { waitUntil: 'networkidle', timeout: 30000 });
      assert.equal(response.status(), 200); assert.equal(response.headers()['referrer-policy'], 'no-referrer');
      assert.match(response.headers()['cache-control'], /no-store/);
      // An additional scanner-style GET must also leave the token active.
      assert.equal((await fetch(`${origin}${capability}?token=${token}`)).status, 200);
      assert.equal(lab.snapshot().consumes, 0); assert.equal(lab.snapshot().hashes, 0);
      const submit = page.getByRole('button', { name: 'Reset password', exact: true });
      assert.equal(await submit.isDisabled(), false);
      await page.getByLabel('New password', { exact: true }).fill(password);
      await page.getByLabel('Confirm new password', { exact: true }).fill('DifferentSynthetic1!');
      await submit.click(); await page.getByRole('alert').filter({ hasText: 'same new password' }).waitFor();
      assert.equal(lab.snapshot().posts, 0);
      await page.getByLabel('Confirm new password', { exact: true }).fill(password);
      await page.screenshot({ path: path.join(output, `reset-form-${width}.png`), fullPage: true });
      await submit.evaluate(button => { button.click(); button.click(); });
      await page.getByRole('status').filter({ hasText: 'reader password has been updated' }).waitFor();
      const proof = lab.snapshot();
      assert.equal(proof.consumes, 1); assert.equal(proof.hashes, 1); assert.equal(proof.posts, 1); assert.equal(proof.cookieClears, 1); assert.equal(proof.localCleanup, 1);
      assert.equal(proof.postMetadata.origin, origin); assert.equal(proof.postMetadata.referer, ''); assert.equal(proof.postMetadata.accept, 'application/json');
      assert.match(proof.postMetadata.contentType, /^application\/x-www-form-urlencoded/);
      assert.deepEqual(proof.postMetadata.keys, ['confirmPassword', 'password', 'token']);
      assert.equal(await page.locator('input[type=password]').count(), 0); assert.equal(new URL(page.url()).search, '');
      assert.equal((await context.cookies()).some(cookie => ['reader_qa', 'writer_qa'].includes(cookie.name)), false);
      const replay = await fetch(origin + capability, { method: 'POST', headers: { Origin: origin, Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token, password, confirmPassword: password }) });
      assert.equal(replay.status, 410); assert.equal(lab.snapshot().consumes, 1); assert.equal(lab.snapshot().hashes, 1);
      assert.equal((await fetch(`${origin}/password-reset?token=${token}`)).status, 410);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

      phase = `uncertain_result_no_automatic_retry_${width}`;
      lab.reset({ uncertain: true });
      await page.goto(`${origin}/password-reset?token=${token}`, { waitUntil: 'networkidle', timeout: 30000 });
      await page.getByLabel('New password', { exact: true }).fill(password);
      await page.getByLabel('Confirm new password', { exact: true }).fill(password);
      await page.getByRole('button', { name: 'Reset password', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'No automatic retry was sent' }).waitFor();
      assert.equal(lab.snapshot().posts, 1); assert.equal(lab.snapshot().consumes, 1); assert.equal(lab.snapshot().hashes, 1);
      assert.equal(await page.getByRole('button', { name: 'Reset password', exact: true }).isDisabled(), true);
      assert.deepEqual(await page.locator('input[type=password]').evaluateAll(inputs => inputs.map(input => input.value)), ['', '']);
      assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
      results.push({ width, nativeOriginFailureReproduced: true, strictOriginChecksRetained: true,
        getDidNotConsume: true, friendlyResetPathWorks: true, realOriginPreserved: true, noReferer: true,
        mismatchDoesNotSubmit: true, oneConsume: true, replayRejected: true, cookieCleared: true,
        noAutoLogin: true, uncertainResultDoesNotRetry: true, noOverflow: true, errors: 0 });
      await context.close();
    }
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
  const report = { status: 'verified', results, cloudWrites: 0, realProviderCalls: 0, realSessions: 0, emailsSent: 0, syntheticServicesOnly: true };
  fs.writeFileSync(path.join(output, 'proof.json'), JSON.stringify(report, null, 2));
  process.stdout.write(JSON.stringify(report) + '\n');
})().catch(error => {
  const message = String(error.message).replace(/pr1_[A-Za-z0-9_-]+/g, '[capability]').replaceAll(password, '[password]');
  recordFixtureFailure(output, { status: 'failed', phase, error: message, syntheticServicesOnly: true }); process.exitCode = 1;
});
