# Ink & Witness Publishing Platform Upgrade

Date: 2026-09-23 (Africa/Nairobi)

## Production baseline

- Baseline commit before this upgrade: `59dabe1bb1bcaaaf1dc193d6243e6cc93684992f`.
- Firestore remains the production source of truth. Existing collections and document IDs must not be reset or replaced.
- Existing standalone pieces, reader licenses/libraries, transactions, affiliate accounts, commissions, wallet balances, homepage settings, media, routes, and payment callbacks remain backward compatible.
- New schemas are additive. Any migration must be idempotent, resumable, and safe to run more than once.
- No production write migration is allowed until its dry-run report, rollback path, and verification checks have passed.

## Delivery stages

### UP-01 — Discovery and compatibility map

Status: complete

- Inventory current Firestore collections, transaction settlement paths, reader entitlements, affiliate attribution, editor format, homepage configuration, categories/topics, and authentication boundaries.
- Record data invariants and introduce shared types without mutating production data.

Checkpoint: repository builds and all existing tests pass with no production data writes.

Completed locally: current collection/payment/access/editor/homepage/auth boundaries were mapped; compatibility invariants and additive newsletter/sales types were recorded. No production data was written.

### UP-02 — Newsletter and reader retention

Status: foundation complete; release integration deferred to UP-04/UP-06

- Add consent-based subscriber records with unique normalized-email index, interests, work follows, status, timestamps, and signed unsubscribe flow.
- Add writer-only subscriber search, segmentation, composition, preview, test-send, resumable campaign sending, and delivery history.
- Add explicit opt-in controls for piece/chapter release notifications. Publishing never emails by default.
- Keep provider credentials server-side. Use a durable provider adapter and idempotency keys.

Checkpoint: subscription/unsubscribe security tests, campaign idempotency tests, UI tests, provider-disabled behavior, and no-email-without-explicit-opt-in test.

Completed locally: double-opt-in subscriber storage, signed unsubscribe, server-only Resend adapter, writer subscriber/campaign UI, audience segmentation, preview/test send, deterministic delivery records, resumable sending, and provider-disabled public signup. Remaining release integration: explicit piece/chapter release notification controls in UP-04; provider webhook outcomes and production provider/domain configuration in UP-06.

### UP-03 — Canonical sales intelligence

Status: complete locally; production backfill/release deferred to UP-06

- Enrich the existing permanent transaction ledger instead of creating competing counters.
- Add a stable unique sale/order ID per confirmed purchase and immutable buyer/piece/payment/affiliate snapshots.
- Derive writer sales, affiliate sales, commissions, wallets, and analytics from the same confirmed purchase records.
- Add a dry-run/backfill migration for historical confirmed purchases.

Checkpoint: M-Pesa, bank, manual confirmation, reader unlock, affiliate attribution, and idempotent retry tests all pass.

Completed locally:

- New and deliberately updated payment records receive additive schema-v2 metadata: stable non-phone order ID, method, direct/affiliate channel, buyer snapshot, and settlement time.
- M-Pesa success atomically commits the payment, hashed receipt claim, reader access, piece counter, and affiliate reconciliation outbox. Provider-confirmed phones receive a verification timestamp.
- Writer bank confirmation is atomic and idempotent; concurrent retries create one license, duplicate receipts are rejected, failed commits grant no access, and settled payments cannot later be rejected.
- Writer Sales now provides buyer/piece/payment/affiliate visibility, direct-versus-affiliate and commission metrics, search, piece/status/method/channel/date filters, clickable piece history, and a private CSV export. Export cells are formula-neutralized.
- Affiliate dashboards show per-sale piece, date, amount, commission, order ID, and status through an explicit privacy allow-list. Phone-shaped legacy transaction identifiers are never exposed as affiliate order IDs.
- `scripts/backfill-sales-ledger.ts` provides a dry-run-by-default, additive historical backfill. Apply mode requires an exact `--expected-project` match, scans the full collection, refuses duplicate order IDs or invalid plans, skips seed data, and never changes existing document IDs or canonical payment fields.

Production state: the code is included in the 2026-09-23 safe release candidate. The backfill tool has **not** been run and no Firestore records were modified by this stage.

## Verified local checkpoint — canonical sales intelligence

