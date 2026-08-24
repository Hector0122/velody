## Why

Reported after live use, using Moises as a reference: in Moises, the
count-in ("1 2 3 4") hands off seamlessly into a continuous metronome that
keeps clicking straight through a song's intro at the original tempo. In
Velody, the metronome instead went silent through any intro and only
"woke up" once the real drums/downbeat arrived — producing an audible gap
("desfase") between the count-in ending and the song's beat actually
starting, even though the count-in itself and the song's start were
correctly aligned in time.

Two separate bugs were found while investigating, both in the in-song
metronome scheduler, not the count-in itself:

1. **`lastScheduledBeatRef` was never actually threaded through.**
   `useMetronome` creates and returns its own internal
   `lastScheduledBeatRef` (the ratchet its scheduling functions read/write
   to avoid double-scheduling a beat). `StemPlayer.tsx` separately declared
   *its own*, unrelated `useRef(-1)` of the same name, and that's what was
   actually passed into `useAudioContextEngine`, `useWaveSurfers`, and the
   BPM-change handlers to reset scheduling on seek/loop/restart/BPM change.
   Since `useMetronome`'s real ratchet was never being reset by any of
   those call sites, every reset was a no-op against the value the
   scheduler actually reads.
2. **The beat-grid scheduler had no concept of "before the first detected
   beat."** `scheduleFromGrid` only ever scheduled clicks for
   `beatTimes[idx] - t < LOOKAHEAD`. While the song position `t` was still
   well before `beatTimes[0]` (the first beat TempoCNN/librosa actually
   detected — i.e. during any intro before the drums come in), that
   condition was never true for any real index, so nothing was ever
   scheduled: silence for the whole intro, exactly matching "se calla el
   metrónomo y vuelve a empezar cuando entra la batería."

## What Changes

- `useMetronome.ts` exports `RESET_SCHEDULED_BEAT` (its scheduling-ratchet
  reset sentinel, now `-Infinity` instead of the previous `-1` — see
  below for why) and returns its own `lastScheduledBeatRef` from the hook,
  which is now the single ref every reset site shares.
- `StemPlayer.tsx` no longer declares its own separate
  `lastScheduledBeatRef`; it destructures the one `useMetronome` returns
  and passes that same instance into `useAudioContextEngine`,
  `useWaveSurfers`, and its own BPM-change handlers, using
  `RESET_SCHEDULED_BEAT` instead of a hardcoded `-1` at every reset site.
- `scheduleFromGrid` now extrapolates *backward* from `beatTimes[0]` at
  the detected tempo for song positions before the first real beat,
  instead of scheduling nothing. Negative indices map to virtual beat
  times via `beatTimes[0] + idx * interval`; the same single loop/ratchet
  that already handles the real grid handles these transparently, so the
  handoff from extrapolated to real beats is seamless (no separate branch,
  no double-click at the boundary). A virtual beat that would land before
  the song's own start (t=0) is skipped (ratchet still advances past it,
  nothing is scheduled) rather than clicking at a negative time.
- `RESET_SCHEDULED_BEAT` changed from `-1` to `-Infinity`: with backward
  extrapolation, legitimate starting indices can themselves be very
  negative (e.g. `-16` for a long intro), and a reset value of `-1` could
  be *less* negative than that, wrongly clamping a legitimate backward
  index via the `Math.max(idx, lastScheduledBeatRef + 1)` ratchet.
  `-Infinity` is safe for every existing use of the ratchet (constant-tempo
  mode's smallest real value is `1`; the original grid mode's smallest was
  `0`) and can never itself out-clamp a real computed index.
- **Deliberately out of scope:** `scheduleConstantTempo` (the fallback
  path used only when no beat grid exists, or the user manually overrides
  BPM) is not given the same backward-extrapolation treatment here — its
  1-based beat-numbering convention makes the equivalent change riskier to
  get right quickly, and it's not the path most songs hit (beat-grid mode
  is preferred whenever BPM detection succeeds, which is the common case).
  Worth a follow-up if the same silence-during-intro complaint ever comes
  up on a song that's using constant-tempo mode.

## Capabilities

(none — `add-song-count-in`'s and the beat-grid metronome's existing
requirements already describe count-in and in-song click as expected to
work together with no gap; this fixes the implementation, it doesn't
change the requirement. `skip_specs: true` set in `.openspec.yaml`.)

## Impact

- `src/renderer/src/hooks/useMetronome.ts`: `RESET_SCHEDULED_BEAT` sentinel
  exported (`-Infinity`); `scheduleFromGrid` extrapolates backward before
  `beatTimes[0]`.
- `src/renderer/src/components/StemPlayer.tsx`: removed its own duplicate
  `lastScheduledBeatRef`; now uses the one returned by `useMetronome`
  everywhere; reset sites use `RESET_SCHEDULED_BEAT` instead of `-1`.
- `src/renderer/src/hooks/useAudioContextEngine.ts`,
  `src/renderer/src/hooks/useWaveSurfers.ts`: reset sites updated to use
  `RESET_SCHEDULED_BEAT` instead of a hardcoded `-1`.
- No IPC, persistence, or UI changes — this is a scheduling-logic and
  ref-wiring fix.
