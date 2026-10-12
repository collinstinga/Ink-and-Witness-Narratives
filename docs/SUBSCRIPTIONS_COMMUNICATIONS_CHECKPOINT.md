# Subscriptions, Communications, and 5 MB Media Checkpoint

Checkpoint date: 2026-10-12 (Africa/Nairobi)

## Current release state

- Working branch: `feature/subscriptions-communications-tree`
- Production baseline: `6f6099f`
- Architecture checkpoint: `482fa4b`
- Implementation: complete locally; production candidate and promotion are still pending.
- Safe next action: commit the verified tree, deploy with `--prod --skip-domain`, verify the candidate, and only then promote it.

## Completed implementation

- Four editable Reader Pass defaults: 3 months/KSh 500, 6 months/KSh 1,000, 9 months/KSh 1,500, and 12 months/KSh 2,000.
- Writer Studio controls plan name, description, price, duration, renewal availability, publication state, order, badge, JPEG cover, and cover focal point.
- Plans appear in a configurable homepage section directly below the hero by default.
- Checkout requires an authenticated reader and rechecks the displayed name, price, duration, and renewal state against the fresh server plan before contacting Daraja.
- Payment records carry an immutable server-side subscription snapshot. Confirmed settlement atomically writes the payment, receipt claim, account-bound entitlement, and idempotent activation record.
- Renewal starts from the later of the current expiry or settlement time and uses exact UTC calendar months. A callback replay cannot extend access twice.
- Active passes unlock the complete published catalogue without creating transferable bearer tokens or fake per-piece purchases. Existing purchases, bundles, and manual grants remain independent.
- Library and personalized-home routes share one subscription read per request, expose only an active pass as `activeSubscription`, and continue recommending unread catalogue items to subscribers.
- Public plan loading uses one canonical catalogue document rather than reading every plan on every homepage load. First deployment seeds only missing defaults and the catalogue; writer saves update the individual plan and catalogue atomically.
- A compact communication hub preserves confirmed email subscriptions and adds the requested WhatsApp channel: `https://whatsapp.com/channel/0029Vb8zwQA0gcfBDoRCWM3z`.
- Writer controls cover communication copy, branch visibility, labels, WhatsApp URL validation, and homepage section ordering.
- Four original text-free Reader Pass artworks are stored under `public/assets/subscriptions/`.

## Media policy and persistence hardening

- Writer Studio accepts genuine JPEG, PNG, and WebP source images up to 5 MiB; collection, bundle, and Reader Pass covers remain JPEG-only.
- The browser inspects decoded dimensions and normalizes large sources before upload. The Base64 request stays below Vercel's fixed 4.5 MB Function body limit.
- The server authenticates the writer before enabling the larger image parser, validates magic bytes and dimensions, strips metadata, caps the canonical long edge at 2400 px, and stores at most 700 KiB of binary image data per Firestore asset document.
- Branding and piece-cover APIs now await authoritative Firestore writes and cache-invalidation markers. They return an error instead of claiming success when persistence fails or the selected piece no longer exists.
- Legacy embedded Data URLs are decoded and dimension-checked before reuse, then converted to permanent cloud assets.

## Additive production writes

The first successful plan read creates missing records only; it does not overwrite writer data:

- `subscription_plans/{planId}` for any missing default plans;
- `site_configs/subscription_plan_catalog` as the one-read public/admin catalogue;
- later purchases create `reader_subscriptions/{hashedUserId}` and `subscription_activations/{checkoutRequestId}` only after confirmed payment.

Rollback may leave these dormant additive documents in Firestore. Older application code ignores them, so they do not need destructive cleanup.

## Verification recorded so far

- Focused Reader Pass, communications, image, request-boundary, and persistence suite: 98/98 passed across 9 files.
- TypeScript: passed (`tsc --noEmit`).
- Full suite: 650/650 passed across 71 files with controlled single-worker concurrency.
- Production client/server build: passed (Vite 1994 modules; esbuild server bundle 881.8 KiB). Only the existing CSS `::highlight` compatibility advisory and large-chunk advisory remain.
- Diff integrity: passed (`git diff --check`; line-ending notices only).
- Secret-pattern scan: no new credential-bearing file was found. The only match is the already tracked Firebase browser configuration, whose API key is intentionally public client configuration; private service credentials remain environment-only.
- Production candidate, custom domain, and Writer Studio verification: pending.

## Production release gate

1. Run full tests with controlled concurrency, TypeScript, production client/server builds, `git diff --check`, and a secret-pattern scan.
2. Commit and push the feature checkpoint before touching production.
3. Deploy an exact committed production candidate using `vercel deploy --prod --skip-domain`.
4. Verify health, homepage bootstrap, four public plans, generated artwork, anonymous/authenticated boundaries, and response caching headers. Do not trigger a real M-Pesa charge during synthetic verification.
5. Promote the exact candidate only after it is healthy.
6. Verify the apex and `www` custom domains, Writer Studio loading, and recent production error logs.
7. Fast-forward the verified commit to `main`; never force-push. If Git integration creates another deployment, verify that final active deployment too.

## Safe resume point

If work stops before release, resume from this branch without reimplementing completed features. Start with `git status --short`, `git log -1`, and the final release gate above. Do not manually create or delete subscription records, do not initiate a real payment for a smoke test, and do not expose Vercel, Firebase, Resend, or Daraja secrets in logs or documentation.
