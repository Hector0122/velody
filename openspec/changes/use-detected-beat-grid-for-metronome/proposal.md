## Why

The metronome scheduler (`useMetronome.ts`) assumes a perfectly constant tempo for the
whole song: every click time is a linear extrapolation `offset + beat * 60/bpm` from a
single detected BPM value and a single first-beat offset. `librosa.beat.beat_track()`
(already run during BPM detection) actually detects the position of every beat across
the whole song, but `detect_bpm.py` only extracts the first one (`beat_frames[0]`) and
discards the rest. On songs with any natural tempo variation (live drums, human
performance, non-quantized recordings) or even a small BPM estimation error, the
linear extrapolation drifts further from the real beat the longer the song plays —
this is a structural limitation of the current design, not an edge-case bug, and it's
the direct cause of "some songs go out of sync as they play."

## What Changes

- `detect_bpm.py` returns the full detected beat-time grid (`beatTimes: number[]`,
  seconds) alongside `bpm`/`firstBeatOffset`, instead of discarding everything but the
  first beat.
- The `song:detectBpm` IPC result, preload types, and the `.velody` cache are extended
  to carry `beatTimes` (building on `fix-cached-metronome-beat-offset`'s caching of
  `firstBeatOffset` — another `CACHE_VERSION` bump).
- `useMetronome`'s scheduler uses the real detected beat times to schedule clicks when
  a grid is available and the user hasn't manually overridden the tempo, instead of
  extrapolating from a single BPM. Beyond the last detected beat (or when no grid is
  available, e.g. librosa missing or the user changed BPM manually), it falls back to
  today's constant-tempo extrapolation unchanged.
- No change to the metronome's UI, controls, or manual BPM override behavior.

## Capabilities

### New Capabilities
- `metronome-tempo-tracking`: How the metronome schedules clicks against the song's
  actually detected beat positions over the course of playback, rather than a single
  constant-tempo projection, including the fallback behavior when no beat grid is
  available or the tempo has been manually overridden.

### Modified Capabilities
(none — `openspec/specs/` has no existing capabilities yet; this is intentionally kept
as a separate capability from `metronome-beat-alignment` even though both changes
touch metronome scheduling, since they land as independently mergeable changes)

## Impact

- `python-worker/detect_bpm.py`: compute and return the full beat-time array.
- `python-worker/tests/test_detect_bpm.py`: extend coverage for `beatTimes`.
- `src/main/ipc/handlers.ts`: `song:detectBpm` handler's parsed-result shape.
- `src/preload/index.ts`, `src/shared/types.ts`: `detectBpm` return type.
- `src/renderer/src/hooks/useSongAnalysis.ts`: cache/reuse `beatTimes` (extends the
  cache work from `fix-cached-metronome-beat-offset`).
- `src/renderer/src/hooks/useMetronome.ts`: scheduling algorithm.
- `src/renderer/src/components/StemPlayer.tsx`: threading `beatTimes`/`originalBpmRef`
  into `useMetronome` alongside the existing `firstBeatOffsetRef`.
