# Literary Circle migration checkpoint

Migration commands are intentionally staging-only. They refuse to connect
unless `--environment=staging`, an exact `--expected-project`, and
`--expected-affiliates=9` are supplied. They also refuse a process marked as
production. Set `LITERARY_CIRCLE_PRODUCTION_PROJECT_IDS` to the comma-separated
production project IDs as an additional deny-list. The known production project
`ink-and-witness-narratives` is denied in code even when that environment
variable is absent.

Both current and legacy production projects are denied in code. Staging access
also requires `LITERARY_CIRCLE_STAGING_PROJECT_IDS` to explicitly contain the
exact target project, with no malformed or production-overlapping entries.
Configured Firebase emulators are refused by these real-staging tools. Use
least-privilege staging-only credentials and explicitly verify the database ID;
the project label alone does not prove credential isolation.

`FIREBASE_PROJECT_ID` and `FIRESTORE_DATABASE_ID` must identify the staging
target. These environment overrides take precedence over
`firebase-applet-config.json`, and the migration validates the same resolved
target that the Firebase server client opens. Do not rely on the
`--environment=staging` label by itself.

The backup command is read-only and may target staging or production. A
production backup additionally requires `--allow-production-read-only`, the
exact project ID, an explicit `--expected-database`, and the exact nine-account
count. That flag never enables a database write. The command rejects duplicate,
unknown, empty or ambiguous arguments, emulator configuration, and production
targets or processes labelled as staging. Before capture and before publishing
backup evidence, it verifies the initialized client's recorded project/database
against that exact target; missing or cross-target bindings fail closed. Provider,
filesystem and payload errors are redacted instead of printing raw details.

The backup contains personal and financial data. It is written under the
git-ignored `data/backups/` directory with a timestamped backup ID. Do not
commit, email, or copy it to an unapproved location.

Current backup schema is v8. It also captures all newsletter campaign and
article documents, preserving release-notification source evidence, unpublished
content and publication state without projection. Treat these additional files
as confidential. Capturing and comparing them requires collection reads; budget
for the full campaign/article counts and quiesce content edits during rehearsal.
These datasets are preservation evidence only, not migration write targets.
Older backups remain unchanged but cannot satisfy the current verifier. Take a
fresh complete backup; never relabel an older manifest or invent empty datasets.

Schema v6 also preserves the named durable-click activation marker and founding
migration marker. Unrelated migration markers are excluded. Activation compares
all datasets exactly before writing; post-verification allows only its exact
independently verified newly created marker. Migration retries accept only an
unchanged marker or the completed first-apply marker tied to the same backup
hash, backup ID and nine affiliate identities; post-verification compares the
exact transaction result. No marker repair/delete fallback is provided.

Schema v7 additionally preserves all independent partner-notification delivery,
lease, attempt, retry, dead-letter and suppression records, plus the reviewed
`affiliate_notification_delivery` configuration. These records are confidential
and must be quiesced with notification workers during a preservation comparison.
They are not migration write targets. Schema v7 originally required a newly
captured snapshot; existing v6 files remain unchanged and must not be relabelled
or padded with invented data. The current verifier requires v8 as described below.

Schema v8 additionally captures every `affiliate_tier_periods` document, including
the exact monthly qualifying commission membership and permanent awarded milestone
keys. These are financial-pricing evidence, not expiring cache entries or migration
write targets. Quiesce sales and commission reversals as well as other financial
writes during exact comparison. A newly captured v8 snapshot is required; schema
v7 was committed before this dataset existed and cannot verify its preservation.
No existing backup is upgraded in place or padded with an invented empty dataset.

Migration now requires `--expected-database` and explicit
`FIREBASE_SERVICE_ACCOUNT_JSON` belonging to the exact allowlisted staging
project. ADC and cross-project credentials are refused before initialization.
The initialized client's recorded project/database must also match before reads
or writes. CLI arguments reject duplicates and unknown flags. Provider failures
are redacted, rather than exposing source payloads or credential details.

