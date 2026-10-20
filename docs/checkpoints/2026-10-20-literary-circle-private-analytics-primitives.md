# Literary Circle private-analytics primitives — 2026-10-20

Status: Locally implemented on `feature/literary-circle-upgrade`. This slice is server-only and is not connected to a route, Writer Portal screen, database write, migration, Vercel environment variable, or production deployment.

## Purpose

Advanced affiliate reporting needs to distinguish new and returning referred readers without exposing or grouping on raw names, emails, phone numbers, IP addresses, receipts, or authentication identifiers. This checkpoint adds the pure, fail-closed calculations required before any production integration.

## Completed in this slice

- Added a versioned `abk1_` buyer-analytics pseudonym derived with HMAC-SHA-256 and a caller-supplied secret of at least 32 bytes.
- Prefers an authenticated reader account identifier and falls back only to a valid normalized Kenyan M-PESA phone from a settled transaction. Email addresses are deliberately excluded.
- Added a privacy projection that joins commissions to payment transactions only through unambiguous order, checkout, transaction, or receipt identifiers.
- Requires settled payment state, an exact KES amount match, and a compatible affiliate code; explicitly direct transactions cannot supply an affiliate buyer key.
- Keeps ambiguous index values ambiguous even when more duplicate records appear. Ambiguous or mismatched joins return no buyer key.
- Added a pure advanced-report builder with Africa/Nairobi day boundaries and a maximum inclusive window of 366 days.
- Counts only positive-value, verified commission states and deduplicates callbacks by provider receipt before internal identifiers.
- Aggregates pieces, bundles, subscriptions, gross sales, recorded and paid commissions, creator-retained revenue, active account counts, monthly trends, leading affiliates, and leading offers.
- Computes aggregate unique, newly affiliate-acquired, and repeat-reader measures only when a valid pseudonymous key is available. Partial identity coverage is labelled; absent coverage returns `null` rather than an invented value.
- Accepts referral click events only as server-side inputs. Visitor hashes never appear in the returned report, and conversion is withheld unless the caller explicitly confirms complete history for the requested window.
- Filters that cannot be safely mapped to click history, such as subscription-plan or tier filters, make click conversion unavailable instead of silently mixing incompatible populations.

## Privacy and integrity boundaries

- The report contains aggregate counts and writer-visible affiliate/offer labels only. It never returns the HMAC buyer key, raw buyer identity, receipt, transaction ID, click visitor hash, IP address, or user agent.
- “New affiliate-acquired reader” means the selected commission is that pseudonym's first verified affiliate-attributed purchase in the complete supplied commission history. A later purchase in a filtered affiliate or offer does not steal that acquisition credit.
- Repeat-purchase calculations use complete supplied affiliate commission history, not browser cookies or permanent cross-session attribution.
- Complimentary Literary Circle reading does not enter the commission input and therefore cannot appear as a sale.
- Inputs are not mutated.

## Verification

- Focused privacy/range/join/report suite: 1 file and 6 tests passed.
- TypeScript: `tsc --noEmit --pretty false --diagnostics` passed across 840 files with exit code 0.
- Full regression: 93 files and all 836 tests passed with one worker. An earlier four-worker run exhausted the constrained host's timing budget in unrelated persistence and Argon2 tests; every affected file then passed serially before the complete clean run.
- Production build: `pnpm run build` passed. The existing non-blocking CSS Highlight API parser and large-chunk warnings remain unchanged.
- No production credential, environment variable, migration, database write, push, merge, deployment, or notification delivery was performed.

## Deliberately not integrated

- No `AFFILIATE_ANALYTICS_HMAC_SECRET` is read or provisioned yet. Production must use a dedicated protected secret and must never place it in source, logs, backups, chat, or client payloads.
- No buyer pseudonym is stored on a commission or transaction, so backup schema version 3 remains unchanged.
- No historical backfill is attempted.
- No Writer Portal API or interface consumes this report yet.
- The current click-event cache is not sufficiently durable to claim complete historical conversion coverage. The builder requires the eventual caller to prove coverage explicitly.

## Safe resumption point

1. Rerun TypeScript, the focused suite, full Vitest, and the production build.
2. Review the staged diff for secret-shaped values and confirm the report cannot serialize buyer or visitor keys.
3. Commit these primitives locally.
4. Before route/UI integration, design a quota-bounded server query that joins only the selected date window and returns aggregates. Do not hydrate or expose the full buyer ledger merely to render a dashboard.
5. Do not persist or backfill buyer pseudonyms until staging credentials, a verified backup, an explicit secret-rotation policy, and the guarded migration rehearsal are available.
