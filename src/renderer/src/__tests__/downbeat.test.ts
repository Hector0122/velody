import { describe, it, expect } from 'vitest'
import {
  isGridAccent,
  isConstantAccent,
  downbeatShiftAt,
  normalizeDownbeatShift,
  planCountIn,
  gridEdgeInterval,
  smoothBeatGrid,
  TAP_REACTION_SEC
} from '../hooks/downbeat'

const grid = {
  beatTimes: [1.0, 1.5, 2.0, 2.5, 3.0, 3.5],
  usingGrid: true,
  bpm: 120,
  firstBeatOffset: 1.0
}

describe('downbeat accents', () => {
  it('accents every 4th grid beat starting at the shift, including negative (intro) indices', () => {
    expect([0, 1, 2, 3, 4].map((i) => isGridAccent(i, 0))).toEqual([
      true,
      false,
      false,
      false,
      true
    ])
    expect([0, 1, 2, 3, 4, 5].map((i) => isGridAccent(i, 2))).toEqual([
      false,
      false,
      true,
      false,
      false,
      false
    ])
    expect(isGridAccent(-2, 2)).toBe(true) // -2 ≡ 2 (mod 4)
    expect(isGridAccent(-2, 0)).toBe(false)
    expect(isGridAccent(-4, 0)).toBe(true)
  })

  it('keeps the original constant-tempo pattern (beat 1, 5, 9…) at shift 0', () => {
    expect([1, 2, 3, 4, 5].map((b) => isConstantAccent(b, 0))).toEqual([
      true,
      false,
      false,
      false,
      true
    ])
    expect(isConstantAccent(2, 1)).toBe(true)
  })

  it('normalizes any integer into 0–3', () => {
    expect(normalizeDownbeatShift(-1)).toBe(3)
    expect(normalizeDownbeatShift(5)).toBe(1)
    expect(normalizeDownbeatShift(NaN)).toBe(0)
  })
})

describe('downbeatShiftAt', () => {
  it('picks the grid beat nearest the tap (compensating for reaction time)', () => {
    // Tapped a bit late after the beat at 2.0 (index 2).
    expect(downbeatShiftAt(2.0 + TAP_REACTION_SEC + 0.1, grid)).toBe(2)
    // Tapped a bit early before the beat at 2.5 (index 3).
    expect(downbeatShiftAt(2.4 + TAP_REACTION_SEC, grid)).toBe(3)
  })

  it('extrapolates before the first and after the last detected beat', () => {
    expect(downbeatShiftAt(0.5 + TAP_REACTION_SEC, grid)).toBe(3) // index -1
    expect(downbeatShiftAt(4.5 + TAP_REACTION_SEC, grid)).toBe(3) // index 5 + 2 = 7 ≡ 3
  })

  it('in constant-tempo mode the result makes that beat number the accent', () => {
    const constant = { beatTimes: [], usingGrid: false, bpm: 120, firstBeatOffset: 0 }
    const time = 1.5 + TAP_REACTION_SEC // beat number 3
    const shift = downbeatShiftAt(time, constant)
    expect(isConstantAccent(3, shift)).toBe(true)
    expect(isConstantAccent(4, shift)).toBe(false)
  })

  it('the shift it returns makes the tapped grid beat an accent', () => {
    const shift = downbeatShiftAt(3.0 + TAP_REACTION_SEC, grid)
    expect(isGridAccent(4, shift)).toBe(true)
  })
})