## Staging sequence

Use staging credentials and replace the example project and backup path:

```powershell
npm run literary-circle:backup -- --environment=staging --expected-project=ink-witness-staging --expected-database="(default)" --expected-affiliates=9

npm run literary-circle:migrate:dry-run -- --environment=staging --expected-project=ink-witness-staging --expected-database="(default)" --expected-affiliates=9 --backup=data/backups/literary-circle-TIMESTAMP/manifest.json

npm run literary-circle:migrate:apply -- --environment=staging --expected-project=ink-witness-staging --expected-database="(default)" --expected-affiliates=9 --backup=data/backups/literary-circle-TIMESTAMP/manifest.json
```

Before any eventual production migration, capture and verify the live records
without enabling writes:

```powershell
npm run literary-circle:backup -- --environment=production --allow-production-read-only --expected-project=EXACT_PRODUCTION_PROJECT_ID --expected-database="(default)" --expected-affiliates=9
```

There is deliberately no production-apply flag in this checkpoint. Production
write enablement requires separately reviewed staging, preservation, approval
and live drift checks. The original staging migration and its exact-nine repeat
remain separate from later intentional test fixtures.

### Offline production release planning

`literary-circle:release:plan` builds a **review plan only** from an already
verified local backup. It never initializes a database client, reads credentials,
connects to a provider, approves an account, sends email or charges a payment.
There is no `--apply`, write-authorization or freshness-bypass flag.

```powershell
pnpm run literary-circle:release:plan --expected-project=EXACT_PRODUCTION_PROJECT_ID --expected-database="(default)" --expected-affiliates=9 --backup=data/backups/EXACT_BACKUP/manifest.json --expected-backup-sha256=EXACT_MANIFEST_SHA256 --expected-cohort-sha256=PINNED_ORIGINAL_NINE_COHORT_SHA256 --source-commit=EXACT_40_CHARACTER_SOURCE_SHA --staging-evidence=data/release-reviews/EXACT_REVIEW/staging-evidence.json
```

The separately pinned cohort digest binds original document IDs, normalized
referral identities and hashed email identities. Compute it from the preserved
original-nine evidence, **not from a changed candidate cohort to bypass a
conflict**. The plan also binds complete account and financial-policy digests.
Existing commission arrangements stay unchanged; proposed rates are not activated.

The fixed backup freshness window is 30 minutes; staging review evidence is
valid for at most 24 hours and must bind the same source SHA. Stale evidence
remains visibly blocked rather than being silently refreshed or relabelled.
An omitted evidence file produces pending rehearsal checks, never assumed passes.
The CLI exits **2 for a blocked review plan**, 1 for invalid inputs/integrity,
and does not offer a release-authorized success mode.

Optional evidence is a strict schema-1 operator report containing `sourceCommit`,
`stagingProjectId`, `databaseId`, `deploymentId`, `deploymentUrl`, `verifiedAt`,
and exactly these check IDs: `access_and_registration`, `financial_preservation`,
`writer_controls`, `reader_purchases_and_chapters`, `subscription_referral_checkout`,
`refund_reconciliation`, `notification_delivery`, `browser_mobile`. Each check
has an explicit string status (`passed`, `pending`, `blocked`); a claimed pass
requires the underlying artifact's SHA-256 digest. No arbitrary messages,
credentials or customer identifiers belong in this report. Evidence paths must
be regular local files within workspace `data/`, capped at 64 KiB; network/device
paths, URI schemes, escapes, symbolic links and junctions are refused. Backup
manifest/dataset paths receive the corresponding local-only link checks.

Even a report claiming every rehearsal passed is **not authorization**. Plans
always retain `writeAuthorized: false` and an empty database-write allowlist.
A future separately reviewed apply path must independently validate the plan,
current database state, policy/config/cohort drift, owner-authorized approval
and its audit, and the exact staged production build before domain promotion.

