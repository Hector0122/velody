// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMetronome } from '../hooks/useMetronome'

interface TrackedOsc {
  type: string
  frequency: { value: number }
  connect: ReturnType<typeof vi.fn>
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
}

function stubAudioContext(oscillators: TrackedOsc[]): void {
  class FakeAudioContext {
    state = 'running'
    currentTime = 0
    destination = {}
    createOscillator(): TrackedOsc {
      const osc: TrackedOsc = {
        type: '',
        frequency: { value: 0 },
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn()
      }
      oscillators.push(osc)
      return osc
    }
    createGain(): unknown {
      return {
        connect: vi.fn(),
        gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }
      }
    }
    createStereoPanner(): unknown {
      return { connect: vi.fn(), pan: { value: 0 } }
    }
    resume(): void {
      /* no-op */
    }
  }
  vi.stubGlobal('AudioContext', FakeAudioContext)
}

function renderMetronome(
  positionRef: { current: number },
  beatTimesRef: { current: number[] },
  originalBpmRef: { current: number },
  firstBeatOffsetRef: { current: number } = { current: 0 }
): ReturnType<typeof renderHook<ReturnType<typeof useMetronome>, unknown>> {
  const masterPlayingRef = { current: true }
  return renderHook(() =>
    useMetronome(
      true,
      masterPlayingRef,
      positionRef,
      firstBeatOffsetRef,
      originalBpmRef,
      beatTimesRef
    )
  )
}

describe('useMetronome - beat-grid scheduling', () => {
  let oscillators: TrackedOsc[]

  beforeEach(() => {
    vi.useFakeTimers()
    oscillators = []
    stubAudioContext(oscillators)
    // These tests exercise the scheduler (beat-grid timing, accent
    // alternation, constant-tempo fallback), not click synthesis — force
    // the 'beep' preset, which is byte-for-byte the pre-add-metronome-
    // click-sounds implementation (osc.frequency.value=, single
    // oscillator/gain, no noise burst), so the existing assertions below
    // stay meaningful without needing to also stub createBufferSource/
    // createBiquadFilter for presets these tests aren't about. Click
    // synthesis itself is covered by clickPresets.test.ts.
    window.localStorage.setItem('velody:clickPreset', JSON.stringify('beep'))
  })

  afterEach(() => {
    vi.useRealTimers()
    window.localStorage.clear()
  })

  it('schedules clicks at the exact detected beat times, including across a seek', () => {
    const beatTimesRef = { current: [1.0, 1.5, 2.0, 2.5, 3.0] }
    const originalBpmRef = { current: 120 }
    const positionRef = { current: 0.8 } // 0.2s before beatTimes[0] — within LOOKAHEAD

    const { result } = renderMetronome(positionRef, beatTimesRef, originalBpmRef)
    act(() => {
      result.current.setMetronomeOn(true)
    })
    act(() => {
      vi.advanceTimersByTime(25)
    })

    expect(oscillators).toHaveLength(1)
    expect(oscillators[0].start).toHaveBeenCalledWith(expect.closeTo(0.2, 5))
    expect(oscillators[0].frequency.value).toBe(1600) // idx 0 % 4 === 0 -> accent

    // Simulate a seek to just before beatTimes[3] (2.5), skipping over
    // beatTimes[1]/[2] entirely.
    positionRef.current = 2.35
    act(() => {
      vi.advanceTimersByTime(25)
    })

    expect(oscillators).toHaveLength(2)
    expect(oscillators[1].start).toHaveBeenCalledWith(expect.closeTo(0.15, 5))
    expect(oscillators[1].frequency.value).toBe(900) // idx 3 % 4 !== 0 -> not accent
  })

  it('extrapolates at a constant interval anchored to the last detected beat once the grid runs out', () => {
    const beatTimesRef = { current: [1.0, 1.5, 2.0] } // 0.5s spacing == 120bpm
    const originalBpmRef = { current: 120 }
    const positionRef = { current: 2.3 } // past the last detected beat (2.0)

    const { result } = renderMetronome(positionRef, beatTimesRef, originalBpmRef)
    act(() => {
      result.current.setMetronomeOn(true)
    })
    act(() => {
      vi.advanceTimersByTime(25)
    })

    // Next beat should continue the grid's cadence: 2.0 + 60/120 = 2.5,
    // i.e. a 0.2s delay from position 2.3 — not a gap, not a duplicate.
    expect(oscillators).toHaveLength(1)
    expect(oscillators[0].start).toHaveBeenCalledWith(expect.closeTo(0.2, 5))
  })

  it('falls back to constant-tempo extrapolation at the live BPM when the tempo is manually overridden', () => {
    const beatTimesRef = { current: [1.0, 1.5, 2.0, 2.5] }
    const originalBpmRef = { current: 120 }
    const positionRef = { current: 1.9 }

    const { result } = renderMetronome(positionRef, beatTimesRef, originalBpmRef)
    act(() => {
      result.current.setMetronomeOn(true)
      result.current.setBpm(140) // diverges from originalBpmRef (120) -> bypasses the grid
    })
    act(() => {
      vi.advanceTimersByTime(25)
    })

    // Constant-tempo at 140bpm from offset 0 lands the next beat at
    // beat 5 = 5*60/140 ≈ 2.142857s, a ≈0.2429s delay from t=1.9 — distinct
    // from the grid's beatTimes[2] (2.0, a 0.1s delay), confirming the grid
    // was bypassed rather than used.
    expect(oscillators).toHaveLength(1)
    expect(oscillators[0].start).toHaveBeenCalledWith(expect.closeTo(0.242857, 4))
  })
})

