'use strict';
// Synthetic QA only. Never loads an application environment or browser profile.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const PLAYWRIGHT_VERSION = '1.62.1';

function browserLaunchOptions(env = process.env) {
  // Runner Chrome is not versioned with Playwright and previously hung at launch.
  // CI must use the matching managed headless shell installed by its exact CLI.
  assert.ok(env.GITHUB_ACTIONS !== 'true' || !env.CHROME_PATH,
    'CI must use managed Chromium, not a system CHROME_PATH override');
  const options = { headless: true, timeout: 30000 };
  if (env.CHROME_PATH) {
    assert.ok(path.isAbsolute(env.CHROME_PATH) && fs.existsSync(env.CHROME_PATH),
      'Local CHROME_PATH must name an existing absolute executable');
    return { ...options, executablePath: env.CHROME_PATH };
  }
  return options;
}

function verifyRuntimeVersion(version, env = process.env) {
  if (env.GITHUB_ACTIONS === 'true') {
    assert.equal(version, PLAYWRIGHT_VERSION, 'CI Playwright package and managed browser must match the reviewed pin');
  }
}

async function launchFixtureBrowser(output) {
  assert.ok(process.env.PLAYWRIGHT_TEST_RUNTIME && path.isAbsolute(process.env.PLAYWRIGHT_TEST_RUNTIME),
    'Set an absolute PLAYWRIGHT_TEST_RUNTIME containing the pinned Playwright package');
  const runtime = createRequire(path.join(process.env.PLAYWRIGHT_TEST_RUNTIME, 'package.json'));
  const playwrightVersion = runtime('playwright/package.json').version;
  verifyRuntimeVersion(playwrightVersion);
  const options = browserLaunchOptions();
  const proof = { status: 'launching', playwrightVersion, nodeVersion: process.version,
    platform: process.platform, mode: options.executablePath ? 'explicit-local-browser' : 'managed-chromium',
    launchTimeoutMs: options.timeout, syntheticOnly: true };
  fs.mkdirSync(output, { recursive: true });
  const save = () => fs.writeFileSync(path.join(output, 'browser-runtime.json'), JSON.stringify(proof, null, 2));
  save();
  const started = Date.now();
  try {
    const browser = await runtime('playwright').chromium.launch(options);
    Object.assign(proof, { status: 'launched', browserVersion: browser.version(), launchMs: Date.now() - started });
    save();
    process.stdout.write(JSON.stringify({ browserRuntime: proof }) + '\n');
    return browser;
  } catch (error) {
    Object.assign(proof, { status: 'failed', launchMs: Date.now() - started, error: error.message });
    save();
    throw error; // Infrastructure failures remain blocking; never retry application tests.
  }
}

function recordFixtureFailure(output, report) {
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'failure.json'), JSON.stringify(report, null, 2));
  process.stderr.write(JSON.stringify(report) + '\n');
}

module.exports = { PLAYWRIGHT_VERSION, browserLaunchOptions, verifyRuntimeVersion, launchFixtureBrowser, recordFixtureFailure };

if (require.main === module) {
  const output = path.resolve(__dirname, '../../data/ci-browser-qa');
  (async () => {
    const launches = [];
    // Three independent successful launches are required, not three attempts at
    // one success. Any startup or render failure fails setup immediately.
    for (let index = 0; index < 3; index++) {
      const browser = await launchFixtureBrowser(output);
      try {
        const context = await browser.newContext({ serviceWorkers: 'block' });
        await context.route('**/*', route => route.abort());
        const page = await context.newPage();
        await page.setContent('<!doctype html><h1>Synthetic browser preflight</h1>');
        assert.equal(await page.getByRole('heading').textContent(), 'Synthetic browser preflight');
        launches.push({ index: index + 1, browserVersion: browser.version(), rendered: true });
        await context.close();
      } finally { await browser.close(); }
    }
    const proof = { status: 'verified', launches, syntheticOnly: true, externalRequests: 0 };
    fs.writeFileSync(path.join(output, 'preflight.json'), JSON.stringify(proof, null, 2));
    process.stdout.write(JSON.stringify(proof) + '\n');
  })().catch(error => {
    recordFixtureFailure(output, { status: 'failed', phase: 'browser_preflight', error: error.message, syntheticOnly: true });
    process.exitCode = 1;
  });
}
