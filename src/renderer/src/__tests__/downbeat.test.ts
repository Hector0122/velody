import { describe, it, expect } from 'vitest'
import {
  isGridAccent,
  isConstantAccent,
  downbeatShiftAt,
  normalizeDownbeatShift,
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
