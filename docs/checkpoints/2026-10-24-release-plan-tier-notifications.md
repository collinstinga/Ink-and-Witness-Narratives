# Literary Circle: release planning and monthly notification targeting

Date: 24–25 October 2026 (Africa/Nairobi). Working continuation of
`2026-10-24-affiliate-auth-and-registration.md`.

**Working checkpoint — do not infer completion or deployment.**
The previous verified functional deployment remains `2ec54c9` / protected
`dpl_5dvMhjtqz81yj5TvQNhBQNzKgFVz`. New source in this checkpoint is not yet
deployed. Functional source was committed and pushed as
`cbbe3a0429dac5fdc7b1b3c2cff77bc455bc9e06`. Remote main and production remain
unchanged. A following test-only correction is described below.

## Implemented and inspected

- Public referral validation now uses the existing fresh bounded identity resolver,
  explicit public metadata projection, no-store headers and the referral limiter.
  Redirect/click/checkout settlement paths were already authoritative and remain
  unchanged. Root's independent read confirmed this scope.
- Offline no-write release planner: new `scripts/literary-circle-release-plan*`
  files and `plan-literary-circle-release.ts`, package script
  `literary-circle:release:plan`. Exact original-nine cohort, source, backup and
  policy fingerprints; fixed 30-minute backup / 24-hour evidence freshness;
  explicit missing/blocked checks; provider/customer details redacted.
  Always `writeAuthorized: false`, empty write allowlist, no apply/sends/charges.
  UNC/device/URI/escape paths are rejected before I/O; local backup datasets
  reject links/junctions; evidence descriptor reads are capped at 65,537 bytes.
- New exact current Nairobi-month notification tier resolver with effective
  approved-policy history and canonical complete summaries. No commission scan,
  bootstrap, financial write or inference from stale stored tier IDs. Manual
  overrides retain precedence. Held intents pin qualification evidence; both
  delivery validations re-read/hash-match it, cancelling changed proofs.
- Default-off production source/delivery gates, scheduling and environment
  configuration remain untouched. No production notification service is claimed.
- Writer eligibility preview now uses one bounded read-only transaction (maximum
  200 accounts, explicit 201-record overflow), fresh policy and the same manual
  and canonical monthly evidence as the dispatcher. It returns aggregates only;
  admin/origin protections and all three no-store headers remain intact.
- TypeScript now excludes root generated/private artifacts, while retaining all
  application, script and test sources and `src/data`. The previous incremental
  cache contained minified `dist` bundles. A boundary regression test prevents
  their accidental inclusion again.

## Evidence so far

- Release-plan/file boundary tests: 2 suites / 62 passed.
- Focused notification/referral/planner batch: **13 suites / 416 passed**, zero
  failures/timeouts (246.96 seconds). This is not the old full-suite total.
- Independent source review found no P1/P2 in the canonical monthly resolver,
  read-before-write ordering or double delivery revalidation. Offline planner
  review findings (array status coercion, filesystem paths, bounded read race)
  were fixed and independently re-reviewed.
- Writer-preview/security/configuration tests: **3 suites / 78 passed**. These
  overlap the previous full suite; do not add them to an old full-suite total.
- Independent review found no P1/P2 in the bounded preview, aggregate response,
  canonical/manual parity, admin/origin/no-store boundaries or error redaction.
- Local full TypeScript execution did not finish. On 25 October the host measured
  **16 MB available RAM and approximately 3,940 page reads/second**. The exact
  task-owned checker was stopped under guarded PID/start-time checks; this is
  neither a successful type check nor an observed compiler failure. No user/app
  process was stopped. Avoid starting more memory-heavy local runners.
- A secret-free feature-branch CI workflow now checks types, the entire serial
  regression suite and frontend/server production builds on a clean runner.
  Dependencies use the existing frozen pnpm lockfile; only argon2/esbuild/sharp
  native build scripts are explicitly allowed. CI has read-only repository
  permissions, no credential persistence, no deploy step and no cloud secrets.
  Its result is pending until an actual pushed-commit run completes.
