# Literary Circle: clean CI and protected staging

Date: 25 October 2026 (Africa/Nairobi).
Phase: **staging verification / production release preparation**.
This is not a production rollout or final-audit completion claim.

## Exact source and build evidence

- Functional source: `b609e02763de76fe0eede5f1557a75050a6999e7`, pushed to
  `feature/literary-circle-upgrade`. It includes `cbbe3a0` plus the corrected
  bounded file-read test assertion. No unrelated runtime change was included.
- Clean Ubuntu CI run: `40160732880`, job `121071540635`, **success**.
  https://github.com/collinstinga/Ink-and-Witness-Narratives/actions/runs/40160732880
- Frozen pnpm install/native builds, full TypeScript, **136 suites / 1,830 tests**,
  frontend build and bundled Node server build all passed. Regression duration
  40.49 seconds; Vite transformed 2,011 modules and built in 3.57 seconds.
- The existing `::highlight` CSS optimizer and large frontend-chunk warnings
  remain visible. They were not suppressed or represented as resolved.
- Initial CI `40160597267` correctly failed on one new test's overloaded Node
  `readSync` tuple type. The correction retains the bounded-read assertion;
  no compiler suppression, production read-limit change or skipped test was used.
- CI has no payment/email/cloud credentials, deploy step, write permissions or
  persisted checkout credentials. It uses pinned action commits, Node 24.22.1,
  pnpm 10.30.0 and the existing frozen lockfile. Native-script allowlist:
  argon2, esbuild and sharp only.

## Protected staging deployment

- Deployment: `dpl_GS54pkq5MMuABRXBf4STiP58r2ht`, independently **READY** at
  exact source `b609e02763de76fe0eede5f1557a75050a6999e7` and feature branch.
- Immutable URL: https://narrativesbyjake-imln1ogiq-ink-n-witness.vercel.app
- Project: `prj_eVEYMHGsvNlI7lngUcdBIw245qf4`; team:
  `team_Zx7GUIRM3lVN5UpUF3VjxvOg`. Git-bound Preview, not production.
- Existing branch-scoped isolated credentials and disabled provider gates were
  retained. No production environment/domain/IAM/billing settings changed.
- Fresh GitHub main inspection still returned
  `f51df2dfb131249728db4023d93760d52c739a0c`.

## Actual cloud rehearsal completed

- **21 real protected-staging API/preservation checks passed**, exit 0, against
  the exact independently inspected deployment above. This is separate from
  the 1,830 mocked/local CI regression tests, not an additional full-suite total.
- Real writer sign-in and bounded aggregate-only notification eligibility
  returned the fresh ten-account audience without partner identities/no-store
  regression. No email intent or delivery operation was requested.
- Both public referral aliases agreed with current committed fixture state,
  reflected reactivation after a warm prior validation and immediately rejected
  suspension. Case-insensitive email/code sign-in, secure HttpOnly cookies,
  complimentary paid-body access, writer-role denial, onboarding persistence,
  no founding-badge escalation and logout revocation passed again.
- Existing labelled non-founding fixture was reused: **freshRegistration false**.
  Do not claim this rerun created a new account. It was left safely **suspended,
  not deleted**, with zero sales/earnings and no founding recognition.
- Original nine complete affiliate profiles and all staged commission, payout,
  transaction and commission-outbox records compared **exactly unchanged**
  before/after. Staging intentionally retains ten affiliates (nine founders and
  one suspended fixture); do not loosen or rerun exact-nine migration guards.
- Versioned private/ignored report (previous original report preserved):
  `data/staging-new-affiliate-verification-b609e02763de76fe0eede5f1557a75050a6999e7.json`.
  Source commit and deployment ID are embedded in it. External operator helper:
  `work/firebase-tooling/verify-staging-new-affiliate.cjs`.
- **Zero production writes, live payment charges or live emails.**

## What this source improves

- Public referral validation reads current identity/status/link permissions and
  current settings, returns only allowlisted metadata, uses no-store headers and
  rate limiting, and fails safely on provider outages.
- Writer notification eligibility uses one bounded read-only snapshot, maximum
  200 affiliates and explicit overflow. It agrees with manual/canonical monthly
  targeting and returns aggregates only.
- Automatic monthly targeting requires complete current Nairobi-month summaries
  and effective approved policy. Held intent hashes are revalidated twice before
  delivery; changed/missing evidence cancels or holds, never defaults to zero.
- Offline production release planner is deliberately **not an apply tool**:
  exact source/original cohort/backup/policy pins, freshness checks and redacted
  evidence. Always no writes, sends or charges. Existing production gates remain.
- Full details, planner hashes and prior preservation proof remain in
  `2026-10-24-release-plan-tier-notifications.md`; do not relabel the old backup.

## Remaining gates and safe resumption

1. Reader registration durability: `store.createUser` still publishes a cached
   user before awaiting cloud persistence. No fix was written before agent usage
   limits. Both callers await it. Next: create-only durable cloud commit before
   cache publication, preserve local-dev behavior/existing identities, and test
   delayed commit, failure, duplicate identity and local fallback.
2. No manual-reader rehearsal helper was created. Use real labelled staging
   registrations, independently verify persisted account identity, issue genuine
   writer grant tokens, prove reader A ownership and reader B denial, persist
   chapter/progress, revoke only fixture grants and log out sessions. No reader
   suspend/delete route exists; retain dormant labelled test accounts.
3. Staging copies contain articles and affiliate transaction history, not reader
   accounts/licenses/subscriptions. Manual grants are not evidence of paid or
   subscription activation. No writer subscription-grant route exists.
4. Actual provider email/payment/refund and paid subscription/reader journeys
   remain unverified. M-Pesa is live-only; never set live mode in Preview as a
   sandbox, fake confirmation, charge a phone or send unsolicited customer mail.
5. Reviewed production apply/drift fencing/original-cohort approval, fresh
   production backup, tested production build before domain promotion and
   production notification/canary authorization remain pending. Preserve existing
   rates and paid history; do not run staging migration guards against production.
6. Browser/mobile verification remains blocked: the documented 25 October browser
   recovery failed with kernel-assets missing-path `os error 3`. Do not automate
   Codex UI or weaken deployment protection. No visual pass is claimed.

Local available RAM measured 16 MB with approximately 3,940 page reads/second.
Only the exact task-owned type checker was stopped; no user/app process was
terminated. Avoid heavy local runners. Independent notification/preview security
reviews completed without P1/P2 findings; later agents hit account usage limits
before registration/helper/CI-review work. Do not treat those as completed.

Resume from this file and the pinned successful CI result, not by rebuilding the
earlier nine-account migration or rerunning old full suites without source
changes. External deployment helper is now pinned to `b609e02`. The existing
staging fixture is reusable; its new verification helper preserves the previous
report and writes a source-SHA-specific report instead. No new approval or
credential reconnection is needed merely to continue the authorized staging work.
The checkpoint follow-up is documentation only and uses `[skip ci]`; no runtime,
test, dependency or deployment input changed after the successful pinned build.
