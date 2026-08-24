## Why

After three prior fixes to the count-in→song-start handoff this session
(wrong AudioContext, an unshared scheduling ratchet, `setTimeout` jitter),
the user asked to stop reactively chasing individual reports and step back:
"podemos dejar de atacar problemas pequeños y ver el panorama completo??"
— this is, in their words, possibly the single most important thing for
live confidence in the app, and the accumulation of separate timing bugs
found this session was itself a signal that the timing subsystem needed a
holistic pass, not another one-off patch.

Audited the full playback-start pipeline fresh (not from memory) —
`useAudioContextEngine.ts`, `useMetronome.ts`, `useCountIn.ts`,
`useRecording.ts`, and their wiring in `StemPlayer.tsx` — tracing every
step of "user presses Play with count-in on" through to "the song's first
sample is audible."

Found one remaining structural gap, even after all three prior fixes: the
count-in's clicks are scheduled with sample accuracy on the *metronome's*
own `AudioContext`, but the moment playback actually starts was still
**reactive** — `toggleMasterPlay()` (which calls `source.start(0, ...)` =
"as soon as possible" on the *stem engine's own, separate* `AudioContext`)
only ran once the count-in was *detected* to have finished, via an
`requestAnimationFrame` poll of the metronome context's clock. That poll
is bounded by ~1 animation frame (~16ms) of granularity — much tighter
than the `setTimeout`-based version it replaced, but still a real,
non-zero gap between "the count-in's last beat lands" and "the song's
first sample begins," on top of `source.start(0, ...)`'s own small
render-quantum latency. Small, but within the range a musician listening
critically for a locked-in click (the user specifically described a
drummer's needs earlier this session) can perceive.

## What Changes

- The song's actual first sample is now **pre-scheduled up front**, at the
  same synchronous moment the count-in's clicks themselves get scheduled
  (when Play is pressed) — not triggered reactively once the count-in is
  observed to have finished.
- This works without needing to convert between the two independent
  AudioContexts' unrelated clocks: both contexts advance at the same
  real-world rate (1 second of `currentTime` == 1 real second), so
  computing "this context's own `currentTime` + the same real-seconds
  count-in duration" independently on *each* context, at the same instant,
  lines the two schedules up exactly — with zero reactive polling step at
  the handoff itself.
- `toggleMasterPlay`/`startSources`/`startSourceForKey` gain an optional
  `when` parameter (the stem engine's own future `AudioContext.currentTime`)
  — when given, sources start via `source.start(when, position)` instead
  of `source.start(0, position)`. The playback-position RAF loop
  (`tick()`) correctly holds position at the start value (not going
  negative) until that instant actually arrives.
- **A gap this surfaced and had to be closed in the same change**: once
  `masterPlaying` flips true immediately (at Play-press time, before the
  scheduled instant arrives, so the transport UI and cancel-ability are
  responsive right away), the in-song metronome scheduler would also start
  polling immediately — and could wrongly schedule a click during the
  count-in's wait for any song whose first real beat lands within the
  scheduler's lookahead window of the start/trim position. That's not a
  rare edge case: it's exactly what `add-song-trim-points` exists to
  produce (trimming a song to start right on the beat). Fixed with a new
  shared `playbackPendingRef`, true from the moment playback is
  pre-scheduled until the scheduled instant actually arrives; the in-song
  scheduler now checks it and does nothing while still pending.
- Canceling mid-count-in now also stops the already-armed (but not yet
  audible) stem sources — `AudioBufferSourceNode.stop()` correctly cancels
  a source before its scheduled start time, per the Web Audio spec.
  Without this, canceling only the count-in's clicks would leave the song
  still armed to start unexpectedly at the original scheduled instant.
- The count-in's own `onComplete` callback is no longer what gates audio —
  it's purely a UI-state signal now (clearing the on-screen countdown
  overlay), where a few ms of imprecision is inaudible/irrelevant.
- **Recording's pre-roll (`useRecording.ts`) is unchanged** — audited but
  not touched: `MediaRecorder.start()` has no equivalent to Web Audio's
  `source.start(when)` (no sample-accurate future-start API), so the same
  pre-scheduling technique isn't available there. Its existing rAF-poll-
  based `onComplete` (from `fix-count-in-onbeat-handoff-jitter`) is already
  close to the best achievable precision for that specific mechanism, and
  recording-offset alignment has a more forgiving tolerance than a live
  performance click.

## Capabilities

(none — `add-song-count-in`'s existing requirement already describes the
count-in ending right where the song begins; this is a precision fix to
the implementation, not a requirement change. `skip_specs: true` set in
`.openspec.yaml`.)

## Impact

- `src/renderer/src/hooks/useCountIn.ts`: exports `COUNT_IN_LEAD_IN`
  (was an inline magic number) so callers can independently compute an
  identical duration for their own pre-scheduling.
- `src/renderer/src/hooks/useAudioContextEngine.ts`: `toggleMasterPlay`,
  `startSources`, `startSourceForKey` gain an optional `when` parameter;
  `tick()`/`joinLateDecodedStem` clamp elapsed time at 0 while a
  pre-scheduled start is still pending; new `playbackPendingRef` param
  (shared, written here); `ensureAudioCtx` (the hook's `ensureCtx`)
  exported from the hook's return value.
- `src/renderer/src/hooks/useMetronome.ts`: new required `playbackPendingRef`
  parameter; `schedulerTick` returns early while it's true.
- `src/renderer/src/components/StemPlayer.tsx`: new `playbackPendingRef`
  (owned here, threaded into both hooks);
  `handleToggleMasterPlayWithCountIn` pre-schedules the stem engine's
  start up front instead of chaining off `playbackCountIn`'s `onComplete`;
  cancel path also stops the pre-armed sources.
- Tests: `useAudioContextEngine.test.ts` (new describe block for
  pre-scheduled playback), `useMetronome.test.ts` (regression test:
  scheduler stays silent while pending even with a beat inside lookahead
  of the clamped position), `renderMetronome`/`useMetronome`'s test call
  sites updated for the new required parameter.
