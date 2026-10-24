# Full build: verified local implementation, staging preparation

Latest continuation: see `2026-10-24-staging-preservation-rehearsal.md`. It records the completed six source-review remediations, 127-suite/1,589-test pass, fresh schema-8 production read-only backup, real staging migration and verified repeat-apply preservation. The pending statements below describe the earlier checkpoint, not the latest state.

Date: 24 October 2026 (Africa/Nairobi).
Branch: `feature/literary-circle-upgrade`; prior committed baseline `b93adbb`.
This is not a production-deployment or final-audit-completion claim.

## Completed and verified locally

- Buyer analytics uses signed, server-only purchase evidence with bounded key rotation, identity-source separation and explicit incomplete-history coverage. No invented historical customer counts or financial backfill.
- Wallet/payout requests, reservations, partial settlement, cancellation and unpaid commission reversals are transactional with atomic audit creation. HTTP routes await commits. Paid history and lifetime earned balances are preserved. Explicit receipts, canonical global receipt claims and guarded terminal states prevent fabricated or duplicate settlement.
- Writer payout controls distinguish approval from independently confirmed payment. Profile edits cannot overwrite money fields. Startup never restores cloud affiliate, commission, payout, campaign, policy or audit records from local snapshots.
- All seven notification source types are wired to committed evidence or bounded scheduled-source discovery. Direct approved creation now receives the activation hook. Preparation never sends email.
- Delivery uses independent expiring staging review, exact project/database and sender/recipient pins, current transactional eligibility, leases, idempotency, bounded retries, dead letters, signed opt-out, suppression and verified webhook reconciliation. Release notices expire after seven days. Infrastructure outages are not misclassified as permanent ineligibility.
- Manual Writer Portal status/prepare/reviewed-dispatch operations expose safe bounded aggregates, no recipient identities, no polling or implicit sends. Admin authentication, cookie-origin checks, request allowlists, rate limiting and a separate constant-time cron secret protect entry points. No cron schedule was installed.
- Campaign and Literary Circle setting audits commit atomically. Backup schema **7** includes the complete delivery/runtime/suppression collection and its reviewed configuration. Old version-6 manifests are not relabelled or reused as version 7.

## Actual verification evidence

- Full serial Vitest run: **119 suites, 1498 tests passed**, zero failures/timeouts.
- Final integration rerun after the payout UI/status compatibility changes: **5 suites, 90 tests passed**, including two new HTTP tests that prove financial success waits for commit. These are not additional tests to add blindly to the full-run count.
- Separate Spark staging configuration regression: **1 suite, 2 tests passed**.
- Final incremental full TypeScript check: exit 0.
- Vite production frontend build: exit 0, 2008 modules transformed.
- Bundled Node production server build: exit 0.
- `git diff --check`: clean after normalizing only added lines in the historically mixed-line-ending store file.
- No live email, M-Pesa charge, migration, production write or deployment was performed by those tests. Provider/database activity in test logs is mocked.

Existing build warnings remain visible: large frontend chunks (WriterDashboard about 614 kB, index about 757 kB) and the CSS optimizer's unsupported-but-valid `::highlight` selector warning. They were not suppressed or replaced with invalid CSS.

## Firebase readiness and isolation

