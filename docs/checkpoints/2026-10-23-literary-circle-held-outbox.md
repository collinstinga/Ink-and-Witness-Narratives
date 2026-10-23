# Literary Circle held notification outbox checkpoint

Date: 2026-10-23 (Africa/Nairobi)

Branch: `feature/literary-circle-upgrade`

## Completed locally

Added create-only transactional storage for planned notification source events
and held recipient intents in `affiliate_notification_outbox`. Storage defaults
to disabled and needs both an explicitly supplied Firestore client and the
internal `held` mode. There are no routes, event hooks, cron jobs, provider
transports, workers, runtime environment changes, or live writes in this slice.

First creation reads current notification settings and affiliate documents in
the same transaction as the event and intent writes. Account identity comes from
the document path, not its stored `id` field. No eligible recipients means no
write. Transactions use `create()` only and never modify existing accounts,
financial records, or outbox documents.

Source evidence and the requested audience are frozen by hashes. Concurrent
requests and retries return the original held records without creating a second
set, even if template revisions or retry time change. Changed source timestamps
or audience sets conflict. Replays verify all referenced held records and their
body hashes. Missing, modified, or orphaned records fail without a repair or
overwrite fallback. Provider errors are replaced with a fixed, redacted error.

The outbox contains internal source and affiliate identifiers so a later worker
can resolve committed business records. It contains no copied recipient email,
phone, name, rendered message, credential, or payment amount. Results expose only
status and count. Checked-in Firestore rules deny browser/mobile reads and writes;
the new collection remains server-only.

## Backup change

Backup schema is now version 4. Its additional all-documents dataset preserves
notification source and intent records verbatim. Migration live-state equality
and click activation include this dataset. Activation uses the shared schema
constant rather than accepting the older incomplete scope.

Older backup files are preserved, but the current verifier refuses them. A fresh
version-4 backup is required before any migration or activation. Do not edit old
manifests, erase existing evidence, or synthesize empty data to bypass scope.

## Cost and next integration boundary

For N requested affiliates and M eligible intents, first creation reads
`2 + N + M` documents and writes `1 + M` documents. No-recipient creation reads
`2 + N` and writes zero. Existing-event verification reads `1 + M` and writes
zero. The bounded 200-person batch therefore uses at most 402 reads and 201
writes per transaction attempt; retries repeat reads. Disabled mode does no
transaction. Full backups additionally read the complete outbox dataset.

The supplied source must eventually come from a committed, verified server-side
business event. This storage helper does not verify the commission/payment
itself, infer sales, or modify financial outcomes. Source-event hooks and recovery
of missed events still need implementation. A later worker must recheck fresh
consent, approval, suppression, configuration, and delivery gates, with separate
lease/attempt state so held evidence remains immutable. Existing storage success
does not authorize dispatch. Scheduled reminder/campaign sources remain blocked
by the planner until their evidence is implemented.

Staging provisioning, fresh backups, the verified affiliate list, preservation
rehearsal and production release checks are still pending. No production data,
secret, environment, deployment, payment, or email was changed.

## Verification

- Outbox/planner, notification settings, consent, approval, backup, and activation
  regression: **8 files, 157 tests passed**, with one worker and no skipped tests.
- Full TypeScript check passed with no diagnostics.
- Staged whitespace and targeted secret/conflict-marker checks passed.
- Production client/server build passed. Existing CSS Highlight API and
  large-chunk warnings remain unchanged.