- No full regression/build/deployment of these new changes has completed yet.
- Actual CI run `40160597267` for `cbbe3a0` installed the frozen lockfile and
  native dependencies successfully, then caught one TypeScript error in a new
  test: Node's overloaded `readSync` mock inferred a three-element tuple while
  the test inspected the real five-argument call. Corrected the assertion to
  inspect a `readonly unknown[]`, enforce five actual arguments and a numeric
  0–65,537 read length, retaining a non-empty-call assertion. No production
  implementation or size limit was relaxed. Await the following commit's CI;
  the first run correctly skipped regression/build after the type failure.

## Actual offline production review

Operator helper `work/firebase-tooling/prepare-release-review.cjs` ran with
`--prepare-offline-review-only` (Node with `--import tsx`). It read the already
verified original schema-8 backup, not the intentionally changed staging DB.
It made **zero network calls and zero production writes**.

- Source application commit: `2ec54c91a423817fbef03ae52cf56d7ae060a949`.
- Plan SHA: `b3e344a210706dcab60fa0cb6f43305f8c24c3cec55250ac72e1e54da1c8f06b`.
- Original founding cohort SHA:
  `d1c67263f094f594e6d8b92b8a2c391a8cf789fd9d2cda3ddedb72360db35555`.
- Private/ignored local review directory:
  `data/release-reviews/review-2026-10-24T20-23-05-206Z-5f45ad`.
- Correctly blocked: original production backup too old for release; nine
  production accounts still need recorded owner-authorized approval; live drift
  fencing/apply and a tested production build remain pending. Actual existing
  staging registration/preservation evidence is recorded, not invented provider
  or browser proof. This historical-source plan is not a new-source release grant.

## Resume safely

- Preserve the current feature branch and all uncommitted scoped changes. Finish
  helper/route tests, TypeScript, regression/build and independent review before
  committing/deploying this source to protected staging.
- Staging intentionally has the original nine founders plus ONE suspended,
  non-founding test affiliate. Do not reseed, rerun exact-nine migration/count
  assertions or reset existing accounts. Earlier preservation evidence remains
  historical and intact.
- Production apply/approval/migration, actual provider email/payment confirmation,
  reader/subscription/chapter flows and browser/mobile QA remain separate gates.
  The M-Pesa client is live-only; do not use `live` in preview as a sandbox.
  No public fake-payment endpoint or manufactured confirmed payment is allowed.
- Browser automation's kernel-assets initialization failure is still unresolved;
  a 25 October documented recovery attempt returned the same missing-path error
  (`os error 3`). No visual verification is claimed. No production main
  merge/deploy occurred.
- Staging has no copied reader accounts/licenses/subscriptions. Transaction
  clones alone are not reader-library proof. The next narrow rehearsal must use
  real labelled staging registrations and writer-issued manual grant tokens,
  verify durable accounts, bind only the claiming reader, revoke only fixture
  grants and log out sessions. This proves manual ownership, not provider-paid
  or subscription activation. No writer subscription-grant route exists.
- Inspection found `store.createUser` publishing a cache/registration result
  before awaiting cloud persistence. **Still pending; no fix/test was written.**
  The two callers already await it. Safest next change: await create-only cloud
  persistence before cache publication/registration success, retain local-dev
  behavior, never overwrite users, test deferred commit/failure/duplicates.
  The assigned agent hit the account usage limit before making source changes.
- The proposed external manual-reader rehearsal helper was **not written or
  executed**; that agent also hit the account usage limit. Do not mistake its
  reviewed API plan above for actual test evidence.
- CI received a preliminary design review request, but the independent reviewer
  hit the account usage limit before returning a final CI review. The earlier
  independent preview/notification security reviews are complete and separate.