- Full automated suite: 399/399 passed across 42 files.
- TypeScript: passed (`tsc --noEmit`).
- Production client build: passed (Vite; existing large-chunk advisory only).
- Production server bundle: passed (esbuild).
- Diff integrity: `git diff --check` passed (line-ending warnings only).
- React review: writer and affiliate changes passed the hooks, derived-state, accessibility, typing, and rendering checklist after memoizing summaries and labeling interactive controls.
- Migration safety: dry-run tool implemented and unit-tested; production dry run/apply intentionally deferred until the UP-06 snapshot and release gate.

### UP-04 — Chaptered publishing and editor reliability

Status: pending; additive schema checkpoint intentionally excluded from this release

- Preserve every existing article as a standalone work by default.
- Add parent-work/child-chapter records, draft/publish/schedule/reorder operations, reader table of contents, direct chapter URLs, and work-follow notifications.
- Replace fragile rich-text command handling with selection-safe formatting and verify round-trip persistence/rendering.

Checkpoint: legacy standalone URL tests, chapter CRUD/reorder/access tests, and rich-text selection/persistence tests pass.

Completed locally: safe shared Markdown rendering plus selection-aware bold/italic/headings/quotes/lists/links in writer preview and reader view. Existing content stays Markdown and raw HTML is not rendered. Remaining: chaptered work schema/routes/editor/table of contents and full control round-trip verification.

An additive chapter-schema checkpoint exists on branch `fix/homepage-manual-grant-piece-scope-2026-09-16` at commit `84f1df5`. It is intentionally excluded from production until its routes, editor workflow, reader table of contents, access controls, and regression tests are complete.

## Verified local checkpoint — newsletter/editor foundation

- TypeScript: passed (`tsc --noEmit`).
- Focused tests: 38/38 passed across newsletter security/provider/store, canonical sales helper, safe Markdown rendering, and editor formatting.
- Production build: Vite client and bundled server passed.
- Diff integrity: `git diff --check` passed (line-ending warnings only).
- Deployment/provider state: included in the safe release candidate; no Firestore migration or production newsletter writes were performed. Newsletter remains disabled unless server-side provider variables are configured.

## Affiliate payout threshold durability hotfix

Status: complete and included in the safe release candidate

- The writer portal accepts whole-number payout thresholds from KES 1 through KES 10,000,000.
- Background affiliate-summary refreshes cannot overwrite unsaved edits or race a newly confirmed save.
- The API acknowledges a setting only after Firestore commits it; a failed write leaves the prior in-memory setting intact and returns a retryable service error.
- Firestore-loaded and local fallback settings are normalized before entering the runtime cache.
- Focused payout/commission durability suite: 26/26 passed.
- Full automated suite: 399/399 passed; TypeScript and both production bundles passed.

### UP-05 — Inclusive discovery and personalization

Status: pending

- Extend writer-managed categories with discovery metadata and content rating/warnings.
- Present Ink & Witness as a literary house first, with intentional access to adult/intimacy content rather than aggressive default promotion.
- Add lightweight reader interests without preventing full-catalogue browsing; reuse consented interests for newsletter segments.

Checkpoint: category configuration, adult-content separation, preference fallback, and accessibility/responsive tests pass.

### UP-06 — Production migration and end-to-end release

Status: pending

- Run read-only migration reports, create a recovery snapshot, then execute bounded idempotent backfills.
- Deploy, verify the custom domain, inspect production logs, and test the complete visitor-to-publication journey.
- Record deployed commit, deployment ID, migration counts, and rollback instructions here.

## Non-negotiable invariants

1. Payment confirmation is the only event that can create paid access automatically.
2. Replayed callbacks or retries cannot create duplicate sales, licenses, commissions, campaigns, or emails.
3. Affiliates never receive full buyer phone numbers, email addresses, or reader IDs.
4. Newsletter subscription is voluntary; unsubscribe remains available in every campaign.
5. Publishing a piece or chapter sends no email unless the writer explicitly opts in for that release.
6. Existing standalone articles require no migration to keep rendering and selling.
7. Secrets and administrative operations remain server-only and cookie-authenticated.
8. Aggregate counts are projections of durable records, never independent sources of truth.

## Resume instructions

Resume at UP-04. Before editing, confirm `git status --short`, the current commit, and that no unrelated user changes are present. After each stage, run focused tests, the full suite, TypeScript, production builds, and `git diff --check`; then update this ledger before committing. Do not run the newsletter provider setup or sales backfill until the UP-06 production snapshot and release gate.