Run the dry-run command again with the same verified backup. A healthy repeat
shows no membership or index changes, proving the migration is idempotent.

## Durable-click activation utility

The create-only durable-click marker has a separate staging-only utility. It is
not part of the founding migration and has no production override. The command
defaults to a zero-write dry run; apply additionally requires all three explicit
acknowledgements shown below.

Before either command:

1. deploy `AFFILIATE_CLICK_LEDGER_MODE=required` to every staging instance with
   the protected dedicated click secret;
2. complete a controlled referral smoke test through that immutable staging
   deployment and retain both its deployment reference and its `aclk2_...`
   Firestore event ID;
3. quiesce staging affiliate traffic;
4. take a new verified schema-v8 backup after the proof event exists; and
5. keep `FIREBASE_SERVICE_ACCOUNT_JSON` available only in the protected local
   process environment. Application-default credentials are refused.

The deployment reference is operator-supplied evidence from the separate
staging smoke run. The utility hashes it in its report but does not claim to
query or validate Vercel. It independently validates the referenced Firestore
event's strict v2 schema, reconciled affiliate ownership, key fingerprint,
create-only metadata, authoritative time, recency, and presence in the fresh
backup.

Example dry run:

```powershell
pnpm run literary-circle:click-activation:dry-run --environment=staging --expected-project=ink-witness-staging "--expected-database=(default)" --expected-affiliates=9 --backup=data/backups/literary-circle-TIMESTAMP/manifest.json --expected-key-fingerprint=ack1_EXPECTED_NON_SECRET_FINGERPRINT --deployment-evidence=dpl_ImmutableStagingDeployment --proof-event-id=aclk2_CONTROLLED_EVENT_ID --lead-minutes=30
```

Only after the dry-run report is reviewed, use the same evidence and add the
irreversible-boundary acknowledgements:

```powershell
pnpm run literary-circle:click-activation:apply --environment=staging --expected-project=ink-witness-staging "--expected-database=(default)" --expected-affiliates=9 --backup=data/backups/literary-circle-TIMESTAMP/manifest.json --expected-key-fingerprint=ack1_EXPECTED_NON_SECRET_FINGERPRINT --deployment-evidence=dpl_ImmutableStagingDeployment --proof-event-id=aclk2_CONTROLLED_EVENT_ID --lead-minutes=30 --acknowledge-create-only --acknowledge-no-rollback --acknowledge-staging-traffic-quiesced
```

Apply performs one permitted write: `transaction.create()` at
`site_configs/affiliate_click_analytics` with the exact six-field v1 marker.
Any pre-existing marker, including an identical one, aborts with a conflict.
The tool never updates, merges, deletes, repairs, or retries an existing marker.
It reads the marker back, verifies `createTime === updateTime` and
`activatedAt <= createTime < completeFrom`, then repeats exact live-to-backup
comparison. If post-verification fails, the marker is deliberately left intact
for manual incident review; never delete it to rerun activation.

The JSON report contains hashes and non-secret configuration evidence only. It
must not contain the service account, dedicated secret, visitor key, affiliate
identity, proof-event ID, or raw provider errors. Store any captured report only
under an approved, git-ignored `data/` location.

## Backup scope and checks

The snapshot contains every document from `affiliates`,
`affiliate_commissions`, `affiliate_clicks`, `affiliate_payouts`,
`affiliate_campaigns`, `affiliate_audit`, `affiliate_codes`,
`affiliate_emails`, `affiliate_commission_outbox`, `affiliate_attribution_claims`,
`affiliate_notification_outbox`, and `affiliate_notification_deliveries`; only affiliate-attributed documents from
`transactions`; and the `affiliate_settings`, `affiliate_literary_circle`,
`affiliate_notifications`, `affiliate_notification_delivery`, and `literary_circle_resources` documents from
`site_configs` when present. Backup schema version 4 includes the preview-only
affiliate-notification configuration without treating it as subscriber consent
or a delivery ledger. It also includes exactly every
`uploaded_assets` document referenced by an `items[].assetId` in that resource
library, including draft, expired, and private resource artwork. The backup
aborts if any referenced asset document is missing.

