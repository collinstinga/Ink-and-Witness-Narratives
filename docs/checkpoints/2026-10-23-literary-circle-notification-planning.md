# Literary Circle notification planning checkpoint

Date: 2026-10-23 (Africa/Nairobi)

Branch: `feature/literary-circle-upgrade`

## Completed locally

Added an internal, bounded notification planner for activation, new releases,
new commissions, and tier upgrades. It derives stable source-event and
per-affiliate intent IDs. Retries, recipient ordering, template revisions, and
planning time do not change the identity of an existing intent. A different
source version or intended affiliate has a distinct identity.

The planner checks the existing strict template settings, global/template
switches, writer approval, account status, accepted terms, membership,
complimentary access and tier filters, and current communication preferences.
Operational events do not require marketing consent. Releases require current
explicit marketing consent, release preference, and no all-marketing opt-out.

Account-specific events require an explicit target and cannot fan out to other
accounts. Batches are capped at 200 with duplicate affiliate IDs rejected;
oversized batches fail rather than silently truncate. Source fields are
allow-listed, identifiers are bounded, timestamps are canonical and cannot be
future-dated, and delays use source time rather than retry time.

All intents remain `held` with `deliveryMode=preview_only`. No names, email
addresses, financial values, message bodies, or raw source IDs are copied into
the plan. Affiliate IDs remain internal server-side routing references and must
not be exposed through a public route. Inputs are not mutated.

## Deliberately incomplete delivery infrastructure

This module performs no database reads/writes and sends no email. It is not
connected to routes, source hooks, a worker, cron, or queue. Stable IDs alone
do not provide exactly-once delivery: durable create-only outbox persistence
and provider idempotency remain necessary.

Scheduled campaigns, inactivity reminders, and opportunities are rejected.
They require validated campaign/opportunity sources, last-activity evidence,
lead times, and cooldown history before planning can be enabled for them.

Before wiring source hooks, add atomic event/outbox persistence together with
backup coverage and migration tests. Sources must be committed server-side
business events, not client-submitted claims. A future worker must recheck
current eligibility, templates, suppression, and consent immediately before
dispatch, then implement bounded leases/retries, provider idempotency, webhook
reconciliation, and dead-letter visibility. Template/source version conflicts
must not overwrite an existing outbox record or create an unintended resend.

The staging resource, preservation rehearsal, and production delivery gates
remain unchanged. No existing account or financial data was touched.

## Verification

- Planner, notification configuration, preferences, and approval regression:
  **4 files, 42 tests passed**, using one worker.
- Full TypeScript check passed without diagnostics.
- Production client/server build passed. Existing CSS Highlight API and
  large-chunk warnings remain unchanged.
- Staged whitespace and targeted secret/conflict-marker checks passed.
