## Why

Reported after further live-testing, described as "a feeling more than
something certain" — a subtle sense that the count-in and the song's beat
aren't quite locked together, distinct from (and reported after fixing)
the much more obvious `fix-count-in-song-start-timing` bug, where the
metronome went completely silent through a song's intro.

Found by reading `useCountIn.ts`: the count-in's clicks are scheduled with
sample-accurate precision via Web Audio (`playClick(accent, scheduledTime)`,
scheduled against the metronome's own `AudioContext.currentTime`). But the
moment the count-in *ends* and hands off to actually starting the song
(`onComplete`, which calls `toggleMasterPlay()` — starting stem playback
and arming the in-song metronome) fired from a plain `setTimeout`, timed
independently on the JS wall clock.

`AudioContext.currentTime` (the audio hardware's own clock) and the JS wall
clock `setTimeout` runs on are two different clocks — not phase-locked to
each other, and `setTimeout` itself has no precision guarantee (main-thread
congestion, garbage collection pauses, Electron's IPC overhead can all
delay when it actually fires). Even over a short 1-2 bar count-in, that's
enough drift — typically single-digit to a few tens of milliseconds — to
produce a real but subtle "not quite on the beat" feeling when the song
starts, without being an obvious, easily-reproduced glitch. That drift
landing on exactly the moment playback starts is the plausible explanation
for what was described.

## What Changes

- `useCountIn.ts`'s `onComplete` no longer fires via `setTimeout`. It now
  polls `ctx.currentTime` via `requestAnimationFrame` and fires the instant
  the audio clock reaches the target time (`scheduleTime +
  totalBeats * interval` — the same clock, and the same formula, the
  clicks themselves are scheduled against). This ties the handoff to the
  audio hardware clock instead of an independent, unsynchronized JS timer,
  capping the error at roughly one animation frame (~16ms) instead of
  unbounded `setTimeout` jitter.
- The on-screen countdown ticks (`onTick`, the visual "3... 2... 1...")
  are unchanged — still `setTimeout`-based. They're display-only and don't
  affect anything audible, so the extra precision isn't needed there.
- `cancel()` now also cancels the pending animation-frame poll (via
  `cancelAnimationFrame`), alongside its existing `clearTimeout` cleanup.
- `useRecording.ts`'s pre-roll count-in shares the same `useCountIn` engine
  and gets this fix automatically — no changes needed there.

## Capabilities

(none — `add-song-count-in`'s existing requirement already describes the
count-in ending right where the song begins; this fixes the
implementation's precision, not the requirement. `skip_specs: true` set in
`.openspec.yaml`.)

## Impact

- `src/renderer/src/hooks/useCountIn.ts`: `onComplete` scheduling switched
  from `setTimeout` to an `requestAnimationFrame` poll against
  `ctx.currentTime`; `cancel()` also cancels the pending rAF.
- `src/renderer/src/__tests__/useCountIn.test.ts`: the shared `ctx` test
  stub's `currentTime` now advances with vitest's faked wall clock (so
  existing tests keep working against the new polling mechanism); added a
  regression test asserting `onComplete` waits for the audio clock
  specifically, not just elapsed wall-clock time.
- No changes to `useRecording.ts`, `StemPlayer.tsx`, or any IPC/persistence
  — this is a scheduling-precision fix contained entirely inside
  `useCountIn.ts`.