Version 4 adds verbatim notification source and held-intent records. Earlier
backup files remain untouched, but current migration and click-activation tools
reject them because they lack the new scope. Take a fresh current-version backup;
never relabel an older manifest or synthesize an empty outbox to bypass checks.

`affiliate_sessions` is deliberately excluded because it contains revocable
bearer credentials rather than historical programme data. The manifest records
SHA-256 hashes, document counts, and financial/statistical sums. Apply verifies
every file hash and summary, the Firestore target, the exact nine-account
identity set, and live ledger contents before any write. After the transaction,
it captures the datasets again and verifies that every backed-up account field,
financial record, click, claim, transaction, configuration value, and other
historical record is unchanged except for the explicitly allowed Literary
Circle membership and same-owner index additions. Resource-asset verification
also requires the backed-up asset-document IDs to exactly match the references
in the backed-up resource library, preventing both omissions and unrelated
asset inclusion.

## Apply checkpoint

- Confirm the manifest reports exactly nine affiliates.
- Confirm commission, payout, wallet, click, revenue, and transaction totals.
- Resolve every referral-code or email-index ownership conflict; the script
  aborts the entire transaction if any conflict exists.
- Confirm the single `migration_markers/literary-circle-founding-affiliates-v1`
  marker is complete after apply.
- Confirm all nine accounts retain their original IDs, referral codes, fields,
  balances, ledgers, and statistics and now have founding membership.
- Keep payment providers in sandbox/test mode throughout staging validation.

The apply transaction adds only missing Literary Circle membership defaults,
forces permanent founding recognition, creates or completes index reservations
only when unowned or owned by the same affiliate, and writes the resumable
migration marker. It does not alter commission or payout ledgers. Restoration
is an operator-controlled Firestore procedure; this change does not include an
automatic restore command.

## Approval and communication-preference checkpoint

Affiliate documents may now contain additive `approvedAt`, `approvedBy`, and
`notificationPreferences` fields. They are already covered by the verbatim
`affiliates` backup and equality checks in schema version 4.
Missing preference data means unknown consent and no optional marketing;
accepted programme terms must never be promoted into marketing consent.

Self-registered accounts are created as `pending` and receive no session until
the writer explicitly approves them. Do not bulk-convert legacy `active` status
into approval. Before a staging or eventual production approval pass, the
writer must verify the exact nine-account identity set from the guarded backup.
Approval, preference saves, and signed marketing opt-outs are transactional and
audited; none of them enables notification delivery.

Before any partner email renderer is activated, provision a protected
`AFFILIATE_NOTIFICATION_SIGNING_SECRET` of at least 32 characters in the exact
target environment. The code can safely fall back to the existing newsletter
or session signing secret, but a dedicated secret gives cleaner rotation and
incident isolation. Never place the value in source, a backup, logs, or chat.

## Commission policy continuity

Tier commission settings remain proposals until the writer explicitly confirms
an active policy and a current or future effective date. Each confirmed
activation, replacement, or deactivation receives a new server-controlled
version and an effective-dated snapshot. Delayed M-PESA settlements are priced
against the highest policy version that was effective when the transaction
occurred; completed commission records remain immutable. Subscription renewals
fail closed unless the effective snapshot explicitly permits renewal
commission.

## Privacy-preserving affiliate analytics checkpoint

The local branch contains server-only analytics primitives that can derive a
versioned, non-reversible buyer pseudonym from a verified reader account or a
settled Kenyan M-PESA payer phone using HMAC-SHA-256. They are not connected to
production, do not read an environment secret, and do not store or backfill a
field. Those primitives add no extra dataset beyond the current version-4 scope.

