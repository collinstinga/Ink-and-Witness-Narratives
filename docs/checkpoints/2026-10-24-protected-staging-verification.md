# Literary Circle: protected staging verified, production release still gated

Date: 24 October 2026 (Africa/Nairobi).
Current phase: **staging verification / production release preparation**, not a completed production rollout or final security assessment.

## Verified source and deployment

- Functional source commit: `cbcc8e7cd6f0453de0c084610833a5cf061a64be` on the pushed `feature/literary-circle-upgrade` branch. This checkpoint is a later documentation-only continuation.
- Prior source hardening/rehearsal commit: `09a3d52`; earlier tested foundation: `e70e685`.
- Protected Git-bound Preview deployment: **`dpl_7gxKUWUgr5sgzB24c6KNUShnUCQD`**, independently READY, pinned to the above SHA.
- Immutable URL: `https://narrativesbyjake-kp7nwhqrm-ink-n-witness.vercel.app`.
- Branch/canonical staging URL: `https://narrativesbyjake-git-feature-literary-circ-eed960-ink-n-witness.vercel.app`.
- Firebase: `ink-witness-staging-20261024`, STANDARD `(default)`, Johannesburg, Spark/billing disabled. All **three** required composite indexes independently verified READY. Deny-all client rules remain deployed.
- Exactly 39 branch-scoped Preview variables were provisioned. The real staging-only service account and independent random secrets are used; inherited live payment/email/AI keys are explicitly empty. Payment network, newsletter sending and partner-notification preparation/delivery are off. No production-scoped env variable was modified.
- `APP_URL` was corrected to Vercel's actual shortened branch alias before the final Git-bound deployment. Do not replace it with the initially guessed overlong alias.
- Automatic deployment is disabled **only for this feature branch**. Main and other branch defaults remain unchanged. Manual Git-bound deployments work.

## Build / unit verification

- Full serial run: **127 suites / 1,589 tests passed**, zero failures/timeouts.
- Separate configuration/routing run: **3 suites / 6 tests passed**, including two newly added packaging/isolation tests; these are not blindly added to the full-run total.
- Packaging guard rerun after the cloud-build correction: **1 suite / 2 tests passed**.
- Final incremental TypeScript check: exit 0. Local frontend and server production builds: exit 0. Final cloud build: succeeded / READY.
- Known CSS optimizer `::highlight` and large-chunk warnings remain visible. No invalid CSS workaround or warning suppression was introduced.

## Real API → Firestore verification (not mocked)

Protected deployment access used the authenticated Vercel CLI, without disabling protection or exposing session/provider secrets. Cookies/passwords travelled in a private subprocess input stream, not shell arguments or chat output.

**20 access checks passed**, including:

- Frontend and public catalogue load; anonymous writer controls and affiliate library return 401.
- A real paid source piece is masked for an anonymous reader (`content === ''`).
- Approved affiliate library contains exactly the public catalogue; a paid body's server response unlocks with `AFFILIATE_COMPLIMENTARY`.
- Affiliate session cannot open writer financial controls; founding badge appears; dashboard responses are no-store.
- Independently provisioned staging writer login succeeds with an HttpOnly cookie; current writer summary loads and is no-store.
- Writer suspension of complimentary privileges immediately denies library access and masks paid text on a warm instance. Reactivation succeeds and the library is available again. The test account was not left suspended.

**11 writer persistence checks passed**, including:

- A changed payout minimum commits, survives an independent writer-summary request, and is seen by a separate affiliate payout-settings request.
- The staging payout minimum is restored to its pre-test value.
- Writer welcome/upgrade copy and three published recommendations commit and survive an independent refresh; the affiliate receives the same saved copy and recommendation IDs.
- Onboarding-only changes do not activate or version-bump the draft commission policy. Pre-test onboarding content is restored.

Private redacted assertion reports are in ignored `data/protected-preview-verification.json` and `data/staging-writer-settings-verification.json`.

## Preservation and controlled staging changes

