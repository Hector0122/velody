## Why

`useSongAnalysis` detects a song's BPM and first-beat offset once, then caches only
the BPM in the `.velody` sidecar file. On every subsequent load of that song (the
common case — nearly every play after the first), the cached-BPM code path hardcodes
`firstBeatOffsetRef.current = 0` instead of reusing the real detected offset, which is
never even persisted. Since almost no song's first beat lands exactly at `t=0`, the
metronome ends up phase-shifted from the actual music from the very start on every
play except the song's first-ever analysis — a plain bug, not a detection-accuracy
limitation.

## What Changes

- Persist `firstBeatOffset` alongside `bpm` when caching BPM detection results to the
  `.velody` sidecar file.
- When loading a cached BPM, use the cached `firstBeatOffset` instead of hardcoding 0.
- Bump `CACHE_VERSION` so existing sidecar caches (which never stored an offset) are
  treated as stale and re-analyzed once, rather than silently using a missing/zero
  offset forever.

## Capabilities

### New Capabilities
- `metronome-beat-alignment`: How the app determines and reuses the song's first-beat
  offset so metronome clicks stay phase-aligned with the actual music, including
  across cached (non-first) loads of the same song.

### Modified Capabilities
(none — `openspec/specs/` has no existing capabilities yet)

## Impact

- `src/renderer/src/hooks/useSongAnalysis.ts`: cached-load branch (currently hardcodes
  `firstBeatOffsetRef.current = 0`) and the `saveMeta` call (currently only writes
  `{ bpm, _version }`); `CACHE_VERSION` bump.
- No IPC contract change — `detectBpm`'s return shape already includes
  `firstBeatOffset`; this only changes what gets cached and reused.
- No Python worker changes (`detect_bpm.py` already computes and returns
  `firstBeatOffset` correctly on a fresh detection).
