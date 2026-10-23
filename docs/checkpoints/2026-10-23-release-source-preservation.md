# Release source preservation checkpoint

Backup schema v5 adds full `newsletter_campaigns` and `articles` collection
snapshots (`newsletter_campaigns` and `release_source_articles` dataset keys).
These preserve the committed release adapter's campaign and publication sources,
including drafts and unknown/custom fields. Existing hashing, manifest scope,
verification and exact live-state comparison apply without projections.

These datasets do not become migration write targets. Founding migration still
writes only its reviewed membership, identity-index and marker records. No
production-apply path was added. Existing backup files are not changed, upgraded
or deleted. The current verifier and click activation refuse older schema-v4
evidence; operators must capture a fresh complete v5 backup. Never relabel an
older manifest or fill missing datasets with fabricated empty arrays.

The backup now contains unpublished article content and campaign information as
well as affiliate/customer/financial data. Keep all files in the approved,
git-ignored backup location with controlled access. Full source collection reads
increase backup/rehearsal cost; budget by live collection size, quiesce edits,
and do not repeatedly capture production just to check progress.

## Verification

- Migration/activation libraries: 2 files, 94 tests passed.
- Activation command: 1 file, 7 tests passed.
- Tests verify exact source capture/round-trip, live source drift rejection,
  older schema refusal and existing activation safety checks.
- Full TypeScript check and production client/server build passed. Existing CSS
  Highlight API and large-chunk warnings remain unchanged.

## Resume boundaries

No real backup capture, migration, database write, payment, email, environment
change or deployment occurred. Staging credentials, actual record preservation
rehearsal and source-consistent backups remain required. Release preparation
remains internal, staging-only and held; automatic audience selection/callers,
sender worker, tier/scheduled sources and buyer analytics remain outstanding.
