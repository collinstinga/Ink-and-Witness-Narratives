# Literary Circle migration checkpoint

Migration commands are intentionally staging-only. They refuse to connect
unless `--environment=staging`, an exact `--expected-project`, and
`--expected-affiliates=9` are supplied. They also refuse a process marked as
production. Set `LITERARY_CIRCLE_PRODUCTION_PROJECT_IDS` to the comma-separated
production project IDs as an additional deny-list. The known production project
`ink-and-witness-narratives` is denied in code even when that environment
variable is absent.

`FIREBASE_PROJECT_ID` and `FIRESTORE_DATABASE_ID` must identify the staging
target. These environment overrides take precedence over
`firebase-applet-config.json`, and the migration validates the same resolved
target that the Firebase server client opens. Do not rely on the
`--environment=staging` label by itself.

The backup command is read-only and may target staging or production. A
production backup additionally requires `--allow-production-read-only`, the
exact project ID, and the exact nine-account count. That flag never enables a
database write.

The backup contains personal and financial data. It is written under the
git-ignored `data/backups/` directory with a timestamped backup ID. Do not
commit, email, or copy it to an unapproved location.

## Staging sequence

Use staging credentials and replace the example project and backup path:

```powershell
npm run literary-circle:backup -- --environment=staging --expected-project=ink-witness-staging --expected-affiliates=9

npm run literary-circle:migrate:dry-run -- --environment=staging --expected-project=ink-witness-staging --expected-affiliates=9 --backup=data/backups/literary-circle-TIMESTAMP/manifest.json

npm run literary-circle:migrate:apply -- --environment=staging --expected-project=ink-witness-staging --expected-affiliates=9 --backup=data/backups/literary-circle-TIMESTAMP/manifest.json
```

Before any eventual production migration, capture and verify the live records
without enabling writes:

```powershell
npm run literary-circle:backup -- --environment=production --allow-production-read-only --expected-project=EXACT_PRODUCTION_PROJECT_ID --expected-affiliates=9
```

There is deliberately no production-apply flag in this checkpoint. Production
write enablement is added only after the staging rehearsal and its idempotency
verification have both passed.

Run the dry-run command again with the same verified backup. A healthy repeat
shows no membership or index changes, proving the migration is idempotent.

## Backup scope and checks

The snapshot contains every document from `affiliates`,
`affiliate_commissions`, `affiliate_clicks`, `affiliate_payouts`,
`affiliate_campaigns`, `affiliate_audit`, `affiliate_codes`,
`affiliate_emails`, `affiliate_commission_outbox`, and
`affiliate_attribution_claims`; only affiliate-attributed documents from
`transactions`; and the `affiliate_settings`, `affiliate_literary_circle`,
`affiliate_notifications`, and `literary_circle_resources` documents from
`site_configs` when present. Backup schema version 3 includes the preview-only
affiliate-notification configuration without treating it as subscriber consent
or a delivery ledger. It also includes exactly every
`uploaded_assets` document referenced by an `items[].assetId` in that resource
library, including draft, expired, and private resource artwork. The backup
aborts if any referenced asset document is missing.

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
`affiliates` backup and equality checks, so backup schema version 3 remains
valid. Missing preference data means unknown consent and no optional marketing;
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
field. Backup schema version 3 therefore remains unchanged.

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
