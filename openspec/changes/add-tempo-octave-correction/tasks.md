## 1. Correction logic

- [x] 1.1 Add `tempoOctaveCorrection.ts` with a pure
      `correctTempoOctave(beatTimes, bpm, firstBeatOffset, direction)`
      function: doubling interpolates a midpoint beat between every
      consecutive pair; halving drops every other beat.
- [x] 1.2 Extract `songDirFromStemPath` into `utils.ts` (from
      `useSongAnalysis.ts`'s existing inline derivation), reused by both.

## 2. Wiring

- [x] 2.1 In `StemPlayer.tsx`, add `handleCorrectTempoOctave(direction)`:
      recomputes via `correctTempoOctave`, updates `beatTimesRef`,
      `firstBeatOffsetRef`, `originalBpmRef`, resets
      `lastScheduledBeatRef` to `RESET_SCHEDULED_BEAT`, calls `setBpm`,
      and persists the result to the song's `.velody` cache via
      `window.api.saveMeta` (same shape `useSongAnalysis` writes).
- [x] 2.2 Add "½"/"×2" buttons next to the BPM control in
      `MasterPanel.tsx`, wired to the new handler.

## 3. Tests

- [x] 3.1 Unit test `correctTempoOctave`: doubling inserts correct
      midpoints and doubles bpm; halving drops every other beat and halves
      bpm; doubling then halving round-trips to the original grid; empty
      grid (bpm-only correction, no crash); single-beat grid (nothing to
      interpolate).
- [x] 3.2 Unit test the extracted `songDirFromStemPath` helper (Unix and
      Windows paths).

## 4. Manual verification

- [ ] 4.1 Run `pnpm dev` on a song with a known octave-detection error;
      apply the correction; confirm the BPM display updates and the
      metronome click now lines up with the real beat.
- [ ] 4.2 Close and reopen the song; confirm the correction is still in
      effect (no re-detection, no reset to the original wrong BPM).
- [ ] 4.3 Confirm a normal, correctly-detected song is unaffected unless
      the user explicitly applies a correction.
