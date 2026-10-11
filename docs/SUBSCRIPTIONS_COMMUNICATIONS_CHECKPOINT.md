# Subscriptions and Communications Checkpoint

Checkpoint date: 2026-10-11 (Africa/Nairobi)

## Resume point

- Working branch: `feature/subscriptions-communications-tree`
- Baseline commit: `6f6099f`
- Production implementation status: discovery and architecture complete; no feature code, database records, images, or production settings have been changed.
- Production deployment status: not deployed.
- Safe next action: implement the additive schema and stores described below, then test locally before any preview or production deployment.

## Confirmed product interpretation

Subscriptions are account-bound, time-limited access to the full published catalogue. They do not replace or shorten existing piece purchases, bundle purchases, or manual grants. When a subscription expires, only subscription-derived access expires.

The four editable default plans are:

1. The First Chapter — 3 months — KSh 500
2. The Long Read — 6 months — KSh 1,000
3. The Deep Archive — 9 months — KSh 1,500
4. The Full Witness — 12 months — KSh 2,000

All plan fields remain editable in Writer Studio: name, description, duration, price, features, image, focal position, visibility, featured state, display order, and whether reader-initiated renewal is enabled. Defaults must only seed missing records and must never overwrite writer edits.

“Renewable” means a reader can renew through a new authorized payment. It does not mean an automatic debit. M-Pesa STK Push does not provide a standing recurring-payment mandate, so the application must not simulate one using a stored phone number.

## Payment and entitlement design

- Extend the existing server-authoritative M-Pesa flow; do not add a parallel payment path.
- Require an authenticated reader account before starting a subscription checkout.
- Add `subscription` to the payment purchase-kind union and snapshot the immutable plan ID, name, price, and duration before contacting Daraja.
- Ignore client-supplied subscription prices and durations.
- Store one deterministic, account-bound subscription entitlement rather than creating one license per article or a transferable `articleId: all` bearer token.
- On successful settlement, atomically write:
  - the confirmed payment transaction;
  - the provider receipt claim;
  - the account subscription entitlement;
  - an immutable activation/renewal audit record.
- Renewal base: the later of the current expiry and settlement time. Add the purchased number of exact UTC calendar months to that base.
- Duplicate callbacks must not extend a subscription twice.
- Active subscriptions unlock every currently published paid piece, including pieces published after activation.
- Existing purchases, bundles, manual grants, and their current behavior remain unchanged.
- Initially keep subscription sales direct and do not consume a piece-affiliate referral claim; subscription commission policy has not been requested or defined.

## Storage and APIs

Use additive Firestore collections:

- `subscription_plans`
- `reader_subscriptions`
- `subscription_activations`

Planned public/account endpoints:

- published plans in `/api/public/bootstrap`;
- authenticated subscription status;
- authenticated M-Pesa subscription checkout.

Planned Writer Studio endpoints:

- list plans and subscription summaries;
- create/update/archive plans with optimistic concurrency;
- audited subscription revocation if required.

Plan deletion must be a soft archive so transaction history is never orphaned.

## Homepage and Writer Studio

- Add a `subscriptions` homepage section directly below the hero by default.
- Reuse the existing section visibility/order controls so the writer can hide or reposition it.
- Add responsive plan cards with artwork, plan name, price, duration, features, renewal state, and a clear subscribe/renew action.
- Include plan records in the coherent public bootstrap payload to avoid another homepage loading waterfall.
- Reuse the existing permanent image-upload path and image focal-position controls for plan covers.
- Generate four original, text-free literary cover artworks. Names and prices remain HTML text for accessibility and editing.

## Communications tree

Create one compact “Stay in the loop” homepage area with two explicit branches:

1. Email — preserve the existing consent, confirmation, unsubscribe, and Notify Me flows.
2. WhatsApp — link to the public Ink & Witness channel:
   `https://whatsapp.com/channel/0029Vb8zwQA0gcfBDoRCWM3z`

Writer controls should include section copy, email visibility, WhatsApp visibility, WhatsApp label/description, validated channel URL, and display order. The public WhatsApp link must open safely with `noopener noreferrer`.

The channel URL supports follower acquisition only. Automated WhatsApp posting must not be claimed or implemented without a compatible WhatsApp Business/provider API and credentials.

## Required verification before deployment

- Default plans seed only when missing; edits persist and stale versions fail with a conflict.
- Unpublished/archived plans disappear publicly.
- Anonymous checkout fails before any provider request.
- Server price/duration snapshot wins over browser data.
- First activation, early renewal, expired renewal, and concurrent renewal behave correctly.
- A replayed callback is idempotent.
- Failed settlement leaves neither confirmed payment nor entitlement.
- Active/expired/revoked access is enforced across full article content, library, reader home, progress, bookmarks, highlights, reactions, reviews, and comments.
- Cross-account subscription use fails closed.
- Existing permanent and piece-specific access still works after subscription expiry.
- No subscription settlement creates fake article licenses or increments fake article counters.
- Public responses expose no capability hashes or internal entitlement identifiers.
- Homepage remains fast, mobile responsive, non-stale, and accessible.
- Existing piece, bundle, tip, bank, newsletter, affiliate, and manual-grant tests remain green.

## Deployment gate

Do not mutate production collections during development. After tests and review:

1. Commit feature work on this branch.
2. Deploy a production-equivalent candidate with `vercel deploy --prod --skip-domain`.
3. Verify the exact candidate URL end to end.
4. Promote only after successful verification.
5. Verify the custom domain and Writer Studio.
6. Merge/push to `main` only when the promoted deployment and repository state match.

