## 1. Full-pipeline audit

- [x] 1.1 Re-read `useAudioContextEngine.ts`, `useMetronome.ts`,
      `useCountIn.ts`, `useRecording.ts`, `StemPlayer.tsx` fresh, tracing
      every step of the count-in→playback handoff and steady-state
      in-song scheduling.
- [x] 1.2 Identified the remaining gap: reactive (rAF-poll-triggered)
      `toggleMasterPlay()` call still bounded by ~1 frame of polling
      granularity, on top of `source.start(0, ...)`'s own latency.
- [x] 1.3 Audited `useRecording.ts`'s pre-roll separately — confirmed
      `MediaRecorder` has no pre-schedulable future-start equivalent, so
      left unchanged (documented in proposal.md).

## 2. Pre-scheduled handoff

- [x] 2.1 Export `COUNT_IN_LEAD_IN` from `useCountIn.ts`.
- [x] 2.2 `useAudioContextEngine.ts`: `startSourceForKey`/`startSources`/
      `toggleMasterPlay` accept an optional `when`; `source.start(when ??
      0, position)`. Export `ensureAudioCtx` (`ensureCtx`) from the hook's
      return value.
- [x] 2.3 `tick()`/`joinLateDecodedStem`: clamp elapsed time at 0 while
      `ctx.currentTime < startTimeRef.current` (a pre-scheduled start
      still pending).
- [x] 2.4 `StemPlayer.tsx`: `handleToggleMasterPlayWithCountIn` computes
      the count-in's real-seconds duration, reads the stem engine's own
      `ensureAudioCtx().currentTime`, and calls
      `toggleMasterPlay(stemCtx.currentTime + duration)` at the same
      synchronous moment the count-in itself starts. `playbackCountIn`'s
      `onComplete` becomes a no-op for audio purposes; a plain `setTimeout`
      matched to the same duration clears the visual countdown state.

## 3. Fix the gap this surfaced (metronome scheduler firing during pre-roll)

- [x] 3.1 Add `playbackPendingRef` (owned by `StemPlayer`, written by
      `useAudioContextEngine`'s `startSources`/`tick`, read by
      `useMetronome`'s `schedulerTick`) — true while a pre-scheduled start
      hasn't arrived yet.
- [x] 3.2 `useMetronome.ts`: new required `playbackPendingRef` parameter;
      `schedulerTick` returns early while it's true.
- [x] 3.3 `handleToggleMasterPlayWithCountIn`'s cancel-mid-count-in path
      also calls `toggleMasterPlay()` (no `when`) to stop the already-armed
      sources, not just the count-in's own clicks.

## 4. Tests

- [x] 4.1 `useAudioContextEngine.test.ts`: new describe block — sources
      start at a given future `when` instead of immediately;
      `playbackPendingRef` set/cleared correctly for a future `when`, an
      immediate start, and a non-future `when`.
- [x] 4.2 `useMetronome.test.ts`: regression test — scheduler schedules
      nothing while `playbackPendingRef` is true even with position
      clamped within lookahead of a real beat; schedules normally once
      pending clears. `renderMetronome` helper and its direct
      `useMetronome()` test call updated for the new required parameter.

## 5. Manual verification

- [ ] 5.1 Run `pnpm dev`, play a song with count-in enabled, confirm the
      handoff feels tightly locked (this is inherently a live-listening
      check, not something the test suite alone can confirm).
- [ ] 5.2 Test specifically on a song trimmed to start right on the beat
      (first real beat within ~0.3s of the trim start) — confirm no extra/
      early click during the count-in wait and the real first beat isn't
      skipped.
- [ ] 5.3 Cancel a count-in mid-countdown and confirm no stray audio starts
      afterward.
- [ ] 5.4 Confirm recording's own count-in (unchanged) still works as
      before.
