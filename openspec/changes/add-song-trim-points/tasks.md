## 1. Persisted trim state

- [ ] 1.1 Add a `useTrim(songDir: string)` hook that loads `trimStart`
      (default `0`) and `trimEnd` (default `null`) from `window.api.loadMeta`
      on mount, mirroring `useSongAnalysis`'s load pattern (guard with a
      `detectedRef`-style ref so it only loads once per song).
- [ ] 1.2 Add `handleSetTrimStart(time)`, `handleSetTrimEnd(time)`, and
      `handleClearTrim()` that update local state and call
      `window.api.saveMeta(songDir, { trimStart, trimEnd })`. Reject (return
      without saving) a `trimEnd` earlier than the current `trimStart`.
- [ ] 1.3 Wire `useTrim` into `StemPlayer.tsx` alongside `useMarkers`/
      `useSongAnalysis`, threading `trimStart`/`trimEnd` down to
      `useAudioContextEngine` and `TimelinePanel`.

## 2. Playback behavior

- [ ] 2.1 In `useAudioContextEngine.ts`, add `trimStart`/`trimEnd` params
      (mirroring how `loopStart`/`loopEnd` are threaded in) and a
      `trimRef` mirroring the existing `loopRef` pattern.
- [ ] 2.2 Change `handleRestart` to seek to `trimRef.current.start` instead
      of the hardcoded `0` (both the `isPlayingRef.current` branch that calls
      `startSources` and the else branch that sets `positionRef.current`).
- [ ] 2.3 In `tick()`, add a boundary check after the existing loop check:
      when loop is not enabled, `trimRef.current.end !== null`, and
      `position >= trimRef.current.end`, stop sources (same as the
      `masterPlaying` watcher effect) and call `setMasterPlaying(false)`
      instead of scheduling the next `requestAnimationFrame`.
- [ ] 2.4 Confirm `seek()` and waveform click/drag handlers are untouched —
      manual seeking must remain unrestricted by the trim range.

## 3. Timeline UI

- [ ] 3.1 Add "Set Trim Start" / "Set Trim End" buttons to `TimelinePanel.tsx`
      near the existing Loop controls, capturing the current
      `positionRef`/live position and calling the handlers from task 1.2.
- [ ] 3.2 Add a "Clear Trim" button, shown only when a non-default trim range
      is set.
- [ ] 3.3 Render dimmed overlays for `[0, trimStart)` and
      `(trimEnd, duration]` on the master waveform container, using the same
      absolute-positioning approach `TimelineMarkers` uses for the loop
      region.
- [ ] 3.4 Surface a toast (reusing `Home.tsx`'s existing toast mechanism, or
      an equivalent inline message in `StemPlayer`) when a trim-end-before-
      trim-start attempt is rejected.

## 4. Export integration

- [ ] 4.1 In `handlers.ts`, extend `export:mix`'s `options` parameter to
      `{ bpm?: number; trimStart?: number; trimEnd?: number }` and add
      `-ss <trimStart>` (when > 0) before each input, `-to <trimEnd>` (when
      set) on the output args.
- [ ] 4.2 Extend `export:single` similarly with an optional trim-range
      parameter and the same `-ss`/`-to` FFmpeg args.
- [ ] 4.3 Update the `VelodyAPI`/preload types (`exportMix`, `exportSingle`)
      to accept the new optional trim fields.
- [ ] 4.4 In `useExportState.ts`, pass the current `trimStart`/`trimEnd` from
      `useTrim` into both `handleExportMix` and `handleExportSingle` calls by
      default.

## 5. Tests

- [ ] 5.1 Add a test for `useTrim` covering: load from `.velody` (present and
      absent), save on set, and rejection of an inverted trim range.
- [ ] 5.2 Add/extend a test for the `tick()` boundary logic (or extract it to
      a testable pure function) covering: playback stops at `trimEnd` when
      loop is off; loop bounds inside the trim range are unaffected by
      `trimEnd`.
- [ ] 5.3 Add a test for the export FFmpeg-arg construction (or extract arg-
      building to a testable function) covering: no trim (unchanged args
      from today), `trimStart` only, `trimStart` + `trimEnd`.

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
