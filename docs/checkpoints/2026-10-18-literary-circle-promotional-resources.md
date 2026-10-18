# Literary Circle promotional-resources checkpoint — 2026-10-18

Status: Locally implemented and verified on `feature/literary-circle-upgrade`. This slice has not been merged to `main`, pushed, deployed to Vercel, or applied to production Firestore.

## Resumption point

- Branch base before this slice: `be0ae61` (`feat: add private Literary Circle bulletin`).
- This checkpoint belongs to the local commit named `feat: add Literary Circle promotional resources`.
- The production/staging migration gate in `docs/literary-circle-migration.md` remains mandatory.

## Completed in this slice

- Added a separately revisioned, writer-managed promotional library for up to 24 campaign kits, captions, piece covers, excerpts, guidance items, and subscription campaigns.
- Added destinations for the homepage, pieces, collections, bundles, and subscription plans, plus optional campaign codes, ordering, scheduling, expiry, and draft/publish controls.
- Added sanitized JPEG, PNG, and WebP artwork uploads through the existing 5 MB source-file workflow, meaningful alternative-text enforcement, private draft previews, and writer replace/remove controls.
- Kept draft artwork private. Explicit publication promotes artwork to a public, shareable asset because affiliates are expected to download and redistribute it. The Writer Portal warns that released or downloaded copies cannot be recalled.
- Added the approved-affiliate promotional library with search/type filters, approved-copy actions, tracked-link copying, shareable artwork downloads, and link-builder handoff.
- Integrated the library into affiliate onboarding and added lazy loading so the private resource document is read only when the affiliate opens the resource tab or explicitly refreshes it.
- Required a force-fresh signed affiliate session, accepted terms, an enabled programme, and currently active Literary Circle complimentary access before returning resource metadata.
- Added per-account request limiting and private/no-store browser, CDN, and Vercel cache headers. Failed fresh reads return no stale resource data or internal error detail.
- Added strict resource, destination, schedule, identifier, image, and unknown-field validation. Writer saves use optimistic revisions and return HTTP 409 instead of overwriting a newer editor.
- Made resource metadata, asset-scope changes, and redacted audit records atomic in Firestore transactions.
- Added audit hashes and lengths for descriptions, approved copy, and alternative text so copy-only changes remain distinguishable without storing the copy in the audit snapshot.
- Changed the admin audit endpoint to perform a bounded fresh Firestore read, preventing a different warm server instance from hiding a newly committed audit entry.
- Hardened public asset delivery against malformed identifiers and path aliases. Private Literary Circle assets return 404 and no-store; writer previews require admin authentication.
- Prevented the affiliate fetch effect from cancelling its own request, cleared private resource state when access is lost, and gated the tab and panel on current eligibility.
- Locked the complete writer editor during saves and artwork mutations so a late response cannot silently overwrite edits made while a request is in flight.
- Extended the guarded backup format to schema version 2. It captures `site_configs/literary_circle_resources` and exactly the referenced `uploaded_assets` documents, including private/draft assets; missing references or over-broad/incomplete closures fail closed.

## Verification completed

- Definitive full Vitest run: 85 files and 788 tests passed with `--maxWorkers=2 --testTimeout=15000`.
- Focused resource, UI, API, asset-delivery, onboarding, and migration run: 7 files and 51 tests passed.
- Affiliate/admin protected-route boundary file: 42 tests passed.
- TypeScript: `pnpm exec tsc --noEmit` passed with no diagnostics.
- Production build: `pnpm run build` passed for the Vite client and bundled Express server.
- `git diff --check` passed. Only the repository's normal LF-to-CRLF notices appeared.
- React review covered hook lifecycles, request cancellation, access-loss cleanup, mutation locking, accessible controls, stable keys, and plain-text rendering.
- Security review covered membership authorization, cache headers, ID validation, private/public asset boundaries, transaction ordering, audit integrity, and cross-instance audit visibility.
- Existing non-blocking build notices remain: the CSS optimizer warning for `::highlight(...)` and JavaScript chunk-size advisories over 500 kB.

## Production and migration gate

Do not deploy or migrate this branch yet. The required production read-only backup and staging rehearsal still have not run because no usable local/staging Firebase Admin credential is available. The protected Vercel Firebase secret must not be exposed or copied into source control, logs, screenshots, or chat.

Before production activation:

1. Supply a non-production staging Firebase Admin credential through the secure local mechanism documented in `docs/literary-circle-migration.md`.
2. Create a new schema-v2 guarded production read-only backup. Older schema-v1 backups are intentionally rejected because they do not contain the promotional-resource asset closure.
3. Run staging backup, dry run, apply, and post-apply equality checks for all nine affiliates, referral identities, sales, commissions, wallets, payouts, resource metadata, and referenced artwork.
4. Verify in a protected preview: writer create/edit/publish/upload flows; legacy, suspended, revoked, and approved affiliate access; tracked links; mobile layout; and existing reader/payment/subscription journeys without live charges.
5. Only then prepare a reviewed merge and deployment. Production migration or activation requires a separate explicit decision.

## Safe next slice

Continue in another isolated commit with configurable affiliate engagement notifications and templates. Advanced analytics, performance-period reporting, reactivation automation, and final production verification remain separate work; this checkpoint does not mark the overall Literary Circle upgrade complete.
