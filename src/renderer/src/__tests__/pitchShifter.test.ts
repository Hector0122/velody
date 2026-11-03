import { describe, it, expect } from 'vitest'
import {
  clampSpeed,
  clampSemitones,
  compensatingSemitones,
  needsPitchShifter
} from '../hooks/pitchShifter'

describe('pitchShifter helpers', () => {
  it('snaps speed to 5% steps within 50–150%', () => {
    expect(clampSpeed(0.95 + 0.05)).toBe(1)
    expect(clampSpeed(0.73)).toBe(0.75)
    expect(clampSpeed(0.2)).toBe(0.5)
    expect(clampSpeed(9)).toBe(1.5)
    expect(clampSpeed(NaN)).toBe(1)
  })

  it('clamps transpose to whole semitones within ±12', () => {
    expect(clampSemitones(2.4)).toBe(2)
    expect(clampSemitones(-20)).toBe(-12)
    expect(clampSemitones(NaN)).toBe(0)
  })

  it('cancels the pitch drop of slowing down, then applies the transpose', () => {
    expect(compensatingSemitones(1, 0)).toBe(0)
    expect(compensatingSemitones(0.5, 0)).toBeCloseTo(12, 10)
    expect(compensatingSemitones(2, -3)).toBeCloseTo(-15, 10)
  })

  it('bypasses the shifter only at normal speed and original key', () => {
    expect(needsPitchShifter(1, 0)).toBe(false)
    expect(needsPitchShifter(0.9, 0)).toBe(true)
    expect(needsPitchShifter(1, -1)).toBe(true)
  })
})
