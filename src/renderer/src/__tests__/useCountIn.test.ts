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
    // currentTime tracks vitest's faked Date.now() (advanced by
    // vi.advanceTimersByTime) so onComplete's ctx.currentTime poll behaves
    // like a real, steadily-advancing audio clock in these tests, the same
    // way it does with a real AudioContext.
    const ctx = {
      get currentTime(): number {
        return Date.now() / 1000
      }
    } as unknown as AudioContext
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

  // Regression test for fix-count-in-onbeat-handoff-jitter: onComplete used
  // to fire off a plain setTimeout, on the JS wall clock — a clock that can
  // drift from the AudioContext's own hardware clock (which is what the
  // count-in clicks are actually scheduled against via ctx.currentTime).
  // onComplete must instead wait for the *audio* clock to reach the target
  // time, not just for enough wall-clock milliseconds to have elapsed.
  it('waits for the audio clock (ctx.currentTime), not just elapsed wall-clock time, before calling onComplete', () => {
    // A ctx whose currentTime is set manually, decoupled from vitest's
    // faked Date.now()/wall clock — simulates the audio clock lagging
    // behind real time. Kept as its own mutable-field type (rather than
    // typed/cast as AudioContext, whose currentTime is readonly) so the
    // test can reassign it directly below.
    const ctx: { currentTime: number } = { currentTime: 0 }
    const ensureAudioCtx = vi.fn(() => ctx as unknown as AudioContext)
    const playClick = vi.fn()
    const { result } = renderHook(() => useCountIn(ensureAudioCtx, playClick))
    const onComplete = vi.fn()
    const bpm = 120 // interval 0.5s; 1 bar -> target = 0.05 + 4*0.5 = 2.05s

    act(() => {
      result.current.start(1, bpm, () => {}, onComplete)
    })

    // Plenty of wall-clock time passes (well past the old 2050ms
    // setTimeout duration), but the audio clock hasn't caught up yet.
    act(() => {
      ctx.currentTime = 1.0
      vi.advanceTimersByTime(3000)
    })
    expect(onComplete).not.toHaveBeenCalled()

    // Now the audio clock reaches the target — onComplete should fire on
    // the next animation-frame poll.
    act(() => {
      ctx.currentTime = 2.05
      vi.advanceTimersByTime(20)
    })
    expect(onComplete).toHaveBeenCalledTimes(1)
  })
})
