## Context

See proposal.md — Why. Relevant existing pieces, established by direct code
reading (not assumption):

- `useRecording.ts` `handleStartRecording`: computes `totalBeats =
  countInBars * 4` (hardcoded 4/4), `interval = 60 / bpm`, schedules each
  click via `playClick(accent, scheduledTime)` (sample-accurate, scheduled
  against the metronome's own `AudioContext.currentTime`), and separately
  drives a purely visual countdown (`recordingCount`) via a chain of
  `setTimeout`s (`totalBeats - i` at `i * interval * 1000 + 50`ms). Capture
  (`beginCapture`) begins after one final `setTimeout` at
  `totalBeats * interval * 1000 + 50`. All of these timeout ids are tracked
  in `recordingTimeoutIds` and cleared by `handleStopRecording`/
  `handleDiscardRecording` — the cancellation path already exists and works.
- `playClick(accent: boolean, scheduledTime: number)` (`useMetronome.ts`) is
  a pure "make a click sound at this AudioContext time" primitive — it does
  **not** check `metronomeOn` or `masterPlaying` itself, so it's already
  safe to call from any flow (recording today, playback with this proposal)
  regardless of the user's separate "metronome click during playback"
  toggle.
- `audioStartRef` (declared in `StemPlayer.tsx`, threaded into
  `useRecording`) is read in `handleStartRecording`'s pre-roll seek-back
  logic but is **never assigned anywhere in the codebase** — it's always
  `null`, so that branch (`audioStart !== null && audioStart > 0`) is
  currently dead code. It reads as a stubbed hook for "the point where the
  real song audio begins," i.e. conceptually the same thing
  `add-song-trim-points`' `trimStart` defines. This proposal does not fix
  that (out of scope — it's recording's pre-roll, not playback-start), but
  notes it because it's the same underlying concept as `trimStart` and a
  future cleanup could wire `audioStartRef` from the same source.
- `toggleMasterPlay` (`useAudioContextEngine.ts`): the "starting from
  stopped" branch (`masterPlaying` false → true) synchronously builds the
  `active` map, calls `ensureCtx()`, `startSources(positionRef.current)`,
  and flips `setMasterPlaying(true)` — all in one synchronous call with no
  existing hook point for an async delay before playback actually starts.
- `song:saveMeta`/`song:loadMeta` (`.velody` sidecar): generic per-song
  key-value JSON, already the storage mechanism `add-song-trim-points`
  proposes to use for `trimStart`/`trimEnd`.

## Goals / Non-Goals

**Goals:**
- Give the performer a predictable lead-in (1 or 2 bars of clicks) before a
  song's first beat, without changing anything for songs/users that don't
  opt in.
- Reuse the click-scheduling/countdown mechanic that already works for
  recording, instead of writing a second implementation of the same
  beat-scheduling math.
- Persist the setting per song, matching `add-song-trim-points`'
  once-per-song-not-per-show rationale — the same "we play the same set
  every night" concern the user raised there applies identically here.

**Non-Goals:**
- Triggering count-in from the Restart button while already playing.
  Restart's current behavior is an instant jump back to the trim
  start/beginning with no gap; turning that into "stop, count in, then
  restart" is a materially different (and riskier — mid-song Restart is
  presumably used precisely to snap back *without* losing the beat, e.g.
  after a mistake) behavior change the user didn't ask for. Only the Play
  button's stopped→playing transition gets a count-in.
- Triggering count-in when starting playback by clicking an individual stem
  while master is paused (`toggleStem`'s equivalent starting branch). Kept
  out to limit the surface of this change; the main Play button is the
  primary way the user starts a song live per their description.
- Unifying this with the existing recording count-in's `countInBars` state
  or its 0/1/2/4 range. They're kept as two independent settings (see
  Decisions) so persisting/defaulting one doesn't change the other's
  established behavior.
- Changing the underlying click sound, volume, or the existing in-playback
  metronome (`metronomeOn`) toggle — count-in only affects the pre-roll
  before playback starts.

