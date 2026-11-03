// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMetronome, type PlaybackClock } from '../hooks/useMetronome'

interface TrackedOsc {
  type: string
  // woodblock (the only click preset now — see
  // simplify-metronome-to-woodblock-only) sweeps frequency via
  // setValueAtTime/exponentialRampToValueAtTime rather than assigning
  // .value directly, so the stub tracks calls to those instead of a plain
  // value.
  frequency: {
    value: number
    setValueAtTime: ReturnType<typeof vi.fn>
    exponentialRampToValueAtTime: ReturnType<typeof vi.fn>
  }
  connect: ReturnType<typeof vi.fn>
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
}

// The frequency setValueAtTime call's first argument is the sweep's start
// frequency — 900 (accent) or 650 (non-accent) for woodblock — used below
// in place of the old fixed-value .frequency.value checks.
function startFreq(osc: TrackedOsc): number | undefined {
  return osc.frequency.setValueAtTime.mock.calls[0]?.[0]
}

function stubAudioContext(oscillators: TrackedOsc[]): void {
  class FakeAudioContext {
    state = 'running'
    currentTime = 0
    sampleRate = 44100
    destination = {}
    createOscillator(): TrackedOsc {
      const osc: TrackedOsc = {
        type: '',
        frequency: { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
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
    // woodblock's noise-burst "punch" transient (see clickPresets.ts) —
    // these tests are about scheduling, not click synthesis, so just
    // enough of a stub to not throw.
    createBuffer(_channels: number, length: number): unknown {
      return { getChannelData: () => new Float32Array(length) }
    }
    createBufferSource(): unknown {
      return { buffer: null, connect: vi.fn(), start: vi.fn(), stop: vi.fn() }
    }
    createBiquadFilter(): unknown {
      return { type: '', frequency: { value: 0 }, connect: vi.fn() }
    }
    resume(): void {
      /* no-op */
    }
    close = vi.fn(() => {
      this.state = 'closed'
      return Promise.resolve()
    })
  }
  vi.stubGlobal('AudioContext', FakeAudioContext)
}

function renderMetronome(
  positionRef: { current: number },
  beatTimesRef: { current: number[] },
  originalBpmRef: { current: number },
  firstBeatOffsetRef: { current: number } = { current: 0 },
  // Every existing call site exercises steady-state scheduling (playback
  // already genuinely underway), never the count-in pre-roll gate —
  // defaults false, matching real "already playing" behavior. See
  // fix-count-in-handoff-precision.
  playbackPendingRef: { current: boolean } = { current: false }
): ReturnType<typeof renderHook<ReturnType<typeof useMetronome>, unknown>> {
  const masterPlayingRef = { current: true }
  return renderHook(() =>
    useMetronome(
      true,
      masterPlayingRef,
      positionRef,
      firstBeatOffsetRef,
      originalBpmRef,
      beatTimesRef,
      playbackPendingRef
    )
  )
}

describe('useMetronome - beat-grid scheduling', () => {
  let oscillators: TrackedOsc[]

  beforeEach(() => {
    vi.useFakeTimers()
    oscillators = []
    stubAudioContext(oscillators)
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
    expect(startFreq(oscillators[0])).toBe(900) // idx 0 % 4 === 0 -> accent

    // Simulate a seek to just before beatTimes[3] (2.5), skipping over
    // beatTimes[1]/[2] entirely.
    positionRef.current = 2.35
    act(() => {
      vi.advanceTimersByTime(25)
    })

    expect(oscillators).toHaveLength(2)
    expect(oscillators[1].start).toHaveBeenCalledWith(expect.closeTo(0.15, 5))
    expect(startFreq(oscillators[1])).toBe(650) // idx 3 % 4 !== 0 -> not accent
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

  // Regression coverage for fix-count-in-song-start-timing: before this
  // fix, a song with a long intro (first detected beat well after position
  // 0) produced total silence from the metronome until the song's position
  // caught up to that first real beat — "the metronome goes quiet and only
  // picks back up once the drums come in."
  it('extrapolates backward from the first detected beat instead of staying silent through a long intro', () => {
    const beatTimesRef = { current: [8.5, 9.0, 9.5, 10.0] } // 0.5s spacing == 120bpm, 8.5s intro
    const originalBpmRef = { current: 120 }
    const positionRef = { current: 0.25 } // deep in the intro, far before beatTimes[0]

    const { result } = renderMetronome(positionRef, beatTimesRef, originalBpmRef)
    act(() => {
      result.current.setMetronomeOn(true)
    })
    act(() => {
      vi.advanceTimersByTime(25)
    })

    // Nearest virtual beat before beatTimes[0]=8.5 at 0.5s spacing is
    // 0.5s (idx -16), a 0.25s delay from t=0.25 — not silence.
    expect(oscillators).toHaveLength(1)
    expect(oscillators[0].start).toHaveBeenCalledWith(expect.closeTo(0.25, 5))
    expect(startFreq(oscillators[0])).toBe(900) // idx -16 % 4 === 0 -> accent
  })

  it('keeps the correct accent pattern on a non-accented extrapolated beat', () => {
    const beatTimesRef = { current: [8.5, 9.0, 9.5, 10.0] }
    const originalBpmRef = { current: 120 }
    const positionRef = { current: 0.75 } // nearest virtual beat is 1.0s (idx -15)

    const { result } = renderMetronome(positionRef, beatTimesRef, originalBpmRef)
    act(() => {
      result.current.setMetronomeOn(true)
    })
    act(() => {
      vi.advanceTimersByTime(25)
    })

    expect(oscillators).toHaveLength(1)
    expect(oscillators[0].start).toHaveBeenCalledWith(expect.closeTo(0.25, 5))
    expect(startFreq(oscillators[0])).toBe(650) // idx -15 % 4 !== 0 -> not accent
  })

  it('hands off seamlessly from extrapolated beats to the real grid with no gap or double click', () => {
    const beatTimesRef = { current: [8.5, 9.0, 9.5, 10.0] }
    const originalBpmRef = { current: 120 }
    // Right before the last extrapolated beat (idx -1, at 8.0) comes into range.
    const positionRef = { current: 7.75 }

    const { result } = renderMetronome(positionRef, beatTimesRef, originalBpmRef)
    act(() => {
      result.current.setMetronomeOn(true)
    })
    act(() => {
      vi.advanceTimersByTime(25)
    })
    expect(oscillators).toHaveLength(1)
    expect(oscillators[0].start).toHaveBeenCalledWith(expect.closeTo(0.25, 5)) // idx -1 at 8.0

    // Advance position to just before the real first beat (8.5) comes into range.
    positionRef.current = 8.25
    act(() => {
      vi.advanceTimersByTime(25)
    })
    // Exactly one more click (the real beatTimes[0]), not zero (a gap) or
    // two (a duplicate at the extrapolated/real boundary).
    expect(oscillators).toHaveLength(2)
    expect(oscillators[1].start).toHaveBeenCalledWith(expect.closeTo(0.25, 5))
    expect(startFreq(oscillators[1])).toBe(900) // real idx 0 -> accent
  })

  it('schedules the real first beat directly when the intro is shorter than one beat interval (nothing to extrapolate)', () => {
    // beatTimes[0] itself is inside the first interval — one beat back
    // would land before the song's own start (t=0), so there's no virtual
    // beat to schedule; the real first beat should just be picked up
    // directly, the same as the non-intro case.
    const beatTimesRef = { current: [0.3, 0.8, 1.3] } // 0.5s spacing == 120bpm
    const originalBpmRef = { current: 120 }
    const positionRef = { current: 0.05 }

    const { result } = renderMetronome(positionRef, beatTimesRef, originalBpmRef)
    act(() => {
      result.current.setMetronomeOn(true)
    })
    act(() => {
      vi.advanceTimersByTime(25)
    })

    expect(oscillators).toHaveLength(1)
    expect(oscillators[0].start).toHaveBeenCalledWith(expect.closeTo(0.25, 5))
    expect(startFreq(oscillators[0])).toBe(900) // real idx 0 -> accent
  })

  // Regression coverage for fix-count-in-handoff-precision: a song whose
  // first real beat lands within LOOKAHEAD of the start/trim position is
  // exactly what add-song-trim-points is *for* (trimming a song to start
  // right on the beat) — without the playbackPendingRef gate, the
  // scheduler would see position "close enough" to a real beat and
  // wrongly schedule a click during the count-in's wait (while position is
  // clamped, not really advancing), consuming the dedup ratchet so the
  // real beat at the correct moment then gets silently skipped.
  it('schedules nothing while playback is pending (pre-scheduled but not yet actually started), even if position is within LOOKAHEAD of a real beat', () => {
    const beatTimesRef = { current: [0.1, 0.6, 1.1] } // first beat 0.1s in — well within LOOKAHEAD of position 0
    const originalBpmRef = { current: 120 }
    const positionRef = { current: 0 } // clamped at the start position, as it is during a count-in wait
    const playbackPendingRef = { current: true }

    const { result } = renderMetronome(
      positionRef,
      beatTimesRef,
      originalBpmRef,
      undefined,
      playbackPendingRef
    )
    act(() => {
      result.current.setMetronomeOn(true)
    })
    act(() => {
      // Well past a single 25ms tick — simulates the scheduler polling
      // repeatedly throughout a real count-in's multi-second wait.
      vi.advanceTimersByTime(2000)
    })

    expect(oscillators).toHaveLength(0)

    // Once real playback actually starts (pending clears, position starts
    // advancing), the same real first beat schedules normally — nothing
    // was consumed/skipped by a premature schedule above.
    playbackPendingRef.current = false
    positionRef.current = 0
    act(() => {
      vi.advanceTimersByTime(25)
    })
    expect(oscillators).toHaveLength(1)
    expect(oscillators[0].start).toHaveBeenCalledWith(expect.closeTo(0.1, 5))
  })
})

describe('useMetronome - metronome pan', () => {
  let panNodes: { pan: { value: number }; connect: ReturnType<typeof vi.fn> }[]

  beforeEach(() => {
    panNodes = []
    window.localStorage.clear()
    class FakeAudioContext {
      state = 'running'
      currentTime = 0
      sampleRate = 44100
      destination = {}
      createOscillator(): TrackedOsc {
        return {
          type: '',
          frequency: { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
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
      // woodblock's noise-burst "punch" transient (see clickPresets.ts) —
      // these tests are about pan routing, not click synthesis, so just
      // enough of a stub to not throw.
      createBuffer(_channels: number, length: number): unknown {
        return { getChannelData: () => new Float32Array(length) }
      }
      createBufferSource(): unknown {
        return { buffer: null, connect: vi.fn(), start: vi.fn(), stop: vi.fn() }
      }
      createBiquadFilter(): unknown {
        return { type: '', frequency: { value: 0 }, connect: vi.fn() }
      }
      resume(): void {
        /* no-op */
      }
      close(): Promise<void> {
        return Promise.resolve()
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

describe('useMetronome - shared playback clock', () => {
  let oscillators: TrackedOsc[]

  beforeEach(() => {
    vi.useFakeTimers()
    oscillators = []
    stubAudioContext(oscillators)
  })

  afterEach(() => {
    vi.useRealTimers()
    window.localStorage.clear()
  })

  function renderWithClock(
    clock: PlaybackClock,
    positionRef: { current: number },
    beatTimesRef: { current: number[] }
  ): ReturnType<typeof renderHook<ReturnType<typeof useMetronome>, unknown>> {
    return renderHook(() =>
      useMetronome(
        true,
        { current: true },
        positionRef,
        { current: 0 },
        { current: 120 },
        beatTimesRef,
        { current: false },
        { current: clock }
      )
    )
  }

  it("schedules on the engine's context using its live clock position, not the stale positionRef", () => {
    const engineCtx = new AudioContext() as unknown as AudioContext & { currentTime: number }
    ;(engineCtx as unknown as { currentTime: number }).currentTime = 10
    // positionRef lags a frame behind (0.75) — the live clock says 0.8.
    const positionRef = { current: 0.75 }
    const clock: PlaybackClock = { ensureCtx: () => engineCtx, getPosition: () => 0.8 }

    const { result } = renderWithClock(clock, positionRef, { current: [1.0, 1.5, 2.0] })
    act(() => {
      result.current.setMetronomeOn(true)
    })
    act(() => {
      vi.advanceTimersByTime(25)
    })

    // Beat at 1.0 from live position 0.8 -> 0.2s after the engine's currentTime.
    expect(oscillators).toHaveLength(1)
    expect(oscillators[0].start).toHaveBeenCalledWith(expect.closeTo(10.2, 5))
  })

  it("never closes the engine's shared context on unmount", () => {
    const engineCtx = new AudioContext() as unknown as { close: ReturnType<typeof vi.fn> }
    const clock: PlaybackClock = {
      ensureCtx: () => engineCtx as unknown as AudioContext,
      getPosition: () => 0
    }
    const { result, unmount } = renderWithClock(clock, { current: 0 }, { current: [] })
    act(() => {
      result.current.ensureAudioCtx()
    })
    unmount()
    expect(engineCtx.close).not.toHaveBeenCalled()
  })
})

describe('useMetronome - own context lifecycle', () => {
  beforeEach(() => {
    stubAudioContext([])
  })

  afterEach(() => {
    window.localStorage.clear()
  })

  it('closes its own AudioContext on unmount so contexts do not pile up per song', () => {
    const { result, unmount } = renderMetronome({ current: 0 }, { current: [] }, { current: 120 })
    let ctx: AudioContext | null = null
    act(() => {
      ctx = result.current.ensureAudioCtx()
    })
    unmount()
    expect((ctx as unknown as { close: ReturnType<typeof vi.fn> }).close).toHaveBeenCalledTimes(1)
  })
})