Before enabling new-reader or repeat-purchase analytics, provision a dedicated
protected `AFFILIATE_ANALYTICS_HMAC_SECRET` with at least 32 bytes in staging,
document rotation behavior, and rehearse the date-bounded join against the
verified backup. Never use an unkeyed phone/email hash, a receipt number, an IP
address, or a browser fingerprint as a buyer identity. The Writer Portal must
receive aggregate counts only; HMAC keys and source identities remain
server-side. Click conversion must stay unavailable until the selected window's
durable click-history coverage can be proven.

The Writer Studio now has a local-only, aggregate analytics checkpoint that
reuses the already-loaded affiliate, commission, and retained click ledgers.
It performs no additional Firestore reads or writes. Buyer metrics therefore
remain unavailable, and the capped 90-day click cache is labelled partial with
conversion withheld. Do not connect the HMAC buyer projection to this route or
hydrate the transaction ledger until a bounded staging rehearsal has proved
privacy, idempotency, and quota cost. See
`docs/checkpoints/2026-10-20-literary-circle-writer-analytics.md`.

The next local-only checkpoint adds privacy-safe durable-click primitives but
does not connect them to a route, cookie, Firestore collection, counter, or
analytics response. A future visitor pseudonym is derived from a signed random
nonce rather than an IP address or browser fingerprint. The v2 event validator
also rejects unknown/private request fields and minimises referrers to their
origin. Runtime integration requires a protected staging
`AFFILIATE_CLICK_ANALYTICS_SECRET`, an activation marker, bounded query proof,
an explicit retention decision, and transaction-level idempotency. Existing
legacy `affiliate_clicks` documents must be preserved verbatim. See
`docs/checkpoints/2026-10-20-literary-circle-durable-click-primitives.md`.

The gated runtime integration is also present locally, but its default mode is
`off`, so it has no new production behavior until an environment is explicitly
staged. `shadow` mode uses the dedicated click key and random first-party
visitor pseudonym to dual-write deterministic v2 events while retaining the
current rolling legacy counter and unique-visitor decisions; `required` mode
then cuts over to deterministic event existence and fails accepted tracking
closed if the same atomic transaction cannot create the event and increment
the affiliate/campaign counters. Legacy click documents are never enumerated,
rewritten, deleted, or assigned TTL. Do not activate this
path until the protected staging key, guarded nine-affiliate backup, event and
quota verification, separately reviewed bounded query, and immutable future
`completeFrom` marker are all ready. See
`docs/checkpoints/2026-10-21-literary-circle-durable-click-runtime.md`.

The bounded Writer analytics query is now present locally. It reads the fixed
activation marker on demand, queries only an inclusive timestamp range with a
1,001-document hard limit, rejects private or malformed records, and never
reads the marker on the public click path. Unsupported click dimensions cause
zero Firestore reads; query or configuration failure keeps financial
aggregates available while making traffic metrics unavailable. Marker creation
is deliberately excluded. The reader verifies immutable Firestore marker
metadata, a non-secret commitment to the deployed click key, and a ten-minute
ingestion watermark; durable conversion stays withheld until a real
click-to-sale cohort join exists. Identical concurrent reads are coalesced and
the writer route is process-limited. The route continues using the explicitly
partial local fallback until the marker exists. Do not activate or deploy this
work without the guarded staging sequence above. See
`docs/checkpoints/2026-10-21-literary-circle-durable-click-query.md`.

Durable event time and the Writer analytics ingestion watermark are now
anchored to Firestore snapshot `readTime`, not an application instance's local
clock. `required` click tracking and activated analytics fail closed when that
authoritative time is unavailable; `shadow` mode preserves the legacy path
without claiming durable coverage. A fully deployed and controlled
`required`-mode staging proof must precede marker creation. See
`docs/checkpoints/2026-10-21-literary-circle-server-time-hardening.md`.
