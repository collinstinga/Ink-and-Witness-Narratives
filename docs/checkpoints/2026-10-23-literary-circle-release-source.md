# Literary Circle committed release source

## Local implementation

The internal committed-event adapter now accepts `new_release` with an explicit
server-selected frozen audience of 1–200 unique affiliate IDs. It reads the
existing piece-specific `newsletter_campaigns` record, checks its deterministic
release ID against the piece ID, requires a recorded creator, canonical UTC
creation/queue timestamps with valid chronology, and queued/sending/sent/
partially_sent status. Draft, cancelled, failed, corrupt and future sources are
ineligible. The associated article must still exist and be published.

The source timestamp is the campaign queue timestamp, never article publishedAt
or updatedAt. Event version stays 1: retries, article edits and campaign delivery
status transitions cannot create another event. Source and article snapshots
are reread in the held-outbox transaction, preventing an unpublish/cancel race.
Changed source evidence or audience on replay cannot overwrite existing held
records. No financial or newsletter campaign data is written by this adapter.

Existing planner consent/preferences and historical-release suppression apply.
No contact details, campaign content or article text are copied to the outbox.
The existing staging-only runtime/client binding gates remain unchanged.

## Verification

- 3 files / 91 notification tests passed, none skipped.
- Full TypeScript check and production client/server build passed. Existing CSS
  Highlight API and large frontend chunk warnings remain unchanged.
- Whitespace check passed.

## Remaining boundaries

No automatic caller, recipient discovery, route, sender, cron, production write,
environment change or deployment was added. This is a held preparation adapter,
not completed notification delivery. Bounded account-event recovery deliberately
does not accept release broadcasts without their explicit audience.

Before staging activation, preserve newsletter campaign source evidence in the
reviewed backup/rehearsal scope as well as the existing v4 affiliate/outbox data.
The audience must be chosen once and retained; do not split a campaign into
different audience calls. More than 200 recipients needs a separately reviewed
batch identity design. Campaign requeue timestamp changes conflict with existing
held source evidence and require inspection, not repair/resend. A future delivery
worker must freshly revalidate source, consent, suppression and delivery gates.
