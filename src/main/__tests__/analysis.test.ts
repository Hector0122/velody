import { describe, it, expect } from 'vitest'
import { ANALYSIS_CACHE_VERSION, needsAnalysis, trackerOf } from '../../shared/analysis'

const current = (tracker?: string): Record<string, unknown> => ({
  bpm: 120,
  _version: ANALYSIS_CACHE_VERSION,
  ...(tracker ? { tracker } : {})
})

describe('needsAnalysis', () => {
  it('redoes a fallback grid only once Beat This! is available', () => {
    expect(needsAnalysis(current('fallback'), false)).toBe(false)
    expect(needsAnalysis(current('fallback'), true)).toBe(true)
  })

  it("never redoes a Beat This! grid or the user's tempo correction", () => {
    expect(needsAnalysis(current('beat_this'), true)).toBe(false)
    expect(needsAnalysis(current('corrected'), true)).toBe(false)
  })

  it('analyzes songs without a current cache', () => {
    expect(needsAnalysis(null, false)).toBe(true)
    expect(needsAnalysis({ bpm: 120, _version: ANALYSIS_CACHE_VERSION - 1 }, false)).toBe(true)
  })
})

describe('trackerOf', () => {
  it('marks anything not produced by Beat This! as a fallback', () => {
    expect(trackerOf({ tracker: 'beat_this' })).toBe('beat_this')
    expect(trackerOf({})).toBe('fallback')
  })
})
