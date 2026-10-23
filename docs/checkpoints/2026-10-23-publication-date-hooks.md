# Publication date hooks checkpoint

## Changes

- New article creation, save-to-publish and publish-toggle paths retain full UTC
  ISO timestamps instead of truncating the time of first publication.
- Saving a draft with an empty publication date preserves its stored historical
  publication date. Editing and unpublishing/republishing do not reset that date.
- Existing date-only values are preserved without migration or invented times.
- Cards, reader heading, carousel and writer homepage list continue showing
  calendar dates only, including when storage holds precise timestamps.
- No effects, requests, dependencies or state were added to the React views;
  changes were reviewed against the React best-practices checklist.

## Verification

- Article mutation/pricing regression: 2 files, 12 tests passed.
- Card/reader rendering regression: 2 files, 10 tests passed.
- Full TypeScript check passed.
- Production client/server build passed. Existing CSS Highlight API and large
  chunk warnings remain unchanged.

## Boundary and resume

No production data, environment or deployment was changed. This repairs date
precision and historical-date retention, not release delivery authorization.
A precise publication date is still not an immutable committed release event.
Do not enable the Literary Circle release hook solely from `publishedAt`:
durable event identity, retry-safe audience handling, source revalidation and
staging verification remain required. No automatic announcement was enabled.
