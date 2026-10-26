import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Deliberately not configurable: never audit an account, checkout, affiliate
// link, arbitrary origin, or URL containing a token/query/hash.
export const PUBLIC_HOME = 'https://www.inkandwitness-narratives.co.ke/';
export const LIGHTHOUSE_VERSION = '13.5.0';
export const BLOCKED_REQUESTS = Object.freeze([
  '*/api/analytics*',
  '*/api/affiliates/track*',
  '*/api/affiliate/track*',
]);

export function lighthouseArgs(reportPath) {
  return [
    '--yes', `--package=lighthouse@${LIGHTHOUSE_VERSION}`, '--', 'lighthouse',
    PUBLIC_HOME,
    '--only-categories=performance', '--form-factor=mobile',
    '--throttling-method=simulate', '--output=json', `--output-path=${reportPath}`,
    '--chrome-flags=--headless --no-sandbox --disable-dev-shm-usage',
    ...BLOCKED_REQUESTS.map(pattern => `--blocked-url-patterns=${pattern}`),
    '--quiet',
  ];
}

export function entrypointFromHtml(html) {
  const match = html.match(/<script\b(?=[^>]*\btype=["']module["'])[^>]*\bsrc=["'](\/assets\/index-[\w-]+\.js)["']/i);
  if (!match) throw new Error('Public homepage did not contain a versioned module entrypoint.');
  return match[1];
}

function finiteMetric(report, id) {
  const value = report.audits?.[id]?.numericValue;
  if (!Number.isFinite(value)) throw new Error(`Missing Lighthouse metric: ${id}`);
  return value;
}

export function summarizeReport(report) {
  if (report.runtimeError) throw new Error(`Lighthouse failed: ${report.runtimeError.code}`);
  if (report.requestedUrl !== PUBLIC_HOME || report.finalDisplayedUrl !== PUBLIC_HOME) {
    throw new Error('Audit navigated away from the fixed public homepage.');
  }
  const score = report.categories?.performance?.score;
  if (!Number.isFinite(score)) throw new Error('Missing Lighthouse performance score.');
  return {
    fetchedAt: report.fetchTime,
    lighthouseVersion: report.lighthouseVersion,
    score: Math.round(score * 100),
    fcpMs: finiteMetric(report, 'first-contentful-paint'),
    lcpMs: finiteMetric(report, 'largest-contentful-paint'),
    cls: finiteMetric(report, 'cumulative-layout-shift'),
    tbtMs: finiteMetric(report, 'total-blocking-time'),
    speedIndexMs: finiteMetric(report, 'speed-index'),
    transferredBytes: finiteMetric(report, 'total-byte-weight'),
    warnings: report.runWarnings ?? [],
    opportunities: Object.entries(report.audits ?? {})
      .filter(([, audit]) => typeof audit.score === 'number' && audit.score < 1 &&
        (audit.details?.overallSavingsMs > 0 || audit.details?.overallSavingsBytes > 0 || audit.metricSavings))
      .map(([id, audit]) => ({ id, title: audit.title, displayValue: audit.displayValue,
        savingsMs: audit.details?.overallSavingsMs, savingsBytes: audit.details?.overallSavingsBytes,
        metricSavings: audit.metricSavings })),
    networkRequests: (report.audits?.['network-requests']?.details?.items ?? [])
      .map(item => ({ url: item.url, resourceType: item.resourceType, statusCode: item.statusCode,
        startTime: item.startTime, endTime: item.endTime, transferSize: item.transferSize })),
  };
}

export function median(values) {
  if (values.length === 0 || values.some(value => !Number.isFinite(value))) {
    throw new Error('Median requires finite measurements.');
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

async function readEntrypoint() {
  const response = await fetch(PUBLIC_HOME, {
    headers: { accept: 'text/html' }, cache: 'no-store', redirect: 'error',
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) {
    throw new Error('Cannot establish the current public homepage version.');
  }
  const html = await response.text();
  if (html.length > 512_000) throw new Error('Unexpected public homepage size.');
  return entrypointFromHtml(html);
}

async function runLighthouse(reportPath) {
  // Isolated, pinned CLI installation; does not install/change app dependencies.
  await new Promise((resolve, reject) => {
    const child = spawn('npx', lighthouseArgs(reportPath), {
      stdio: 'inherit', shell: false, timeout: 240_000,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve() :
      reject(new Error(`Lighthouse exited ${code ?? signal}.`)));
  });
}

export async function main() {
  const reportsDirectory = path.resolve('performance-reports');
  await mkdir(reportsDirectory, { recursive: true });
  const entrypoint = await readEntrypoint();
  const runs = [];
  for (let index = 1; index <= 3; index += 1) {
    const reportPath = path.join(reportsDirectory, `mobile-${index}.json`);
    await runLighthouse(reportPath);
    const summary = summarizeReport(JSON.parse(await readFile(reportPath, 'utf8')));
    if (await readEntrypoint() !== entrypoint) {
      throw new Error('Production changed during the audit; do not compare these measurements.');
    }
    runs.push(summary);
    console.log(`MOBILE_RUN_${index} ${JSON.stringify(summary)}`);
  }
  const medianMetrics = Object.fromEntries(
    ['score', 'fcpMs', 'lcpMs', 'cls', 'tbtMs', 'speedIndexMs', 'transferredBytes']
      .map(key => [key, median(runs.map(run => run[key]))]),
  );
  const result = { target: PUBLIC_HOME, entrypoint, auditSourceCommit: process.env.GITHUB_SHA ?? null,
    analyticsRequestsBlocked: BLOCKED_REQUESTS, method: 'Lighthouse mobile simulated throttling; three fresh browser runs',
    median: medianMetrics, runs };
  await writeFile(path.join(reportsDirectory, 'summary.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(`MOBILE_AUDIT_SUMMARY ${JSON.stringify(result)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
