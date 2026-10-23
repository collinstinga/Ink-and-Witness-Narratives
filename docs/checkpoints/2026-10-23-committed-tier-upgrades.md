# Committed tier-upgrade evidence and held notifications

## Implementation

Automatic dashboard tiers are calculated from monthly sales; they were not
stored as membership transitions. New automatic tier-rate commissions can now
carry optional `literaryCircleTierTransition` evidence captured in the existing
commission transaction. The pure builder requires a real increasing threshold
and rank crossing under the effective transaction policy, exact before/after
counts and canonical identities. It does not assign membership tiers, change
rates, update old commissions or alter financial increments.

The snapshot includes the Nairobi calendar period, policy version, from/to
tiers, ranks, threshold, timestamp and sorted supporting commission IDs. Existing
commission backup coverage preserves every field; no new dataset/schema bump is
needed. Missing historical evidence is never invented or backfilled.

Malformed/current suspicious evidence, manual/override rates, tips, self-sales,
ambiguous policy ordering, incomplete 10,000-row queries and more than 100 prior
supporting commissions suppress evidence without throwing or blocking payment
settlement. Unrelated older legacy history does not poison a current crossing.
Prior milestone evidence, including reversed records, prevents repeat crossing
snapshots in the same period/policy/tier after reversal and requalification.

After commit, `tier_upgrade` preparation uses the existing off-by-default,
staging-only held outbox. It revalidates canonical commission identity, effective
policy, snapshot fields, affiliate and every supporting commission/payment.
Payments must be confirmed purchases with matching identity, amount, affiliate,
receipt and the same selected settlement timestamp used by commission creation.
Historical-period upgrades are suppressed. Every source is fingerprinted and
reread in the outbox transaction to reject reversal/source-change races.
Tier and ordinary commission alerts have separate stable event identities.

## Quota and preservation

Evidence creation reuses the existing commission query and adds no collection
read or document write. Disabled notification preparation adds no reads. In
explicit staging held mode, N supporting commissions require at most 4N+12
reads and two outbox creates for first preparation, or 4N+10 reads/zero writes
for an existing intent, before transaction retries. N is capped at 100; tier
recovery is capped at five explicit source IDs (maximum 2,060 pre-retry reads).
No scan, cron, provider send, refund adjustment or financial repair was added.

## Verification

Initial tier/source regression: 9 tests exposed a missing affiliate code in the
new shared test fixture; the required identity was supplied, not bypassed.
Five suites then passed 169 tests. Independent review added payment timestamp
agreement and mismatch coverage; destination-tier eligibility filtering was also
tested without mutating membership. Final tier/source regression: **5 files,
173 tests passed**. M-Pesa settlement/request-lock regression: **2 files,
37 tests passed**. Total: 210 targeted tests, none skipped.
Full TypeScript validation and production client/server builds passed. Existing
CSS Highlight API optimizer and large frontend chunk warnings remain unchanged.
The first 768 MB type-check process was stopped after prolonged local resource
pressure (not an assertion failure). The retry uses 1,024 MB and TypeScript's
incremental cache under ignored node_modules/.cache, with the same full checking
options. Reuse that cache for subsequent checks instead of repeating cold scans.
The retry completed successfully before the final stop attempt; that attempt
stopped no process. Local diagnostics showed only approximately 272 MB physical
RAM free, explaining the prolonged paging pressure. No unrelated apps or system
settings were changed.

## Remaining limits

This captures automatic tier-rate crossings only. Campaign/piece/affiliate
overrides continue their existing commission arrangements and do not gain extra
monthly queries. The underlying financial qualification count still uses
existing commission-status rules; the notification adapter independently joins
payments and refuses unsupported evidence rather than rewriting those rules.
Tier-upgrade template filters use the verified destination tier without changing
recorded membership. Other notification filters retain their existing semantics.
Automatic dashboard tiers are not persisted as membership assignments.

Held records never authorize sending. A delivery worker must recheck current
source/payment validity, approval, consent/preferences, suppression, period and
reviewed delivery gates. Scheduled sources, delivery/provider reconciliation,
buyer analytics, staging provisioning/rehearsal and final end-to-end/mobile
verification remain outstanding. No production/environment/data migration,
email, live payment or deployment was performed.
