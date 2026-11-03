import { describe, it, expect } from 'vitest'
import {
  isGridAccent,
  isConstantAccent,
  downbeatShiftAt,
  normalizeDownbeatShift,
  planCountIn,
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
  // 120 bpm grid, beats every 0.5s from 2.0s; downbeats at indices 1, 5, 9…
  const beatTimes = Array.from({ length: 40 }, (_, i) => 2.0 + i * 0.5)
  const base = {
    bars: 1,
    beatTimes,
    usingGrid: true,
    bpm: 120,
    firstBeatOffset: 2.0,
    downbeatShift: 1
  }

  it('ends one beat before the first song beat and starts on a "1"', () => {
    // Start at 3.4 → first beat at/after is 3.5 (index 3, a "3"): count "1 2 3 4 | 1 2".
    const clicks = planCountIn({ ...base, position: 3.4 })
    expect(clicks.map((c) => c.songTime)).toEqual([0.5, 1.0, 1.5, 2.0, 2.5, 3.0])
    expect(clicks.map((c) => c.accent)).toEqual([true, false, false, false, true, false])
  })

  it('is exactly N bars when the song enters on a downbeat', () => {
    const clicks = planCountIn({ ...base, position: 4.5, bars: 2 }) // index 5 = "1"
    expect(clicks).toHaveLength(8)
    expect(clicks[0].songTime).toBeCloseTo(0.5, 9)
    expect(clicks[7].songTime).toBeCloseTo(4.0, 9)
    expect(clicks[0].accent && clicks[4].accent).toBe(true)
  })

  it('extrapolates the grid backwards for a start before the first detected beat', () => {
    // Music starts at 0.9s, drums (grid) come in at 2.0s.
    const clicks = planCountIn({ ...base, position: 0.9 })
    const last = clicks[clicks.length - 1]
    expect(last.songTime).toBeCloseTo(0.5, 9) // index -3; next beat (1.0) is the entry
    expect(clicks.every((c, i) => i === 0 || c.songTime - clicks[i - 1].songTime === 0.5)).toBe(
      true
    )
    expect(clicks[0].accent).toBe(true)
  })

  it('uses constant-tempo numbering when not on the grid', () => {
    const clicks = planCountIn({
      ...base,
      usingGrid: false,
      bpm: 60,
      firstBeatOffset: 0,
      downbeatShift: 0,
      position: 9.0
    })
    // Entry beat 9 is a "1" (beats 1, 5, 9 accented) → exactly one bar: 5..8.
    expect(clicks.map((c) => c.songTime)).toEqual([5, 6, 7, 8])
    expect(clicks.map((c) => c.accent)).toEqual([true, false, false, false])
  })

  it('returns nothing when count-in is off', () => {
    expect(planCountIn({ ...base, bars: 0, position: 3 })).toEqual([])
  })
})
