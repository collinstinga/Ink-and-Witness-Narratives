# Literary Circle completion — verification checkpoint

## Updated evidence (27 October 2026)

This section supersedes the archived pre-integration plan below. Production is
still `cc169678fbf2dd4200c473512a5e5c8668a0fba1`; do not claim this candidate
has been released until its production deployment and custom domains are verified.

Integrated candidate `405241b12b4b06aecaf5b0a5b0c166e6ea013d76` passed GitHub
run 40474018040: 169 suites / 2,511 tests, all source types, frontend and server
builds. New mobile layout/source-refresh/double-tap safeguards and portable
synthetic browser QA are a subsequent revision and require fresh exact-source CI.

Completed implementation:

- Immutable externally confirmed refund/chargeback and known-cost corrections,
  wallet revision/idempotency/race protection, adjusted payout eligibility,
  retained original financial evidence and writer-only review controls.
- Bound signed referral-click evidence to verified commissions, coherent
  financial read-time reporting, protected and explicitly partial legacy
  customer/cohort coverage. No invented historic unique visitors or customers.
- Authenticated daily bounded notification scheduler, fixed-recipient temporary
  owner test with authentic Google identity, signed review, delivery receipt and
  consent gates. No general admin session, rates approval or live-send bypass.

Preservation evidence:

- Actual production remains Standard Firestore / Johannesburg / Spark.
- Private schema-9 backup captured all 23 datasets, nine affiliate profiles,
  12 commission records, one payout, 65 referral clicks and 99 audit entries.
  Manifest SHA-256:
  `eb03d1d3056be47be8f6e5f090e17e60819e64c84a301c2b23507c97a21b19d3`.
- Actual isolated staging financial rehearsal passed at 08:35 UTC, fixture
  prefix `fc_20261027_4d9e7e6f86e2`: revision race fencing, reservation baseline,
  payout recheck, exact replay, debt, compensating corrections, integer-cent
  costs, all pre-existing records and original nine profiles preserved.
  Synthetic fixtures retained for audit. No production writes/provider calls.
  This exercised the actual SDK service, not an authenticated HTTP writer save.
- Protected preview `dpl_5gTw4SfUvxEBZtPpQfGkP7uEh4gU` is READY at source405:
  actual isolated staging identity and four provider-off switches verified;
  public bootstrap 200/17 pieces, anonymous financial 401, operator404,
  anonymous scheduler401. No protection changes.

Remaining release gates: fresh browser/CI pass for the final UI safeguards;
staged production and live-domain checks; one approved owner email to
collinstinga@gmail.com with a real signed delivery receipt; cleanup and safe
redeployment of the temporary operator. Future-only advanced analytics capture
still requires protected production configuration and reviewed coverage marker.
No historic backfill, real charge/refund, customer announcement, new commission
structure approval or original-nine migration is authorized by these tests.

## Archived pre-integration plan (historical, not current runtime state)

Date: 27 October 2026, Africa/Nairobi.

## Honest current status

The user requested completion of the remaining affiliate email automation,
customer/attribution analytics and financial-adjustment/refund integration.
These are NOT complete or newly deployed. Three parallel workers reached the
account usage limit during read-only investigation, before changing files.
Do not misrepresent source review or earlier draft tests as this integration.

The existing core, guides, notification controls and performance fixes remain
live at `cc169678fbf2dd4200c473512a5e5c8668a0fba1`, deployment
`dpl_Dz85w3ZKTNVLZDP7PgSTGF52gvyM`, canonical www custom domain. The completed
release has 161 suites / 2,292 tests, types/builds, seven mobile checks and
independent Lighthouse evidence. Do not repeat that migration/release/testing.

## Workspace and preservation

- Continue in `work/Ink-and-Witness-performance`, local branch
  `feat/literary-circle-completion-20261026`, created from live cc16967.
- At this checkpoint only this documentation is new. No runtime implementation
  was changed in this continuation. No new production release was requested.
