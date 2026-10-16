# Literary Circle phase-one checkpoint — 2026-10-16

Status: Locally implemented and verified on `feature/literary-circle-upgrade`. Nothing in this branch has been merged to `main`, pushed as a release, deployed to Vercel, or applied to production Firestore.

## Resumption point

- Phase-one policy, access, migration tooling, subscription attribution, and Writer Portal controls: `4e84575` (`feat: add Literary Circle phase one safeguards`).
- Referral destinations, exact homepage landing, duplicate-click protection, and complimentary dashboard library: `d21aab8` (`feat: expand Literary Circle referral journeys`).
- Expected clean branch tip before continuing: `d21aab8` plus this documentation-only checkpoint commit.

## Completed in the referral/access checkpoint

- Affiliate links can target the homepage, one published piece, a published collection, a published bundle, or a published Reader Pass.
- Legacy `article` links remain compatible.
- Collection and bundle links open the selected contents; Reader Pass links focus the selected plan; piece links open the selected reader view.
- A published destination outside the small homepage curation is loaded from the public discovery endpoint only for that direct landing.
- Redirect targets are validated, multi-destination links fail closed, and unsafe identifiers are not reflected.
- Redirects and the client click follow-up now use the same canonical target (`collection:…`, `bundle:…`, or `subscription:…`). This preserves the existing signed deduplication cookie and prevents a second homepage click from inflating analytics or replacing destination context.
- The signed attribution remains a browser-session, single-use checkout claim. No persistent future-purchase attribution was reintroduced.
- The affiliate dashboard now presents a compact complimentary catalogue populated only after a fresh Literary Circle access check. Opening a piece still retrieves its protected body through the server route that force-refreshes affiliate status.
- Complimentary reading remains separate from purchases, reader ownership, transaction counts, and commissions.

## Verification completed

- Full Vitest suite: 81 files, 737 tests passed.
- Focused redirect/access/homepage suite: 9 files, 78 tests passed.
- Literary Circle onboarding component: 4 tests passed.
- TypeScript: `tsc --noEmit` passed.
- Vite production client build passed.
- Bundled server build passed.
- `git diff --check` passed. Only the repository's normal LF-to-CRLF notices appeared.
- React review passed for hook lifecycles, derived state, control labels, keyboard/focus behavior, and rendering boundaries.
- Existing non-blocking build notices remain: the CSS optimizer warning for `::highlight(...)` and chunk-size advisories over 500 kB.

## Production and migration gate

Do not deploy or migrate yet. The required production read-only backup and staging rehearsal have not run because no usable local/staging Firebase Admin credential is available. The Vercel `FIREBASE_SERVICE_ACCOUNT_JSON` value is a protected Secret and cannot be pulled by the CLI. Do not copy it into source control, logs, screenshots, or chat.

The checked-in migration tooling deliberately has no production-apply mode. It also denies the known production project during staging apply. Resume with the guarded commands and preservation checks documented in [`docs/literary-circle-migration.md`](../literary-circle-migration.md).

## Safe next work

1. Confirm this branch is clean and still points at the documentation checkpoint above.
2. Obtain a service-account credential for a non-production staging Firebase project through a secure local path or environment variable; never commit it.
3. Run the read-only production backup with the exact production project ID and expected count of nine affiliates.
4. Run staging backup, dry run, staging apply, and the post-apply equality checks for affiliate counts, links, sales, commissions, balances, payouts, and historical documents.
5. Only after those gates pass, prepare a reviewed merge and preview deployment. Production migration or activation still requires a separate explicit decision.
6. Continue phase two in isolated commits: tier-period reporting, richer wallet views, promotional resources, community publishing, reactivation notifications, and advanced analytics.
