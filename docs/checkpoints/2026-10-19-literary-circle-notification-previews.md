# Literary Circle notification-preview checkpoint — 2026-10-19

Status: Locally implemented and verified on `feature/literary-circle-upgrade`. This slice has not been merged to `main`, pushed, deployed to Vercel, used to send email, or applied to production Firestore.

## Resumption point

- Branch base before this slice: `75f34e5` (`feat: add Literary Circle promotional resources`).
- This checkpoint belongs to the local commit named `feat: add partner notification previews`.
- The production/staging migration gate in `docs/literary-circle-migration.md` remains mandatory.

## Completed in this slice

- Added a separate, revisioned `site_configs/affiliate_notifications` configuration model. It does not reuse reader newsletter subscribers, campaigns, consent, or delivery records.
- Added all seven requested event templates: activation, new release, upcoming campaign, new commission, tier upgrade, inactivity reminder, and exclusive opportunity.
- Added writer controls for plain-text subject, preheader, heading, body, CTA, event delay, campaign lead time, inactivity threshold/cooldown, founding-member targeting, tier targeting, and complimentary-access requirements.
- Added a dedicated, data-lazy Partner Notifications tab in Affiliate Control. The editor itself is code-split from the main Writer Dashboard bundle.
- Added a branded live sample preview and aggregate eligibility checks that return only counts and exclusion reasons, never an affiliate recipient list.
- Enforced immutable base eligibility: active account, explicit writer approval, valid email, accepted terms, and Literary Circle membership. Marketing events additionally require separate affiliate marketing consent and category preference.
- Added additive account types for explicit writer approval and affiliate notification preferences. No existing affiliate is silently marked approved and existing terms acceptance is not treated as marketing consent.
- Kept operational commission/tier notices distinct from promotional release, campaign, inactivity, and opportunity messages.
- Added strict unknown-field, size, timing, tier-ID, single-line header, plain-text, placeholder, CTA, and HTTPS/internal-path validation.
- Added event-specific placeholder allowlists. Commission copy cannot reference buyer email, phone, receipt, transaction, or payout data.
- Added optimistic revision checks and atomic Firestore configuration plus redacted audit writes. Template copy and CTA values are represented in the audit by length and SHA-256 digest, not raw content.
- Added private/no-store browser, CDN, and Vercel cache headers to every admin route.
- Kept the complete slice in `preview_only` mode. Every event defaults disabled; save and eligibility routes have no provider-send, enqueue, test-recipient, cron, or status-mutation capability.
- Made the Writer Portal state explicitly say that inactivity reminders never suspend an affiliate, revoke access, change a tier, or disable a referral link.
- Extended the guarded affiliate backup to schema version 3 so the preview configuration is preserved alongside other affiliate settings.

## Verification completed

- Definitive full Vitest run: 88 files and 800 tests passed.
- Focused notification, API, UI, and migration run: 4 files and 25 tests passed.
- Additional focused Literary Circle regression run: 5 files and 21 tests passed.
- TypeScript: `pnpm exec tsc --noEmit` passed with no diagnostics.
- Production build: `pnpm run build` passed for the Vite client and bundled Express server.
- `git diff --check` passed. Only the repository's normal LF-to-CRLF notices appeared.
- React review covered lazy data/component loading, hook dependencies, revision resets, mutation locking, accessible fieldsets/statuses, mobile expansion, and plain-text preview rendering.
- Security review covered approval versus account status, affiliate-specific consent, least-data eligibility responses, fail-closed defaults, placeholder/URL safety, audit redaction, and absence of any delivery path.
- Existing non-blocking build notices remain: the CSS optimizer warning for `::highlight(...)` and JavaScript chunk-size advisories over 500 kB.

## Deliberately not activated

- No affiliate currently receives a message from this system.
- No event hook, scheduled worker, cron, delivery test, provider call, or outbox exists in this slice.
- No existing affiliate is automatically granted the new explicit writer-approval marker or marketing consent.
- No inactivity condition changes an account, link, tier, or complimentary-access state.
- Reader newsletter consent and unsubscribe records remain untouched.

## Production and migration gate

Do not deploy or migrate this branch yet. A usable non-production Firebase Admin credential is still unavailable locally, and the protected Vercel Firebase secret must not be copied into source, logs, screenshots, or chat.

Before any live notification delivery:

1. Obtain a securely supplied staging Firebase Admin credential and run the schema-v3 backup, staging dry run, staging apply, repeat-idempotency run, and equality checks.
2. Add an explicit writer-controlled approval transition and migrate the nine known founding affiliates only after the writer verifies the exact account list.
3. Add an affiliate-owned consent/preferences screen with versioned disclosure, free category opt-out, and suppression handling. Existing affiliates must default to unknown/no marketing until they act.
4. Add deterministic source-event and per-affiliate delivery IDs, transactional outbox creation, bounded leases/retries, fresh pre-send eligibility checks, webhook reconciliation, and dead-letter visibility.
5. Add a production-only delivery gate requiring the exact canonical HTTPS base URL, verified sender configuration, explicit live mode, production environment, and a reviewed configuration revision.
6. Verify protected-preview writer, affiliate, reader, payment, referral, subscription, and notification-preference journeys without live charges or external email delivery.

## Safe next slice

Implement explicit writer approval plus affiliate-owned notification consent/preferences and signed marketing opt-out. Keep delivery disabled. Only after that slice is migrated and verified should deterministic event/outbox wiring begin.
