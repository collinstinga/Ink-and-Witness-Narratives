# Writer identity repair — implementation checkpoint

28 October 2026, Africa/Nairobi. User explicitly confirmed the writer email and
approved non-destructive consolidation with a secure password reset. No existing
user row, password, role, purchase or session has been changed by this work.

Live/main remains045aeaca1c7749a6fb60c7ad2ca2447f1b62a742,
deploymentdpl_Ch5oq6WMMNpFRMD9xwxJh3ecuxvE, both custom domains verified.
That release passed169suites/2511tests, types/builds and mobile/desktop QA;
paid content remains protected. Affiliate sending is off; temporary operator
keys removed and its process closed. Do not repeat this completed release.

## Discovery

A bounded read initially showed at least4valid writer rows sharing the same
owner email. Actual read-only aggregate subsequently confirmed21records.
No canonical email reservation and no saved affiliate notification settings
exist. Cached first-match login can choose one record without a uniqueness
query; the genuine owner-email probe correctly refused that ambiguous identity.

The first targeted backup stopped at its20record limit without writes.
The repair now permits at most32members plus an overflow sentinel, based on
the confirmed21record size; it never truncates the live cohort. The expanded
private, read-only backup/dependency capture must pass before review seeding.

## Candidate design

- Separate writer-purpose recovery from unchanged client-only reader resets.
- Actual signed-in Writer Studio actor chooses its own canonical ID, not an
  operator, first query result or oldest-password guess.
- Private fresh backup/review binds the complete cohort and snapshot digest.
  Alias-owned purchases/access/profiles/reviews/comments/reactions cause refusal;
  retaining database rows is not permission to strand their functional ownership.
- Issue only inert pending metadata and a hash-stored, one-use, one-hour token.
  No existing account/session/password changes until valid token+new password POST.
- New password must pass existing Argon2/strength rules and not match any old
  cohort password. Activation changes only canonical password, creates the
  canonical reservation/generation and an immutable private audit receipt.
- Canonical identity is checked before cached credentials. Every cohort writer
  session, including warm sessions with historical email, must pass generation
  checks; new session creation CAS-rechecks the just-verified credential.
- Never auto-sign-in after reset. Original IDs/rows/roles/emails/financial records
  stay intact. Cloud bootstrap must not rotate/promote an existing account.
- Recovery UI is an independent portal panel; existing drafts stay mounted.
  Only the approved owner receives a recovery link. Provider acceptance is not
  claimed as delivery; ambiguous outcomes are never automatically resent.

## Unfinished gates

Candidate files are not deployed. Full CI, independent integration review,
actual isolated staging/race/preservation rehearsal and mobile checks remain.
Root is preparing the private production cohort/dependency backup read-only.
Do not seed review, send mail, activate consolidation or claim completion until
the corresponding proof exists. No real payment/refund or announcements allowed.

After verified deployment/review, the writer starts recovery from their genuine
authenticated portal, opens the private emailed link and chooses a password.
Do not request a password, raw reset token or session cookie in chat. Activation
and normal sign-in must then be verified before notification review/testing.
