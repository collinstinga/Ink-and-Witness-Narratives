# Literary Circle private-community checkpoint — 2026-10-18

Status: Locally implemented and verified on `feature/literary-circle-upgrade`. This slice has not been merged to `main`, pushed as a release, deployed to Vercel, or applied to production Firestore.

## Resumption point

- Branch base before this slice: `e598cf8` (`docs: checkpoint Literary Circle phase one`).
- This checkpoint belongs to the local commit named `feat: add private Literary Circle bulletin`.
- The production/staging migration gate in `docs/literary-circle-migration.md` remains mandatory.

## Completed in this slice

- Added a writer-managed private Literary Circle bulletin with announcements, release previews, excerpts, monthly campaigns, featured pieces, and promotional guidance.
- Added draft/publish controls, writer ordering, publish and expiry times, optional linked-piece actions, safe HTTPS resource actions, and a 24-item bound.
- Added the approved-affiliate community view with mobile-responsive cards, safe WhatsApp invitation handling, linked-piece navigation, accessible controls, and automatic expiry while a dashboard remains open.
- Kept drafts, future posts, expired posts, disabled-community content, and disabled-programme content out of affiliate responses.
- Removed all private community content from the cached/polled affiliate dashboard. The sole browser source is a dedicated private endpoint that rereads the account/session and writer settings before disclosure.
- Added private/no-store browser and CDN headers. Fresh-load errors fail closed and never return stale content or internal error details.
- Replaced the endpoint's duplicate authentication reads with one force-fresh verification and added a per-affiliate limit of 12 private refreshes per minute.
- Kept the 15-second general dashboard poll from repeatedly reading the private settings document. Opening or explicitly retrying the private area performs the fresh read.
- Sequenced complimentary-library refresh after the fresh access decision so a manual refresh cannot spend a redundant protected read.
- Added monotonic writer-settings revisions and an atomic Firestore transaction. A stale writer tab receives HTTP 409 and cannot restore a deleted or unpublished private item.
- Prevented delayed older Firestore reads and other older settings snapshots from regressing a newer process cache used by dashboards and commission-policy calculations.
- Preserved existing bulletin posts when a compatible older Writer Portal client omits the newly introduced `posts` field. Malformed community payloads are rejected instead of resetting the section.
- Preserved the existing separation between complimentary access, purchases, reader ownership, sales, and commissions.

## Verification completed

- Definitive full Vitest run: 82 files and 756 tests passed with `--maxWorkers=2 --testTimeout=15000`.
- Final affected server/data subset: 4 files and 62 tests passed.
- Final affiliate session/security route file: 35 tests passed.
- TypeScript: `pnpm exec tsc --noEmit` passed with no diagnostics.
- Production build: `pnpm run build` passed for both the Vite client and bundled Express server.
- Client build processed 2,000 modules; server bundle completed successfully.
- `git diff --check` passed. Only the repository's normal LF-to-CRLF notices appeared.
- React best-practices review passed for effect lifecycles, request sequencing, accessibility, stable keys, escaped content, external-link safety, and expiry scheduling.
- Backend review passed after closing the stale-cache, legacy-save, route-conflict, fresh-session, and quota-abuse findings.
- Existing non-blocking build notices remain: the CSS optimizer warning for `::highlight(...)` and two JavaScript chunk-size advisories over 500 kB.

## Production and migration gate

Do not deploy or migrate this branch yet. The required production read-only backup and staging rehearsal still have not run because no usable local/staging Firebase Admin credential is available. The Vercel `FIREBASE_SERVICE_ACCOUNT_JSON` value is protected and cannot be pulled into the workspace. Do not expose it in source control, logs, screenshots, or chat.

Before any production activation:

1. Supply a non-production staging Firebase Admin credential through the secure local mechanism documented in `docs/literary-circle-migration.md`.
2. Run the guarded production read-only backup with the exact production project ID and expected nine-affiliate count.
3. Run staging backup, dry run, staging apply, and post-apply equality checks for affiliates, referral identities, sales, commissions, wallets, payouts, and related history.
4. Review a preview deployment and verify writer, affiliate, reader, payment, subscription, and referral journeys without live payment charges.
5. Only then prepare a reviewed merge/deployment. Production migration or activation requires a separate explicit decision.

## Safe next slice

Continue the upgrade in another isolated commit. The safest next bounded phase is a writer-managed promotional-resources library, followed by configurable affiliate engagement notifications. Advanced analytics, tier-period reporting, reactivation automation, and final production verification remain separate work; this checkpoint does not mark the overall Literary Circle upgrade complete.