## Decisions

- **Extract the click-scheduling + numeric-countdown logic out of
  `useRecording.ts` into a shared hook (e.g. `useCountIn`), rather than
  duplicating it for playback-start.** Both flows need identical math
  (`totalBeats = bars * 4`, `interval = 60 / bpm`, schedule N `playClick`
  calls, tick a countdown number down to 0, fire a callback when done,
  support cancellation). `useRecording` keeps calling it for its own
  0/1/2/4 control; the new playback-start path calls it with the new
  per-song OFF/1/2 setting. Matches this repo's own established pattern of
  extracting shared hooks out of duplicated logic (AGENTS.md's R7/R8/R16/R17
  performance-tracking entries are exactly this kind of extraction).
- **Fix the accent to land on every bar's downbeat (`i % 4 === 0`), not just
  the very first click (`i === 0`).** Bundled into the extraction since it's
  the same code being touched and is clearly the intended behavior for a
  multi-bar count-in (the in-playback metronome scheduler already accents
  every 4th beat, `beat % 4 === 1` / `idx % 4 === 0` — the recording
  count-in's `i === 0` is inconsistent with that, most plausibly an
  oversight from when count-in only supported 1 bar).
- **New, separate per-song state — not a reuse of `countInBars`.** The
  recording control is intentionally session-only and defaults to 1 bar
  every time the app opens; changing its persistence or default as a side
  effect of this proposal would alter recording behavior the user didn't
  ask to change. The new setting (`playbackCountInBars: 0 | 1 | 2`, stored
  per song) is independent, defaults to `0` (off) for every song, and is
  surfaced as its own OFF/1/2 control near the Play button rather than
  folded into the existing recording-panel control.
- **Persist via the same `.velody` sidecar mechanism as
  `add-song-trim-points`.** No new storage system; `song:saveMeta`/
  `song:loadMeta` already do exactly this. Loaded alongside trim points if
  that proposal has shipped, or independently otherwise — the two don't
  depend on each other technically, they just share a storage pattern and a
  motivation (setlist prep that survives to show day).
- **Cancellable via the same Stop-button/`masterPlaying` semantics already
  used for recording's countdown.** Pressing Stop (or Play again) during
  the count-in clears the pending scheduled clicks/timeouts and never calls
  `startSources` — mirroring `handleStopRecording`'s existing cleanup of
  `recordingTimeoutIds` exactly, so this doesn't need a new cancellation
  pattern, just the same one applied to the new call site.
- **Count-in only fires on the stopped→playing transition, regardless of
  current position.** Matches the recording count-in's own precedent: it
  fires on every `handleStartRecording` call regardless of `positionRef`, no
  "are we actually near the start" gate on whether the count-in plays at
  all (only recording's now-dead pre-roll *seek* logic had a `nearStart`
  check, and that's for something else — rewinding audio, not deciding
  whether to count in). Simpler, and matches what the user described: they
  want the click before the song's first beat, every time they hit Play
  from stopped.

## Risks / Trade-offs

- [Extracting `useRecording`'s scheduling logic touches a working,
  already-shipped feature] → Mitigated by keeping the extraction
  behavior-preserving for recording (same 0/1/2/4 range, same session-only
  state, same defaults) aside from the deliberate accent-timing fix called
  out above; task list includes re-running recording's existing manual
  verification after the extraction.
- [A count-in adds a fixed delay (1–2 bars at the song's BPM) before sound
  starts, which could surprise a user who doesn't expect it the first time
  they enable it for a song] → Mitigated by defaulting to OFF and requiring
  an explicit per-song opt-in; the on-screen countdown makes it obvious
  what's happening while it plays.

## Migration Plan

No migration needed. Existing `.velody` sidecars have no
`playbackCountInBars` key; absence is treated as `0` (off), so every
existing song behaves exactly as it does today until the user explicitly
turns count-in on for it.
