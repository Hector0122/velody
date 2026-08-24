## 1. Fix the handoff timing

- [x] 1.1 In `useCountIn.ts`, replace the `setTimeout(onComplete, totalMs)`
      call with a `requestAnimationFrame` poll of `ctx.currentTime` against
      the same target time (`scheduleTime + totalBeats * interval`) the
      clicks are scheduled against.
- [x] 1.2 Add an `rafIdRef` and cancel the pending poll in `cancel()` via
      `cancelAnimationFrame`, alongside the existing `clearTimeout` cleanup.
- [x] 1.3 Leave the `onTick` countdown display timers as `setTimeout` —
      display-only, no audible effect, doesn't need the extra precision.

## 2. Tests

- [x] 2.1 Update `useCountIn.test.ts`'s shared `ctx` stub so
      `currentTime` advances with vitest's faked wall clock, so existing
      tests (which advance fake timers without manually touching
      `ctx.currentTime`) still reach `onComplete` correctly under the new
      polling mechanism.
- [x] 2.2 Add a regression test: with `ctx.currentTime` held artificially
      behind wall-clock time, `onComplete` does NOT fire even after plenty
      of wall-clock time has passed — only once `ctx.currentTime` reaches
      the target does it fire.

## 3. Manual verification

- [ ] 3.1 Run `pnpm dev`, use the playback count-in on a song, and confirm
      the song's first beat feels locked to the count-in's implied tempo
      rather than slightly early/late.
- [ ] 3.2 Confirm the recording pre-roll count-in (`useRecording`) is
      unaffected/still works, since it shares the same hook.
- [ ] 3.3 Cancel a count-in mid-countdown (Stop before it finishes) and
      confirm no stray `onComplete`/playback start happens afterward.