- Installed Firebase integration remains present. Its MCP commands were not exposed to this session; the missing `npx` launcher was not repaired by altering global PATH/plugin files.
- The official Firebase CLI **15.34.1** is cached in the outer workspace's `work/firebase-tooling`. A private interactive sign-in was completed and verified for **collinstinga@gmail.com**; no credential/code was pasted into chat or committed.
- Read-only project listing confirmed the old `divine-experience-pq6d2` and current `ink-and-witness-narratives` projects, with no pre-existing staging project.
- After explicit user approval, created **`ink-witness-staging-20261024`**, display name **Ink and Witness Staging**. The initial ampersand display name was rejected before creation; the valid-name retry succeeded.
- Enabled Firestore API in this new staging project only. Official billing check returned **billingEnabled: false**; no billing account was linked. Intended plan is Spark, not a paid/starter tier.
- Initial database listing after API enablement returned no databases. The subsequent create succeeded for `projects/ink-witness-staging-20261024/databases/(default)`: `databaseEdition=STANDARD`, `type=FIRESTORE_NATIVE`, `locationId=africa-south1` (verified available location display name Johannesburg), deletion protection enabled and point-in-time recovery disabled.
- The first rules/index deployment was refused because production's `comment_submission_locks.expiresAt` TTL cleanup requires billing. No billing was enabled. Added separate `firebase.staging.json` and `firestore.staging.indexes.json`, retaining all production composite indexes/exemptions but omitting TTL. Production files remain unchanged. The staging-only deploy then succeeded, released the deny-all client rules, and both comments indexes were independently verified **READY**. Billing was rechecked **false**, with no TTL configured. Application expiry checks remain authoritative; automatic cleanup is not exercised on Spark staging.
- Created the real Google-issued staging-only runtime identity `literary-staging-runtime@ink-witness-staging-20261024.iam.gserviceaccount.com`, granted only `roles/datastore.user` in staging. Its generated key is outside the application repository under ignored local tooling secrets, with inheritance removed and a user-only Windows ACL. No user OAuth token was exported as a server credential. Existing project IAM was not changed. Actual runtime authentication still needs verification.
- Both existing projects remain unchanged. No production account/financial documents have yet been captured in a new schema-7 backup, copied, migrated or validated against staging.

## Remaining release gates / limitations

1. Staging infrastructure provisioning is complete and verified: deny-all rules deployed, two required indexes READY, Standard edition, Johannesburg region, deletion protection and disabled billing. Do not recreate it or deploy production's TTL-enabled index file to Spark staging.
2. Verify the provisioned least-privilege staging runtime access and configure a protected preview without importing production payment/email secrets. Do not export user OAuth tokens into server deployment credentials or weaken staging tool guards to accept a wrong target.
3. Capture/verify a fresh schema-7 production read-only preservation backup under the explicit guard, then rehearse the reviewed founding migration against staging. Verify the actual affiliate count and financial/referral/purchase equality; do not assume the historical count of nine still holds.
4. Verify browser/mobile journeys and cloud transactions end-to-end, including complementary access vs permanent purchases, account boundaries, subscription/commission attribution, partial payouts, opt-out/webhooks/retries and denied ordinary-reader/admin paths. Use no live charges.
5. Production notification sending remains deliberately blocked. No automated scheduled delivery is enabled. A reviewed production-release gate and actual delivery verification are still required.
6. General automatic-monthly-tier notification targeting is unsupported and fails closed; explicit current manual tiers and verified tier-upgrade milestones work. See the dedicated tier-filter checkpoint. A future bounded materialized qualification projection is required before claiming this feature complete.
7. Paid/part-paid refunds and ambiguous legacy active payouts require writer-led reconciliation; the new wallet refuses silent repair or removal of previously disbursed money.
8. Merge/push/deploy only after these gates. No new main commit, Vercel deployment or custom-domain verification has occurred in this checkpoint.

## Additional independent release review (not yet remediated here)

- `updateAffiliate` still publishes profile/rate/payout-detail/terms activity patches before persistence and suppresses failures. Convert it and its callers to durable transactional updates with atomic audit publication.
- Financial dashboards still depend on startup per-instance commission/payout caches despite HTTP no-store. Add bounded authoritative refresh and explicit truncation/unavailability handling, preserving newer wallet revisions.
- Legacy summary totals/rankings include reversed/rejected commission rows. Keep the ledger intact, but base verified-sale performance on the canonical verified projection rather than all historical rows.
- Monthly tier pricing reads up to 10000 lifetime commissions on each sale and prices from known-incomplete history at its cap. Replace repeated scans with reviewed per-period qualification evidence; never silently misprice.
- Onboarding copy and first-three recommendations are not yet writer-curatable; settings currently expose only version/duration.
- Permanent affiliate deletion remains available even for financially linked accounts. Add reversible archival or a refusal for preserved financial/referral identities.

Resume here, not by reimplementing already-tested modules. Keep all notification/buyer gates off by default until reviewed isolated staging configuration is in place. Runtime audience/cursor/suppression documents are already covered by backup schema 7.
