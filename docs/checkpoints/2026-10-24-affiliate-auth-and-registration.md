# Literary Circle: fresh affiliate sign-in and registration verification

Date: 24 October 2026 (Africa/Nairobi).
Phase: **staging verification / production release preparation**. Not a production rollout or completed audit.

## Source and build evidence

- Functional commit: `2ec54c91a423817fbef03ae52cf56d7ae060a949`, pushed to `feature/literary-circle-upgrade`.
- Full serial regression: **131 suites / 1,684 tests passed**, zero failures/timeouts (394.77 seconds).
- Focused final run: **7 suites / 247 tests passed**. Do not add these to the full-run total.
- Incremental TypeScript check: exit 0. Local Vite and server production builds: exit 0 (2,011 frontend modules; server bundle 1.3 MB).
- Existing valid `::highlight` optimizer warning and large frontend chunks remain visible; neither was suppressed or misrepresented as fixed.
- Protected Git-bound staging deployment **`dpl_5dvMhjtqz81yj5TvQNhBQNzKgFVz`** independently READY at the exact functional SHA.
- Immutable preview: `https://narrativesbyjake-pe09gexmu-ink-n-witness.vercel.app`.
- Stable branch alias remains `https://narrativesbyjake-git-feature-literary-circ-eed960-ink-n-witness.vercel.app`.
- Firebase remains the existing isolated Spark / STANDARD Johannesburg project `ink-witness-staging-20261024`. No project recreation, reseeding, billing change or production environment change.

## Changes in this checkpoint

1. Affiliate login resolves its shared reservation and account in one bounded read-only transaction, rather than requiring an account in a warm instance's startup directory. Missing legacy indexes use an exact query capped at two; mixed-case legacy records may use a candidate ID only after a fresh identity match. No cached password is trusted, no full directory scan or index rewrite occurs, and identity conflicts/outages fail closed with a controlled retryable error.
2. Login-time password upgrades compare the exact verified old hash/session generation and active status in a transaction. A concurrent writer reset, suspension or competing upgrade cannot be overwritten. Credential/session rotation and a redacted audit commit atomically. Existing writer reset behavior remains compatible; no existing account's password was reset for staging verification.
3. The read-only backup CLI now requires explicit project, database and nine-account count, verifies the initialized client's target before capture/publication, rejects ambiguous arguments/emulators/production relabeling, and redacts provider errors. Production read-only opt-in still grants no write capability. Staging migration guards remain unchanged.

## New-partner cloud rehearsal — verified complete

**17 real protected API → Firestore checks passed**, with `freshRegistration: true`, `fixtureSuspended: true`, zero production writes, zero live charges and zero live emails. Redacted assertions are in ignored `data/staging-new-affiliate-verification.json`.

- A new application returns pending approval with no authenticated session. Pending sign-in is denied; explicit writer approval succeeds.
- Approved sign-in by case-insensitive email succeeds with an HttpOnly, Secure, SameSite cookie and no JSON bearer disclosure.
- New-member onboarding appears without founding recognition. Progress commits and survives an independent refresh; extra client-supplied privilege fields cannot elevate membership.
- Complimentary published-library access works and real paid text unlocks with `AFFILIATE_COMPLIMENTARY`, without checkout.
- The affiliate cannot access writer controls. Sign-out revokes its shared session. Independent sign-in by referral code succeeds.
- The test account is left safely suspended, not deleted, retaining its non-founding identity and zero sales/commission earnings.
- The original nine **full profile documents** and every document in `affiliate_commissions`, `affiliate_payouts`, `transactions` and `affiliate_commission_outbox` are exactly unchanged across the rehearsal. This supplements the prior source-backup financial preservation comparison rather than replacing it.

The reviewed operator helper `work/firebase-tooling/verify-staging-new-affiliate.cjs` independently inspects Vercel deployment ID, project, READY state, source branch/SHA and non-production target before HTTP writes. It verifies the pinned source manifest digest, reads staging through its exact staging-only service account, and uses one clearly labelled create-only `.invalid` email fixture. Credentials stay private with restrictive ACLs. Audited suspension is attempted even if registration's response/private-file publication is interrupted; success requires independently confirmed suspension and preservation.

**Do not rerun the old exact-nine migration/seed/backup comparison after adding the test fixture.** Staging now intentionally contains ten affiliates: the original founding nine plus one suspended, non-founding test partner. The old `verify-protected-preview.cjs` writer-summary assertion and `verify-staging-money-preservation.cjs` total-account-count assertion also intentionally expect nine; do not blindly rerun them against this changed test database or loosen their evidence. Use a separately reviewed fixture-aware comparison for future checks. The migration's exact-nine guard must remain intact.

## Remaining release gates

- Browser/mobile interaction and visual QA still unverified: browser runtime initialization again fails before page access with `failed to write kernel assets: The system cannot find the path specified. (os error 3)`. No Deployment Protection bypass was disabled and no native Codex UI was automated.
- Remaining chapter journeys, reader-owned purchases/subscriptions, full referral-to-checkout attribution, provider refunds and email delivery require the remaining safe isolated checks. A sign-in by referral code is not proof of checkout attribution.
- A separately reviewed production release plan/apply path, fresh target-bound production backup/drift checks and auditable explicit approval of the backed-up nine are still required. Legacy active status alone is not approval.
- Production notification source/delivery transport and scheduling remain gated; no live notification cron/email was enabled.
- Paid/part-paid refunds and ambiguous historical active payouts remain fail-closed for writer reconciliation; do not silently rewrite financial history.
- Production affiliate/month index must be READY before activating any writer-approved automatic-tier policy. Draft proposed rates do not alter existing arrangements.
- No main merge, production migration/deployment or final custom-domain upgraded-flow verification occurred. Do not describe this upgrade or the audit as 100% complete.

## Resume pointers

- The functional commit and READY deployment above supersede the older `cbcc8e7` staging source for subsequent checks. The obsolete `ovj14rntx` CLI-upload preview is still invalid; do not use it.
- Deployment helper `work/firebase-tooling/deploy-git-staging-preview.cjs` is pinned to the new tested SHA. Update that pin only after verifying later functional changes.
- Private generated staging configuration, service-account key and test fixture credentials stay outside the app repository under `work/firebase-tooling/secrets`. Never print or commit them.
- The new helper's fixture manifest is `work/firebase-tooling/secrets/new-affiliate-fixture.json`. Replays reuse only that exact fixture, are reported as repeat rehearsals rather than fresh registration, and must again leave it suspended. Do not create more accounts or promote the test account to founding status.
- Original nine-account create-only migration and idempotent second apply are complete. Do not reseed/recreate the database, reset accounts or replay source production records.
