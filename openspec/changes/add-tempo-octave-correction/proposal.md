## Why

Reported after comparing against Moises: for "Just Like Heaven" (The
Cure), Moises correctly detects ~151bpm and its click lines up beat for
beat; Velody detected ~76.9bpm — almost exactly half — and the click felt
wrong. This is a well-known failure mode in beat-tracking algorithms in
general (a "tempo octave error"): the detector locks onto half or double
the real tempo, most often when a song's groove has a strong pulse every 2
beats that reads as the beat itself. It isn't specific to Velody's
detector or a sign it's worse than Moises' — any beat tracker can make this
mistake on the right (or wrong) song; the user confirmed other songs detect
correctly, consistent with this being an isolated per-song ambiguity rather
than a systemic bug.

Velody already lets the user manually type in a corrected BPM, but that
alone doesn't fully fix this: `useMetronome`'s scheduler only follows the
real detected beat-time grid (`scheduleFromGrid`) while the current BPM
still matches `originalBpmRef` (the originally detected value); changing
the BPM number manually falls back to `scheduleConstantTempo`, a naive
fixed-interval click with no relationship to the song's actual detected
transients anymore. For a click reference during live practice, that's a
real downgrade from the "smart metronome" the app is otherwise built
around.

## What Changes

- Two small buttons next to the BPM control — "½" (halve) and "×2"
  (double) — let the user correct a detected tempo that's off by exactly
  one octave.
- **Revised after initial testing** (see design.md — the first version's
  approach produced an audible "se adelanta y se atrasa" drift): the
  correction now **re-runs beat detection** (`detect_bpm.py --bpm-hint`)
  with the corrected tempo as an explicit prior, instead of arithmetically
  rebuilding the existing grid client-side. librosa's beat tracker
  re-derives genuinely onset-aligned beat positions directly from the
  audio at the corrected tempo, rather than assuming the original grid was
  perfectly uniformly spaced (real recordings rarely are). The original
  arithmetic approach (`tempoOctaveCorrection.ts`'s `correctTempoOctave` —
  doubling interpolates a midpoint between every consecutive detected
  pair, halving drops every other beat) is kept as a fallback for if
  redetection itself fails (Python worker error, etc.) — an imperfect grid
  is still better than none.
- `originalBpmRef` is updated to the corrected value alongside the
  displayed BPM, so the scheduler's grid-mode check
  (`bpm === originalBpmRef.current`) stays satisfied — the metronome keeps
  following the real (now-corrected) beat grid instead of falling back to
  constant-tempo.
- Since redetection spawns a real Python process (though a lighter one —
  see design.md), applying a correction now has a brief loading state
  ("Correcting…", buttons disabled) instead of being instant.
- The correction is persisted to the song's `.velody` metadata cache
  (same file/shape `useSongAnalysis` already writes), so it survives
  closing and reopening the song — the user shouldn't have to re-correct
  the same song every time.
- Not an automatic "fix every song" heuristic — deliberately manual and
  opt-in per song. Auto-correcting based on a tempo-range heuristic (e.g.
  "anything under 85bpm is probably really double that") would risk
  silently breaking genuinely slow, correctly-detected songs (ballads,
  etc.); a two-button manual correction avoids that risk entirely while
  still fixing the concrete problem reported.

## Capabilities

### New Capabilities
- `tempo-octave-correction`: Manual per-song correction for a detected
  tempo that's exactly double or half the real tempo, which also rebuilds
  the detected beat-time grid so the metronome stays locked to real audio
  transients at the corrected tempo.

## Impact

- `python-worker/detect_bpm.py`: `detect_bpm()` accepts an optional
  `bpm_hint` — when given, skips TempoCNN entirely and calls
  `librosa.beat.beat_track(y=y, sr=sr, bpm=bpm_hint)` directly; new
  `--bpm-hint <bpm>` CLI flag.
- `src/main/ipc/handlers.ts`: `song:detectBpm` accepts an optional
  `bpmHint`; shared `runDetectBpm` helper threads it through as
  `--bpm-hint`; a second, independent singleflight guard
  (`bpmRedetectionRunning`) so a correction redetect can't collide with a
  normal (hint-less) detection's in-flight promise.
- `src/preload/index.ts`, `src/shared/types.ts`: `detectBpm`'s signature
  gains the optional `bpmHint` parameter.
- `src/renderer/src/hooks/tempoOctaveCorrection.ts` (new): pure
  `correctTempoOctave(beatTimes, bpm, firstBeatOffset, direction)` —
  kept as the fallback path (see above), not the primary mechanism.
- `src/renderer/src/utils.ts`: new `songDirFromStemPath` helper, extracted
  from `useSongAnalysis.ts`'s existing inline derivation (now shared by
  both) for the `.velody` cache write.
- `src/renderer/src/hooks/useSongAnalysis.ts`: uses the extracted
  `songDirFromStemPath` helper (no behavior change).
- `src/renderer/src/components/StemPlayer.tsx`: `handleCorrectTempoOctave`
  is now async — calls `window.api.detectBpm` with a hint, applies the
  redetected grid (or falls back to `correctTempoOctave` on failure),
  updates `originalBpmRef`/`firstBeatOffsetRef`/`bpm`, resets
  `lastScheduledBeatRef` (grid shape changed), persists to the `.velody`
  cache; new `correctingTempoOctave` loading-state flag.
- `src/renderer/src/components/MasterPanel.tsx`: two small buttons ("½",
  "×2") next to the BPM control, disabled with a "Correcting…" label while
  in flight.
- `python-worker/tests/test_detect_bpm.py`: new `--bpm-hint` coverage,
  gated on `HAS_LIBROSA` only (not `HAS_TEMPOCNN` — the hint path doesn't
  use TempoCNN).
