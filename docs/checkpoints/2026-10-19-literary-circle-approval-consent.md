# Literary Circle approval and communication-consent checkpoint — 2026-10-19

Status: Locally implemented and verified on `feature/literary-circle-upgrade`. This slice has not been merged to `main`, pushed, deployed to Vercel, used to send email, or applied to production Firestore.

## Resumption point

- Branch base before this slice: `95b7826` (`feat: add partner notification previews`).
- This checkpoint belongs to the local commit named `feat: add partner approval and notification consent`.
- The production/staging migration gate in `docs/literary-circle-migration.md` remains mandatory.

## Completed in this slice

- Added an explicit writer-approval transition backed by one Firestore transaction. Approval activates a pending account and writes its approval metadata and audit record atomically.
- Made self-registration genuinely pending. It returns HTTP 202, issues no affiliate session, and cannot sign in until the writer approves the account.
- Kept existing active affiliates usable. Legacy status alone is not silently converted into notification approval, and existing sessions are not revoked merely because approval metadata is added.
- Added Writer Portal approval state and a deliberate approval action. Suspended accounts cannot be silently reactivated through that action; status reactivation remains a separate explicit control.
- Added affiliate-owned, revisioned communication preferences. Existing terms acceptance is never treated as marketing consent, and every legacy/missing/old-disclosure record fails closed to no marketing.
- Separated optional release, campaign, inactivity, and opportunity emails from operational commission and tier alerts. Optional marketing consent is not required for membership, catalogue access, referrals, commissions, or payouts.
- Added a lazy-loaded, mobile-responsive communication-preferences panel in the affiliate dashboard with explicit opt-in, category controls, all-marketing opt-out, mutation locking, stale-revision protection, and delivery-disabled disclosure.
- Added a signed, scoped marketing opt-out capability for future email footers. It is idempotent, does not require a logged-in browser, never exposes whether an affiliate exists, clears only optional marketing categories, and preserves operational alert choices.
- Added opt-out timestamps and source provenance without storing capability tokens.
- Hardened notification eligibility to require valid approval metadata and a current disclosure-version consent record. A truthy but malformed approval or a stale consent record cannot qualify.
- Kept all partner notification templates in `preview_only`; this slice adds no send, test-send, provider call, outbox, queue, cron, webhook delivery, or live-mode switch.

## Persistence and audit guarantees

- Writer approval, affiliate preference saves, and signed opt-outs each use Firestore transactions.
- Approval and preference writes fail closed on missing accounts; preference saves reject stale revisions and unknown client fields.
- Signed opt-out tokens are HMAC-scoped to affiliate marketing and use a dedicated secret with safe server-secret fallbacks. Invalid and missing-account tokens receive the same public accepted boundary.
- Private browser, CDN, and Vercel caches are disabled for preference and approval routes.
- Affiliate records are already included verbatim in backup schema version 3, so approval and preference subfields require no destructive schema rewrite or backup-version bump.

## Verification completed

- Focused approval, consent, capability, API, UI, and real-route run: 7 files and 77 tests passed.
- Definitive resource-controlled full Vitest run: 92 files and 826 tests passed. One earlier unconstrained run had a single unrelated reader-cover timeout; that test passed alone and the complete controlled rerun passed.
- Final post-review focused regression run: 4 files and 61 tests passed.
- TypeScript: `pnpm exec tsc --noEmit` passed with no diagnostics.
- Production build passed for the Vite client and bundled Express server. The preference panel remains a separate lazy chunk at approximately 6.02 kB.
- `git diff --cached --check` passed, and the staged diff contains no credential-shaped values.
- Existing non-blocking build notices remain: the CSS optimizer warning for `::highlight(...)` and JavaScript chunk-size advisories over 500 kB.
- React review covered lazy component/data loading, hook lifecycle, accessible fieldsets/statuses, mutation locking, mobile layout, and the absence of recipient or secret rendering.
- Security review covered pending-registration bypass, current-disclosure enforcement, approval integrity, authenticated ownership, optimistic concurrency, idempotent opt-out, cache policy, audit atomicity, and the absence of a delivery path.

## Deliberately not activated

- No affiliate receives email from this feature.
- No existing affiliate receives an approval marker or marketing consent automatically.
- No production affiliate document, session, balance, referral link, commission, payout, or notification record was changed.
- No signed opt-out token is emitted yet because there is no delivery renderer for partner notifications.
- Reader newsletter consent, subscriber records, campaigns, and unsubscribe behavior remain separate and unchanged.

## Production and migration gate

Do not deploy or migrate this branch yet. A usable non-production Firebase Admin credential is still unavailable locally, and the protected Vercel Firebase secret must not be copied into source, logs, screenshots, or chat.

Before live partner notification delivery:

1. Securely supply a staging Firebase Admin credential and run the schema-v3 backup, staging dry run, staging apply, repeat-idempotency run, and equality checks.
2. Have the writer verify the exact nine founding accounts, then exercise explicit approval against that verified list in staging. Do not infer approval from historical `active` status.
3. Verify preference opt-in, category opt-out, signed marketing opt-out, stale-revision conflict, suspension, and reactivation journeys in the protected preview.
4. Add deterministic source-event and per-affiliate delivery IDs, transactional outbox creation, bounded leases/retries, fresh pre-send eligibility checks, webhook reconciliation, suppression, and dead-letter visibility.
5. Add a production-only delivery gate requiring the canonical HTTPS domain, verified sender, configured signing secret, explicit live mode, production environment, and reviewed configuration revision.
6. Re-run writer, affiliate, reader, payment, referral, subscription, and notification journeys without live charges or external email delivery before any production decision.

## Safe next slice

The next notification slice is deterministic event/outbox infrastructure with delivery still disabled. Do not enable it or migrate approval markers until the staging credential and verified nine-account list are available.
