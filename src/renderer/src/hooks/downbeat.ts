// Which metronome beat is the bar's "1" (the accented click).
//
// The scheduler numbers beats by their index in the detected beat grid (or,
// in constant-tempo mode, by beat number from firstBeatOffset). Without a
// shift, index 0 is assumed to be a downbeat — but the detector's first beat
// is often beat 2/3/4 of a bar (pickups, intros), so the accent landed in the
// wrong place. `downbeatShift` (0–3, saved per song) moves it.

export const BEATS_PER_BAR = 4

const mod = (n: number, m: number): number => ((n % m) + m) % m

export function normalizeDownbeatShift(shift: number): number {
  return Number.isFinite(shift) ? mod(Math.round(shift), BEATS_PER_BAR) : 0
}

/** Grid mode: beat-grid index (may be negative for extrapolated intro beats). */
export function isGridAccent(idx: number, shift: number): boolean {
  return mod(idx - shift, BEATS_PER_BAR) === 0
}

/** Constant-tempo mode: beat numbers start at 1 (first beat after the offset). */
export function isConstantAccent(beat: number, shift: number): boolean {
  return mod(beat - 1 - shift, BEATS_PER_BAR) === 0
}

// How late, on average, someone presses "this is the 1" after hearing it.
// Subtracted so a slightly late tap still snaps to the intended beat, even
// at fast tempos where beats are only ~300ms apart.
export const TAP_REACTION_SEC = 0.08

/**
 * The shift that makes the beat closest to `time` the downbeat. Mirrors the
 * scheduler's own beat numbering in each mode (see useMetronome).
 */
export function downbeatShiftAt(
  time: number,
  opts: { beatTimes: number[]; usingGrid: boolean; bpm: number; firstBeatOffset: number }
): number {
  const t = time - TAP_REACTION_SEC
  const interval = 60 / opts.bpm
  const { beatTimes } = opts

  if (opts.usingGrid && beatTimes.length > 0) {
    const first = beatTimes[0]
    const lastIdx = beatTimes.length - 1
    const last = beatTimes[lastIdx]
    let idx: number
    if (t <= first) {
      idx = Math.round((t - first) / interval)
    } else if (t >= last) {
      idx = lastIdx + Math.round((t - last) / interval)
    } else {
      let lo = 0
      let hi = lastIdx
      while (hi - lo > 1) {
        const mid = (lo + hi) >>> 1
        if (beatTimes[mid] <= t) lo = mid
        else hi = mid
      }
      idx = t - beatTimes[lo] <= beatTimes[hi] - t ? lo : hi
    }
    return mod(idx, BEATS_PER_BAR)
  }

  const beat = Math.round((t - opts.firstBeatOffset) / interval)
  return mod(beat - 1, BEATS_PER_BAR)
}
