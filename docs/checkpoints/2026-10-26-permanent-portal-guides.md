# Permanent portal guides — 26 October 2026

## Scope and preservation

Incremental UI-only release on the already released Literary Circle core.
No database, account, purchase, licence, commission, payout, provider, secret or
consent migration. No payment, email or background automation is activated.
Unfinished notification/analytics/financial service drafts remain in the separate
original worktree and are not part of this release.

## Permanent guidance

- Affiliate header: **Guide & Demo**, including before programme-term acceptance.
- Writer Studio: **Guide & Demo** in mobile/desktop headers and sidebar.
- Twelve affiliate topics, twenty writer topics, local keyword search, numbered
  instructions, important notes and replayable eight/six-step explanatory demos.
- The guide is independent of one-time onboarding completion/dismissal. No new
  registration, onboarding mutation, account storage or cloud reads are needed.
- A demo changes only help state: it cannot save, publish, navigate away, send,
  request/approve a payout or trigger a charge.
- Existing editors and settings remain mounted; closing help returns to the
  current form. The guide does not claim to save unsaved edits.
- Native modal dialogs contain focus, support Escape, restore trigger focus and
  stop portal events reaching the affiliate close-on-click backdrop. Loading
  and failed-chunk states are help-only modals, not whole-portal crashes.
- Guide bundles load only when opened; static guide text does not enter the
  public homepage's initial bundle. Runtime database data remains gitignored;
  only the five named static guide source/test files are narrowly unignored.

Guidance describes real current labels and limitations: collection versus priced
bundle, subscription renewal versus automatic debit, section save versus header
snapshot, piece/phone single-use manual grants, password-reset privacy, founding
recognition versus performance tier, proposed versus active rates, complimentary
access versus purchases, verified versus estimated metrics, session-bound
single-use checkout attribution, payout review versus confirmed disbursement,
and preview-only partner notifications versus reader newsletters.

Also corrected misleading affiliate dashboard wording: current dynamic rate
instead of a hardcoded 15% badge; legacy visitors explicitly estimated; no
unverified sales/clicks conversion percentage; no 30-day/lifetime commission
promise; verified sales require explicit refresh rather than an instant-feed
claim. These are presentation corrections, not financial-policy changes.

## Verification and release gates

- Seven focused suites: **27/27 passed** after final content/loading updates.
- Whole-project TypeScript passed after declaring the help boundary's props in
  the same style as the existing application boundary.
- Real isolated headless Chrome fixture browser: **25/25** checks passed across
  writer/affiliate and 1280, 390 and 320 px viewports. Search, no-results/clear,
  topics, complete/replay demo, native modal focus, Escape, close/reopen and
  unsaved writer/profile field values plus original DOM nodes were verified.
  No mutation attempts, unexpected API calls or browser errors remained.
- Screenshots of synthetic fixtures reviewed; mobile intro copy shortened.
- Independent static review found no release blocker. Its loading accessibility,
  exact checkout-binding wording and conditional-tab wording notes were fixed.
- Browser fixtures use no real credentials, user profiles, production data,
  provider calls or actual sessions. They are not represented as live auth tests.
- A separate notification-draft fixture counter bug was fixed in the original
  worktree; its 35 tests passed. That draft is deliberately NOT released here.

Before promotion require exact-commit remote serial regression/types/build,
staged production read-only smoke, source/environment/alias fences and final
canonical checks retaining the corrected M-Pesa production configuration. Record
exact commit/deployment IDs and actual results in the external release ledger;
do not infer deployment from this source checkpoint.

### Final loading/failure hardening

An additional real-browser slow-chunk check caught Tab reaching `BODY` from
the native loading dialog's single button. Added explicit first/last Tab
cycling shared by loaded, loading and failed-help dialogs; native Escape is
not prevented. Three new unit assertions and five browser checks passed,
including both roles' slow/failed chunks, focus restoration and unchanged
original unsaved form nodes. No mutation or unexpected API request occurred.
The initial guide source's remote CI passed 148 suites / 2,060 tests plus types
and frontend/server builds. This follow-up must receive its own exact-source
CI/build checks before promotion; the older staged build is superseded.

Independent review additionally identified the deliberately focused topic
heading (`tabindex=-1`) after the last control. The same keyboard helper now
detects a focused non-control with no later/earlier tabbable control and wraps
appropriately. Added a fourth keyboard unit case and an actual browser
topic-selection-then-Tab assertion. Ordinary navigation and native Escape remain
unchanged; independent re-review found no further actionable issue.
