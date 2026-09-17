# Narration auto-scroll checkpoint — 2026-09-17

Status: Paused immediately at the user's request. No code fix, test, push, or deployment has been made for the scroll issue. The worktree was clean before this checkpoint.

Current production/source baseline: `9d8c57dd6d8f67ae52eeb54508b4497ed409c198` on GitHub `main`, deployed to `https://www.inkandwitness-narratives.co.ke` (Git-connected Vercel deployment `dpl_Ch8qnzwBMgpmSmpZpsrowbXyV98G`). The user reports the previous reader changes work, except that the reading view scrolls ahead of audible narration.

## Evidence and likely cause

- `src/components/ArticleReaderModal.tsx` currently scrolls in `SpeechSynthesisUtterance.onstart`, after only an 80 ms timer, using `scrollIntoView({ behavior: 'smooth', block: 'center' })` (around lines 443–457). Some speech engines begin audible output later than that callback, so the viewport can move early.
- `onend` eagerly calls `setCurrentChunkIndex(nextIndex)` before the configured inter-chunk pause and before the next utterance starts (around lines 460–469). This advances the active snippet/highlight early too.
- Several speech chunks can share one paragraph's `rawIndex`; repeatedly centering that paragraph can cause unnecessary movement. A `block: 'nearest'` scroll may be less jarring.
- The Web Speech API provides a `boundary` event at spoken word/sentence boundaries when the engine supports it. The specification does **not** guarantee every engine supplies boundary events. Use generation guards and a conservative fallback. Primary specification: `https://webaudio.github.io/web-speech-api/`, sections 4.2.5–4.2.6.

## Safe resume plan

1. Confirm clean worktree and current `HEAD`/`origin/main`; read `AGENTS.md` and this checkpoint. Do not touch Firestore or paid-entitlement logic.
2. In `ArticleReaderModal.tsx`, move visual advancement/auto-scroll to the first actual speech boundary for the current chunk, instead of the 80 ms `onstart` timer. Keep `onstart` for playback state. If a voice never emits boundaries, use a delayed, generation-guarded fallback after `onstart` (or another explicitly documented conservative fallback), and cancel it on stop/skip/close/article switch.
3. Do not eagerly advance `currentChunkIndex` in `onend`. Track a pending next chunk during the inter-chunk pause so Pause/Resume starts the correct next segment without replaying the previous one. Verify skip, voice/speed change, reset, unlock transition, and short utterance behavior.
4. Avoid repeat-centering an already visible paragraph; prefer `scrollIntoView({ behavior: 'smooth', block: 'nearest' })` and only scroll when the narrated paragraph changes.
5. Add focused regression coverage for timing (no scroll/active-section advance before a speech boundary, no stale timer after cancel, correct pause/resume between chunks), then run typecheck, full tests, client/server builds, and scoped browser verification. The `agent-browser` CLI and CUA browser were unavailable on this host last turn; headless Chrome screenshots and Vercel authenticated requests were available.
6. Commit the fix, deploy a Vercel production candidate with `--skip-domain`, verify, promote, push to `main`, and confirm the Git-triggered production deployment plus custom-domain health. Do not claim audible sync tested on the user's phone; request a quick device check after release.

No production action is pending for this new issue.