- The schema-8 production read-only source backup and nine-account staging migration/repeat-apply evidence remain exactly as recorded in `2026-10-24-staging-preservation-rehearsal.md`. Do not recapture/relabel an old backup to bypass guards.
- Source production cohort has **9 active legacy accounts and zero explicit `approvedAt`/`approvedBy` records**. Active status alone was not silently treated as writer approval.
- After the exact migration-preservation comparison and repeat apply passed, the owner-authorized original nine were explicitly approved **in staging only**, through the existing transactional audited approval function. Their passwords were not reset. The staging programme was enabled while its financial policy stayed draft.
- A private one-hour staging affiliate session was minted using the actual server session function for controlled API checks. Production sessions/credentials were not exported, altered or used as preview runtime credentials.
- Post-check read-only comparison independently confirms **all commission documents unchanged, all payout documents unchanged, all nine accounts' monetary/counter/rate fields unchanged, and all referral identities/emails/password hashes unchanged** against the source backup. Complimentary reads did not mint financial records or consume wallet balances.
- Staging now intentionally contains additive membership/approval/settings/audit/session evidence from these checks. Do not claim it is still a byte-for-byte pristine clone outside the specifically verified historical/financial fields.
- **No production writes, production migration, main merge, live payment charge or live email send** occurred. Remote main remains `f51df2dfb131249728db4023d93760d52c739a0c`. The public custom-domain catalogue was checked read-only: HTTP 200 with 17 public pieces.

## Cloud issues found and resolved

1. The first cloud build exposed `.vercelignore`'s unanchored `data/` excluding tracked `src/data/affiliateTerms.ts`. Exclusions are now root-anchored (`/data/`, etc.), with regression coverage. Backups/secrets remain excluded; the cloud build now succeeds.
2. A plain CLI upload recorded generic Git metadata but did not select the branch-specific staging credential. API failed closed with 503 rather than connecting to another database. Deploy through the explicit GitHub `gitSource` branch + pinned SHA; the final deployment's real Firestore/API checks pass. Do not broaden the preview credential scope to work around this.

## Outstanding / unverified release gates

1. **Actual browser/mobile interaction and visual verification is blocked by the local automation runtime**, not account permission: both Browser Use and the documented Windows Computer Use initialization fail before browser/window access with `failed to write kernel assets: The system cannot find the path specified. (os error 3)`. Browser reset/retry and the documented independent initialization path were attempted. No app security settings or Deployment Protection were weakened. Native Codex UI was not automated.
2. Actual new-affiliate registration/onboarding, chapter journeys, reader-owned purchases/subscriptions, checkout attribution and provider refund/delivery flows still need the remaining isolated end-to-end rehearsal; unit coverage is not falsely reported as those cloud/browser journeys.
3. Production founding migration/explicit writer-approval enablement must use a separately reviewed guarded production path after final staging. The existing apply utility remains deliberately staging-only; do not bypass it, export user OAuth as runtime credentials, infer approval from legacy active status, or silently switch rate policies.
4. Production partner-notification delivery remains blocked. Reviewed staging-only transport, production release gating/scheduling and general automatic-monthly-tier audience targeting are not a completed production notification service. No cron schedule is installed and no test email was sent in this checkpoint.
5. Paid/part-paid refunds and ambiguous legacy active payouts remain fail-closed for auditable writer reconciliation. No silent repair or financial-history rewrite is allowed.
6. Deploy the new production affiliate/month index before enabling any approved automatic-tier policy. Existing rates stay in force until the writer explicitly activates a new policy.
7. Production merge/deploy and final custom-domain upgraded-flow verification have **not** happened. Do not report the upgrade/audit as 100% complete from these passing checks alone.

## Resume without redoing completed work

- Preserve the pushed feature branch, the verified source/staging manifests and private generated staging credentials. No fresh Firebase/Vercel login is needed unless the official CLI reports expiry.
- The real schema-8 backup, create-only seed, nine-account migration and idempotent second apply are complete. Do not recreate the project, rerun destructive restoration, re-seed a changed staging database or reset existing passwords.
- Operator helpers are outside the app repo under `work/firebase-tooling`. The deployment helper is pinned to the verified functional SHA; review/update that pin only after testing any subsequent functional commit.
- Access/persistence helpers are `verify-protected-preview.cjs`, `verify-staging-writer-settings.cjs`, and read-only `verify-staging-money-preservation.cjs`. The short-lived private affiliate test session may need refresh using the guarded staging-only access helper; never paste its contents into chat.
- Start at the remaining browser/runtime and production-release gates above. Existing user authorization covers routine implementation; do not ask for the same approvals or reconnects again.
