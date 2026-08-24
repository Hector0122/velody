## 1. Correction logic (v1 — arithmetic, now the fallback path)

- [x] 1.1 Add `tempoOctaveCorrection.ts` with a pure
      `correctTempoOctave(beatTimes, bpm, firstBeatOffset, direction)`
      function: doubling interpolates a midpoint beat between every
      consecutive pair; halving drops every other beat.
- [x] 1.2 Extract `songDirFromStemPath` into `utils.ts` (from
      `useSongAnalysis.ts`'s existing inline derivation), reused by both.

## 2. Wiring (v1)

- [x] 2.1 In `StemPlayer.tsx`, add `handleCorrectTempoOctave(direction)`:
      recomputes via `correctTempoOctave`, updates `beatTimesRef`,
      `firstBeatOffsetRef`, `originalBpmRef`, resets
      `lastScheduledBeatRef` to `RESET_SCHEDULED_BEAT`, calls `setBpm`,
      and persists the result to the song's `.velody` cache via
      `window.api.saveMeta` (same shape `useSongAnalysis` writes).
- [x] 2.2 Add "½"/"×2" buttons next to the BPM control in
      `MasterPanel.tsx`, wired to the new handler.

## 3. Tests (v1)

- [x] 3.1 Unit test `correctTempoOctave`: doubling inserts correct
      midpoints and doubles bpm; halving drops every other beat and halves
      bpm; doubling then halving round-trips to the original grid; empty
      grid (bpm-only correction, no crash); single-beat grid (nothing to
      interpolate).
- [x] 3.2 Unit test the extracted `songDirFromStemPath` helper (Unix and
      Windows paths).

## 4. Manual verification (v1 — surfaced the accuracy problem)

- [x] 4.1 Run `pnpm dev` on "Just Like Heaven" (known octave error);
      applied ×2. **Result: BPM updated correctly (76.9 → 153.8) but the
      click sounded wrong — "se adelanta y se atrasa" (drifts ahead/
      behind, alternating).** Root-caused to arithmetic midpoint
      interpolation assuming perfectly uniform beat spacing, which real
      (non-quantized) recordings don't have — see design.md. Led directly
      to the redetection-based revision below.

## 5. Redetection logic (v2 — the fix, now the primary path)

- [x] 5.1 `detect_bpm.py`: extract `_beat_track_result` helper; add
      optional `bpm_hint` parameter to `detect_bpm()` — when given, skips
      TempoCNN and calls `librosa.beat.beat_track(y=y, sr=sr,
      bpm=bpm_hint)` directly; new `--bpm-hint <bpm>` CLI flag.
- [x] 5.2 `handlers.ts`: extract shared `runDetectBpm(stemPath, bpmHint?)`;
      `song:detectBpm` accepts an optional `bpmHint`, threaded through as
      `--bpm-hint`; new independent `bpmRedetectionRunning` singleflight
      guard (kept separate from `bpmDetectionRunning` — see design.md).
- [x] 5.3 `preload/index.ts`, `shared/types.ts`: `detectBpm` gains the
      optional `bpmHint` parameter.

## 6. Wiring (v2)

- [x] 6.1 `StemPlayer.tsx`: `handleCorrectTempoOctave` is now async —
      computes `hintBpm` (`originalBpmRef.current * 2` or `/ 2`), calls
      `window.api.detectBpm(stems[0], hintBpm)`; on success applies the
      redetected grid; on failure/empty result falls back to
      `correctTempoOctave` (v1's arithmetic approach); either way persists
      via the shared `applyTempoOctaveCorrection`. New
      `correctingTempoOctave` state guards against overlapping corrections
      and drives a loading indicator.
- [x] 6.2 `MasterPanel.tsx`: "½"/"×2" buttons disabled and labeled
      "Correcting…" while `correctingTempoOctave` is true.

## 7. Tests (v2)

- [x] 7.1 `test_detect_bpm.py`: new `TestBpmHint` class (gated on
      `HAS_LIBROSA` only, not `HAS_TEMPOCNN` — confirms the hint path
      doesn't need TempoCNN) — a synthetic click track at a known tempo
      confirms `--bpm-hint <correct>` finds beats at that tempo, and
      `--bpm-hint <wrong-octave>` still returns a valid (if differently-
      spaced) grid rather than erroring. Verified manually (pytest itself
      isn't installed in this environment) via an equivalent standalone
      script exercising the same script subprocess calls — all passed,
      including the pre-existing no-args/nonexistent-file error-path
      tests (confirming no regression).

## 8. Manual verification (v2)

- [ ] 8.1 Re-run `pnpm dev` on "Just Like Heaven"; apply ×2; confirm the
      click no longer drifts ahead/behind and stays locked to the real
      beat throughout the song.
- [ ] 8.2 Close and reopen the song; confirm the corrected (redetected)
      grid is still in effect.
- [ ] 8.3 Confirm a normal, correctly-detected song is unaffected unless
      the user explicitly applies a correction.
- [ ] 8.4 Confirm the "Correcting…" loading state appears and clears
      correctly, and the buttons can't be double-clicked mid-correction.
