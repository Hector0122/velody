## Context

See proposal.md — Why. Confirmed by direct code reading:

- `useMetronome.ts`'s `schedulerTick` decides grid vs. constant-tempo mode
  via `const usingGrid = beatTimes.length > 0 && currentBpm ===
  originalBpmRef.current`. Any correction that only changes the displayed
  `bpm` without also updating `originalBpmRef` (and `beatTimesRef` to
  match) falls out of grid mode entirely — this is the concrete mechanism
  behind "just retyping the BPM loses the real beat lock" in the proposal.
- `useSongAnalysis.ts` caches `{ bpm, firstBeatOffset, beatTimes,
  _version: CACHE_VERSION }` to a `.velody` sidecar via `window.api.saveMeta`,
  keyed by the song's directory (derived from `stems[0]`'s path). Any
  correction needs to write through the same shape/path or it'll be
  silently overwritten by the cached (wrong) value on next open.
- `lastScheduledBeatRef` (returned by `useMetronome`, threaded into
  `StemPlayer`'s BPM handlers) is already the established "the grid/tempo
  changed, reset the scheduling ratchet" signal — reused here unchanged.

## Goals / Non-Goals

**Goals:**
- Fix the concrete reported case (and any song with the same octave-error
  failure mode) with a simple, discoverable, low-risk manual control.
- Keep the metronome's "follows real detected beats" behavior intact after
  correction — not just a renumbered constant-tempo click.
- Make the correction stick across reopening the song.

**Non-Goals:**
- Automatic octave-error detection/correction. A tempo-range heuristic
  (e.g. "under 85bpm is suspicious") would inevitably misfire on
  genuinely slow songs and silently corrupt a correct detection — not
  worth that risk for a problem a two-button manual control already
  solves with the user's own judgment in the loop.
- Detecting arbitrary tempo ratios (e.g. 3:2, triplet-feel confusions).
  Octave (2x/0.5x) errors are the common, well-understood failure mode;
  other ratios are rarer and not what was reported.
- Any change to the detection algorithm itself (`detect_bpm.py`). This is
  a post-hoc correction layer in the renderer, not a change to how
  TempoCNN/librosa produce their initial estimate.

## Decisions

- **Doubling interpolates a midpoint beat between every consecutive pair,
  rather than re-running beat detection at 2x.** The existing detected
  beats are real transients — halving the tempo doesn't make them wrong,
  it just means the detector found every *other* real beat. Inserting the
  arithmetic midpoint between each pair is a cheap, purely-arithmetic
  operation that produces a plausible corrected grid without any new
  audio analysis, and keeps the correction instant (no re-running Python/
  TempoCNN).
- **Halving drops every other beat (even indices) rather than trying to
  detect which beats are "real."** Assumes the existing grid's index 0 is
  a genuine detected transient (the normal case — the detector generally
  isn't hallucinating extra beats, just too many correctly-detected ones
  relative to the true tempo). Simple, predictable, matches the doubling
  operation's inverse exactly (round-trip tested).
- **Operates on `originalBpmRef`/`beatTimesRef` (the detected values), not
  whatever the user may have manually drifted `bpm` to.** If the user had
  already manually overridden BPM before applying a correction, the
  correction still recomputes from the last *detected* grid and
  overwrites the displayed BPM to match — correcting a detection error and
  a manual override are different intents, and this proposal only handles
  the former; re-syncing to the corrected detected value is the
  unambiguous, predictable behavior.
- **Persisted through the exact same `.velody` cache shape
  `useSongAnalysis` already reads/writes**, not a separate "correction
  applied" flag. A corrected `{bpm, firstBeatOffset, beatTimes}` is
  indistinguishable from what a hypothetically-correct fresh detection
  would have produced — no need for the cache format to know a correction
  ever happened.
- **Two explicit buttons ("½"/"×2"), not one "fix octave" auto-toggle.**
  The direction (was it detected too fast or too slow?) is something only
  the user listening to the click can judge; a single button would have to
  guess.

## Risks / Trade-offs

- [If the detected grid itself has occasional missing/spurious beats
  (typical of real-world beat tracking, not just octave errors), doubling
  will interpolate a midpoint across that gap too, propagating the
  original grid's own imperfections into the corrected one] → Accepted;
  this proposal only targets the octave-ratio problem specifically, not
  general beat-detection quality — see Non-Goals.
- [A user could apply the correction repeatedly (double twice, e.g.),
  ending up at 4x/0.25x the real tempo] → Not specially guarded against —
  same category of "user can set a nonsensical value" as the existing
  manual BPM number input, which also has no semantic validation beyond
  `BPM_MIN`/`BPM_MAX`. Trusting the user's own ears here is consistent
  with the rest of the BPM controls.

## Migration Plan

No migration needed. Existing `.velody` caches are unaffected until the
user explicitly applies a correction for a given song; the cache shape
written is identical to what a normal detection already produces.