describe('planCountIn', () => {
  // 120 bpm grid, beats every 0.5s from 2.0s.
  const beatTimes = Array.from({ length: 40 }, (_, i) => 2.0 + i * 0.5)
  const base = { bars: 1, beatTimes, usingGrid: true, bpm: 120, firstBeatOffset: 2.0 }

  it('is always exactly 4 clicks per bar, ending one beat before the next song beat', () => {
    // Start at 3.4 → first beat at/after is 3.5: count 1.5 2.0 2.5 3.0 → song.
    const clicks = planCountIn({ ...base, position: 3.4 })
    expect(clicks.map((c) => c.songTime)).toEqual([1.5, 2.0, 2.5, 3.0])
    expect(clicks.map((c) => c.accent)).toEqual([true, false, false, false])
  })

  it('2 bars = 8 clicks, accenting the first of each 4', () => {
    const clicks = planCountIn({ ...base, position: 4.5, bars: 2 })
    expect(clicks).toHaveLength(8)
    expect(clicks[0].songTime).toBeCloseTo(0.5, 9)
    expect(clicks[7].songTime).toBeCloseTo(4.0, 9)
    expect(clicks.map((c) => c.accent)).toEqual([
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      false
    ])
  })

  it('click count never depends on where in the bar the song starts', () => {
    for (const position of [2.0, 2.1, 2.6, 3.1, 3.6, 7.77]) {
      expect(planCountIn({ ...base, position })).toHaveLength(4)
      expect(planCountIn({ ...base, position, bars: 2 })).toHaveLength(8)
    }
  })

  it('extrapolates the grid backwards for a start before the first detected beat', () => {
    // Music starts at 0.9s, drums (grid) come in at 2.0s.
    const clicks = planCountIn({ ...base, position: 0.9 })
    expect(clicks).toHaveLength(4)
    expect(clicks[3].songTime).toBeCloseTo(0.5, 9) // next beat (1.0) is the entry
    expect(clicks.every((c, i) => i === 0 || c.songTime - clicks[i - 1].songTime === 0.5)).toBe(
      true
    )
  })

  it('uses constant-tempo numbering when not on the grid', () => {
    const clicks = planCountIn({
      ...base,
      usingGrid: false,
      bpm: 60,
      firstBeatOffset: 0,
      position: 9.0
    })
    expect(clicks.map((c) => c.songTime)).toEqual([5, 6, 7, 8])
    expect(clicks.map((c) => c.accent)).toEqual([true, false, false, false])
  })

  it('in an intro, follows the grid spacing, not the rounded BPM (no drift)', () => {
    // Real grid every 0.4876 s from 34.34 s (Otherside); BPM rounded to 124 (0.4839 s).
    const grid = Array.from({ length: 20 }, (_, i) => 34.34 + i * 0.4876)
    const clicks = planCountIn({ ...base, beatTimes: grid, bpm: 124, position: 1.0 })
    const entry = Math.ceil((1.0 - 34.34) / 0.4876 - 1e-9)
    // The song's own beat at `entry` lands 0.4876 s after the last click.
    expect(34.34 + entry * 0.4876 - clicks[3].songTime).toBeCloseTo(0.4876, 6)
    expect(clicks[1].songTime - clicks[0].songTime).toBeCloseTo(0.4876, 6)
  })

  it('returns nothing when count-in is off', () => {
    expect(planCountIn({ ...base, bars: 0, position: 3 })).toEqual([])
  })
})

describe('gridEdgeInterval', () => {
  it('uses the median gap at each edge, ignoring one odd beat', () => {
    const grid = [0, 0.5, 1.0, 1.7, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5]
    expect(gridEdgeInterval(grid, 'start', 0.6)).toBe(0.5)
    expect(gridEdgeInterval([0, 1, 2, 2.4, 2.8, 3.2], 'end', 0.6)).toBeCloseTo(0.4, 9)
  })

  it('falls back to the BPM interval when there is no grid to measure', () => {
    expect(gridEdgeInterval([5], 'start', 0.6)).toBe(0.6)
  })
})

describe('smoothBeatGrid', () => {
  const spread = (xs: number[]): number => Math.max(...xs) - Math.min(...xs)
  const gaps = (ts: number[]): number[] => ts.slice(1).map((t, i) => t - ts[i])

  it("removes the tracker's 23 ms frame jitter from a steady tempo", () => {
    // Real gaps detected in Just Like Heaven (steady ~0.395 s, snapped to 23 ms frames).
    const pattern = [
      0.372, 0.395, 0.372, 0.395, 0.372, 0.395, 0.395, 0.418, 0.372, 0.395, 0.372, 0.395
    ]
    const raw = [0.9288]
    for (let k = 0; k < 48; k++) raw.push(raw[raw.length - 1] + pattern[k % pattern.length])
    const smooth = smoothBeatGrid(raw)
    expect(spread(gaps(raw))).toBeGreaterThan(0.04)
    // Away from the edges the beats are now evenly spaced (within a few ms).
    expect(spread(gaps(smooth).slice(4, -4))).toBeLessThan(0.012)
    expect(smooth).toHaveLength(raw.length)
  })

  it('keeps a gradual tempo change', () => {
    // Gap grows from 0.50 s to 0.56 s over 40 beats.
    const truth: number[] = [0]
    for (let i = 1; i < 40; i++) truth.push(truth[i - 1] + 0.5 + (0.06 * i) / 40)
    const g = gaps(smoothBeatGrid(truth))
    expect(g[5]).toBeCloseTo(0.5 + (0.06 * 6) / 40, 2)
    expect(g[33]).toBeCloseTo(0.5 + (0.06 * 34) / 40, 2)
  })

  it('leaves tiny grids alone', () => {
    expect(smoothBeatGrid([1, 1.5])).toEqual([1, 1.5])
  })
})
