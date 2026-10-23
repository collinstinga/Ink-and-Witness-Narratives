# Literary Circle: release consent checkpoint

## Scope

Incremental local hardening after `de37ed4`. No deployment, email send,
environment change, database migration, or customer/financial record write.

Release notification planning now requires marketing consent to predate or
equal the committed release event timestamp. Consent acquired after a release
cannot make that historical release eligible on replay, even when replay is
performed days later. Existing current-consent/preference checks remain intact;
operational commission alerts remain independent of marketing consent.

This does not authorize email delivery. A future worker must independently
recheck current consent, suppression, source validity and delivery gates.
Existing held records are not modified or deleted by this change.

## Verification

- Planner, held outbox and committed-event regression: 3 files, 80 tests passed.
- Full TypeScript check passed.
- Production client/server build passed; existing CSS Highlight API and large
  frontend chunk warnings remain unchanged.

## Resume

Release and tier source adapters, scheduled events, delivery worker, buyer
analytics integration and staging preservation rehearsal remain outstanding.
Article `publishedAt` can be a date-only string and must not be treated as a
durable publication event/revision. Establish explicit committed publication
evidence and retry-safe audience partitioning before enabling release hooks.
Keep default notification event mode off; no production delivery is enabled.
