# Literary Circle performance-period checkpoint — 2026-10-19

Status: Locally implemented on `feature/literary-circle-upgrade`. This slice has not been merged to `main`, pushed, deployed to Vercel, or applied to production Firestore.

## Resumption point

- Branch base before this slice: `53ef9f3` (`feat: add partner approval and notification consent`).
- This checkpoint belongs to the local commit named `feat: add Literary Circle period reporting`.
- The production/staging migration gate in `docs/literary-circle-migration.md` remains mandatory.

## Completed in this slice

- Added a read-only six-month performance ledger for each affiliate using Africa/Nairobi calendar-month boundaries.
- Counts only payment-verified commission states (`PENDING`, `APPROVED`, and `PAID`). Rejected and reversed records are excluded from sales, revenue, commission, and tier qualification totals and are shown separately as exclusions.
- Separates lifetime/historical verified achievement from prospectively qualifying sales when a tier qualification effective date starts part-way through a month.
- Resolves each period against the commission-policy snapshot that was effective during that period. Later tier edits do not rewrite the historical report.
- Preserves and displays tier IDs and policy versions recorded on completed commission records. A separately labelled active/projected performance tier never mutates those transaction snapshots.
- Reports verified pieces, bundles, and Reader Pass subscriptions independently, plus gross affiliate sales, recorded commissions, and creator-retained revenue before other direct costs.
- Added the affiliate's own mobile-responsive performance history beneath current tier progress.
- Added a writer-only monthly performance ledger with month selection, aggregate totals, affiliate ranking, manual-tier context, recorded tier/policy snapshots, and no customer identifiers.
- Reused the existing dashboard payloads and cached verified ledgers. This slice adds no public route, no background polling, no additional Firestore query, and no database write.
- Hardened the local server entry point so importing `server.ts` under `NODE_ENV=test` does not bind a second process to port 3000. Route tests continue to create their own isolated ephemeral HTTP server, and the user's running local site is not interrupted.

## Data and financial safeguards

- Performance reporting is a pure derivation; it does not edit affiliate accounts, commission records, balances, payouts, tiers, or policy history.
- Complimentary catalogue access never appears as a sale.
- Invalid dates and non-finite/negative monetary values fail closed instead of inflating totals.
- Current and historical calculations share the same verified-commission and Africa/Nairobi period helpers used by commission qualification.
- Customer names, emails, phone numbers, receipts, and transaction identifiers are not included in the performance report type or UI.
- Historical commission rates remain the amounts already recorded on each transaction; no retroactive recalculation is performed.

## Verification

- Focused policy, store, affiliate UI, and writer UI run: 4 files and 33 tests passed.
- Isolated newsletter route-server regression: 1 file and 5 tests passed without binding the development port.
- Full regression: 92 files and 830 tests passed.
- TypeScript: `pnpm exec tsc --noEmit` passed.
- Production build: `pnpm run build` passed. The build retained the project's existing non-blocking warnings for the CSS Highlight API parser and large application chunks.
- No production credential, migration, push, merge, deployment, email delivery, or Firestore write was performed.

## Deliberately unchanged

- No migration or backup schema bump is required because the report stores no new data.
- Notification delivery remains disabled.
- Existing attribution, payment settlement, commission, wallet, payout, reader access, and subscription behavior is unchanged.
- This is period reporting, not the final advanced-analytics implementation. Unique referred-reader and repeat-purchase metrics still require a privacy-preserving durable buyer identity design rather than inference from raw customer data.

## Safe next slice

Design and test privacy-preserving advanced affiliate analytics using deterministic, non-reversible buyer identifiers and bounded date filters. Do not backfill or write buyer identifiers until staging credentials, the guarded backup, and a reviewed migration plan are available.