- Original `work/Ink-and-Witness-release-newsletter` is dirty and preserved.
  Its analytics/financial drafts are source material, not releasable bundles.
- Original notification drafts are superseded by the integrated notification
  implementation already on current main. Never copy them over the release.
- No cloud data, financial adjustment, payout, email, payment, credential,
  environment, commission-rate, account, grant or content changes were made.
- Do not rerun original-nine activation, identity reservations or old backups.

## Database evidence refreshed

Authenticated Firebase CLI15.34.1 production `firestore:databases:list` finished
successfully (owned session23873). Actual target is
`ink-and-witness-narratives/(default)`, `STANDARD`, `FIRESTORE_NATIVE`,
`africa-south1`, freeTier true. UID64b02511-5562-4067-b12a-66eb5584d06b.
CLI update-check warning is unrelated to the successful database metadata read.
The concurrent staging metadata command was interrupted through its exact owned
session96813 to reduce host contention; it is NOT a new passing staging probe.
Known established isolated target remains
`ink-witness-staging-20261024/(default)`; actual runtime binding and four
provider-off attestations must be rechecked before staging fixture writes.
AGENTS.md's older Firebase-project name is obsolete; never switch to it.

## Financial work — next concrete implementation

Read the complete preserved draft checkpoint
`../Ink-and-Witness-release-newsletter/docs/checkpoints/2026-10-26-affiliate-financial-adjustments.md`
and its service/tests. They have earlier focused62-test evidence, NOT evidence
of current full integration. Candidate still has no new financial module.

Required integration, as a single reviewed unit before exposure:

1. Reuse immutable adjustment/correction service and safe DTOs. Preserve original
   commission/payout/payment/access records. A recorded external refund is NOT
   an instruction or proof that the website transferred refund money.
2. `affiliateStore.requestPayout` around line2821: read additive wallet summary
   inside the same transaction before validation/writes. Use adjusted headroom
   for eligibility, but subtract payout reservations from the ORIGINAL balance,
   not the adjusted projection (otherwise the permanent overlay is deducted
   twice). Default requested amount may use adjusted available headroom.
3. `processPayout` around line2898: also read overlay in the confirmation
   transaction; verify reserved amount remains covered by original available
   plus reservation plus overlay. Preserve receipt uniqueness/allocation bounds.
   Cancelling/rejecting a payout must remain possible even when debt exists.
4. Fresh affiliate/admin dashboards must show adjusted available balance,
   separate adjustment/debt, unchanged historical earned/paid amounts. Never use
   warm startup balance as authoritative financial eligibility.
5. Exclude fully refunded purchases from prospective monthly qualification,
   without rewriting founding badges, lifetime achievements or historical rates.
6. Add writer-only origin-protected/no-store/limited routes and explicit review
   UI/API: exact source/current revision/real external reference/idempotency key,
   correction history and no provider/access-revocation claims. Bodies cannot
   choose actor, target DB, clock, affiliate debit or source payment amount.
7. Include all three new private collections in backup/restore planning before
   actual use. Independent review, race/preservation tests and isolated staging
   API verification required before release or production adjustments.

Existing exports to reuse:
`createAffiliateRefundAdjustment`, `reverseAffiliateRefundAdjustment`,
`recordAffiliateDirectCost`, `reverseAffiliateDirectCost`,
`readAffiliateAdjustmentWallet`, `readAffiliateDirectCostSummary`,
`projectAffiliateAdjustedAvailableBalance`,
`getAffiliateFinancialAdjustmentOverview`.

Wallet summary: revision/walletDeltaKes/refundAmountKes/adjustmentCount;
negativeBalancePolicy=offset_future_available_balance. Projection separates
availableBalanceKes, adjustmentDebtKes and walletAdjustmentKes. Summary reads
inside caller-owned transactions must retain read-before-write ordering. Add
proper actual-SDK-target mocks to tests; never weaken target validation to make
legacy mocks pass.

## Analytics work

Preserved drafts are seven analytics/UI/cohort files in the dirty original tree.
Read the committed buyer/click/financial snapshot modules already on current
main first; do not replace released guides in AffiliateDashboardModal.

