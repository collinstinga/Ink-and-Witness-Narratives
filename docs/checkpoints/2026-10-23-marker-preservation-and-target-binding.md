# Marker preservation and migration target binding

## Completed local work

- Backup schema v6 adds explicit snapshots of the named click-activation and
  founding-migration markers. Unknown marker fields are preserved in backups;
  unrelated migration markers are not captured. Older files remain untouched,
  but current release verification requires a fresh complete v6 backup.
- Activation preflight remains exact across all datasets. Post-verification may
  differ only by the exact six-field marker independently verified after this
  command's create-only transaction. Existing markers cannot be replaced.
  The activation test harness now captures marker state after writes instead
  of returning a stale backup clone that hid this distinction.
- Founding migration compares the marker again inside its transaction and
  returns its expected merged marker for exact post-verification, excluding that
  payload from reports. Same-backup retries permit only unchanged evidence or a
  strict completed first-apply marker bound to the backup hash/ID, nine-account
  identity set, chronology and attempt count. Unrelated marker drift is refused.
- Migration now requires explicit expected project and database, a valid
  staging allowlist, and explicit service-account JSON owned by that staging
  project. ADC and cross-project credentials are refused before initialization.
  Unknown, duplicate, whitespace-padded or ambiguous arguments fail closed.
- Both migration and activation check the actual SDK client's recorded target,
  not just environment labels, before database reads/writes. Migration validates
  that binding again at apply and post-verification boundaries. Generic CLI
  failures suppress provider details and raw source/credential values.

## Verification

Initial four migration/activation suites: 173 tests passed. An expanded forked
run reported 169 passing tests but a worker out-of-memory crash; it was not
treated as a complete pass. A launcher/thread retry also exhausted memory and
reported a launcher runtime failure. Direct bundled Node execution with a
256 MB heap and one thread then passed all 10 activation CLI checks, with
unchanged assertions and timeouts. Final expanded regression, full TypeScript
and build results recorded after completion.

Final bounded-runtime regression: **5 files, 179 tests passed**, none skipped,
no unhandled errors. Full TypeScript check passed using direct bundled Node
with a 768 MB heap (no assertions, library checking or compiler options skipped).
Production client and server builds passed using direct Node with bounded heaps
(512 MB for Vite, 256 MB for the esbuild launcher). This runs the same build
steps/arguments as package.json without the pnpm wrapper. The root cause of
the earlier resource/runtime failures was not conclusively isolated. Existing
CSS Highlight API and large frontend chunk warnings remain unchanged.

## No live changes

No real backup capture, Firebase project creation, migration, production read or
write, credential/environment change, payment, email, deployment or automatic
notification activation occurred. No existing backup was overwritten/deleted.

## Remaining upgrade work

Actual staging credential/resource provisioning, fresh v6 preservation evidence
and rehearsal remain required. Tier/scheduled notification sources, bounded
delivery worker and provider reconciliation, buyer analytics integration and
full end-to-end/mobile/payment verification are still incomplete. Existing
frontend chunk-size and CSS Highlight API optimizer warnings remain. These
checks close the previously documented marker/credential/client-binding gaps;
they do not establish full audit completion or production release readiness.
