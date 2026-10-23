# Literary Circle durable-click activation-tool checkpoint

Date: 2026-10-22

Verification completed: 2026-10-23 (Africa/Nairobi).

Branch: `feature/literary-circle-upgrade`

Status: local-only; no credential retrieval, Firestore connection, backup,
migration, activation marker, environment change, push, merge, or deployment

## Completed in this checkpoint

- Added a standalone staging-only durable-click activation utility. Dry run is
  the default and has no write path. Apply requires explicit create-only,
  no-rollback, and staging-traffic-quiesced acknowledgements.
- Pinned the exact environment, Firebase project, Firestore database, founding
  affiliate count, staging allow-list, production deny-list, credential source,
  key fingerprint, backup, deployment evidence, proof event, and future lead
  window before any write can be reached.
- Explicitly requires `FIREBASE_SERVICE_ACCOUNT_JSON` with a matching service
  account identity. Application-default credentials, emulators, production
  process environments, known production projects, and allow-list overlap are
  rejected.
- Requires a verified schema-v3 backup no more than 60 minutes old and exact
  equality across every captured affiliate dataset. Unlike the founding
  migration's compatibility comparison, this activation comparison permits no
  Literary Circle, index, click, financial, configuration, or asset drift.
- Reconciles the exact nine founding identities and completed migration marker,
  including chronological marker timestamps and each membership's founding and
  complimentary-access shape.
- Requires a recent controlled immutable v2 click event from a reconciled
  affiliate. The event must have the expected key fingerprint, visitor key,
  deduplication window, canonical schema, create-only metadata, server-time
  proximity, and an exact copy in the fresh backup.
- Authoritative activation time can come only from a Firestore snapshot
  `readTime`. Local `Date`, string, `_seconds`, and `toDate()` substitutes are
  rejected. The local clock is used only for a bounded 30-second drift check.
- Apply uses exactly one `transaction.create()` at
  `site_configs/affiliate_click_analytics`. Any existing marker aborts,
  including an identical marker or a concurrent create race. There is no
  set/merge/update/delete/repair path.
- Post-verification requires the exact six-field body,
  `createTime === updateTime`, and
  `activatedAt <= createTime < completeFrom`, followed by another exact backup
  comparison. Failure never deletes or repairs the irreversible marker.
- Quota cost is explicit: each full comparison reads every document in the
  schema-v3 backup scope. Dry run performs one full comparison; apply performs
  one immediately before the transaction and one after marker verification.
  Each gate snapshot additionally reads the marker, proof event, migration
  marker, and nine affiliate documents. Transaction retries can repeat those
  12 gate reads. Review the manifest counts against staging quota first. Apply
  still commits only the one marker write.
- Reports hash deployment, target, backup, founding-set, proof-event, live-state,
  and marker evidence. They exclude secrets, credentials, visitor keys,
  affiliate identities, proof-event IDs, backup payloads, and raw provider
  errors.

## Verification

- Focused activation library and CLI tests cover zero-write dry run, exact
  create-only apply, existing-marker refusal, concurrent-create conflict,
  post-verification failure without repair, backup drift, explicit
  acknowledgements, strict server-time provenance, exact backup equality, proof
  event privacy/freshness, and output redaction.
- Focused activation tests: 2 files, 82 tests passed.
- Affiliate regression including activation tests: 28 files, 371 tests passed
  with a 30-second test timeout. Vitest reported a slow credential-worker
  termination warning; the run exited successfully with all assertions passed.
- Full TypeScript check and production build passed. Existing build warnings
  remain for the reader-notes CSS highlight selector and large frontend chunks.
- Staged whitespace checks passed. Credential-shaped matches in the new tests
  are deliberately invalid unit-test fixtures; no real credential was added.
- Corrected the pnpm examples to pass arguments without a literal `--` separator.

## Activation remains blocked

The utility has not been run. The workspace still has no approved staging
Firebase Admin credential, verified nine-account staging backup, controlled
required-mode deployment evidence, or backed-up recent proof event. Supplying
those inputs is a separate staging operation.

After a reviewed staging apply, the remaining gates are complete reporting from
`completeFrom`, read/write quota measurement, key-continuity and failure-mode
rehearsal, payment and attribution regression, and an explicit production
decision. This checkpoint provides no production override and does not authorize
production activation.
