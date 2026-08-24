## 1. Persisted trim state

- [x] 1.1 Add a `useTrim(songDir: string)` hook that loads `trimStart`
      (default `0`) and `trimEnd` (default `null`) from `window.api.loadMeta`
      on mount, mirroring `useSongAnalysis`'s load pattern (guard with a
      `detectedRef`-style ref so it only loads once per song). Implemented as
      `useTrim(stems: string[])` instead — matches `useSongAnalysis`'s actual
      signature (it takes `stems` and derives `songDir` internally), so
      `StemPlayer` doesn't need to compute `songDir` twice for two hooks.
- [x] 1.2 Add `handleSetTrimStart(time)`, `handleSetTrimEnd(time)`, and
      `handleClearTrim()` that update local state and call
      `window.api.saveMeta(songDir, { trimStart, trimEnd })`. Reject (return
      without saving) a `trimEnd` earlier than the current `trimStart`.
      `handleSetTrimEnd` returns `boolean` (accepted/rejected) so the caller
      can surface a toast on rejection.
- [x] 1.3 Wire `useTrim` into `StemPlayer.tsx` alongside `useMarkers`/
      `useSongAnalysis`, threading `trimStart`/`trimEnd` down to
      `useAudioContextEngine` and `TimelinePanel`.

## 2. Playback behavior

- [x] 2.1 In `useAudioContextEngine.ts`, add `trimStart`/`trimEnd` params
      (mirroring how `loopStart`/`loopEnd` are threaded in) and a
      `trimRef` mirroring the existing `loopRef` pattern.
- [x] 2.2 Change `handleRestart` to seek to `trimRef.current.start` instead
      of the hardcoded `0` (both the `isPlayingRef.current` branch that calls
      `startSources` and the else branch that sets `positionRef.current`).
      Also fixed a latent bug this surfaced: the per-stem `stemWaves`
      `sw.seekTo(...)` calls took a 0-1 *fraction*, not seconds — hardcoded
      `0` happened to work either way, but restarting to a nonzero trim
      start needed the actual `restartTo / durationRef.current` conversion.
- [x] 2.3 In `tick()`, add a boundary check after the existing loop check:
      when loop is not enabled, `trimRef.current.end !== null`, and
      `position >= trimRef.current.end`, stop sources (same as the
      `masterPlaying` watcher effect) and call `setMasterPlaying(false)`
      instead of scheduling the next `requestAnimationFrame`. Extracted the
      loop/trim decision as a pure `resolveTickAction(position, loop, trim)`
      function (exported from `useAudioContextEngine.ts`) so it's directly
      unit-tested without an `AudioContext`/RAF loop.
- [x] 2.4 Confirm `seek()` and waveform click/drag handlers are untouched —
      manual seeking must remain unrestricted by the trim range.

## 3. Timeline UI

- [x] 3.1 Add "Set Trim Start" / "Set Trim End" buttons to `TimelinePanel.tsx`
      near the existing Loop controls, capturing the current
      `positionRef`/live position and calling the handlers from task 1.2.
- [x] 3.2 Add a "Clear Trim" button, shown only when a non-default trim range
      is set.
- [x] 3.3 Render dimmed overlays for `[0, trimStart)` and
      `(trimEnd, duration]` on the master waveform container, using the same
      absolute-positioning approach `TimelineMarkers` uses for the loop
      region.
- [x] 3.4 Surface a toast (reusing `Home.tsx`'s existing toast mechanism, or
      an equivalent inline message in `StemPlayer`) when a trim-end-before-
      trim-start attempt is rejected. Threaded `Home.tsx`'s `addToast` down
      as a new optional `onToast` prop on `StemPlayer`.

## 4. Export integration

- [x] 4.1 In `handlers.ts`, extend `export:mix`'s `options` parameter to
      `{ bpm?: number; trimStart?: number; trimEnd?: number }` and add
      `-ss <trimStart>` (when > 0) before each input, `-to <trimEnd>` (when
      set) on the output args. **Deviation:** used `-t <duration>` (output
      duration = trimEnd - trimStart) instead of `-to <trimEnd>` — with
      multiple `-ss`'d inputs (one per stem) feeding a single output, `-to`'s
      "relative to what" semantics are ambiguous/version-dependent across
      FFmpeg, while `-t` is an unambiguous output duration regardless of how
      the inputs were seeked. Extracted `trimInputArgs`/`trimOutputArgs` as
      pure, exported, directly-testable arg builders shared by both
      `export:mix` and `export:single`.
- [x] 4.2 Extend `export:single` similarly with an optional trim-range
      parameter and the same trim FFmpeg args (via the shared arg builders).
- [x] 4.3 Update the `VelodyAPI`/preload types (`exportMix`, `exportSingle`)
      to accept the new optional trim fields.
- [x] 4.4 In `useExportState.ts`, pass the current `trimStart`/`trimEnd` from
      `useTrim` into both `handleExportMix` and `handleExportSingle` calls by
      default.

## 5. Tests

- [x] 5.1 Add a test for `useTrim` covering: load from `.velody` (present and
      absent), save on set, and rejection of an inverted trim range.
- [x] 5.2 Add/extend a test for the `tick()` boundary logic (or extract it to
      a testable pure function) covering: playback stops at `trimEnd` when
      loop is off; loop bounds inside the trim range are unaffected by
      `trimEnd`. Covered via `resolveTickAction` unit tests, plus a
      `handleRestart`-uses-`trimStart` integration test.
- [x] 5.3 Add a test for the export FFmpeg-arg construction (or extract arg-
      building to a testable function) covering: no trim (unchanged args
      from today), `trimStart` only, `trimStart` + `trimEnd`. New
      `src/main/ipc/__tests__/trimArgs.test.ts`, following the existing
      `scanSongsLibrary.test.ts` pattern for importing `handlers.ts` outside
      Electron's runtime.

## 6. Manual verification

- [ ] 6.1 Run `pnpm dev`, open a song with a long intro, set a trim start
      past the intro, hit Restart, and confirm playback begins past the
      intro.
- [ ] 6.2 Set a trim end, let playback run into it, and confirm it stops
      automatically.
- [ ] 6.3 Close and reopen the song (or restart the app) and confirm the
      trim range is still applied.
- [ ] 6.4 Export a mix and a single stem for a trimmed song and confirm the
      resulting file's length matches the trimmed range.
- [ ] 6.5 Confirm manually scrubbing before the trim start or after the trim
      end on the waveform still works, and that clearing the trim range
      restores full-song playback.
