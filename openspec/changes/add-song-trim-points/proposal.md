## Why

Velody's MVP is explicitly a live-practice/live-performance tool (see AGENTS.md
"herramienta de práctica musical" / Phase 2 navigation goals), but many
imported songs (especially YouTube rips, per `download.py`/`url:import`) carry
long, non-musical intros — visualizer intros, label idents, spoken
introductions — before the actual song starts. Today there is no way to skip
past that automatically: every time the user hits Play or Restart, playback
starts at second 0 of the raw file, forcing them to manually seek past the
intro during a live set. Marker/loop state (`useMarkers`) is also
session-only — it resets the moment the song is reopened — so even a manual
loop workaround has to be re-set every time, which is a nonstarter for a
song prepared ahead of a gig and opened again on show day.

## What Changes

- Add a per-song **trim range** (`trimStart`, optional `trimEnd`) that defines
  where the "real" song begins and (optionally) ends, independent of the
  underlying audio file's actual length.
- Persist the trim range in the song's existing `.velody` sidecar (via
  `song:saveMeta`/`song:loadMeta`, the same mechanism already used for the
  BPM/key cache), so it survives closing and reopening the song — unlike
  markers/loop points, which are intentionally session-only today.
- "Restart" (and the initial play position when a song is opened) seeks to
  `trimStart` instead of hardcoded `0`.
- If `trimEnd` is set and A/B loop is not active, playback stops when it
  reaches `trimEnd` instead of continuing into the untrimmed remainder of the
  file.
- The master timeline visually dims the trimmed-out regions (before
  `trimStart`, after `trimEnd`) so the user can see at a glance what's being
  skipped. The user can still freely scrub anywhere in the full waveform
  (including the dimmed regions) to preview or re-adjust the trim points —
  trimming only changes default/end-of-playback behavior, it never blocks
  manual seeking.
- Two controls ("Set Trim Start", "Set Trim End") capture the current
  playhead position, next to the existing Loop controls in `TimelinePanel`; a
  "Clear Trim" control resets to the untrimmed default (`trimStart: 0`,
  `trimEnd: null`).
- Export (`export:mix`, `export:single`) gains an optional trim range so
  exported files match what the trimmed range plays live, instead of always
  exporting the full untrimmed source.
- The underlying stem files on disk are never modified — this is purely a
  playback/export-time range, not a destructive edit (see design.md for why).

## Capabilities

### New Capabilities
- `song-trim-points`: Defines a persisted, per-song playback range that lets
  long intros/outros be skipped during playback, restart, and export without
  altering the underlying audio files.

### Modified Capabilities
(none — `openspec/specs/` has no existing capabilities yet)

## Impact

- `src/main/ipc/handlers.ts`: `export:mix`, `export:single` gain an optional
  trim-range parameter; FFmpeg args gain `-ss`/`-to`. `song:saveMeta`/
  `song:loadMeta` are reused as-is (already generic key-value merge/read).
- `src/renderer/src/hooks/useAudioContextEngine.ts`: `handleRestart` and the
  playback-position tick loop.
- `src/renderer/src/components/TimelinePanel.tsx` (and the master waveform
  overlay it renders): new trim controls and dimmed-region rendering.
- `src/renderer/src/components/StemPlayer.tsx`, `useExportState.ts`: thread
  the loaded/edited trim range through to the engine, timeline, and export
  calls.
- No changes to `python-worker/` or the separation/BPM/key pipelines.
