# CI browser-startup remediation — 28 October 2026

## Confirmed failure

- Screenshot: Literary Circle verification run #31, source `69a81f12a4108a15c17ce45433412dfd85787e2d`.
- Run: https://github.com/collinstinga/Ink-and-Witness-Narratives/actions/runs/40703856503
- Types, all 181 regression files / 2,744 tests, and frontend/server builds passed.
- Financial browser QA failed in `phase: launch`: runner `/usr/bin/google-chrome` did not establish the Playwright connection within 30 seconds. No browser assertion had run. Subsequent browser steps were skipped.
- The same source passed run #30; newer source `9167531` passed both #32 and #33. The screenshot is not evidence of a currently broken production deployment.
- DBus warnings occurred, but the logs do not establish them as the cause.

## Repair

The workflow pinned Playwright but forced the independently changing runner Chrome executable. CI now installs matching managed Chromium headless shell and OS dependencies using the exact pinned Playwright CLI. All steps share its isolated browser directory. CI rejects system-browser overrides; explicit local Chrome remains available for local compatibility checks.

Three fresh launch/render/close checks must all succeed before browser QA. These are not retries. All original mobile/desktop application assertions and timeouts remain unchanged. A failed browser suite still fails the job; the other independent suites can now collect their own results. `pipefail` preserves process errors through log capture.

Seven-day artifacts contain only allowlisted synthetic screenshots, JSON proofs and browser QA logs. No environment files, browser profiles, application database, source bundles or provider credentials are uploaded. The shared runtime records package/browser versions and launch timing, including startup failures.

## Verification / safe resumption

- Focused runtime and workflow-contract tests: 6 passed locally.
- Independent diff review: no blocking findings.
- CJS syntax checks: passed for the runtime and all three suites.
- Full exact-source GitHub suite and managed-browser checks must pass before advancing main. Record their run IDs in the release checkpoint outside the repository.
- This change is CI/test infrastructure only. Production application code, purchases, accounts, access permissions, M-PESA configuration and database contents are unchanged. No production rebuild or migration is required.

## Running locally

Set `PLAYWRIGHT_TEST_RUNTIME` to an absolute directory containing Playwright `1.62.1`. Use its CLI to install the matching browser:

```text
node <runtime>/node_modules/playwright/cli.js install --with-deps --only-shell chromium
node scripts/qa/browser-runtime.cjs
```

Keep `PLAYWRIGHT_BROWSERS_PATH` consistent between install and execution if set. Outside GitHub Actions only, an absolute existing `CHROME_PATH` can be supplied for additional local system-browser checks. Build the application CSS before running the three component suites.

This removes the identified unpinned-browser dependency; it does not promise that GitHub infrastructure or future application changes can never fail. Genuine failures must remain visible.
