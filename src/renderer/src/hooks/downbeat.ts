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

/**
 * Beat spacing of the detected grid at its start or end, used to extrapolate
 * beats before/after it. The song's rounded BPM drifts hundreds of ms over a
 * long intro (e.g. 124 bpm vs a real 487.6 ms grid), putting clicks off-beat.
 */
export function gridEdgeInterval(
  beatTimes: number[],
  edge: 'start' | 'end',
  fallback: number
): number {
  const n = Math.min(8, beatTimes.length - 1)
  if (n < 1) return fallback
  const s = edge === 'start' ? beatTimes.slice(0, n + 1) : beatTimes.slice(-n - 1)
  const gaps = s
    .slice(1)
    .map((t, i) => t - s[i])
    .sort((a, b) => a - b)
  return gaps[gaps.length >> 1]
}

/**
 * Removes the beat tracker's frame quantization: librosa snaps beats to
 * 23 ms frames, so a steady song comes back as 0.372/0.395/0.418 s gaps and
 * the clicks wobble audibly. Each beat is moved onto a least-squares line
 * through its ±4 neighbours — the jitter averages out, gradual tempo
 * changes are kept. Beat count and indices are unchanged.
 */
export function smoothBeatGrid(beatTimes: number[], radius = 4): number[] {
  const n = beatTimes.length
  if (n < 3) return beatTimes
  return beatTimes.map((_, i) => {
    const lo = Math.max(0, i - radius)
    const hi = Math.min(n - 1, i + radius)
    let sx = 0
    let sy = 0
    let sxx = 0
    let sxy = 0
    const m = hi - lo + 1
    for (let j = lo; j <= hi; j++) {
      sx += j
      sy += beatTimes[j]
      sxx += j * j
      sxy += j * beatTimes[j]
    }
    const slope = (m * sxy - sx * sy) / (m * sxx - sx * sx)
    return (sy - slope * sx) / m + slope * i
  })
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
      idx = Math.round((t - first) / gridEdgeInterval(beatTimes, 'start', interval))
    } else if (t >= last) {
      idx = lastIdx + Math.round((t - last) / gridEdgeInterval(beatTimes, 'end', interval))
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

export interface CountInClick {
  /** Position of the click on the song's timeline (seconds; may precede 0). */
  songTime: number
  accent: boolean
}

/**
 * Count-in clicks laid on the song's own beat grid, ending right before the
 * first beat at/after `position`, so the count flows straight into the song's
 * beats (and the in-song metronome) with no gap or phase jump. Always exactly
 * `bars × 4` clicks, the first of every 4 accented ("1 2 3 4") — it counts
 * the player in, it doesn't depend on (possibly wrong) bar detection.
 */
export function planCountIn(opts: {
  position: number
  bars: number
  beatTimes: number[]
  usingGrid: boolean
  bpm: number
  firstBeatOffset: number
}): CountInClick[] {
  const { position, bars, beatTimes, bpm } = opts
  if (bars <= 0 || !(bpm > 0)) return []
  const interval = 60 / bpm

  let beatAt: (i: number) => number
  let entry: number

  if (opts.usingGrid && beatTimes.length > 0) {
    const first = beatTimes[0]
    const lastIdx = beatTimes.length - 1
    const last = beatTimes[lastIdx]
    const before = gridEdgeInterval(beatTimes, 'start', interval)
    const after = gridEdgeInterval(beatTimes, 'end', interval)
    beatAt = (i) =>
      i < 0 ? first + i * before : i > lastIdx ? last + (i - lastIdx) * after : beatTimes[i]
    if (position <= first) {
      entry = Math.ceil((position - first) / before - 1e-9)
    } else if (position > last) {
      entry = lastIdx + Math.ceil((position - last) / after - 1e-9)
    } else {
      let lo = 0
      let hi = lastIdx
      while (lo < hi) {
        const mid = (lo + hi) >>> 1
        if (beatTimes[mid] < position) lo = mid + 1
        else hi = mid
      }
      entry = lo
    }
  } else {
    beatAt = (n) => opts.firstBeatOffset + n * interval
    entry = Math.ceil((position - opts.firstBeatOffset) / interval - 1e-9)
  }

  const total = bars * BEATS_PER_BAR
  const clicks: CountInClick[] = []
  for (let j = 0; j < total; j++) {
    clicks.push({ songTime: beatAt(entry - total + j), accent: j % BEATS_PER_BAR === 0 })
  }
  return clicks
}
