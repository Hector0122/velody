// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import useCountIn from '../hooks/useCountIn'

describe('useCountIn', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function setup(): {
    playClick: ReturnType<typeof vi.fn>
    ensureAudioCtx: ReturnType<typeof vi.fn>
    result: ReturnType<typeof renderHook<ReturnType<typeof useCountIn>, unknown>>['result']
  } {
    const ctx = { currentTime: 0 } as unknown as AudioContext
    const ensureAudioCtx = vi.fn(() => ctx)
    const playClick = vi.fn()
    const { result } = renderHook(() => useCountIn(ensureAudioCtx, playClick))
    return { playClick, ensureAudioCtx, result }
  }

  it('schedules bars * 4 clicks, accenting every 4th (downbeat)', () => {
    const { playClick, result } = setup()

    act(() => {
      result.current.start(
        2,
        120,
        () => {},
        () => {}
      )
    })

    expect(playClick).toHaveBeenCalledTimes(8)
    const accents = playClick.mock.calls.map((call) => call[0])
    expect(accents).toEqual([true, false, false, false, true, false, false, false])
  })

  it('does nothing when bars <= 0', () => {
    const { playClick, result } = setup()
    const onTick = vi.fn()
    const onComplete = vi.fn()

    act(() => {
      result.current.start(0, 120, onTick, onComplete)
    })

    expect(playClick).not.toHaveBeenCalled()
    expect(onTick).not.toHaveBeenCalled()
    vi.advanceTimersByTime(5000)
    expect(onComplete).not.toHaveBeenCalled()
  })

  // Regression test for fix-count-in-silent-click: start() must call
  // ensureAudioCtx() itself (not just check an already-populated ref) so
  // the count-in produces sound even the very first time it's used, before
  // anything else has created the AudioContext.
  it('calls ensureAudioCtx() to obtain the context, and does nothing if it returns null', () => {
    const ensureAudioCtx = vi.fn(() => null)
    const playClick = vi.fn()
    const { result } = renderHook(() => useCountIn(ensureAudioCtx, playClick))
    const onTick = vi.fn()
    const onComplete = vi.fn()

    act(() => {
      result.current.start(1, 120, onTick, onComplete)
    })

    expect(ensureAudioCtx).toHaveBeenCalled()
    expect(playClick).not.toHaveBeenCalled()
    expect(onTick).not.toHaveBeenCalled()
    vi.advanceTimersByTime(5000)
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('uses ensureAudioCtx() rather than requiring the context to already exist', () => {
    const { playClick, ensureAudioCtx, result } = setup()

    act(() => {
      result.current.start(
        1,
        120,
        () => {},
        () => {}
      )
    })

    expect(ensureAudioCtx).toHaveBeenCalled()
    expect(playClick).toHaveBeenCalledTimes(4)
  })

  it('ticks the countdown from totalBeats down to 1, then calls onComplete once', () => {
    const { result } = setup()
    const onTick = vi.fn()
    const onComplete = vi.fn()
    const bpm = 120 // interval = 0.5s/beat, 1 bar = 4 beats = 2000ms

    act(() => {
      result.current.start(1, bpm, onTick, onComplete)
    })

    // Immediate tick with the full count.
    expect(onTick).toHaveBeenCalledWith(4)

    act(() => {
      // Last tick at 1550ms, onComplete at totalMs = 4*500 + 50 = 2050ms.
      vi.advanceTimersByTime(2100)
    })

    // 4 (immediate) + one per beat (4, 3, 2, 1) = 5 calls total.
    expect(onTick.mock.calls.map((c) => c[0])).toEqual([4, 4, 3, 2, 1])
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('cancel() prevents onComplete and further ticks', () => {
    const { result } = setup()
    const onTick = vi.fn()
    const onComplete = vi.fn()

    act(() => {
      result.current.start(2, 120, onTick, onComplete)
    })
    const callsBeforeCancel = onTick.mock.calls.length

    act(() => {
      result.current.cancel()
      vi.advanceTimersByTime(10_000)
    })

    expect(onTick.mock.calls.length).toBe(callsBeforeCancel)
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('starting again cancels any still-pending previous count-in', () => {
    const { result } = setup()
    const firstOnComplete = vi.fn()
    const secondOnComplete = vi.fn()

    act(() => {
      result.current.start(2, 120, () => {}, firstOnComplete)
    })
    act(() => {
      result.current.start(1, 120, () => {}, secondOnComplete)
    })

    act(() => {
      vi.advanceTimersByTime(10_000)
    })

    expect(firstOnComplete).not.toHaveBeenCalled()
    expect(secondOnComplete).toHaveBeenCalledTimes(1)
  })
})
