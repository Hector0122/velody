// Corrects a common tempo-detection failure mode ("octave error"): the
// detector locks onto half or double the real tempo — most often when a
// song's groove has a strong pulse every 2 beats that reads as the beat
// itself (e.g. a driving 151bpm rock song detected as ~76bpm). This is a
// known, common ambiguity in beat-tracking algorithms in general, not a
// Velody-specific bug — reported after comparing against Moises on a song
// where it got the tempo right and Velody got exactly half.
//
// Unlike simply re-typing a doubled/halved BPM (which would fall back to
// constant-tempo scheduling — see useMetronome.ts's `usingGrid` check,
// `currentBpm === originalBpmRef.current`), this also rebuilds the detected
// beat-time grid itself, so the metronome stays locked to real audio
// transients at the corrected tempo instead of degrading to a naive fixed
// interval. See openspec/changes/add-tempo-octave-correction.

export type TempoOctaveDirection = 'double' | 'halve'

export interface TempoOctaveCorrection {
  bpm: number
  firstBeatOffset: number
  beatTimes: number[]
}

export function correctTempoOctave(
  beatTimes: number[],
  bpm: number,
  firstBeatOffset: number,
  direction: TempoOctaveDirection,
  // Halving: which beats to keep (0 = even indices, 1 = odd).
  phase = 0
): TempoOctaveCorrection {
  let newBeatTimes: number[]

  if (direction === 'double') {
    // Insert a midpoint beat between every detected pair — the detector's
    // real beats become every other beat of the corrected grid, exactly
    // matching what genuinely detecting twice the tempo would have found.
    newBeatTimes = []
    for (let i = 0; i < beatTimes.length; i++) {
      newBeatTimes.push(beatTimes[i])
      if (i < beatTimes.length - 1) {
        newBeatTimes.push((beatTimes[i] + beatTimes[i + 1]) / 2)
      }
    }
  } else {
    // Drop every other detected beat — every kept one is still a real,
    // detected beat; `phase` picks the half that holds the downbeat.
    newBeatTimes = beatTimes.filter((_, i) => i % 2 === phase)
  }

  return {
    bpm: direction === 'double' ? bpm * 2 : bpm / 2,
    // Anchor to the corrected grid's own first beat rather than trying to
    // halve/double the old offset (which isn't a well-defined operation on
    // an absolute timestamp) — matches what a fresh detection at the
    // corrected tempo would naturally produce.
    firstBeatOffset: newBeatTimes[0] ?? firstBeatOffset,
    beatTimes: newBeatTimes
  }
}
