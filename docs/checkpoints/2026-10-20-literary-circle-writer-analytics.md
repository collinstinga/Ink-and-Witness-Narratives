# Literary Circle writer analytics checkpoint

Date: 2026-10-20

Branch: `feature/literary-circle-upgrade`

Status: local-only; not pushed, merged, migrated, or deployed

## Completed in this checkpoint

- Added an authenticated Writer Studio route at
  `GET /api/admin/affiliates/analytics`.
- Added an allow-listed query parser for a maximum 366-day Africa/Nairobi
  reporting window and the following optional filters:
  - affiliate
  - piece
  - purchase type (`piece`, `bundle`, or `subscription`)
  - subscription plan
  - recorded Literary Circle tier
- Added an aggregate store adapter that reuses the already-loaded affiliate,
  commission, and retained click ledgers. Generating a report performs no new
  Firestore read or write.
- Added a lazily loaded **Circle Analytics** Writer Studio section with:
  - verified sales, gross sales, recorded/paid commission, and retained revenue
  - active and selling-partner counts
  - monthly verified trends
  - top partners and offers
  - integrity exclusions for invalid, unverified, and duplicate records
  - date and programme filters
- Added explicit coverage states:
  - buyer metrics remain **Not enabled** because this checkpoint does not load
    customer transactions or an analytics HMAC secret;
  - retained click counts are labelled **Partial** and conversion is withheld
    because the legacy click cache is capped and retained for only 90 days;
  - unsupported click filters never produce an invented conversion rate.
- Kept all buyer pseudonyms, source identities, click hashes, phone numbers,
  email addresses, receipts, and payout details out of the response and UI.
- Hardened the affiliate and writer performance tables with accessible
  captions, scoped headers, row headers, keyboard-focusable horizontal scroll
  regions, readable metadata sizes, and expanded privacy assertions.

## Security and quota invariants

- The route is protected by the existing writer-admin session middleware.
- Responses use `Cache-Control: private, no-store`.
- Unexpected query parameters are ignored and never reflected.
- Malformed or duplicated supported parameters fail with a bounded 400 error.
- Generic failures are logged server-side and return a non-sensitive message.
- Complimentary access is never counted as a sale.
- Only verified positive commission records enter financial totals.
- No Firebase project, collection, index, document, environment variable,
  secret, or production deployment was changed.

## Verification

- Focused analytics primitives/parser/store/UI/route/accessibility suite:
  **6 files, 71 tests passed**.
- Final fail-closed analytics/security rerun: **5 files, 67 tests passed**.
- TypeScript: passed (`pnpm exec tsc --noEmit`).
- Production build: passed. The analytics editor is emitted as a separate lazy
  chunk (18.91 kB, 4.21 kB gzip). Existing CSS Highlight API and large-chunk
  warnings remain unchanged.
- Full serial suite: **94 files / 843 tests passed**; the sole remaining test
  exceeded Vitest's default 5-second timeout while performing memory-hard
  Argon2 work on the contended Windows host.
- Isolated credential rerun: **1 file / 8 tests passed**, including that exact
  Argon2 test in 4.71 seconds. No credential code changed in this checkpoint.

## Next gated analytics step

Buyer acquisition and repeat-purchase metrics require a staging-only,
date-bounded transaction join plus a dedicated protected
`AFFILIATE_ANALYTICS_HMAC_SECRET` of at least 32 bytes. Before that is enabled:

1. provision the secret only in the intended staging environment;
2. rehearse against the verified backup;
3. prove query cost and window bounds do not threaten Firestore quota;
4. verify pseudonym rotation/continuity behavior;
5. return aggregate counts only; never send buyer keys to the browser.

Durable conversion metrics separately require a complete, durable click ledger.
The current capped local click history must not be relabelled as complete.
