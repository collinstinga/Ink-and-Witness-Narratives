import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { browserLaunchOptions, verifyRuntimeVersion, PLAYWRIGHT_VERSION } = require('./browser-runtime.cjs');
const workflow = readFileSync(new URL('../../.github/workflows/literary-circle-verification.yml', import.meta.url), 'utf8');

describe('reproducible synthetic CI browser runtime', () => {
  it('uses the managed headless browser without a system executable override', () => {
    expect(browserLaunchOptions({ GITHUB_ACTIONS: 'true' })).toEqual({ headless: true, timeout: 30000 });
    expect(browserLaunchOptions({})).not.toHaveProperty('executablePath');
  });
  it('rejects even an existing system browser override in GitHub Actions', () => {
    expect(() => browserLaunchOptions({ GITHUB_ACTIONS: 'true', CHROME_PATH: process.execPath })).toThrow('managed Chromium');
  });
  it('allows an explicit existing absolute executable for local checks only', () => {
    expect(browserLaunchOptions({ CHROME_PATH: process.execPath }).executablePath).toBe(process.execPath);
    expect(() => browserLaunchOptions({ CHROME_PATH: './missing-chrome' })).toThrow('absolute executable');
  });
  it('fails closed if the CI package no longer matches the browser install pin', () => {
    expect(() => verifyRuntimeVersion(PLAYWRIGHT_VERSION, { GITHUB_ACTIONS: 'true' })).not.toThrow();
    expect(() => verifyRuntimeVersion('0.0.0', { GITHUB_ACTIONS: 'true' })).toThrow('reviewed pin');
    expect(workflow).toContain(`playwright@${PLAYWRIGHT_VERSION}`);
  });
  it('installs the exact runtime browser and dependencies instead of runner Chrome', () => {
    expect(workflow).toContain('node "$PLAYWRIGHT_TEST_RUNTIME/node_modules/playwright/cli.js" install --with-deps --only-shell chromium');
    expect(workflow).toContain('PLAYWRIGHT_BROWSERS_PATH: ${{ runner.temp }}/ink-witness-browsers');
    expect(workflow).not.toContain('command -v google-chrome');
    expect(workflow).not.toContain('CHROME_PATH:');
    expect(workflow).not.toMatch(/continue-on-error|retry|retries/);
  });
  it('keeps all three real component suites and bounded allowlisted diagnostic artifacts', () => {
    for (const name of ['financial-controls', 'writer-security', 'chapter-books']) {
      expect(workflow).toContain(`node scripts/qa/${name}.cjs`);
      const source = readFileSync(new URL(`./${name}.cjs`, import.meta.url), 'utf8');
      expect(source).toContain('launchFixtureBrowser(output)');
      expect(source).toContain('recordFixtureFailure(output,');
      expect(workflow).toContain(`data/${name}-qa/*.json`);
      expect(workflow).toContain(`data/${name}-qa/*.png`);
    }
    expect(workflow).toContain('persist-credentials: false');
    expect(workflow).toContain('retention-days: 7');
    expect(workflow).not.toContain('secrets.');
    expect(workflow).not.toMatch(/path: \.[\r\n]|data\/\*\*|\.env/);
  });
});
