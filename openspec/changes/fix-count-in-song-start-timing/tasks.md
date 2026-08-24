## 1. Fix the ref-threading bug

- [x] 1.1 In `useMetronome.ts`, export `RESET_SCHEDULED_BEAT` (changed from
      `-1` to `-Infinity`, with a comment explaining why) and return the
      hook's internal `lastScheduledBeatRef` from its return value.
- [x] 1.2 In `StemPlayer.tsx`, remove the component's own separate
      `useRef(-1)` declaration of `lastScheduledBeatRef`; destructure the
      one `useMetronome()` returns instead, and pass that same ref
      instance into `useAudioContextEngine` and `useWaveSurfers`.
- [x] 1.3 Update every reset site (`useAudioContextEngine.ts`,
      `useWaveSurfers.ts`, StemPlayer's BPM increment/decrement/change
      handlers) to assign `RESET_SCHEDULED_BEAT` instead of a hardcoded
      `-1`.

## 2. Fix the silent-intro bug

- [x] 2.1 In `useMetronome.ts`'s `scheduleFromGrid`, add a `beatTimeAt(i)`
      helper that extrapolates backward from `beatTimes[0]` at the
      detected tempo for negative `i`, and compute the scheduler's
      starting `idx` so it can be negative when `t < beatTimes[0]`.
- [x] 2.2 Guard against scheduling a click at a negative audio position
      (a virtual beat landing before the song's own t=0) — skip playing
      it but still advance the ratchet past it.
- [x] 2.3 Confirm the existing forward/past-the-end extrapolation branch
      (used once playback passes the last detected beat) is unaffected.

## 3. Tests

- [x] 3.1 Add a regression test: metronome on, position well before
      `beatTimes[0]`, confirms a click is scheduled at the correct
      extrapolated time instead of nothing.
- [x] 3.2 Add a test confirming the accent pattern (every 4th beat) stays
      correct across the negative/extrapolated indices.
- [x] 3.3 Add a test that ticks across the extrapolated → real-grid
      boundary and confirms no gap and no double-click at the handoff.
- [x] 3.4 Add a test confirming a short intro (less than one beat
      interval before `beatTimes[0]`) schedules the real first beat
      directly, with nothing negative ever attempted.

## 4. Manual verification

- [ ] 4.1 Run `pnpm dev` on a song with a long instrumental/silent intro
      before the beat grid's first detected beat; enable count-in +
      in-song metronome click; confirm the click continues seamlessly
      from the count-in through the intro into the detected beat, with no
      audible gap or restart when the real beat/drums begin.
- [ ] 4.2 Confirm behavior on a song with little/no intro (first detected
      beat very close to t=0) is unchanged from before this fix.
- [ ] 4.3 Seek/loop/change BPM mid-song and confirm click scheduling still
      resets correctly (regression check for the ref-threading fix).
