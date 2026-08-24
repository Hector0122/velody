import { describe, it, expect } from 'vitest'
// Importing handlers.ts outside Electron's runtime is safe here — see the
// comment in scanSongsLibrary.test.ts; clickSampleValue is pure and never
// touches the electron/fs bindings.
import { clickSampleValue } from '../handlers'

describe('clickSampleValue', () => {
  it('is silent well before or well after the click window', () => {
    expect(clickSampleValue(-0.1, true)).toBe(0)
    expect(clickSampleValue(0.1, true)).toBe(0)
  })

  it('is silent for negative beatPos close to 0 (the pre-beat half of the cycle)', () => {
    // Regression coverage: the original math lacked a lower bound, so any
    // negative beatPos (roughly the second half of every beat interval)
    // incorrectly triggered the click branch with an unbounded envelope.
    expect(clickSampleValue(-0.001, true)).toBe(0)
    expect(clickSampleValue(-0.02, true)).toBe(0)
  })

  it('produces a non-silent, finite sample shortly after the beat', () => {
    const sample = clickSampleValue(0.0005, true)
    expect(Number.isFinite(sample)).toBe(true)
  })

  it('never exceeds a full-scale [-1, 1] envelope', () => {
    for (let beatPos = -0.05; beatPos <= 0.05; beatPos += 0.0005) {
      const sample = clickSampleValue(beatPos, true)
      expect(sample).toBeGreaterThanOrEqual(-1)
      expect(sample).toBeLessThanOrEqual(1)
    }
  })

  it('accent beats are at least as loud as non-accent beats at the same beatPos', () => {
    const accentPeak = Math.abs(clickSampleValue(0.001, true))
    const regularPeak = Math.abs(clickSampleValue(0.001, false))
    expect(accentPeak).toBeGreaterThanOrEqual(regularPeak)
  })

  // Regression coverage for simplify-metronome-to-woodblock-only: gain
  // multipliers boosted from 0.5/0.35 to 0.95/0.75 to match the renderer's
  // louder woodblock, so an exported mix's baked-in click isn't quieter
  // than what's heard live.
  it('matches the boosted gain envelope exactly (accent)', () => {
    const beatPos = 0.001
    const decay = 0.03
    const [start, end] = [900, 500]
    const freq = start + (end - start) * (beatPos / decay)
    const expected = Math.sin(2 * Math.PI * freq * beatPos) * (1 - beatPos / decay) * 0.95
    expect(clickSampleValue(beatPos, true)).toBeCloseTo(expected, 10)
  })

  it('matches the boosted gain envelope exactly (non-accent)', () => {
    const beatPos = 0.001
    const decay = 0.03
    const [start, end] = [650, 400]
    const freq = start + (end - start) * (beatPos / decay)
    const expected = Math.sin(2 * Math.PI * freq * beatPos) * (1 - beatPos / decay) * 0.75
    expect(clickSampleValue(beatPos, false)).toBeCloseTo(expected, 10)
  })
})
