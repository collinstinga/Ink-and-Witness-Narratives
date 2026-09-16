# Reader narration and cover checkpoint — 2026-09-17

Status: Paused at the user's request. No feature code has been changed, committed, or deployed for this request. The worktree was clean before this checkpoint.

Production baseline: commit `72b85d1aa2afa859088088673c74d0aad24182ef` on the local branch `fix/homepage-manual-grant-piece-scope-2026-09-16`. The user confirmed the previous homepage/manual-grant release works well.

## Requested outcome

1. In Writer Studio, make the estimated `min read` time visible or hidden per piece, with existing pieces remaining visible by default.
2. Make audio narration sound more like book reading, respecting punctuation and tone. Do not promise a uniformly human voice from browser-native speech: quality depends on device/browser voices. Do not introduce a paid TTS provider or expose paid-content audio publicly without a deliberate service and entitlement design.
3. Show the piece's cover image in the unlocked reader view.

## Findings so far

- `src/components/ArticleReaderModal.tsx` owns the reader view and all browser Web Speech narration. It shows `readTimeMinutes` in its header (around line 986), locked synopsis (around line 1564), and spoken intro (around line 278). It currently does not render `article.coverImage` above the unlocked body.
- `src/components/writer/WriterEditor.tsx` calculates `readTimeMinutes` and saves article fields. A backward-compatible optional article field named `showReadTime?: boolean` is the planned toggle; `false` hides the time while missing/`true` retains current behavior. Inspect `src/types.ts`, the save DTO/server sanitization, and `src/components/ArticleCard.tsx` before implementation.
- Speech currently speaks UI metadata (`Category`, estimated time, literal `Section:` and `Quote:` prefixes), uses paragraph-sized utterances, starts the next utterance immediately, and picks a voice with a basic name regex. These contribute to robotic delivery. A no-cost improvement is to preserve prose punctuation, remove spoken UI labels, split long paragraphs at sentence boundaries into moderate chunks while preserving `rawIndex` for scroll highlighting, rank natural/neural voices when available, set a calmer default speed, and use cancellable pauses at paragraph/section boundaries. Add pure-helper tests.
- The cover-image data flow and protected full-article fetch still need investigation; do not assume the image is missing from data. Ensure the cover remains visible after the entitlement update and uses the persisted image URL, without changing paid-content authorization.

## Safe resume sequence

1. Check `git status --short --branch` and confirm this checkpoint is the only new file; inspect `AGENTS.md` and current `HEAD`/`origin/main` before edits.
2. Trace article save/public/full DTOs and unlocked reader props; implement the per-piece toggle throughout Writer Studio, public cards, reader, and spoken intro. Preserve legacy default.
3. Improve browser narration as above, with cleanup for pause, stop, close, article switch, speed and voice changes. Keep the user's voice choice available. Be explicit that a consistent studio-quality human voice would require recorded audio or a separately approved neural TTS service.
4. Render the cover in the unlocked reader body/header using existing `coverImage`; verify it is available from the full article response. Add regression tests for toggle, speech text/segmentation, and cover behavior where feasible.
5. Run typecheck, unit tests, build, React review, and browser/production verification in proportion to risk. Only after checks, commit/push to main, deploy/promote production, and verify the custom domain. Do not reveal secrets or alter Firestore content for testing.

No production deployment is pending for this new request. The last verified production custom domain was `https://www.inkandwitness-narratives.co.ke`.
