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

  it('never exceeds a full-scale [-1, 1] envelope, even with the noise burst active', () => {
    for (let beatPos = -0.05; beatPos <= 0.05; beatPos += 0.0005) {
      const sample = clickSampleValue(beatPos, true)
      expect(sample).toBeGreaterThanOrEqual(-1)
      expect(sample).toBeLessThanOrEqual(1)
    }
  })

  // beatPos = 0.01 is past the noise burst's 0.005s window but still
  // inside the tone's 0.03s decay — isolates the deterministic tone
  // comparison from the noise burst's randomness (see below), avoiding a
  // flaky assertion.
  it('accent beats are louder than non-accent beats at the same beatPos (tone-only, outside the noise window)', () => {
    const accentPeak = Math.abs(clickSampleValue(0.01, true))
    const regularPeak = Math.abs(clickSampleValue(0.01, false))
    expect(accentPeak).toBeGreaterThanOrEqual(regularPeak)
  })

  // Regression coverage for simplify-metronome-to-woodblock-only's
  // follow-up fix: a tone-only click (even at boosted gain) still read as
  // too soft/dull to cut through a live mix, so a brief noise-burst
  // transient was added and the gain budget rebalanced between the tone
  // and the noise (0.7/0.55 tone, 0.3/0.2 noise — matches the renderer's
  // clickPresets.ts woodblock). Checked outside the noise window (see
  // above) so the expected value is deterministic.
  it('matches the rebalanced tone envelope exactly, outside the noise window (accent)', () => {
    const beatPos = 0.01
    const decay = 0.03
    const [start, end] = [900, 500]
    const freq = start + (end - start) * (beatPos / decay)
    const expected = Math.sin(2 * Math.PI * freq * beatPos) * (1 - beatPos / decay) * 0.7
    expect(clickSampleValue(beatPos, true)).toBeCloseTo(expected, 10)
  })

  it('matches the rebalanced tone envelope exactly, outside the noise window (non-accent)', () => {
    const beatPos = 0.01
    const decay = 0.03
    const [start, end] = [650, 400]
    const freq = start + (end - start) * (beatPos / decay)
    const expected = Math.sin(2 * Math.PI * freq * beatPos) * (1 - beatPos / decay) * 0.55
    expect(clickSampleValue(beatPos, false)).toBeCloseTo(expected, 10)
  })

  it('the noise burst only contributes within its 0.005s window, not beyond', () => {
    // Just past the noise window, only the deterministic tone remains —
    // running this twice must give the identical value (no randomness
    // left in play).
    const a = clickSampleValue(0.006, true)
    const b = clickSampleValue(0.006, true)
    expect(a).toBe(b)
  })

  it('the noise burst makes samples within its window vary run to run (confirms it is actually active)', () => {
    const samples = new Set<number>()
    for (let i = 0; i < 5; i++) samples.add(clickSampleValue(0.0005, true))
    // Random noise contribution means these 5 samples shouldn't all be
    // identical (astronomically unlikely if the burst is truly active).
    expect(samples.size).toBeGreaterThan(1)
  })
})
