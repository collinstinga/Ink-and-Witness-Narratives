# Subscriptions, Communications, and 5 MB Media Checkpoint

Checkpoint date: 2026-10-12 (Africa/Nairobi)

## Current release state

- Working branch: `feature/subscriptions-communications-tree`
- Production baseline: `6f6099f`
- Architecture checkpoint: `482fa4b`
- Verified implementation commit: `23c7744a4fd6f937ef59f77716536120e4125768`.
- Production deployment: `dpl_4kpmawrpSVxS1X2Tg54gdjF8Hszv` (`narrativesbyjake-emj54g1qh-ink-n-witness.vercel.app`).
- Promotion status: promoted successfully on 2026-10-12 and serving the custom-domain aliases.
- Safe next action: fast-forward the documentation-complete branch to `main`, then verify any deployment created by the Git integration before closing the release.

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
- Candidate health and root: HTTP 200; deployment status `READY` in `cpt1`.
- Public bootstrap: 15 published pieces, four Reader Pass plans with prices `500,1000,1500,2000`, the expected durations, no administrative plan fields, ordered visible homepage sections, and the requested WhatsApp URL.
- Security boundaries: anonymous subscription status, Writer plan administration, and a synthetically valid checkout request all returned 401 before any M-Pesa provider call.
- Media: all four bundled artworks returned HTTP 200; `the-full-witness.png` returned `image/png` and the expected 632,659-byte payload.
- Custom domains: the apex returns a permanent 308 redirect to `https://www.inkandwitness-narratives.co.ke/`; `www` root and health return HTTP 200 and serve the promoted deployment.
- Runtime review: no application exception was observed in the candidate checks. Vercel logs contained only the existing Node `url.parse()` deprecation notice and normal cold-start informational output.
- Rendered-browser helper: unavailable after one safe retry because its local kernel-asset path was missing. No UI automation result is claimed; the production HTTP, API, build, and component-test gates remain the verification evidence.

## Production release gate

1. Completed: full tests, TypeScript, production builds, diff integrity, and secret-pattern scan.
2. Completed: recoverable feature commit and remote branch.
3. Completed: exact committed production candidate using `vercel deploy --prod --skip-domain`.
4. Completed: candidate health, bootstrap, four plans, artwork, and anonymous/private boundaries without initiating a real payment.
5. Completed: exact candidate promotion.
6. Completed: apex/`www` alias, live API, and runtime-log verification. Writer-admin API remains protected as expected; no credential was used in a synthetic UI login.
7. Remaining: fast-forward to `main`, verify any Git-integration deployment, and record the final active deployment if it changes.

## Safe resume point

If work stops before the final `main` push, resume from this branch without reimplementing completed features. Start with `git status --short`, `git log -2`, confirm that deployment `dpl_4kpmawrpSVxS1X2Tg54gdjF8Hszv` still owns the apex, `www`, and `narrativesbyjake.vercel.app` aliases, then complete step 7 above. Do not manually create or delete subscription records, do not initiate a real payment for a smoke test, and do not expose Vercel, Firebase, Resend, or Daraja secrets in logs or documentation.
