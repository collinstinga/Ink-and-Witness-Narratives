# Literary Circle committed-event notification checkpoint

Date: 2026-10-23 (Africa/Nairobi)

Branch: `feature/literary-circle-upgrade`

## Completed locally

Connected explicit writer approval and committed commission generation/retries
to notification preparation after their business transactions commit. Failures
in preparation cannot roll back or turn a successful approval/payment into a
failure. They emit a fixed warning without source IDs, receipts, contacts,
provider errors, or credentials. Both original business workflows retain their
existing financial and access behavior.

Activation requires an active account with valid, non-future explicit approval
metadata. Its event version is the approval timestamp, so retrying the same
approval does not create another activation intent.

Commission preparation loads the committed commission and its exact payment
document. It requires a positive bounded commission and sale amount, a verified
commission status without a fraud flag, and a settled PURCHASE on a supported
payment rail. Transaction ID, checkout ID, piece, affiliate code, receipt and
amount must agree. Tips, pending/failed payments, reversals, zero commissions,
future sources and mismatched joins produce no new intent. Existing paid data
is neither modified nor backfilled.

Before outbox reads/writes, a transaction precondition re-reads the source
documents and compares their fingerprints with the originally inspected
records. A concurrent suspension, approval edit, reversal or payment change
prevents preparation. Config/recipient eligibility is still read transactionally
by the held-outbox implementation on first creation. Returning an existing held
record is storage verification, not permission to dispatch it.

## Runtime and recovery safeguards

`AFFILIATE_NOTIFICATION_EVENT_MODE=off` is the default. It performs no extra
notification database reads or transactions. The only enabled mode is `held`,
restricted to an explicit staging project allow-list and a Firestore client
matching the configured project and database. Known/dynamic production targets,
production deployments, allow-list overlap, emulators and unknown modes fail
closed. Vercel preview with NODE_ENV=production is allowed only for the verified
staging target. No provider-send mode exists.

Client identity is recorded in a private WeakMap at actual server-client
construction. Reading a copy of that binding performs no network operation;
unregistered clients are refused. Later environment or returned-object edits
cannot relabel a cached client. This replaces an initial unsupported assumption
about a public SDK `projectId` property, caught by TypeScript and covered by
dedicated client-binding tests.

Added bounded internal recovery for at most 25 unique exact source IDs per call.
It performs sequential direct-document reads, no collection scan, cron or
background discovery. Inputs are captured before asynchronous work so appending
IDs cannot bypass the batch limit. Results contain aggregate statuses only.
No runtime routes or scheduled recovery entry points were added.

For a newly eligible single-recipient event, activation uses six reads and two
writes; commission preparation uses eight reads and two writes. Existing-event
verification uses four/six reads respectively and zero writes. Transaction
retries repeat the transaction reads; the initial source reads are outside that
retry. A 25-ID batch therefore has a pre-retry ceiling of 150/200 reads and
50 writes. Disabled or blocked preparation performs no document read.

Held source/intent records are already covered by backup schema v4; no new
dataset, schema bump, secret, production environment change, deployment,
production write, payment or email was performed in this checkpoint.

## Remaining work

Release and tier-upgrade source adapters still require committed publication
revision and tier-transition evidence. Scheduled campaign, opportunity and
inactivity adapters still require their timing/cooldown histories. The sender
worker must independently recheck current approval, consent/preferences,
suppression, configuration, source validity, and reviewed delivery gates, then
implement bounded leases/retries, provider idempotency, webhook reconciliation
and dead-letter visibility. Held records alone never authorize delivery.

Staging provisioning, verified affiliate records, fresh v4 backups, preservation
rehearsal and the production release gate remain pending. Do not run historical
recovery or activate preparation before those staging prerequisites are met.

## Verification

- Final source, held-outbox, planner, settings, consent, approval, commission and
  payment-settlement/client-binding regression: **10 files, 157 tests passed**, no skipped tests.
- Full TypeScript check passed after the client-target correction.
- Production client/server build passed. Existing CSS Highlight API and
  large-chunk warnings remain unchanged.
- Staged whitespace and targeted secret/conflict-marker checks passed.
