# Notification tier-filter safety scope — 24 October 2026

This is an implementation handoff, not a production deployment or final audit claim.

## Supported

- Notifications without a tier filter keep their existing approved-account, consent, complimentary-access and delivery safeguards.
- A general tier-filtered notice may select an explicitly manually assigned tier only when fresh Literary Circle settings still contain that exact enabled tier. Assignment must have a canonical effective timestamp. Outbox preparation and delivery validate their settings in the respective transaction.
- `tier_upgrade` notifications retain separate, committed transition evidence and backing-payment verification. Their verified destination tier is not inferred from a stale stored profile.
- Direct creation of an approved active affiliate now prepares activation after its account transaction commits; pending/unapproved creation does not.

## Deliberate limitation

General notification filters for automatically calculated monthly tiers are **unsupported and fail closed** in this release. The planner exposes `automatic_tier_filter_requires_verified_evidence`; runtime preflight surfaces that outcome instead of selecting an affiliate using a possibly stale stored default tier. No fabricated default, arbitrary membership cap, commission-history scan, new index or financial mutation was added.

A future implementation must use reviewed, bounded, current materialized qualification evidence before enabling these automatic filters. Until then, the writer can leave tier filters empty (ordinary existing eligibility remains enforced), or use an explicit manually assigned, enabled recognition tier. This limitation does not change commission rates, tier calculations in the dashboard, paid library ownership, or reading privileges.

## Verification handoff

New/extended mocked coverage is in `affiliateNotificationTierFilter.test.ts`, `affiliateNotificationPlan.test.ts`, `affiliateNotificationOutbox.test.ts`, `affiliateNotificationDelivery.test.ts` and `affiliateStore.security.test.ts`. Root runs tests and builds serially due local memory constraints. No test/build processes, provider sends, deployment or production database operations were performed by the implementing subagent.
