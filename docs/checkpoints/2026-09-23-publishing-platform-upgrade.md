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

Status: in progress

- Add consent-based subscriber records with unique normalized-email index, interests, work follows, status, timestamps, and signed unsubscribe flow.
- Add writer-only subscriber search, segmentation, composition, preview, test-send, resumable campaign sending, and delivery history.
- Add explicit opt-in controls for piece/chapter release notifications. Publishing never emails by default.
- Keep provider credentials server-side. Use a durable provider adapter and idempotency keys.

Checkpoint: subscription/unsubscribe security tests, campaign idempotency tests, UI tests, provider-disabled behavior, and no-email-without-explicit-opt-in test.

Completed locally: double-opt-in subscriber storage, signed unsubscribe, server-only Resend adapter, writer subscriber/campaign UI, audience segmentation, preview/test send, deterministic delivery records, resumable sending, and provider-disabled public signup. Remaining: explicit piece/chapter release notification controls, provider webhook outcomes, and production provider/domain configuration.

### UP-03 — Canonical sales intelligence

Status: in progress

- Enrich the existing permanent transaction ledger instead of creating competing counters.
- Add a stable unique sale/order ID per confirmed purchase and immutable buyer/piece/payment/affiliate snapshots.
- Derive writer sales, affiliate sales, commissions, wallets, and analytics from the same confirmed purchase records.
- Add a dry-run/backfill migration for historical confirmed purchases.

Checkpoint: M-Pesa, bank, manual confirmation, reader unlock, affiliate attribution, and idempotent retry tests all pass.

### UP-04 — Chaptered publishing and editor reliability

Status: pending

- Preserve every existing article as a standalone work by default.
- Add parent-work/child-chapter records, draft/publish/schedule/reorder operations, reader table of contents, direct chapter URLs, and work-follow notifications.
- Replace fragile rich-text command handling with selection-safe formatting and verify round-trip persistence/rendering.

Checkpoint: legacy standalone URL tests, chapter CRUD/reorder/access tests, and rich-text selection/persistence tests pass.

Completed locally: safe shared Markdown rendering plus selection-aware bold/italic/headings/quotes/lists/links in writer preview and reader view. Existing content stays Markdown and raw HTML is not rendered. Remaining: chaptered work schema/routes/editor/table of contents and full control round-trip verification.

## Verified local checkpoint — newsletter/editor foundation

- TypeScript: passed (`tsc --noEmit`).
- Focused tests: 38/38 passed across newsletter security/provider/store, canonical sales helper, safe Markdown rendering, and editor formatting.
- Production build: Vite client and bundled server passed.
- Diff integrity: `git diff --check` passed (line-ending warnings only).
- Deployment/provider state: not deployed; no Firestore migration or production newsletter writes performed. Newsletter remains disabled unless server-side provider variables are configured.

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

Resume at the first stage marked `in progress`. Before editing, confirm `git status --short`, the current commit, and that no unrelated user changes are present. After each stage, run focused tests, the full suite, TypeScript, production builds, and `git diff --check`; then update this ledger before committing.
