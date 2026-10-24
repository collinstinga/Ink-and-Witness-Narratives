# Monthly tier qualification remediation — 2026-10-24

## Implemented, pending the main build's verification

- Replaced each automatic tier-priced sale's 10,000-row lifetime commission scan
  with server-only `affiliate_tier_periods` evidence keyed by affiliate and Nairobi
  calendar month. New sales and removal on rejection/reversal commit in the same
  Firestore transaction as their financial changes.
- A missing period is bootstrapped only when an explicitly activated automatic
  tier rate requires it. The one-time query is restricted to affiliate + exact
  month UTC boundaries, capped at 400 rows plus one overflow probe. Canonical
  commission IDs, exact checkout, transaction, owner, amount, receipt, settlement
  time, purchase kind and confirmed payment evidence must match. Malformed or
  incomplete evidence fails closed for writer review; no guessed lower rate or
  local financial fallback is used.
- Tips, flagged/self-referral records and rejected/reversed commissions do not
  qualify. Existing campaign, per-piece, manual affiliate and inactive-policy
  commission arrangements remain unchanged. Once present, the period includes
  eligible campaign/manual-rate purchases so a later applicable tier is accurate.
- Counts respect the effective qualification date and the sale's settlement
  timestamp; delayed callbacks cannot borrow sales occurring later that month.
- Duplicate callback replays return the already persisted commission. Reversals
  remove only an exact recorded member once; missing summaries are not fabricated.
  Awarded tier milestone keys remain permanent when qualification is reversed.
- The period is bounded to 2,000 members, 1,024 milestone keys and 700,000 UTF-8
  serialized bytes. Reaching a bound requires reviewed reconciliation; no financial
  record is silently truncated. Milestone notification proofs retain their own
  100-prior-row limit; larger exact counts can price correctly without an email.
- Added the affiliate/month composite index and unindexed membership arrays to
  both production and staging manifests. The production TTL override is retained;
  staging deliberately still has no TTL enablement.
- Backup schema is now **8**, explicitly including every `affiliate_tier_periods`
  document. Schema 7 was committed before this dataset existed and no actual v7
  snapshot had been captured at implementation time. Older backups are not
  relabelled, overwritten or padded; capture a fresh complete v8 snapshot.

## Authored regression coverage (not run by the subagent)

- Nairobi month/year boundaries; one bounded month bootstrap; zero later history
  queries with over 10,000 lifetime rows; off/manual no-bootstrap behavior.
- Overflow, malformed/noncanonical/duplicate evidence, missing/unconfirmed or
  mismatched backing payments, purchase-kind mismatch and settlement mismatch.
- Tips, effective-date/as-of counting, append/member/serialized-document bounds,
  reversal idempotence and retained recognition.
- Atomic sale concurrency, failed commit/retry, no repeated milestone after a
  reviewed reversal, unchanged historical rows and conservative incomplete-history
  refusal. Existing transaction doubles enforce reads before writes.
- Schema 8 capture/round-trip/drift detection and explicit schema 7 rejection.

## Resume / release gates

1. Main agent runs focused tests, full tests, TypeScript and client/server builds.
2. Review new helper and atomic integration, including Firestore transaction read
   ordering and bounded-query behavior against isolated staging.
3. Deploy/verify the new index in staging, then production before enabling the
   new code against an approved automatic commission policy.
4. Capture a fresh verified schema 8 backup and complete the existing nine-affiliate
   preservation rehearsal before production migration/rollout.

No cloud command, live database write, backup capture, payment, email, commit,
push, deployment or historical financial rewrite was performed by this subagent.
