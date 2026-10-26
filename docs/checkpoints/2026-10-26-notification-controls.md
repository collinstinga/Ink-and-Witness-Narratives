# CP-LC-NOTIFY-01 — production notification controls

## Preservation and release boundary

Worktree: `work/Ink-and-Witness-notification-release`.
Branch: `fix/notification-controls-20261026`, based on released guide source
`e8edad9cbbee74f83f07c5693a2fc5fe7e443046`.

This integrates only the isolated notification draft plus its writer controls,
request boundaries and tests. The original dirty analytics/financial drafts in
`work/Ink-and-Witness-release-newsletter` remain untouched and excluded.
No historical commissions, wallets, purchases, licences, referral identities,
reader accounts or existing affiliate approval were changed. No migration was
rerun. No production flags/configuration were changed, no provider request or
real email was sent, and no live payment was initiated.

The existing production database was reconfirmed with the authenticated official
CLI: `ink-and-witness-narratives/(default)`, STANDARD, FIRESTORE_NATIVE,
africa-south1, freeTier true. Initial CMD quoting passed literal quotes around
the ID and returned 400; corrected PowerShell argument passing returned success.
This was metadata only, not a data/schema write. No new database was created.

## Implemented

- Server-owned, signed, time-limited review of exact saved templates, provider
  account/sender, actual bound production SDK and canonical origin; default off.
- Separate owner-allowlisted test delivery. Provider acceptance is not delivery;
  initial live review requires the matching signed delivered receipt.
- Four exact writer-authenticated, rate-limited, no-store endpoints for status,
  review, pause and controlled test. Bodies cannot select recipients, actor,
  source, server clock, environment or transport. Revision conflicts do not retry.
- Existing raw webhook signature verification retained before partner routing;
  production test/live reconciliation joins the same signed endpoint.
- Severe owner-test outcomes now also suppress the correctly indexed newsletter
  subscriber, preserving unrelated fields. Wrong identity/index never mutates
  a different subscriber; replay cannot undo suppression.
- Scheduled preparation is review-bound at its shared source resolver, including
  transactional revalidation. Direct scheduler calls cannot bypass test-only,
  pause, review-edit or expiry restrictions. Removed redundant wrapper reads.
- Bounded production recovery of prospective commissions and tier evidence.
  Failed records stop a page before cursor advancement; edited/deleted timestamp
  anchors fail closed. Equal timestamps use the document-name tie-break.
- Recovery deliberately cycles within the limited review activation window to
  catch late commits: createdAt is NOT a durable commit watermark. Each query
  reads at most six commissions and prepares at most five. Deterministic intents
  prevent repeat emails; no claim of zero repeated reads or complete change-feed
  coverage. This is not the separate analytics-watermark implementation.
- Writer controls distinguish server capability, signed review and delivery
  status; explicit confirmation for review/test/pause and production dispatch.
  No automatic approval/sending, no background polling, no automatic mutation
  retry. Failed/ambiguous responses lock actions until manual status refresh.
- Repeated test clicks are guarded, and any existing test-attempt status disables
  another attempt for that review. Server idempotency remains authoritative.
- Unsaved parent fields and review choices survive refresh. Parent pending
  template edits disable actions. Permanent writer help explains the new controls.

## Evidence so far

- Initial eleven focused suites: **288/288 passed**.
- Added real-signature/mocked-transport and recovery checks; latest four focused
  suites: **185/185 passed**, including signed test receipt → signed live review
  → prospective ordinary delivery exactly once, pause races, preservation,
  bounded pages, failed-record retry and late-commit catch-up.
- Full semantic TypeScript passed after correcting review-union narrowing and
  explicit client-safe environment mode typing. Final full-source recheck still
  required after the last additional test/UI changes.
- Real isolated headless Chrome fixtures: **10/10** mobile/desktop checks passed
  before the final attempt-button disabling refinement. Actual React StrictMode
  controls and API client, synthetic same-origin responses, no real accounts or
  providers. Screenshot reviewed. Recheck that final refinement before release.
- No mutation from page loading, explicit confirmation/cancellation, exact
  request bodies, duplicate-click guard, acceptance versus delivered receipt,
  pause, conflict/manual-refresh lock and unchanged unsaved parent tested.
- Full serial regression: **152 suites / 2,167 tests passed**, exit 0; 275.96
  seconds including local import/transform overhead. Final browser refinement
  rerun also passed **10/10** checks on both widths with zero real provider calls,
  cloud writes or real sessions. Own fixture server stopped afterward.
  Browser fixture files are ignored local `data/` and the helper is external
  tooling; do not include either in a deployment upload.

## Remaining release gates

1. Retrieve actual full regression result; fix any failures, then final whole-
   project types/build. Do not relax tests or hide timeouts.
2. Rerun final browser refinement, save exact source and remote CI evidence.
3. Only push the reviewed candidate to the existing guarded feature branch for
   CI; main still serves the verified guide release until all release checks.
4. Isolated preview must use the existing protected, branch-scoped staging SDK
   and all provider-off controls. Verify its actual runtime attestation first.
5. Before any promotion: exact-source CI, staged production read-only/source/
   alias fences, new unauthenticated endpoint boundaries, guide assets and
   preserved production M-Pesa configuration. Do not promote a preview build.
6. This candidate alone does NOT enable automated emails. Controlled owner-only
   delivery proof, provider webhook verification, explicit valid review and
   operational scheduling remain separate gates. Approved real test address is
   only `collinstinga@gmail.com`; no real email was sent during this work.

Core activation is already complete under durable marker
`literary-circle-production-core-v1`. Never repeat registration, identity
seeding, original-nine migration, rate activation or historical recalculation.
Original analytics and financial adjustment drafts remain separate follow-ups.