Finish signed referral-session/click to verified-settlement binding, coherent
Firestore read-time watermark, protected customer acquisition/returning metrics
and scoped adjustment joins. No raw identities, HMACs, tokens or receipts in UI.
Do not invent historical unique customers or backfill financial records. Direct
later sessions without new referral must not inherit an old affiliate claim.

Net retained revenue after KNOWN direct costs is original scoped gross sales
minus refunded purchase amounts minus (earned commission minus clawbacks) minus
known recorded costs. Join by authoritative scoped transaction IDs, not the
adjustment entry's date. Never label unknown costs zero or call this net profit.

## Notification operational completion

Use CURRENT `affiliateNotificationRollout.ts`, Routes/Delivery/Runtime and
`../firebase-tooling/NOTIFICATION_CONTROLS_CHECKPOINT_20261026.md`; no original
draft overwrite. Existing Resend and M-Pesa must be reused, not reprovisioned.
Only approved controlled real email destination is collinstinga@gmail.com.

Required server configuration key NAMES (not values):

- AFFILIATE_NOTIFICATION_EVENT_MODE=production_held
- AFFILIATE_NOTIFICATION_DELIVERY_MODE=production_test first
- AFFILIATE_NOTIFICATION_PRODUCTION_BASE_URL=canonical www HTTPS origin
- AFFILIATE_NOTIFICATION_SIGNING_SECRET (dedicated independent secret)
- AFFILIATE_NOTIFICATION_TEST_RECIPIENT_SHA256 and server-only
  AFFILIATE_NOTIFICATION_TEST_RECIPIENT_EMAIL
- Existing RESEND_API_KEY, NEWSLETTER_FROM_EMAIL and RESEND_WEBHOOK_SECRET

No keys were generated/read back/set in this continuation. Presence/config
checks must not print values. Production/Preview secrets are not recoverable
through env pull; do not fabricate provider credentials or sessions.

Writer routes already exist at
`/api/admin/affiliates/notifications/rollout`, `/pause`, `/test`. Real writer
identity is server session role=admin plus actual normalized user email. Review
body has only expectedRevision/mode/durationDays/includeFoundingWelcome. Test
body must be empty; recipient is server owned. Test delivery ledger is separate
from affiliate messages. A successful provider response is only ACCEPTED, not
DELIVERED. A real raw-signature-verified delivery webhook, exact recipient and
same sender/provider fingerprint must pass before live review. No customer or
affiliate announcements during tests, no fake admin session, no consent bypass.

Root still needs to determine whether genuine authenticated owner CLI authority
can exercise the supported server-only test path with available credentials;
otherwise the actual writer must use the portal. No such owner test or approval
was performed. Existing runtime exposes bounded prepare/dispatch operations but
vercel.json currently contains no scheduled job. Add and test a genuine
server-authenticated scheduled entry point, after reviewing platform plan
limits, rather than a UI heartbeat or unauthenticated cron. Live dispatch still
requires a valid time-limited signed review and fresh eligibility/consent.

## Verification/continuation rules

- Read required skills fully in the next turn before implementation. Main read
  Firestore/Standard SDK+indexes, verification, env and deployments/CLI guidance
  this turn. Functions skill output was partially truncated and must be fully
  reread before scheduler work. Do not delegate skill interpretation.
- Host has severe memory pressure. Prefer cmd.exe/login:false for simple
  commands; run CLI, tests and builds serially. No heavy processes remain from
  this checkpoint. Do not repeat source browsing that this record settles.
- Full CI still targets the existing NON-deploying
  feature/literary-circle-upgrade branch. Do not push arbitrary feature branches
  that might inherit production environment through automatic previews.
- New exact-source full CI, genuine isolated staging binding/provider-off
  preservation checks, bounded own-session cleanup, staged production and final
  custom-domain verification are required for any new implementation release.
- Task remains unfinished; next work is INTEGRATION, not another core migration
  or an assertion that all optional features are already operational.
