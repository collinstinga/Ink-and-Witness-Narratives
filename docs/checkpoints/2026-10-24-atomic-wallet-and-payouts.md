# Atomic wallet and partial payouts — 2026-10-24

Status: locally verified by the coordinating agent; see `2026-10-24-full-build-local-verification.md` for test/build evidence and remaining staging gates. No live financial record, receipt, payout, purchase or production configuration was changed by this implementation.

## Prior failures addressed

The old wallet methods changed warm-cache balances first, suppressed independent Firestore write failures, permitted repeated payment-state changes, fabricated a B2C reference when no receipt was supplied, and marked every linked commission paid even when only part of the balance was requested. The request also did not reserve its commissions or balance.

## Atomic implementation

- `updateCommissionStatus`, `requestPayout`, `processPayout` and `reverseCommissionForTransaction` return promises. HTTP callers must await them and handle the rejected operation; reporting success before durable commit is no longer valid.
- Requests read the current affiliate, current payout threshold, active payout requests and current approved commissions in a Firestore transaction. No local/cached fallback may authorize money changes.
- Exactly the requested amount is reserved. The available balance falls by that amount; a separate reserved balance and account-level active payout ID are recorded. Each selected commission carries its exact allocated reservation and the reservation owner.
- Existing financial records receive only additive version/revision/allocation bookkeeping when participating in a new operation. Other legacy records are not migrated, reset, backfilled or re-totalled.
- A partial payment adds its allocation to each commission's cumulative paid amount. The commission remains APPROVED until its full commission amount has been paid, then becomes PAID. Every payout retains its allocation history even if a commission finishes in a later payout.
- Reject/fail releases the exact reservation. Successful payment consumes the reserved balance without deducting available funds twice. Lifetime earned totals are preserved; unpaid reversals accumulate separately as reversed earnings.
- The payout, commission changes, wallet balance and administrative audit create commit together. Failed commits/audit creation publish no local success and cannot leave partial durable state.
- Account/commission/payout wallet revisions prevent an older completed operation from replacing newer wallet state in the warm cache. Existing sale commits increment account wallet revision without changing their commission, access or attribution decisions.
- General profile edits reject balances, totals and wallet/reservation bookkeeping and persist an allowlisted profile patch only. An older profile edit cannot write its old wallet back into Firestore.

## State and payment evidence

- A payout must be approved before mark-paid. Paid/rejected/failed payouts are terminal. Repeating the same completed action is idempotent; a different receipt cannot replace a settled payout's historical receipt.
- Mark-paid requires an explicit payment receipt/reference, normalized to uppercase and recorded as `writer_confirmed`. No reference or actual payment is fabricated. A receipt already attached to another payout is rejected.
- Pending commissions may be approved/rejected/reversed; approved commissions may be rejected/reversed only while unreserved and wholly unpaid. Paid or part-paid reversals require an explicit writer-led reconciliation rather than silently removing already-disbursed money.
- Reserved commissions require payout cancellation first. Missing/inconsistent balances are never clamped to zero to force an action through.
- Legacy active requests without the new allocation/reservation evidence, duplicate active requests, historical ambiguous payout links, orphan reservations or malformed financial values fail closed with a review message. Already settled legacy payouts remain unchanged; a matching paid replay performs no writes.

## Quota and privacy bounds

At most 400 approved commission rows may enter one reviewed payout, with a 401st-row truncation sentinel. At most 403 documents are written by one maximum-size request or settlement, below the 450-document reviewed bound. Active legacy detection uses three bounded equality queries. Mark-paid additionally checks at most 1001 payout rows for legacy case/space receipt collisions; overflow refuses settlement for review. A deterministic create-only audit ID claims the canonical receipt in the same transaction, preventing concurrent reuse across accounts. This settlement-only scan is not a reader hot-path query. No new wallet collection was introduced; existing full affiliate/financial backup datasets preserve the additive fields.

Partial paid earnings are reflected in the affiliate projection, dashboard, writer summary and advanced aggregate report. Buyer-analytics proofs remain server-only. Neither complimentary reading nor ordinary reader purchases are rewritten by wallet operations.

## Verification prepared

`src/server/affiliateStore.wallet-durability.test.ts` covers competing requests, exact partial allocations, payment idempotency, release on reject/fail, atomic commit/audit failures, explicit and duplicate receipts, guarded commission transitions, insufficient durable balances, reserved/part-paid reversals, legacy preservation, oversized histories, stale profile protection, the 400-allocation/403-write boundary and unique transaction reversal. Existing security tests were adapted to await durable operations and seed financial fixtures directly instead of abusing the general profile editor.

Full regression and the final wallet/route rerun passed; staging edition/index and live preservation verification remain separate gates. Final review also fixed flagged-commission reservation release and removed automatic startup uploads of local financial, policy and audit snapshots. The Writer Portal now exposes approval separately from receipt-backed payment confirmation and uses canonical server statuses. No production database was read or modified for these local tests.
