import { describe, it, expect } from 'vitest'
import { correctTempoOctave } from '../hooks/tempoOctaveCorrection'

describe('correctTempoOctave', () => {
  it('doubling inserts a midpoint beat between every detected pair', () => {
    const beatTimes = [1.0, 1.8, 2.6, 3.4] // 0.8s spacing == 75bpm
    const result = correctTempoOctave(beatTimes, 75, 1.0, 'double')

    expect(result.bpm).toBe(150)
    expect(result.beatTimes).toEqual([1.0, 1.4, 1.8, 2.2, 2.6, 3.0, 3.4])
    expect(result.firstBeatOffset).toBe(1.0)
  })

  it('halving drops every other detected beat', () => {
    const beatTimes = [1.0, 1.4, 1.8, 2.2, 2.6, 3.0, 3.4] // 0.4s spacing == 150bpm
    const result = correctTempoOctave(beatTimes, 150, 1.0, 'halve')

    expect(result.bpm).toBe(75)
    expect(result.beatTimes).toEqual([1.0, 1.8, 2.6, 3.4])
    expect(result.firstBeatOffset).toBe(1.0)
  })

  it('doubling then halving round-trips back to the original grid', () => {
    const beatTimes = [1.0, 1.8, 2.6, 3.4]
    const doubled = correctTempoOctave(beatTimes, 75, 1.0, 'double')
    const halved = correctTempoOctave(
      doubled.beatTimes,
      doubled.bpm,
      doubled.firstBeatOffset,
      'halve'
    )

    expect(halved.bpm).toBe(75)
    expect(halved.beatTimes).toEqual(beatTimes)
  })

  it('handles an empty beat-time grid (no detected grid, bpm-only correction)', () => {
    const result = correctTempoOctave([], 75, 2.0, 'double')
    expect(result.bpm).toBe(150)
    expect(result.beatTimes).toEqual([])
    // No new grid to anchor to — falls back to the given offset unchanged.
    expect(result.firstBeatOffset).toBe(2.0)
  })

  it('handles a single-beat grid (nothing to interpolate when doubling)', () => {
    const result = correctTempoOctave([1.0], 75, 1.0, 'double')
    expect(result.bpm).toBe(150)
    expect(result.beatTimes).toEqual([1.0])
  })
})
