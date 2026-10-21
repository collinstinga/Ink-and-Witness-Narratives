# Literary Circle bounded durable-click query checkpoint

Date: 2026-10-21

Branch: `feature/literary-circle-upgrade`

Status: local-only; no activation marker, environment change, Firestore
migration, secret retrieval, push, merge, or deployment

## Completed in this checkpoint

- Added a writer-only, server-side adapter that reads the fixed
  `site_configs/affiliate_click_analytics` activation marker and, only when
  that marker is valid, queries a bounded slice of `affiliate_clicks`.
- Added strict allow-list validation for the immutable v1 marker. It accepts
  only canonical ISO timestamps, fixed schema/event/key versions, and a
  `completeFrom` instant strictly after `activatedAt`. A marker is also
  rejected if Firestore reports that it was updated after creation or created
  at/after `completeFrom`.
- Queries only the canonical `timestamp` field, in ascending order, with
  inclusive lower/upper bounds and a `1,001`-document limit. The first 1,000
  documents are the report bound and the extra document is only a truncation
  sentinel. This needs no composite Firestore index.
- Clamps a partially overlapping request to `completeFrom`. A range wholly
  before durable coverage returns traffic as unavailable and never enumerates
  legacy events.
- Requires the runtime to be in `required` mode and verifies a non-secret key
  fingerprint on the marker and every v2 event against the currently deployed
  `AFFILIATE_CLICK_ANALYTICS_SECRET`. Missing or rotated key material is
  fail-closed instead of silently splitting visitor identities.
- Applies a ten-minute ingestion safety lag. A live interval is explicitly
  partial through its returned `queriedThrough` watermark so an in-flight
  Firestore transaction cannot be omitted while the report claims completion.
- Validates every returned document with the privacy-minimised v2 allow-list
  and requires the Firestore document ID to match the body ID. Invalid,
  visitorless, truncated, or pre-activation history can never be labelled
  complete.
- Connected the aggregate Writer analytics route to the bounded adapter. A
  click-query failure keeps verified sales, revenue, commissions, and other
  financial aggregates available while returning referral traffic as
  unavailable rather than as a misleading zero.
- Preserved the existing capped local click ledger as an explicitly partial
  fallback only while the activation marker is absent. Once any marker exists,
  invalid configuration or query failure cannot silently fall back to local
  state.
- Preserved writer authentication and `Cache-Control: private, no-store` on
  the analytics route. No event, visitor key, referrer, secret, provider error,
  email, phone number, or payout detail is serialized to the client.
- Added a regression proving `off`, `shadow`, and `required` public click paths
  never read the activation marker.
- Coalesces identical concurrent server queries while preserving the original
  cutoff in the shared result. Completed results are not cached. The protected
  Writer route is additionally limited to six refreshes per 15 minutes per
  authenticated writer on each process.

## Firestore quota contract

| Admin analytics case | Marker lookups | Click query |
| --- | ---: | ---: |
| Unsupported purchase/subscription/tier filter | 0 | 0 |
| Marker absent, invalid, unreadable, or range before `completeFrom` | 1 | 0 |
| Marker valid but runtime/secret unsafe | 1 | 0 |
| Active supported durable range | 1 | limited to 1,001 documents |

An empty Firestore query may still incur its platform minimum read charge.
Only simultaneously in-flight identical queries are coalesced; there is no
completed-result cache that could pair an older slice with a newer timestamp.
The public click hot path and store initialization incur zero
activation-marker reads. The route limiter is process-local defense in depth,
not a substitute for a staged shared Vercel Firewall rule.

## Coverage semantics

- `complete`: the entire selected interval is on or after `completeFrom` and
  before the safe ingestion watermark, the bounded query succeeded without a
  truncation sentinel, every document is a valid v2 event with a matching ID
  and key fingerprint, and every event has a visitor key.
- `partial`: the returned aggregates are lower bounds because the interval
  overlaps pre-activation history, the query was truncated, an invalid event
  was observed, or visitor identity coverage is incomplete. Conversion remains
  withheld.
- `unavailable`: the marker/query/configuration cannot prove a safe event set,
  or the requested interval is wholly before durable history. Clicks, visitors,
  and conversion are returned as `null`, never zero.

Durable conversion remains withheld even when click coverage is complete. A
valid conversion percentage requires a separately reviewed bounded
click-to-purchase cohort join; dividing independent period sales by period
clicks could exceed 100% under the existing attribution window.

## Verification

- Focused durable query, coverage, analytics, store, click-runtime, route, and
  Writer-view regression set: 7 files and 111 tests passed.
- Complete affiliate-named regression set: 26 files and 284 tests passed.
- TypeScript validation passed with `pnpm exec tsc --noEmit`.
- The production bundle passed with `pnpm run build`. Vite reported only the
  existing Highlight API parser notice and large-chunk optimization notices;
  neither is a build failure introduced by this checkpoint.
- `git diff --check` passed for tracked changes. New files were separately
  checked for trailing whitespace and conflict markers before commit.
- The pre-commit secret-pattern scan covered every modified and new file and
  found no credential material.

## Safe activation boundary

This checkpoint reads but never creates, updates, or deletes the activation
marker. Marker creation remains a separate guarded staging maintenance task
requiring:

1. a verified staging Firebase Admin credential;
2. a fresh guarded backup and reconciliation of all nine affiliate records;
3. a protected dedicated click secret and a verified `required` deployment;
4. a create-only, future-dated marker carrying the deployed key fingerprint,
   with Firestore create/update metadata verified in staging; and
5. post-boundary privacy, completeness, quota, failure, and rollback evidence.

No usable staging Firebase Admin credential is available in this workspace,
so activation and deployment remain blocked. Existing legacy click documents
are not backfilled, rewritten, deleted, or assigned TTL.
