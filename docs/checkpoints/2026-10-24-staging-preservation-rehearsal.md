# Literary Circle: preservation and real staging rehearsal

Date: 24 October 2026, Africa/Nairobi. Branch: `feature/literary-circle-upgrade`.
Supersedes the pending source-review and preservation items in the earlier full-build checkpoint. This is not a production-release claim.

## Source changes completed and tested

- Fresh, bounded, consistent financial snapshots replace per-instance startup-cache financial responses. Outages/overflow return explicit unavailability, never old balances. Canonical verified totals exclude reversed/rejected/duplicate records; paid and reserved partial amounts remain distinct.
- Both 15-second financial polling loops were removed. Writer refresh uses one authoritative response and adopts newer saved settings/campaigns without overwriting unsaved editor drafts. Overlapping affiliate responses are sequenced.
- Profile, terms, login-activity and payout-contact edits now await transactional persistence and atomic audits. Credential/session races reject login. Profile publication preserves newer wallet/session revisions.
- The former destructive affiliate deletion is reversible suspension, with truthful writer UI wording and preserved identities/ledgers.
- Automatic tier pricing uses bounded Nairobi-month evidence, exact confirmed purchase proof and atomic reversal membership. No repeated lifetime-history query or pricing from truncated evidence. Delayed settlements use as-of membership. Historical commissions remain unchanged.
- Welcome copy, all eight fixed-ID onboarding steps and up to three recommended published pieces are writer-curatable. Existing progress survives. Draft/deleted recommendations are not disclosed; compatible older saves preserve newly added content.
- Backup schema 8 includes monthly tier evidence. Staging indexes include the new affiliate/month query and large-map index exemptions; Spark staging still has no billing-dependent TTL.

## Actual local verification

- Full run: **127 suites, 1,589 tests passed**, no failures/timeouts, 277.56 seconds.
- Full incremental TypeScript check: exit 0.
- Vite production build: exit 0, 2,011 modules; Node production server bundle: exit 0.
- Separate preview isolation/configuration regression follows the full run and is recorded at release time, not blindly added to the full-run count.
- Known warnings remain: large frontend chunks and optimizer warning for valid `::highlight` CSS. They are not suppressed or replaced with invalid CSS.

## Production read-only preservation

- Official authenticated Firebase account: `collinstinga@gmail.com`.
- Production metadata independently verified: `ink-and-witness-narratives`, `(default)`, STANDARD / FIRESTORE_NATIVE, `africa-south1`.
- A local operator-only OAuth client captured records read-only. No user OAuth token was persisted or deployed. A real staging-only service account is used for staging writes/runtime.
- Source schema-8 backup: `data/backups/literary-circle-2026-10-24T15-07-38-929Z-c4733ce6/manifest.json`.
- Source SHA-256: `2df71f3312571b18964c52f10ef6e8f1a8bb52508e4087ad42cb4bc269579b02`.
- Actual counts: **9 affiliates, 10 commissions, 65 clicks, 1 payout, 59 audit records, 39 affiliate-attributed transaction records, 12 newsletter campaigns, 20 source articles**. All other schema datasets/configuration scopes are in the verified manifest. Counts are not an assertion that every transaction succeeded or earned commission.
- Files remain under git-ignored, private-ACL `data/backups/`. They contain confidential data and must not be uploaded with the app.
- **Production writes: zero.** No main merge, production migration, live charge, live notification send or production deployment occurred in this rehearsal.

## Real isolated staging rehearsal

- Project: `ink-witness-staging-20261024`; STANDARD `(default)`, Johannesburg (`africa-south1`), deletion protection on, billing disabled / Spark.
- Least-privilege runtime identity successfully read the initially empty database. Deny-all client rules protect the confidential rehearsal copy.
- Create-only seed atomically created **228 documents**, checked against all source backup datasets. Existing unrelated/non-empty seed targets are refused; no overwrite/repair path.
- Staging schema-8 manifest SHA-256: `627f98fb6581b318ae0339ab469c279e28719b4f10512f114dac9da26a3e8a61`.
- Guarded dry run: **9 memberships to create, 6 missing code reservations, 6 missing email reservations, 0 conflicts**.
- Actual staging migration succeeded and independently verified full preserved-backup equality, allowing only specified additive memberships/indexes and its exact migration marker.
- Second actual apply returned **already_complete**, all 9 memberships/code/email reservations unchanged, no marker write, preservation verified again.
- New staging indexes/rules deployed successfully. Final independent READY-state check remains part of preview verification.

## Next release gates (do not redo completed work)

1. Push the tested branch with branch-only automatic deployment disabled; Vercel refuses branch-scoped env creation until the remote branch exists. This guard leaves main/other branch deployment behavior unchanged.
2. Configure only that Preview branch with staging service-account/runtime secrets. Explicitly empty inherited live provider keys and disable payment/email networks. Do not import production credentials. No production-scoped env changes.
3. Deploy and verify protected staging browser/API/data flows, including ordinary-reader denial, approved affiliate access, each chapter, purchases vs complimentary library, referral continuity, onboarding/admin authorization and responsive layouts. Use controlled synthetic readers and no live charges.
4. Resolve production migration/release enablement through a separately reviewed safe path after staging. Current migration apply remains staging-only. Inspect legacy writer approval evidence; founding recognition alone is not approval.
5. Production notification delivery remains deliberately blocked; staging-only reviewed delivery and automatic general monthly-tier notification targeting are not final production automation. No cron schedule is installed.
6. Paid/part-paid refunds and ambiguous historical payouts still require auditable writer-led reconciliation. Do not silently rewrite financial history.
7. Only claim full upgrade completion after the remaining production release/verification gates, not from passing local tests alone.
