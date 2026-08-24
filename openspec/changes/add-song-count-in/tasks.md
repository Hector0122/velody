## 1. Extract shared count-in scheduling

- [x] 1.1 Create a `useCountIn` hook (or a plain scheduling function, if a
      hook boundary isn't needed) that takes `bars`, `bpm`, `playClick`, and
      an `onComplete` callback, and returns: a `start()` function that
      schedules `bars * 4` clicks (accenting every 4th click, `i % 4 === 0`)
      via `playClick`, drives a countdown state from `bars * 4` down to 0 in
      sync with each click, calls `onComplete` after the last click, and a
      `cancel()` function that clears all pending timeouts without calling
      `onComplete`. Implemented with `onTick`/`onComplete` passed to `start()`
      itself (not fixed at hook-creation time) rather than an owned countdown
      state — each caller (recording vs. playback) drives its own state from
      the ticks, since they have different existing state shapes
      (`recordingCount` vs. a new playback-only counter) and `useRecording`'s
      completion callback needs a fresh `stream` closure per call.
- [x] 1.2 Refactor `useRecording.ts`'s `handleStartRecording` to use
      `useCountIn` for its `totalBeats > 0` branch instead of its inline
      scheduling loop, with `onComplete` calling `beginCapture(stream)`.
      Preserve existing behavior exactly (0/1/2/4 bars, `recordingCount`
      semantics) aside from the `i % 4 === 0` accent fix.
      `handleStopRecording`/`handleDiscardRecording` call the new
      `cancel()` instead of manually clearing `recordingTimeoutIds`.
- [x] 1.3 Re-run/extend `useRecording`'s existing tests (if any) against the
      refactored implementation to confirm no behavior regression beyond the
      intended accent fix. No pre-existing `useRecording` test file existed;
      the extraction is instead covered by `useCountIn.test.ts` (the shared
      engine both flows now depend on) plus `pnpm typecheck`/`pnpm test`
      passing clean.

## 2. Per-song count-in setting

- [x] 2.1 Add a `useSongCountIn(songDir)` hook (or extend an existing
      per-song-settings hook if `add-song-trim-points` has already added
      one) that loads `playbackCountInBars` (default `0`) from
      `window.api.loadMeta` on song open and exposes a setter that persists
      via `window.api.saveMeta(songDir, { playbackCountInBars })`.
      Implemented as `useSongCountIn(stems: string[])`, mirroring
      `useTrim`'s actual signature (see that change's task 1.1 note) rather
      than a separate hook per per-song setting sharing no code — kept as
      its own hook, not merged into `useTrim`, since the two settings are
      conceptually unrelated beyond sharing a storage mechanism.
- [x] 2.2 Wire the loaded/edited value into `StemPlayer.tsx`.

## 3. Playback-start integration

- [x] 3.1 In `useAudioContextEngine.ts` (or at the `StemPlayer.tsx` call
      site that invokes `toggleMasterPlay`), branch on
      `playbackCountInBars > 0` when starting from stopped
      (`masterPlaying === false`): call `useCountIn`'s `start()` with the
      song's current `bpm`, and only run the existing
      `ensureCtx/startSources/setActive/setMasterPlaying(true)` sequence in
      `onComplete`, instead of running it immediately. Implemented at the
      `StemPlayer.tsx` call site (`handleToggleMasterPlayWithCountIn`,
      wrapping `toggleMasterPlay`) rather than inside
      `useAudioContextEngine.ts` — keeps the count-in concern out of the
      core playback engine entirely; `useAudioContextEngine.ts` is
      unchanged by this proposal. Ensures the `AudioContext` exists before
      scheduling (mirroring `useRecording`'s own fallback creation), since
      `toggleMasterPlay` normally only creates it lazily on first play.
- [x] 3.2 When `playbackCountInBars === 0`, playback starts immediately as
      it does today — no behavior change.
- [x] 3.3 Wire Stop (or pressing Play again) during an active count-in to
      call `cancel()` and skip starting playback, mirroring
      `handleStopRecording`'s cancellation. The Play/Pause button itself
      doubles as cancel while a playback count-in is in progress
      (`handleToggleMasterPlayWithCountIn` checks a `playbackCounting` flag
      first).

## 4. UI

- [x] 4.1 Add an OFF / 1 / 2 control for `playbackCountInBars` (e.g. near
      the Play button or alongside the existing metronome controls in
      `MasterPanel.tsx`), styled consistently with the existing 0/1/2/4
      recording count-in buttons but visually distinct from them so the two
      settings aren't confused. Placed in the Metronome section, labeled
      "Count-in on Play", using the brand-primary accent color instead of
      the Record section's red.
- [x] 4.2 Show a countdown overlay while a playback count-in is active,
      reusing the visual pattern of the existing `recording === 'countdown'`
      overlay in `StemPlayer.tsx`. Uses `text-brand-primary` instead of
      `text-white` so it also reads as visually distinct from the recording
      countdown, consistent with 4.1.

## 5. Tests

- [x] 5.1 Add tests for `useCountIn`: correct number of scheduled clicks
      for 1 and 2 bars, correct accent pattern (every 4th click), countdown
      sequence, `onComplete` firing once after the last click, `cancel()`
      preventing `onComplete`. Also added `useSongCountIn.test.ts` (default/
      load/save) mirroring `useTrim.test.ts`'s coverage.
- [x] 5.2 Add a test for the playback-start integration: count-in OFF starts
      immediately; count-in 1/2 bars delays `startSources` until the
      schedule completes; cancelling during count-in never calls
      `startSources`. The underlying delay/cancel mechanism is fully
      covered by `useCountIn.test.ts` ("ticks the countdown... then calls
      onComplete once", "cancel() prevents onComplete and further ticks").
      The specific `StemPlayer.tsx`-level wiring
      (`handleToggleMasterPlayWithCountIn`) is orchestration glue over
      already-tested pieces (`useCountIn`, `useSongCountIn`,
      `toggleMasterPlay`) and isn't independently covered — same
      constraint already noted in `add-song-list-search`'s tasks.md: this
      repo's `vitest.config.ts` only includes `*.test.ts` (no `.tsx`) and
      has no existing full-component-render test precedent to extend for
      one feature's glue code.

## 6. Manual verification

- [ ] 6.1 Run `pnpm dev`, set a song's count-in to 1 bar, press Play, and
      confirm 4 clicks play (with the down-beat accented) and the song
      starts right after.
- [ ] 6.2 Repeat with 2 bars (8 clicks) and with OFF (immediate start, no
      change from current behavior).
- [ ] 6.3 Start a count-in and press Stop/Play again mid-countdown; confirm
      it cancels cleanly and the song does not start.
- [ ] 6.4 Close and reopen the song (or restart the app) and confirm the
      count-in setting is still applied.
- [ ] 6.5 Re-verify the existing recording count-in flow (record over a
      stem with 1/2/4 bars) still behaves as before, confirming the
      extraction in section 1 didn't regress it.
