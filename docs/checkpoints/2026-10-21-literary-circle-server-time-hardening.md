# Literary Circle durable-click server-time hardening checkpoint

Date: 2026-10-21

Branch: `feature/literary-circle-upgrade`

Status: local-only; no credential retrieval, backup, migration, activation
marker, environment change, push, merge, or deployment

## Completed in this checkpoint

- Durable v2 click timestamps and 30-minute deduplication windows now derive
  from the authoritative Firestore transaction snapshot `readTime`, not the
  Vercel instance's local wall clock.
- `required` mode fails the click transaction closed when Firestore does not
  supply a valid server read time. No click event or counter update can commit
  in that case.
- `shadow` mode remains behavior-preserving before activation: when server time
  is unavailable it skips the best-effort durable event and retains the legacy
  click/counter path. `off` mode retains its prior local-time semantics.
- Campaign validity and `lastActivityAt` use the same transaction time whenever
  durable mode is active, so a single click attempt cannot mix clock domains.
- The Writer analytics ingestion watermark now derives from the activation
  marker snapshot's Firestore `readTime`. A fast or slow application instance
  cannot extend or shorten the claimed complete range.
- A marker that exists without a valid authoritative read time returns traffic
  coverage as unavailable with `missing_server_time`; financial aggregates
  remain available.
- The shared read-time parser accepts Firestore timestamp objects only. It
  rejects local `Date` and string substitutes, throwing timestamp accessors,
  invalid nanoseconds, unsafe integers, and out-of-range instants.

## Verification

- Focused server-time, durable-runtime, and bounded-query tests: 3 files and 47
  tests passed.
- Affiliate regression set excluding the separate uncommitted activation-tool
  work: 26 files and 289 tests passed.
- Full TypeScript validation passed with `pnpm exec tsc --noEmit`.
- The production bundle passed with `pnpm run build`; only the existing CSS
  Highlight API parser and large-chunk optimization notices remained.
- Diff/whitespace validation and a staged secret scan are required immediately
  before commit.

## Activation remains blocked

This checkpoint fixes a prerequisite; it does not activate durable analytics.
Before any marker can be created, staging still requires:

1. an explicit staging Firebase Admin credential and exact project/database
   pinning;
2. a fresh verified schema-v3 backup and reconciliation of all nine founding
   affiliates;
3. a protected dedicated click secret;
4. a fully deployed and verified `required` runtime producing recent controlled
   v2 events with the expected key fingerprint and Firestore-derived time;
5. a separately reviewed create-only marker utility using Firestore server time
   for its future boundary; and
6. post-boundary completeness, quota, payment, attribution, and rollback-mode
   failure evidence in staging.

Local process time must never again be used as evidence that durable click
coverage is complete.
