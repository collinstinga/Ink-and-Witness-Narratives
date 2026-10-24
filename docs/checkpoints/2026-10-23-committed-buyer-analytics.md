# Committed private buyer analytics — 2026-10-23

Status: implementation prepared locally; tests and whole-project verification must be run by the coordinating agent. No provider, production database, credential provisioning, migration, backfill, or deployment was performed by this slice.

## Implementation

- `affiliateBuyerAnalytics.ts` derives pseudonymous buyer evidence only for a verified, eligible, positive-KES PURCHASE already selected by the existing commission transaction. Pieces, bundles and eligible subscription payments use the same evidence checks. Tips, direct transactions, rejected self-referrals and flagged records do not qualify.
- Evidence is an optional field on the existing commission and is created atomically with that commission. It adds no database read, new collection or extra write to settlement. Callback replay returns the original commission and never backfills or changes its identity evidence.
- Each identity is protected by the existing purpose-separated buyer HMAC. A second independently domain-separated HMAC authenticates the immutable purchase binding, timestamp, identity source and all rotation aliases. Firestore map ordering cannot invalidate an otherwise unchanged proof.
- Binding includes canonical checkout-derived commission document identity, transaction, affiliate, offer, amount/currency, purchase kind, subscription plan/renewal and settlement time. Approved-to-paid state changes do not invalidate historical evidence; reversed/rejected records are excluded from buyer counts.
- No raw reader ID, phone number, email, IP, receipt or authentication token enters buyer evidence. Buyer keys/proofs are stripped from affiliate projections, writer commission ledgers, status responses, writer summaries and audit values. The analytics response contains aggregate counts only.
- When explicitly enabled, the writer analytics operation reads fresh all-affiliate commission history with a 10,001-record truncation sentinel. It does not filter history before first-acquisition attribution, use client-provided keys or hydrate payment/customer records. A failed or oversized read withholds buyer metrics; existing financial reporting remains available.
- Disabled/invalid configuration adds zero buyer-history database reads and never stops settlement.

## Protected server configuration

- `AFFILIATE_BUYER_ANALYTICS_MODE`: absent/`off` disables enrichment and buyer reads. Only exact `enabled` opts in; invalid values fail closed.
- `AFFILIATE_BUYER_ANALYTICS_ACTIVE_KEY_ID`: a stable lower-case key name, beginning with a letter, up to 32 characters.
- `AFFILIATE_BUYER_ANALYTICS_KEYS_JSON`: JSON map of one to three stable key IDs to canonical base64 encodings of independently generated 32–64 random-byte secrets. Never use a browser-exposed variable or reuse payment, session, manual-grant or click-tracking credentials. No real values belong in source, logs, chat or backups.

No key was generated or installed. Provision through protected environment-secret management after the staging preservation review. Changing an existing key ID's bytes makes old proofs unsupported, rather than silently merging identities.

## Rotation and historical honesty

Keep the old key in the bounded keyring when adding a fresh key and switching the active proof key. New committed sales carry aliases for all configured keys. Authenticated overlapping aliases can join old and new records without raw identities or backfilling historical financial data.

Retiring an old proof key deliberately makes evidence signed solely by that key unsupported. Disconnected key eras are not counted as different readers when they could represent the same people. Mixed account-based and phone-based identities also withhold identity counts because they cannot be safely merged without additional verified account-ownership evidence.

Pre-existing commissions have no new field and are not modified. Unique counts can be labelled partial when some valid identities are known. New/returning-buyer metrics remain `null` unless complete supplied verified history is both available and identity-covered. “New affiliate-acquired” retains the existing narrow definition: first verified affiliate-attributed purchase, not proof of a person's first direct purchase anywhere on the platform.

## Verification to run

- New `src/server/affiliateBuyerAnalytics.test.ts`: disabled/invalid config, proof and privacy, payment mismatches, bundles/subscriptions, immutable binding and Firestore map ordering, overlapping and disconnected rotation, legacy/incomplete/mixed-source histories, reversal exclusion.
- Extended `src/server/affiliateStore.commission-durability.test.ts`: same-transaction evidence, callback replay, failed atomic commit, outward-response redaction, disabled zero reads, fresh history rather than stale cache, query failure and truncation.
- Existing `src/server/affiliateAnalytics.test.ts`, Literary Circle/store/security/payment suites, TypeScript and production builds.

## Remaining release gates

Actual staging service credentials and protected key provisioning remain unverified. No claim is made that historic customer identity coverage, activation, live analytics, staging migration or production behavior has been validated. Before release, complete the requested full staging rehearsal and verification; independently review the pre-existing wallet/payout durability and idempotency findings documented to the coordinating agent.
