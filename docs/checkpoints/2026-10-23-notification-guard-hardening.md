# Notification and staging-guard hardening checkpoint

## Reviewed weaknesses and fixes

1. Staging migration guards previously denied only the current production
   project. Both current and legacy production projects are now denied by the
   shared guard used by migration and click activation. Staging additionally
   requires a valid explicit matching project allowlist with no production
   overlap, rejects Firebase emulator configuration and trims production
   environment markers before checking them. Activation tests cover both
   production projects even when labelled/allowlisted as staging.
2. Global marketing consent alone did not prove when release updates were
   enabled. Server-owned `releaseUpdatesEnabledAt` now records that topic opt-in,
   survives unchanged saves and resets after disable/re-enable. Release planning
   requires both canonical consent timestamps to predate/equal the event.
   Missing legacy evidence is never backdated: an explicit current preference
   save starts eligibility from now. The visible preference is not silently
   disabled, and operational alerts remain independent of marketing consent.
3. Firestore recursive merge could retain omitted stale preference evidence.
   Saves and signed opt-outs now replace only the notificationPreferences map
   and updatedAt field using explicit mergeFields. Other account fields, wallet
   balances and operational preference choices are preserved. Clients cannot
   inject opt-in timestamps through preference updates.
4. Held-outbox retries now independently validate intent type, deterministic
   recipient identity, uniqueness, allowed fields, revision and chronology in
   addition to stored hashes. Semantically invalid records fail closed even
   when a stored evidence hash agrees. No repair/update/delete is attempted.
   Sparse audiences are rejected and database/verifier references are captured
   before asynchronous work. Future-dated approvals cannot prepare intents.

## Verification

- Backup/migration/activation: 3 files, 117 tests passed.
- Notifications, consent, planner, held outbox, sources, approval: 6 files,
  137 tests passed. Total targeted regression: 254 tests, none skipped.
- The initial sandboxed Vitest invocation failed during Vite config loading
  (ancestor-directory access denial), before running tests. Approved local
  test execution outside that restriction passed; no test assertions or
  timeouts were weakened.
- Full TypeScript check and production client/server build passed. Existing CSS
  Highlight API and large frontend chunk warnings remain unchanged.

## Boundaries and outstanding review items

No live emails, payments, production reads/writes, migrations, environment
changes, deployment or automatic notification activation occurred. Existing
backup files were untouched. Backup schema remains v5; preference evidence is
optional and carried by existing full affiliate snapshots without fabrication.

This is targeted hardening, not a claim of maximum/absolute security or full
audit completion. Remaining release gates include staging credentials, fresh
verified backups and migration rehearsal, delivery worker/source revalidation,
tier/scheduled event adapters, buyer analytics and end-to-end/mobile testing.

Further preservation review should include immutable click-activation and
founding migration markers in future backup scope (requiring a new schema
version and fresh evidence). Migration CLI explicitly selects SDK project and
database, but stricter staging-only credential provenance and independent
database confirmation should be added before any real apply; unlike activation,
it can currently use ADC or cross-project credentials. No demonstrated target
redirect was found, and no real apply was attempted. Existing frontend chunk
size and CSS Highlight API optimizer warnings also remain open.
