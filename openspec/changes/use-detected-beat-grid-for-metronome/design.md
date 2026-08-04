## Context

See proposal.md - Why. `useMetronome`'s `schedulerTick` runs on a 25ms `setInterval`
while playing, with a `LOOKAHEAD = 0.3` window: on each tick it computes which
upcoming beats (within the next 0.3s of song time) need to be scheduled and calls
`playClick(accent, ctx.currentTime + delay)` for each, deduping already-scheduled
beats via `lastScheduledBeatRef` (a count of beats scheduled since the last reset).
External code (StemPlayer, useWaveSurfers, useRecording) resets alignment by writing
`lastScheduledBeatRef.current = -1` on seek/restart/loop/manual-BPM-change — this ref
is only ever *written* by callers outside `useMetronome`, never read, so its internal
meaning is free to reinterpret. `detect_bpm.py` already runs
`librosa.beat.beat_track()`, which returns beat frame indices for the *entire* track;
today only `beat_frames[0]` survives into the app.

## Goals / Non-Goals

**Goals:**
- Metronome clicks track the song's actual detected beat positions for as long as a
  beat grid is available, eliminating cumulative drift from constant-tempo
  extrapolation.
- No change to the manual BPM controls' behavior or the metronome's audio/UI.
- Minimal-footprint integration: reuse `lastScheduledBeatRef`'s existing external
  reset contract so every other file that resets it (`StemPlayer.tsx`,
  `useWaveSurfers.ts`, `useRecording.ts`) needs no changes.

**Non-Goals:**
- Real-time / continuous re-analysis of tempo during playback (e.g. live beat
  tracking) — the grid is computed once, up front, same as BPM is today.
- Time-signature detection — accent-beat placement stays a fixed "every 4th beat"
  assumption (`idx % 4 === 0` on the detected grid), same assumption the current code
  already makes (`beat % 4 === 1` today).
- Changing what `detect_bpm.py` uses to pick the *base* BPM (TempoCNN + librosa
  refinement stays as-is) — only what gets returned/used downstream changes.

## Decisions

- **Reinterpret `lastScheduledBeatRef` as "last scheduled beat-grid index" when a grid
  is in use, instead of introducing a second ref.** The two scheduling modes (grid vs.
  constant-tempo) are mutually exclusive per tick, and every transition between them
  (song change, manual BPM change) already goes through an existing `-1` reset in
  caller code. Because nothing outside `useMetronome` ever reads this ref, reusing it
  keeps the change contained to `useMetronome.ts` and `detect_bpm.py`/caching plumbing
  — no other file needs to learn about a new "beat index" concept.
- **Binary-search the beat-times array for the current position each tick**, rather
  than maintaining a persistent cursor. `beatTimes` is sorted ascending and typically
  a few hundred entries for a full song — a binary search per 25ms tick is negligible
  cost, and naturally handles arbitrary seeks/loops without needing separate
  cursor-resync logic (which a persistent-cursor approach would require).
- **Fall back to today's constant-tempo formula beyond the last detected beat**,
  anchored at the last beat's time/index instead of the song start. Beat tracking
  algorithms don't always extend cleanly to the very last moment of audio (trailing
  silence, fade-outs); rather than trying to force grid coverage to the exact end of
  the file, extending the existing, already-understood extrapolation from the last
  real beat is simpler and lower-risk than inventing a new "end of song" tempo model.
- **Manual BPM override disables the grid entirely for that session, keyed off
  `bpm !== originalBpmRef.current`** (both already available: `originalBpmRef` from
  `useSongAnalysis`, `bpm` from `useMetronome`'s own state). The detected grid
  corresponds to the originally detected tempo; once the user asks for a different
  tempo, continuing to use the original grid's timings would be actively wrong
  (clicks at the *old* tempo's positions while displaying a *new* BPM). Falling all
  the way back to constant-tempo extrapolation at the user's chosen BPM is simple,
  predictable, and matches what the metronome already does today for every song.
- **Cache `beatTimes` in the same `.velody` sidecar entry as `bpm`/`firstBeatOffset`**
  (extending `fix-cached-metronome-beat-offset`'s work) rather than a separate cache
  file — it's derived from the same detection run and has the same lifecycle
  (invalidated together via `CACHE_VERSION`).

## Risks / Trade-offs

- [Larger cache payload: a full song's beat grid is a few hundred floats (~5-10KB as
  JSON) vs. today's single number] → Acceptable: `.velody` is a small per-song
  sidecar file already; this is negligible next to typical stem file sizes.
- [`detect_bpm.py`'s protocol output grows a field] → Backward-compatible: the
  `song:detectBpm` IPC handler should treat a missing/non-array `beatTimes` as `[]`
  (empty grid), which the metronome already treats as "no grid, use constant-tempo" —
  so an old cached `.velody` entry or an unexpected script output degrades gracefully
  rather than breaking.
- [Beat tracking can occasionally mis-detect a beat (spurious/missed beat in the
  grid), which would show up as one wrong-feeling click rather than a gradual drift]
  → Accepted trade-off: an occasional single mis-placed click is a much smaller UX
  problem than the current guaranteed cumulative drift, and is inherent to any
  beat-tracking approach — not something this change can fully eliminate.

## Migration Plan

Renderer + Python worker + IPC types change together; no data migration (the
`CACHE_VERSION` bump handles invalidating old cache entries, consistent with how
`fix-cached-metronome-beat-offset` already invalidates once for its own cache shape
change). Land after `fix-cached-metronome-beat-offset` so the cache-shape changes
compose in one additional version bump rather than two independent ones. Rollback is
a plain revert; the constant-tempo fallback path means a partial rollout (e.g. Python
script updated but renderer not yet, or vice versa) degrades to today's behavior
rather than breaking.
