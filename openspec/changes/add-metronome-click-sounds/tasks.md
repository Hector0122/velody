## 1. Preset synthesis (renderer)

- [x] 1.1 Define a `ClickPreset` type (`'pingpong' | 'woodblock' |
      'rimclick' | 'beep'`) and a `CLICK_PRESETS` map of
      `(ctx, accent, scheduledTime, volume) => void` synthesis functions,
      one per preset, per the parameters in design.md. New file
      `src/renderer/src/hooks/clickPresets.ts`.
- [x] 1.2 Implement `pingpong`: sine oscillator with
      `frequency.exponentialRampToValueAtTime` sweep (2000→1200Hz accent /
      1400→900Hz regular) over ~12ms, gain decay to silence over ~18ms,
      layered with a short (~4ms) bandpass-filtered (~2.5kHz) white-noise
      burst at low relative gain.
- [x] 1.3 Implement `woodblock` (triangle oscillator, lower frequency
      sweep, ~30ms decay) and `rimclick` (noise-only, bandpass ~3.5kHz,
      ~6ms) similarly.
- [x] 1.4 Implement `beep` as exactly today's existing
      `playClick` body (triangle, 1600/900Hz, 60ms exponential decay) —
      behavior-preserving, just renamed/moved into the preset map.
- [x] 1.5 Rewrite `playClick` in `useMetronome.ts` to look up the current
      preset and delegate to it, keeping its existing signature
      (`(accent, scheduledTime)`) unchanged so none of its four call sites
      need to change.

## 2. Preference persistence

- [x] 2.1 Add a small `useClickPreset()` hook (or inline in
      `useMetronome.ts`) that reads the selected preset from
      `localStorage` on init (defaulting to `'pingpong'` if unset or
      invalid), and a setter that updates state and writes back to
      `localStorage`. Built on a new generic `useLocalStoragePreference`
      hook (validated-type localStorage read/write, default fallback on
      missing/corrupted/invalid stored values) so
      `add-metronome-and-mix-panning`'s pan values can reuse it directly,
      per that proposal's own stated plan.

## 3. UI

- [x] 3.1 Add a preset picker (e.g. a row of labeled buttons, matching the
      existing 0/1/2/4 count-in button style) near the metronome volume
      control in `MasterPanel.tsx`. Used a 2x2 button grid (4 labeled
      presets don't fit one row in the panel's `w-44` width).
- [x] 3.2 Wire selection to `useClickPreset`'s setter; confirm switching
      presets while the metronome is actively clicking takes effect on the
      next scheduled click without needing to stop/restart playback.
      (`playClick` reads `clickPresetRef.current`, mirrored from state via
      the same `useLayoutEffect` pattern already used for `metroVolume` —
      so a preset change is visible to the very next scheduled click with
      no extra wiring needed.)

## 4. Export click track (main process)

- [x] 4.1 In `handlers.ts`, extend `generateClickTrackWavAsync`'s
      per-sample synthesis to branch on a `preset` parameter, implementing
      equivalent raw-PCM versions of the same four presets (frequency
      sweep via a linear/exponential interpolation over the sample window,
      decay envelope, and — for `pingpong`/`rimclick` — a mixed-in
      pseudo-random noise burst). Extracted as a standalone, exported,
      directly-testable `clickSampleValue(preset, beatPos, accent)`
      function. **Bug found and fixed while doing this:** the original
      per-sample loop's `beatPos` is a *signed* offset from the nearest
      beat (negative for roughly the second half of every beat interval),
      but the original 'beep' math only checked an upper bound
      (`beatPos < clickDur`), so it incorrectly re-triggered the click
      envelope across that entire negative half with an unbounded,
      clipping `(1 - phase)` scale factor for very negative `beatPos`. All
      four presets (including `beep`) now require `beatPos >= 0` too;
      covered by a regression test
      (`clickSampleValue.test.ts` — "never exceeds a full-scale [-1, 1]
      envelope").
- [x] 4.2 Extend `export:mix`'s `options` parameter from `{ bpm?: number }`
      to `{ bpm?: number; trimStart?: number; trimEnd?: number;
      clickPreset?: ClickTrackPreset }` (trim fields already present from
      `add-song-trim-points`), defaulting to `'pingpong'` when omitted,
      and pass it through to `generateClickTrackWavAsync`.
- [x] 4.3 Update `VelodyAPI.exportMix`'s type (`shared/types.ts`,
      `preload/index.d.ts`) to include the new optional field.
- [x] 4.4 In `useExportState.ts`, pass the renderer's currently selected
      `clickPreset` into `handleExportMix`'s `exportMix` call — only
      included when `exportWithMetronome` is on (mirrors how `bpm` is
      already conditional), since the preset is meaningless without a
      click track being generated.

## 5. Tests

- [x] 5.1 Add tests for `useClickPreset`: default when unset, round-trip
      persistence, invalid stored value falls back to the default. Plus a
      separate `useLocalStoragePreference.test.ts` covering the shared
      helper generically (corrupted JSON, failed validation, persistence).
- [x] 5.2 Add a test confirming `playClick` dispatches to the correct
      preset function for each `ClickPreset` value (e.g. by mocking the
      preset map and asserting the right entry is invoked). Covered via
      `clickPresets.test.ts` asserting each `CLICK_PRESETS[preset]`
      function's exact Web Audio node calls (oscillator type, frequency
      sweep values, filter type/frequency, noise vs. no-noise), plus
      `useMetronome.test.ts`'s existing scheduling tests (pinned to the
      `'beep'` preset via `localStorage`, since they test scheduling
      timing/accent alternation, not synthesis — see the comment added
      there).
- [x] 5.3 Add a test for the export PCM synthesis covering: each preset
      produces non-silent samples within its expected click window, and
      samples outside any click window stay silent (0).
      `clickSampleValue.test.ts` in `src/main/ipc/__tests__/`, following
      the `scanSongsLibrary.test.ts`/`trimArgs.test.ts` pattern for
      importing `handlers.ts` outside Electron's runtime.

## 6. Manual verification (tune by ear — see design.md Risks)

- [ ] 6.1 Run `pnpm dev`, play each preset at a few different BPMs and
      volumes, and confirm none of them clip or sound harsh at the noise
      layer's chosen gain; adjust levels in code if needed before
      finalizing.
- [ ] 6.2 Confirm the recording count-in and playback count-in
      (`add-song-count-in`) both audibly use the same selected preset as
      live playback.
- [ ] 6.3 Export a mix with the metronome click track enabled for a couple
      of presets and confirm the exported file's click audibly matches
      what was heard live.
- [ ] 6.4 Restart the app and confirm the previously selected preset is
      still active.
