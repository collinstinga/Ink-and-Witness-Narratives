# Literary Circle durable click runtime checkpoint

Date: 2026-10-21

Branch: `feature/literary-circle-upgrade`

Status: local-only and disabled by default; no environment change, Firestore
migration, activation marker, push, merge, or deployment

## Completed in this checkpoint

- Added a three-state runtime gate:
  - `off` is the default and preserves the existing click path exactly;
  - `shadow` writes a privacy-minimised v2 event when the dedicated key and
    visitor identity are available, while retaining the pre-activation legacy
    fallback; and
  - `required` fails the accepted click closed if durable recording cannot be
    completed.
- Wired the signed random visitor token to an HttpOnly, SameSite=Lax,
  Secure-in-production, first-party cookie with a maximum 90-day lifetime. The
  cookie has no `Domain` attribute, is never used for authentication or access,
  and is emitted only after a current active affiliate has been verified.
- Added same-origin enforcement to the public click POST while retaining
  top-level cross-site affiliate redirect GETs used by email and social links.
- Made the v2 click event and affiliate/campaign counter increments one
  Firestore transaction. In `shadow`, the existing rolling legacy decision
  remains authoritative for counters and unique-visitor behavior while the v2
  event is dual-written for verification. Only `required` cuts over to the
  deterministic event-document read as the authoritative 30-minute decision.
- Preserved the existing short redirect-to-POST handoff cookie, attribution
  cookie, affiliate eligibility checks, destination behavior, and default
  attribution duration.
- Ensured the durable event stores only the server-derived visitor pseudonym,
  canonical affiliate/destination/campaign fields, referrer origin, and
  timestamps. It never stores the visitor cookie, IP, browser fingerprint,
  user agent, account identity, phone number, email address, or raw referrer.
- Kept legacy `affiliate_clicks` records byte-for-byte unchanged. The runtime
  reads only the exact new deterministic `aclk2_...` document and does not
  enumerate, rewrite, migrate, delete, or attach TTL to legacy history.
- Kept the legacy `uniqueVisitors` counter unchanged in durable mode because a
  process-local cache cannot prove global uniqueness. Bounded durable reporting
  must derive unique visitors from distinct v2 visitor keys.

## Firestore cost per required-mode transaction attempt

| Case | Reads | Writes |
| --- | ---: | ---: |
| Active affiliate, no campaign, new v2 event | 3 | 2 |
| Active affiliate, no campaign, duplicate v2 event | 3 | 0 |
| Active affiliate, one valid campaign, new v2 event | 4 | 3 |
| Active affiliate, one valid campaign, duplicate v2 event | 4 | 0 |
| Campaign supplied but unmatched | 4 | 2 |

The reads are the affiliate query, optional campaign query, settings document,
and exact event document. New writes are the event, affiliate counter, and
optional campaign counter. Firestore transaction retries repeat reads; only a
successful commit publishes writes. Ambiguous two-document queries can add one
read and are rejected or ignored under the existing ownership rules.

`shadow` performs the same reads. Its writes are intentionally independent for
rollout parity: a new v2 event is written when absent, while legacy counters are
updated only when the existing rolling process-local rule accepts the click.
This can produce event-only or counter-only shadow transactions and must not be
interpreted as complete durable coverage.

## Failure and rollback behavior

- Missing or invalid `AFFILIATE_CLICK_ANALYTICS_SECRET` in `required` mode
  produces no event, counter, visitor cookie, handoff cookie, or attribution.
- A Firestore transaction failure publishes neither the event nor counters and
  does not update the process-local click cache.
- Invalid, inactive, or link-disabled affiliates do not read or write an event.
- A tampered or expired visitor token is replaced only after the affiliate is
  validated and the click transaction succeeds. The stable replacement cookie
  is emitted before any later attribution-signing failure can return, so a
  retry cannot silently mint a second durable visitor identity.
- Redirect failures land safely on the selected non-attributed destination.
  Direct POST failures return a generic error and never expose the visitor
  token, pseudonym, key, or provider detail.
- Rollback is an environment-only change to
  `AFFILIATE_CLICK_LEDGER_MODE=off` before an activation marker exists. Once a
  complete-coverage marker becomes active, falling back to legacy-only writes
  would create an unreported gap and is not a valid rollback.

## Verification

- Durable transaction suite: **1 file / 10 tests passed**. It covers concurrency, deduplication across windows,
  atomic commit failure, missing-key failure, shadow fallback, inactive
  affiliates, legacy-record preservation, and the legacy-to-v2 rollout bridge.
- Final click/route/analytics security regression set: **6 files / 66 tests
  passed**. It covers default-off compatibility, visitor-cookie issuance and
  reuse, tamper replacement, cross-site POST rejection, required-mode failure,
  invalid affiliates, store failure, and response privacy.
- Broader affiliate security, Literary Circle, commission durability,
  attribution, claim-store, and request-validation regression set: **6 files /
  88 tests passed**.
- Full-project TypeScript validation passed (`pnpm exec tsc --noEmit`).
- Production build passed. The existing CSS Highlight API and large-chunk
  advisory warnings remain unchanged.
- A resource-saturated full-suite attempt timed out in two unrelated homepage
  persistence cases; the affected file was immediately rerun in isolation and
  passed **1 file / 8 tests**. No failure intersected this checkpoint.

## Safe staged activation sequence

1. Obtain a verified staging Firebase Admin credential and take the guarded
   nine-affiliate backup. No usable staging credential exists in this workspace
   yet, so activation is currently blocked.
2. Provision a protected, random `AFFILIATE_CLICK_ANALYTICS_SECRET` of at least
   32 characters in staging. Never place its value in source, logs, backups,
   terminal output, or chat.
3. Deploy with `AFFILIATE_CLICK_LEDGER_MODE=shadow`, generate controlled test
   referrals, and verify event privacy, deterministic deduplication, exact
   counter changes, operation cost, and unchanged attribution/purchases.
4. Add the separately reviewed bounded admin query and immutable create-only
   marker support. Do not infer coverage from the first observed event.
5. Create `site_configs/affiliate_click_analytics` with a `completeFrom`
   timestamp slightly in the future, then switch every staging instance to
   `required` before that instant.
6. Prove complete reporting from `completeFrom`, rehearse key continuity and
   failure behavior, and repeat the guarded backup comparison.
7. Only after explicit approval and successful staging evidence may the same
   sequence be considered for production.

## Still deliberately excluded

- No activation marker is created or read in this checkpoint.
- No Writer Portal query consumes Firestore v2 events yet.
- No legacy document is backfilled, converted, deleted, or assigned TTL.
- No dedicated secret is generated, retrieved, printed, or deployed.
- No staging or production environment is changed.
