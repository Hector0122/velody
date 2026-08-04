## 1. Python: return the full beat grid

- [x] 1.1 In `detect_bpm.py`'s librosa branch, convert all of `beat_frames` (not just index 0) to times via `librosa.frames_to_time(beat_frames, sr=sr)`, round each to 4 decimals, and include as `beatTimes: [...]` in the returned dict. Keep `firstBeatOffset` as `beatTimes[0]` (or `0.0` if empty) for backward compatibility with existing consumers.
- [x] 1.2 In the no-librosa fallback branch, include `beatTimes: []`.
- [x] 1.3 Extend `python-worker/tests/test_detect_bpm.py`'s `test_returns_bpm_and_offset` (and/or add a new test) to assert `beatTimes` is present, is a list of numbers, and — when non-empty — is sorted ascending and its first element equals `firstBeatOffset`.

## 2. IPC / types plumbing

- [x] 2.1 Update `song:detectBpm`'s handler in `src/main/ipc/handlers.ts` to parse and return `beatTimes` from the Python script's JSON output, defaulting to `[]` if missing or not an array (forward/backward compatibility per design.md's Risks section).
- [x] 2.2 Update the `detectBpm` return type in `src/preload/index.ts`/`src/shared/types.ts` to include `beatTimes: number[]`.

## 3. Cache beatTimes alongside bpm/firstBeatOffset

- [x] 3.1 In `useSongAnalysis.ts`, bump `CACHE_VERSION` again (building on `fix-cached-metronome-beat-offset`'s bump).
- [x] 3.2 Persist `beatTimes` in the `saveMeta` call alongside `bpm`/`firstBeatOffset`.
- [x] 3.3 On a cache hit, populate a new `beatTimesRef` (returned from `useSongAnalysis`, mirroring `firstBeatOffsetRef`) from the cached value; default to `[]` if absent.
- [x] 3.4 Expose `originalBpmRef` (already computed in `useSongAnalysis`) as-is for `useMetronome` to compare against the live `bpm` state (per design.md's manual-override decision).

## 4. Metronome scheduling

- [ ] 4.1 Add `beatTimesRef` and `originalBpmRef` params to `useMetronome`.
- [ ] 4.2 Implement a binary-search helper (first index with `beatTimes[idx] >= t`) used by the grid-scheduling path.
- [ ] 4.3 In `schedulerTick`, branch on `beatTimesRef.current.length > 0 && bpmRef.current === originalBpmRef.current`: grid path schedules from `beatTimes`, deduping via `lastScheduledBeatRef` reinterpreted as "last scheduled grid index" (see design.md - Decisions); accent = `idx % 4 === 0`.
- [ ] 4.4 When the grid path's search index runs past the end of `beatTimes`, extrapolate forward from the last detected beat's time/index using the existing constant-tempo formula (anchored at `beatTimes[last]`/`lastIdx` instead of `offset`/`0`), continuing to write into `lastScheduledBeatRef`.
- [ ] 4.5 When the branch condition is false (no grid, or BPM manually overridden), run today's existing constant-tempo extrapolation unchanged.
- [ ] 4.6 Thread `beatTimesRef`/`originalBpmRef` from `useSongAnalysis`'s return into `useMetronome`'s call site in `StemPlayer.tsx`.

## 5. Tests

- [ ] 5.1 Add a renderer test for `useMetronome`'s scheduler: given a `beatTimesRef` with a known set of times, playing through them schedules `playClick` at those exact times (not a constant-tempo projection), including across a seek (position jumps to an arbitrary point mid-song).
- [ ] 5.2 Add a test for the past-the-grid extrapolation: position advances beyond the last entry in `beatTimesRef`, and clicks continue at a constant interval anchored to the last detected beat.
- [ ] 5.3 Add a test for the manual-override fallback: `bpm` differs from `originalBpmRef.current` even though `beatTimesRef` is non-empty, and scheduling uses constant-tempo extrapolation at the live `bpm` instead of the grid.
- [ ] 5.4 Confirm existing `useSongAnalysis`/metronome-related tests (including the ones added by `fix-cached-metronome-beat-offset`) still pass with the extended cache shape.

## 6. Manual verification

- [ ] 6.1 With a real Demucs/librosa setup, separate a song with natural (non-quantized) timing (e.g. a live recording), enable the metronome, and listen through the full song to confirm clicks stay on-beat throughout rather than drifting.
- [ ] 6.2 Manually adjust the BPM during playback and confirm the metronome switches to the new constant tempo immediately, then confirm it resumes grid-based tracking if BPM is set back to the detected value.
- [ ] 6.3 Seek/loop around a song with a beat grid and confirm no missed or duplicated clicks at the seek/loop boundaries.
