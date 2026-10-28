# Chaptered books and author formatting — implementation checkpoint

Baseline: `46d79f4860c77087c7e8552ae1eb73c37948a329`.
Branch: `feat/chaptered-books-20261028`.

This is an additive release candidate, not evidence of a production deployment.

## User story

Writer Studio selects individual/chapter format, saves original pieces, then
Reader Experience → New Book groups selected published piece IDs in an explicit
order. The book has its own JPEG cover, price, visibility and chapter-credit
policy. Public book contents lead to the existing authorized reader. Verified
M-PESA bundle settlement grants every snapshotted chapter to the purchaser.

## Preservation and security

- No automatic title-based grouping, deletion, text concatenation, migration,
  account mutation, licence rewrite or historical financial adjustment.
- Original chapter IDs/links, text, purchases, bookmarks and progress remain.
- Owning one chapter never grants the other chapters.
- `full_price` or `remaining_chapters` is writer-controlled. Remaining pricing
  allocates the book price proportionally to current paid-chapter prices and
  rounds the remaining amount up to a whole shilling. This is not a refund.
- Credits use a fresh account-bound paid-licence lookup, not a phone, client
  unlock flag, Reader Pass, manual grant, affiliate privilege or expired access.
- Fully owned/all-free books do not initiate another payment.
- Checkout rechecks price, chapter publication and the exact reviewed book
  revision before any affiliate reservation or provider call. It snapshots all
  included IDs, not just the unowned subset.
- Successful book payments use existing permanent bundle entitlements. Earlier
  individual purchases keep their original terms. Future chapter additions are
  not retroactively included in a previously purchased edition.
- Book writes use atomic `updatedAt` compare-and-set. Conflicts retain the draft;
  successful acknowledgements supply the next editor version.
- Books have 2–30 chapters, matching the existing bundle settlement limits.
- Hide-separate is presentation only. Hidden/disabled book shelves do not make
  original pieces disappear; reader libraries and old links are not filtered.
- Bold/italic and heading labels store safe Markdown; preview uses the existing
  sanitized renderer, not raw HTML.

## Validation / remaining release gates

Focused writer, reader and backend suites passed during implementation. The
combined targeted run had 129 passes and one repeatable cold-import timeout in
the pre-existing article-price persistence suite. Diagnostic isolation found
the actual mocked import/init/commit path passes; unused SDK/native loading is
being isolated without changing the production save path or skipping checks.

Before release, require all of:

1. Final TypeScript check and frontend/server builds.
2. The complete serial suite on the exact committed candidate, including the
   failed price-persistence regression rerun without increased timeout.
3. `scripts/qa/chapter-books.cjs` at 390px and 1280px, plus existing security and
   financial browser checks. All fixtures intercept APIs and block external
   network/provider requests; they are not proof of a new live payment.
4. Protected no-alias production stage, unchanged Firebase/environment binding,
   public paid-body masking and unauthenticated quote/admin rejection.
5. Guarded main fast-forward and promotion of that exact tested production build,
   followed by custom-domain checks. Do not promote a preview with different env.

No real payment charges, refunds, account recovery emails or affiliate/customer
announcements are needed to test this change. Existing notification settings
and the writer's live-review requirement must remain unchanged.
