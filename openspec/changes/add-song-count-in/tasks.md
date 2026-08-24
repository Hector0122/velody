## 1. Extract shared count-in scheduling

- [ ] 1.1 Create a `useCountIn` hook (or a plain scheduling function, if a
      hook boundary isn't needed) that takes `bars`, `bpm`, `playClick`, and
      an `onComplete` callback, and returns: a `start()` function that
      schedules `bars * 4` clicks (accenting every 4th click, `i % 4 === 0`)
      via `playClick`, drives a countdown state from `bars * 4` down to 0 in
      sync with each click, calls `onComplete` after the last click, and a
      `cancel()` function that clears all pending timeouts without calling
      `onComplete`.
- [ ] 1.2 Refactor `useRecording.ts`'s `handleStartRecording` to use
      `useCountIn` for its `totalBeats > 0` branch instead of its inline
      scheduling loop, with `onComplete` calling `beginCapture(stream)`.
      Preserve existing behavior exactly (0/1/2/4 bars, `recordingCount`
      semantics) aside from the `i % 4 === 0` accent fix.
      `handleStopRecording`/`handleDiscardRecording` call the new
      `cancel()` instead of manually clearing `recordingTimeoutIds`.
- [ ] 1.3 Re-run/extend `useRecording`'s existing tests (if any) against the
      refactored implementation to confirm no behavior regression beyond the
      intended accent fix.

## 2. Per-song count-in setting

- [ ] 2.1 Add a `useSongCountIn(songDir)` hook (or extend an existing
      per-song-settings hook if `add-song-trim-points` has already added
      one) that loads `playbackCountInBars` (default `0`) from
      `window.api.loadMeta` on song open and exposes a setter that persists
      via `window.api.saveMeta(songDir, { playbackCountInBars })`.
- [ ] 2.2 Wire the loaded/edited value into `StemPlayer.tsx`.

## 3. Playback-start integration

- [ ] 3.1 In `useAudioContextEngine.ts` (or at the `StemPlayer.tsx` call
      site that invokes `toggleMasterPlay`), branch on
      `playbackCountInBars > 0` when starting from stopped
      (`masterPlaying === false`): call `useCountIn`'s `start()` with the
      song's current `bpm`, and only run the existing
      `ensureCtx/startSources/setActive/setMasterPlaying(true)` sequence in
      `onComplete`, instead of running it immediately.
- [ ] 3.2 When `playbackCountInBars === 0`, playback starts immediately as
      it does today — no behavior change.
- [ ] 3.3 Wire Stop (or pressing Play again) during an active count-in to
      call `cancel()` and skip starting playback, mirroring
      `handleStopRecording`'s cancellation.

## 4. UI

- [ ] 4.1 Add an OFF / 1 / 2 control for `playbackCountInBars` (e.g. near
      the Play button or alongside the existing metronome controls in
      `MasterPanel.tsx`), styled consistently with the existing 0/1/2/4
      recording count-in buttons but visually distinct from them so the two
      settings aren't confused.
- [ ] 4.2 Show a countdown overlay while a playback count-in is active,
      reusing the visual pattern of the existing `recording === 'countdown'`
      overlay in `StemPlayer.tsx`.

## 5. Tests

- [ ] 5.1 Add tests for `useCountIn`: correct number of scheduled clicks
      for 1 and 2 bars, correct accent pattern (every 4th click), countdown
      sequence, `onComplete` firing once after the last click, `cancel()`
      preventing `onComplete`.
- [ ] 5.2 Add a test for the playback-start integration: count-in OFF starts
      immediately; count-in 1/2 bars delays `startSources` until the
      schedule completes; cancelling during count-in never calls
      `startSources`.

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
