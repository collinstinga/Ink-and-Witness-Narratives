# Durable campaign management checkpoint

## Scope and completed implementation

This closes a prerequisite for scheduled Literary Circle campaign notices. The
old campaign editor only created records, and its save could acknowledge a local
cache change before Firestore accepted it. No scheduled notice or provider send
has been enabled in this slice.

Campaign saves now read the authoritative document and code query inside a
Firestore transaction, then commit the campaign and its audit entry together.
Only editable campaign fields are applied. Stored creation dates, all four
financial/click counters, unknown fields and existing campaign IDs/codes survive.
Older full-record payloads may include known server-owned fields, but those
values are ignored. New campaigns start with zero counters and a deterministic
code-derived identity; duplicate codes cannot become accidental updates.

New/edited records carry a server-owned revision and updatedBy. Missing revisions
are accepted only for legacy revision-zero records; versioned edits/pauses require
the exact current revision. Stale writes conflict rather than overwrite. Provider
failures are redacted, with no local write fallback.

The legacy DELETE endpoint now performs a reversible pause, not document
deletion. It preserves referral and financial history, commits an audit with the
pause, and supports later re-enabling through Edit. An absent campaign returns
404 rather than a false success. Existing commissions are not recalculated.

The writer UI now loads current campaign versions, supports edits, dates, rates,
attribution windows, active state and piece scopes, and keeps unavailable piece
IDs selected until the writer explicitly changes them. Existing codes are
readonly. A lazy-loaded native dialog preserves drafts on failure, labels form
controls, traps focus natively and supports mobile-sized controls. Local device
times are converted to UTC; untouched legacy dates are not rewritten.

Campaign GET is authenticated, private/no-store, Firestore-authoritative and
bounded to 500 records plus one overflow probe. Failure is explicit and does not
take the rest of affiliate administration offline. Fresh directory reads run on
initial load, campaign-tab entry, active campaign polling and edit opening; they
are not added to unrelated 15-second summary polls.

Click, sale and writer-save cache projections now share a publisher that retains
the highest writer revision and independently preserves increment-only campaign
counters. Late projections cannot undo a newer writer configuration. Projections
are never written back to Firestore. Startup also no longer uploads a local
campaign snapshot into an empty cloud directory; a real restore must use a
reviewed backup/migration, not automatic startup writes.

## Preservation and bounds

No production records were read or changed. No migration, email, real payment,
push, merge or deployment was performed. Existing schema-v6 backups already
include full campaign records; additive revision/actor fields require no new
dataset or schema version. No historical IDs, affiliate records, sale amounts,
commissions, balances, purchases, permissions or content were reset.

A save reads its target and at most two matching code-query documents before two
atomic campaign/audit writes. A pause reads one target before two writes; an
already paused current revision adds no audit/write. Transaction retries may
repeat reads. Fresh directory overflow fails rather than silently truncating.

The cache-counter maximum is valid only for today's nonnegative increment paths.
Future campaign refunds, financial corrections or imports must introduce an
independent financial revision instead of treating maxima as authoritative.
Other affiliate startup/payout/local-cache paths were not rewritten in this
campaign-focused slice and are not covered by its durability guarantee.

## Verification

Final targeted regression: **10 files, 173 tests passed**, none skipped. Includes
campaign commit failures/concurrency/preservation/pausing/cache order/startup,
editor payload/date cases, API contracts and component static rendering, plus
existing affiliate click, commission, security, Literary Circle and M-Pesa
settlement/intent-lock tests. An early regression exposed rewriting an identical
legacy date; the code now preserves it. The changed-date fixture separately
verifies canonicalization of genuinely edited dates.

Full TypeScript validation and production client/server builds passed. The
compiler caught a new test mock's parameter signature; its typing was corrected
without changing assertions. The final campaign/component recheck passed all 44
tests in two files. Reuse the existing 1,024 MB incremental TypeScript cache at
node_modules/.cache/literary-circle-upgrade.tsbuildinfo for subsequent checks.

The frontend built in 1m30s and the server bundle in 344ms. Existing large-chunk
and valid CSS Highlight API optimizer warnings remain; they were not suppressed.
The new editor is a separate 7.55 kB chunk (2.79 kB gzip) rather than added to the
initial reader bundle. React review retained lazy loading, guarded async results,
native dialog focus/keyboard handling and labelled mobile-sized controls.
Static component rendering is not a substitute for staging/browser/mobile
end-to-end verification.

## Exact next work

Use committed campaign revisions/audits for scheduled source provenance. Add
independent server-owned campaign-topic opt-in timestamps before enabling that
marketing event. Define lead-window expiry and stable deduplication; do not turn
later opt-ins or routine campaign edits into a historical notification backlog.
Inactivity and exclusive-opportunity sources still need equivalent evidence.

Delivery worker/provider reconciliation, fresh send-time eligibility, buyer
analytics runtime integration, actual staging provisioning/access, fresh v6
backup/migration rehearsal, and complete payment/refund/access/mobile verification
remain outstanding. Held intents still never authorize sending. Production
notification and payment safety gates remain unchanged.