describe('useMetronome - metronome pan', () => {
  let panNodes: { pan: { value: number }; connect: ReturnType<typeof vi.fn> }[]

  beforeEach(() => {
    panNodes = []
    window.localStorage.clear()
    // These tests exercise pan routing, not click synthesis — force 'beep'
    // (simple oscillator, no frequency sweep) since this stub's
    // createOscillator only supports the plain `frequency.value =` API.
    window.localStorage.setItem('velody:clickPreset', JSON.stringify('beep'))
    class FakeAudioContext {
      state = 'running'
      currentTime = 0
      destination = {}
      createOscillator(): TrackedOsc {
        return {
          type: '',
          frequency: { value: 0 },
          connect: vi.fn(),
          start: vi.fn(),
          stop: vi.fn()
        }
      }
      createGain(): unknown {
        return {
          connect: vi.fn(),
          gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }
        }
      }
      createStereoPanner(): unknown {
        const node = { pan: { value: 0 }, connect: vi.fn() }
        panNodes.push(node)
        return node
      }
      resume(): void {
        /* no-op */
      }
    }
    vi.stubGlobal('AudioContext', FakeAudioContext)
  })

  afterEach(() => {
    window.localStorage.clear()
  })

  it('defaults metroPan to 0 and creates the pan node at that value on first use', () => {
    const positionRef = { current: 0 }
    const beatTimesRef = { current: [] as number[] }
    const originalBpmRef = { current: 120 }
    const { result } = renderMetronome(positionRef, beatTimesRef, originalBpmRef)

    expect(result.current.metroPan).toBe(0)

    // playClick only reads the already-created AudioContext/pan node; the
    // scheduler (driven by metronomeOn + masterPlaying) is what actually
    // creates them via getAudioCtx.
    act(() => {
      result.current.setMetronomeOn(true)
    })
    act(() => {
      result.current.playClick(true, 0)
    })
    expect(panNodes).toHaveLength(1)
    expect(panNodes[0].pan.value).toBe(0)
    expect(panNodes[0].connect).toHaveBeenCalled()
  })

  it('setMetroPan updates the persistent pan node value and persists to localStorage', () => {
    const positionRef = { current: 0 }
    const beatTimesRef = { current: [] as number[] }
    const originalBpmRef = { current: 120 }
    const { result } = renderMetronome(positionRef, beatTimesRef, originalBpmRef)

    act(() => {
      result.current.setMetronomeOn(true)
    })
    act(() => {
      result.current.playClick(true, 0) // forces the AudioContext/pan node to exist
    })

    act(() => {
      result.current.setMetroPan(-1)
    })

    expect(result.current.metroPan).toBe(-1)
    expect(panNodes[0].pan.value).toBe(-1)
    expect(window.localStorage.getItem('velody:metroPan')).toBe('-1')
  })
})
