## Why

Many of the user's songs start "de golpe" (cold, with no lead-in) — the first
downbeat lands immediately when playback starts, leaving no time to get
instruments/hands positioned before the band needs to be playing in time.
This is a real problem in live use: the user has to either pre-roll manually
every time or just get caught off guard.

Velody already has this exact mechanic built and working — but only for the
"record over a stem" flow. `useRecording.ts`'s `handleStartRecording`
schedules `countInBars * 4` metronome clicks via `playClick`, shows a
live-updating on-screen countdown (`recordingCount`, ticking `8, 7, 6, ...`
for 2 bars or `4, 3, 2, 1` for 1 bar), and only starts capturing audio once
the clicks finish. None of that is wired to the main Play button — pressing
Play always starts the song immediately, count-in or not.

## What Changes

- Add a metronome count-in before playback starts from a stopped state (the
  main Play button, when not already playing), reusing the same click
  scheduling and on-screen countdown mechanic already built for recording,
  extracted into a shared piece rather than duplicated.
- Per-song setting, selectable as **OFF / 1 bar / 2 bars** (4 or 8 clicks at
  the song's BPM), independent of the existing recording count-in control
  (which stays 0/1/2/4 bars, unchanged, and stays session-only).
- Persisted per song in the `.velody` sidecar (same mechanism as
  `song-trim-points`), so — like trim points — it's set once for a song in
  the regular setlist and stays set for every future show, not just the
  current session.
- Defaults to OFF for every song (new or existing) until the user explicitly
  turns it on, so this never changes behavior for a song the user hasn't
  configured.
- While a count-in is playing, the Play button shows the same kind of
  countdown overlay the recording flow already shows, and can be cancelled
  (stopping the scheduled clicks and never starting playback) the same way
  `handleStopRecording` cancels an in-progress recording count-in.
- Small accompanying correction while extracting the shared logic: the
  existing recording count-in only accents the very first click
  (`i === 0`) instead of the first click of *each* bar; the shared version
  accents every bar's downbeat (`i % 4 === 0`), which is what the recording
  flow was almost certainly meant to do already.

## Capabilities

### New Capabilities
- `song-playback-count-in`: A persisted, per-song metronome count-in that
  plays before playback starts from a stopped state, giving the performer
  time to get ready before the song's first beat.

### Modified Capabilities
(none — `openspec/specs/` has no existing capabilities yet; the recording
count-in's existing behavior is unchanged except for the accent-timing
correction noted above, which is a bug fix to its current implementation,
not a spec-level behavior this proposal is redefining)

## Impact

- `src/renderer/src/hooks/useRecording.ts`: count-in scheduling
  (click-scheduling + numeric countdown) extracted into a shared hook/helper
  reused by both flows; recording behavior otherwise unchanged (still
  0/1/2/4 bars, session-only, unaffected by the new per-song setting).
- `src/renderer/src/hooks/useAudioContextEngine.ts`: `toggleMasterPlay`'s
  "starting from stopped" branch gains an optional count-in delay before
  calling `startSources`.
- `src/renderer/src/components/StemPlayer.tsx`, `MasterPanel.tsx`: new
  per-song count-in setting/control and countdown overlay for playback
  start.
- `song:saveMeta`/`song:loadMeta` (`.velody` sidecar) reused as-is for
  persistence — no backend/IPC changes needed.
- No changes to `python-worker/` or the separation/BPM/key pipelines.
