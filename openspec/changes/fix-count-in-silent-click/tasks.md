## 1. Fix the wiring

- [x] 1.1 In `useMetronome.ts`, rename the private `getAudioCtx` to
      `ensureAudioCtx` and add it to the hook's return value.
- [x] 1.2 In `useCountIn.ts`, change the `audioCtxRef` parameter to an
      `ensureAudioCtx: () => AudioContext | null` function; `start()` calls
      it itself (`const ctx = ensureAudioCtx(); if (!ctx) return`) instead
      of reading a ref that may never have been populated.
- [x] 1.3 In `useRecording.ts`, replace the `audioCtxRef` param with
      `ensureAudioCtx`; remove the hook's own duplicate inline
      "create an AudioContext if missing, resume if suspended" logic in
      `handleStartRecording` (now handled inside `ensureAudioCtx`/
      `useCountIn` itself) in favor of a single `ensureAudioCtx()` call
      before proceeding.
- [x] 1.4 In `StemPlayer.tsx`, pass `useMetronome`'s `ensureAudioCtx`
      (aliased `ensureMetronomeAudioCtx` at the call site to disambiguate
      from `useAudioContextEngine`'s unrelated `audioCtxRef`) into both
      `useCountIn` (playback count-in) and `useRecording`. Removed the
      component's own manual, incorrect AudioContext creation in
      `handleToggleMasterPlayWithCountIn` and the now-unused
      `audioCtxRef` destructuring from `useAudioContextEngine`.

## 2. Tests

- [x] 2.1 Add a regression test to `useCountIn.test.ts`: `start()` calls
      the given `ensureAudioCtx()` itself and does nothing (no `playClick`
      calls, no ticks, no `onComplete`) when it returns `null` — this is
      the exact failure mode of the bug (a not-yet-created/wrong context).
- [x] 2.2 Add a positive-path test confirming `ensureAudioCtx()` is called
      and clicks are scheduled on a normal `start()`, so the two tests
      together pin both sides of the fix.

## 3. Manual verification

- [ ] 3.1 Run `pnpm dev` on a freshly opened song (metronome toggle OFF,
      never touched), set playback count-in to 1 or 2 bars, press Play,
      and confirm the count-in clicks are audible even though the metronome
      was never turned on.
- [ ] 3.2 Confirm the in-song metronome toggle still works independently —
      turning it on/off during playback doesn't affect whether count-in
      clicks played before it started.
- [ ] 3.3 Re-verify the recording count-in (record over a stem, 1/2/4 bars)
      still produces audible clicks, confirming the `useRecording` side of
      the fix didn't regress it.
