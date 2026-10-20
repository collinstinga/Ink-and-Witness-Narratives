# Literary Circle durable click primitives checkpoint

Date: 2026-10-20

Branch: `feature/literary-circle-upgrade`

Status: local-only; no runtime wiring, Firestore write, migration, push, merge, or deployment

## Completed in this checkpoint

- Added a server-only, signed first-party visitor-token primitive for future
  referral analytics.
  - It begins with a cryptographically random 32-byte nonce.
  - Only a domain-separated HMAC pseudonym is eligible for durable storage.
  - The cookie token itself is never part of the durable event shape.
  - It contains no IP address, browser fingerprint, account ID, phone number,
    email address, or reader-session credential.
  - It fails closed in production when no stable server signing secret exists.
- Added a deterministic 30-minute deduplication identity derived from the
  affiliate, destination, campaign, pseudonymous visitor, and time window.
  The resulting document ID reveals none of those inputs.
- Added a fail-closed v2 durable-event validator. It accepts only an explicit
  field allow-list and rejects raw referrers, IP hashes, user agents, reader
  identifiers, cookie values, and every unknown field.
- Added referrer minimisation that retains only a valid HTTP(S) origin and
  removes paths, query strings, fragments, and credentials.
- Added a coverage proof helper that keeps click and conversion coverage
  unavailable or partial when:
  - durable tracking is not enabled;
  - the query fails;
  - the requested range predates activation;
  - a bounded query is truncated;
  - any event is invalid or outside the requested range; or
  - unique-visitor pseudonyms are missing.

## Current non-effects

This checkpoint deliberately does **not**:

- emit a new cookie;
- write to or read from `affiliate_clicks` in Firestore;
- change the existing referral redirect or public click endpoint;
- change affiliate counters, attribution, commissions, sessions, or checkout;
- claim that existing capped local click history is complete;
- enable a Firestore TTL or delete any legacy click record; or
- create or expose a production secret.

The existing application therefore has identical runtime and quota behaviour
after this checkpoint.

## Verification

- Focused visitor-token, deduplication, event-privacy, and coverage suite:
  **1 file / 12 tests passed**.
- Surrounding click-cookie, attribution, redirect, and analytics regression
  suite: **5 files / 42 tests passed** (including the 12 focused tests).
- Full-project TypeScript validation: passed (`pnpm exec tsc --noEmit`).
- Production build: passed. The existing CSS Highlight API and large-chunk
  advisory warnings remain unchanged; this server-only module adds no browser
  bundle or route.

## Next gated integration step

Runtime integration must remain a separate, reversible checkpoint. Before it
can be considered deployable:

1. use an HttpOnly, SameSite=Lax, Secure-in-production cookie and keep it
   entirely separate from authentication and purchase attribution;
2. provision a protected staging `AFFILIATE_CLICK_ANALYTICS_SECRET` of at least
   32 characters; never store the value in source, logs, backups, or chat;
3. create the durable event and increment counters in one idempotent Firestore
   transaction so a duplicate cannot inflate either value;
4. prove the exact read/write cost under load and enforce public-route rate
   limits before staging traffic is allowed;
5. use bounded, on-demand writer queries only, with no polling or homepage
   hydration, and retain a truncation sentinel;
6. record a durable activation timestamp so earlier ranges can never be
   mislabeled as complete;
7. make an explicit retention decision before adding TTL. Historical records
   must not be silently removed because the upgrade requires preservation; and
8. rehearse against staging and the verified nine-affiliate backup before any
   production migration or deployment.
