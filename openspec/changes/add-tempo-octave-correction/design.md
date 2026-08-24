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

- **Revised after initial testing: re-run beat detection with the
  corrected tempo as a hint, rather than arithmetically rebuilding the
  grid.** The first version of this feature did exactly what the
  paragraph below describes (arithmetic midpoint interpolation/decimation)
  — cheap, instant, no new audio analysis. Tested live against "Just Like
  Heaven" after the ×2 correction: the BPM display updated correctly
  (76.9 → 153.8), but the click itself sounded "raro... se adelanta y se
  atrasa" (drifts ahead, then behind, alternating). Diagnosis: arithmetic
  midpoint interpolation assumes the original detected beats are
  *perfectly* evenly spaced and that the true intermediate beat is exactly
  their arithmetic midpoint — true only for a perfectly quantized/
  mechanical tempo. A real recording (human performance, not a click
  track) has natural timing variance even in a studio take, so the
  original detected beats (every other real beat) were themselves not
  perfectly uniform — and the interpolated midpoints inherited that error
  while the originally-detected beats stayed accurate, producing exactly
  the alternating "correct, off, correct, off..." pattern reported.
  Confirmed via a synthetic test: a perfectly periodic click track shows
  no difference between the two approaches (midpoint interpolation and
  redetection agree almost exactly), but only redetection can be trusted
  on real, non-quantized audio. `librosa.beat.beat_track(y, sr,
  bpm=hint)` — already the exact mechanism the *first, non-hinted*
  detection uses (with TempoCNN's estimate as the `bpm` prior instead of
  a corrected one) — re-derives beat positions from the audio's real
  onset-strength envelope at the given tempo, adapting to natural timing
  variance via its `tightness` parameter instead of assuming uniformity.
  Reusing the same, already-proven-reliable mechanism (just with a
  corrected prior) is more consistent than inventing a separate
  arithmetic approximation.
- **The original arithmetic approach is kept as a fallback**, not deleted
  — if redetection itself fails (Python worker error, missing librosa,
  etc.), an approximate corrected grid is still better than silently doing
  nothing or reverting to no grid at all.
- **Doubling interpolates a midpoint beat between every consecutive pair
  (fallback path only)**: inserting the arithmetic midpoint between each
  detected pair is a cheap, purely-arithmetic approximation — acceptable
  as a degraded fallback, not as the primary mechanism (see above).
- **Halving drops every other beat (even indices) rather than trying to
  detect which beats are "real" (fallback path only).** Assumes the
  existing grid's index 0 is a genuine detected transient (the normal
  case — the detector generally isn't hallucinating extra beats, just too
  many correctly-detected ones relative to the true tempo). Simple,
  predictable, matches the doubling operation's inverse exactly
  (round-trip tested).
- **A separate singleflight guard (`bpmRedetectionRunning`) for the hint
  path**, independent from the existing `bpmDetectionRunning` used by
  normal (hint-less) detection. The existing guard is a single global
  in-flight-promise slot (by design — CLAUDE.md notes concurrent TempoCNN/
  TensorFlow processes can OOM low-RAM machines), so if a correction
  redetect for one song happened to overlap with a normal detection for
  another, sharing one slot could return the *wrong* song's result to one
  of the two callers. The hint path also doesn't load TempoCNN at all
  (skips straight to librosa), so it doesn't carry the same OOM risk the
  original guard exists for — a separate, independent guard is both safer
  and doesn't need to serialize behind unrelated normal detections.
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
