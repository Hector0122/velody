// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useAudioContextEngine, resolveTickAction } from '../hooks/useAudioContextEngine'

const shifterNode = {
  connect: vi.fn(),
  disconnect: vi.fn(),
  start: vi.fn(async () => undefined),
  stop: vi.fn(async () => undefined),
  schedule: vi.fn(async () => undefined),
  latency: vi.fn(async () => 0.15)
}
vi.mock('signalsmith-stretch', () => ({ default: vi.fn(async () => shifterNode) }))
import type { VelodyAPI } from '../../../shared/types'

// Minimal fake AudioContext: jsdom doesn't implement the Web Audio API, and
// these tests only need decodeAudioData + the handful of node-creation calls
// the engine makes while wiring up playback graph nodes.
class FakeAudioContext {
  state = 'running'
  currentTime = 0
  destination = {}
  decodeAudioData = vi.fn(
    async (buf: ArrayBuffer): Promise<AudioBuffer> =>
      ({
        numberOfChannels: 2,
        duration: 1,
        _bytes: buf.byteLength
      }) as unknown as AudioBuffer
  )
  createGain(): unknown {
    return { connect: vi.fn(), gain: { setValueAtTime: vi.fn(), setTargetAtTime: vi.fn() } }
  }
  createStereoPanner(): unknown {
    return { connect: vi.fn(), disconnect: vi.fn(), pan: { value: 0 } }
  }
  createBufferSource(): unknown {
    return { connect: vi.fn(), start: vi.fn(), stop: vi.fn(), playbackRate: { value: 1 } }
  }
  resume(): void {
    /* no-op */
  }
  close(): void {
    /* no-op */
  }
}

function buildParams(
  overrides: Partial<Parameters<typeof useAudioContextEngine>[0]> = {}
): Parameters<typeof useAudioContextEngine>[0] {
  return {
    allStems: ['/song/vocals.wav', '/song/drums.wav'],
    urls: {
      vocals: 'http://127.0.0.1:1234/vocals.wav',
      drums: 'http://127.0.0.1:1234/drums.wav'
    },
    setUrls: vi.fn(),
    active: {},
    solo: {},
    stemVolumes: {},
    stemPannings: {},
    masterVolume: 1,
    masterPlaying: false,
    loopEnabled: false,
    loopStart: null,
    loopEnd: null,
    trimStart: 0,
    trimEnd: null,
    masterWaveDuration: 0,
    duration: 0,
    positionRef: { current: 0 },
    masterPlayingRef: { current: false },
    durationRef: { current: 0 },
    onAudioTimeRef: { current: () => {} },
    lastScheduledBeatRef: { current: -1 },
    playbackPendingRef: { current: false },
    progressRef: { current: 0 },
    setMasterPlaying: vi.fn(),
    setActive: vi.fn(),
    setSolo: vi.fn(),
    setMasterVolume: vi.fn(),
    setStemVolumes: vi.fn(),
    setStemPannings: vi.fn(),
    setRecordedStems: vi.fn(),
    ensureWaveSurfer: vi.fn(),
    stemWaves: { current: {} },
    waveUrlsRef: { current: {} },
    mediaStreamRef: { current: null },
    notifyStemDecodedRef: { current: () => {} },
    ...overrides
  }
}

describe('resolveTickAction', () => {
  const noLoop = { enabled: false, start: null, end: null }
  const noTrim = { start: 0, end: null }

  it('continues when nothing is enabled/set', () => {
    expect(resolveTickAction(10, noLoop, noTrim)).toEqual({ type: 'continue' })
  })

  it('loops when position reaches loop.end and loop is enabled', () => {
    const loop = { enabled: true, start: 5, end: 20 }
    expect(resolveTickAction(20, loop, noTrim)).toEqual({ type: 'loop', to: 5 })
    expect(resolveTickAction(25, loop, noTrim)).toEqual({ type: 'loop', to: 5 })
    expect(resolveTickAction(19.9, loop, noTrim)).toEqual({ type: 'continue' })
  })

  it('stops at trimEnd when loop is off', () => {
    const trim = { start: 0, end: 30 }
    expect(resolveTickAction(30, noLoop, trim)).toEqual({ type: 'trimStop', at: 30 })
    expect(resolveTickAction(35, noLoop, trim)).toEqual({ type: 'trimStop', at: 30 })
    expect(resolveTickAction(29.9, noLoop, trim)).toEqual({ type: 'continue' })
  })

  it('does not stop at trimEnd when trimEnd is null', () => {
    expect(resolveTickAction(1000, noLoop, { start: 0, end: null })).toEqual({ type: 'continue' })
  })

  it('loop bounds entirely inside the trimmed range keep looping, unaffected by trimEnd', () => {
    // Loop is [40, 60], trim end is 200 — well past the loop, so the loop
    // boundary is hit first every time and trimEnd never matters here.
    const loop = { enabled: true, start: 40, end: 60 }
    const trim = { start: 0, end: 200 }
    expect(resolveTickAction(60, loop, trim)).toEqual({ type: 'loop', to: 40 })
  })

  it('loop takes priority over trimStop when loop is enabled, even past trimEnd', () => {
    // Enabled loop, and position has already passed trimEnd too — loop
    // still wins because the trimStop branch is only checked when
    // !loop.enabled.
    const loop = { enabled: true, start: 5, end: 10 }
    const trim = { start: 0, end: 8 }
    expect(resolveTickAction(10, loop, trim)).toEqual({ type: 'loop', to: 5 })
  })
})

describe('useAudioContextEngine - decode + notify', () => {
  beforeEach(() => {
    vi.stubGlobal('AudioContext', FakeAudioContext)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        arrayBuffer: async () => new ArrayBuffer(16)
      }))
    )
  })

  it('decodes each stem once and notifies for each on success', async () => {
    const notifyStemDecodedRef = { current: vi.fn() }
    const { result } = renderHook(() =>
      useAudioContextEngine(buildParams({ notifyStemDecodedRef }))
    )

    await waitFor(() => {
      expect(notifyStemDecodedRef.current).toHaveBeenCalledTimes(2)
    })

    expect(notifyStemDecodedRef.current).toHaveBeenCalledWith('vocals')
    expect(notifyStemDecodedRef.current).toHaveBeenCalledWith('drums')
    expect(result.current.getDecodedBuffer('vocals')).toBeDefined()
    expect(result.current.getDecodedBuffer('drums')).toBeDefined()
  })

  it('still notifies for a stem whose decode fails, without a buffer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('drums')) throw new Error('network error')
        return { arrayBuffer: async () => new ArrayBuffer(16) }
      })
    )
    const notifyStemDecodedRef = { current: vi.fn() }
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { result } = renderHook(() =>
      useAudioContextEngine(buildParams({ notifyStemDecodedRef }))
    )

    await waitFor(() => {
      expect(notifyStemDecodedRef.current).toHaveBeenCalledTimes(2)
    })

    expect(result.current.getDecodedBuffer('vocals')).toBeDefined()
    expect(result.current.getDecodedBuffer('drums')).toBeUndefined()

    errorSpy.mockRestore()
  })

  it('does not re-decode a stem it has already decoded', async () => {
    const notifyStemDecodedRef = { current: vi.fn() }
    const params = buildParams({ notifyStemDecodedRef, allStems: ['/song/vocals.wav'] })
    const { rerender } = renderHook((p) => useAudioContextEngine(p), { initialProps: params })

    await waitFor(() => {
      expect(notifyStemDecodedRef.current).toHaveBeenCalledTimes(1)
    })

    const fetchCallsAfterFirstDecode = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.length

    act(() => {
      rerender(buildParams({ notifyStemDecodedRef, allStems: ['/song/vocals.wav'] }))
    })

    await waitFor(() => {
      // Still only 1 stem decoded; a second effect run should be a no-op for it.
      expect(notifyStemDecodedRef.current).toHaveBeenCalledTimes(1)
    })
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      fetchCallsAfterFirstDecode
    )
  })
})

interface TrackedSource {
  connect: ReturnType<typeof vi.fn>
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  playbackRate: { value: number; setValueAtTime: ReturnType<typeof vi.fn> }
}

function stubTrackingAudioContext(createdSources: TrackedSource[]): void {
  class TrackingAudioContext extends FakeAudioContext {
    createBufferSource(): TrackedSource {
      const src: TrackedSource = {
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        playbackRate: { value: 1, setValueAtTime: vi.fn() }
      }
      createdSources.push(src)
      return src
    }
  }
  vi.stubGlobal('AudioContext', TrackingAudioContext)
}

// Regression coverage for the "mute/unmute a stem the first time does nothing"
// bug: a source that never gets `.start()`ed can't be un-muted later just by
// ramping its gain (see startSourceForKey's comment in useAudioContextEngine.ts).
describe('useAudioContextEngine - source lifecycle (mute-at-start / late decode)', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(16) }))
    )
  })

  it('starts a live source even for a stem that begins inactive (muted), once playback actually starts', async () => {
    const createdSources: TrackedSource[] = []
    stubTrackingAudioContext(createdSources)

    const notifyStemDecodedRef = { current: vi.fn() }
    const params = buildParams({ notifyStemDecodedRef, active: {}, masterPlaying: false })
    const { result } = renderHook(() => useAudioContextEngine(params))

    await waitFor(() => {
      expect(notifyStemDecodedRef.current).toHaveBeenCalledTimes(2)
    })

    act(() => {
      // Pre-configure the mix while stopped: 'vocals' active, 'drums' left
      // muted — matches the "set up mutes before pressing Play" workflow
      // (see fix-stem-mute-while-paused).
      result.current.toggleStem('vocals')
      result.current.toggleMasterPlay()
    })

    // Both stems get a live source — the inactive one just starts at gain 0,
    // it is not skipped, so a later un-mute only needs to ramp its gain.
    expect(createdSources).toHaveLength(2)
    for (const src of createdSources) {
      expect(src.start).toHaveBeenCalledTimes(1)
    }
  })

  // Regression coverage for fix-stem-mute-while-paused: toggleStem used to
  // special-case "master not playing" into auto-starting full playback
  // (clobbering every *other* stem's mute state) when toggling a muted
  // stem, and into a silent no-op when toggling an already-active one —
  // reported as "no puedo poner pausa a stems cuando la canción o el
  // master está en pausa."
  describe('toggleStem while paused', () => {
    it('toggles mute state without starting playback', async () => {
      const createdSources: TrackedSource[] = []
      stubTrackingAudioContext(createdSources)
      const notifyStemDecodedRef = { current: vi.fn() }
      const setMasterPlaying = vi.fn()
      const params = buildParams({
        notifyStemDecodedRef,
        active: { vocals: true, drums: true },
        masterPlaying: false,
        setMasterPlaying
      })
      const { result } = renderHook(() => useAudioContextEngine(params))
      await waitFor(() => expect(notifyStemDecodedRef.current).toHaveBeenCalledTimes(2))

      act(() => {
        result.current.toggleStem('vocals')
      })

      expect(createdSources).toHaveLength(0) // no playback started
      expect(setMasterPlaying).not.toHaveBeenCalled()
    })

    it('un-muting one stem does not disturb any other stem’s mute state', async () => {
      stubTrackingAudioContext([])
      const notifyStemDecodedRef = { current: vi.fn() }
      const setActive = vi.fn()
      const params = buildParams({
        notifyStemDecodedRef,
        active: { vocals: false, drums: true, bass: false },
        masterPlaying: false,
        setActive
      })
      const { result } = renderHook(() => useAudioContextEngine(params))
      await waitFor(() => expect(notifyStemDecodedRef.current).toHaveBeenCalledTimes(2))

      act(() => {
        result.current.toggleStem('vocals')
      })

      // setActive is called with an updater function here (the real hook,
      // not a plain object) — apply it to the prior state to confirm only
      // 'vocals' changed.
      const updater = setActive.mock.calls[0][0] as (
        prev: Record<string, boolean>
      ) => Record<string, boolean>
      expect(updater({ vocals: false, drums: true, bass: false })).toEqual({
        vocals: true,
        drums: true,
        bass: false
      })
    })

    it('toggling an already-active stem off actually works (previously a silent no-op)', async () => {
      stubTrackingAudioContext([])
      const notifyStemDecodedRef = { current: vi.fn() }
      const setActive = vi.fn()
      const params = buildParams({
        notifyStemDecodedRef,
        active: { vocals: true },
        masterPlaying: false,
        setActive
      })
      const { result } = renderHook(() => useAudioContextEngine(params))
      await waitFor(() => expect(notifyStemDecodedRef.current).toHaveBeenCalledTimes(2))

      act(() => {
        result.current.toggleStem('vocals')
      })

      expect(setActive).toHaveBeenCalledTimes(1)
      const updater = setActive.mock.calls[0][0] as (
        prev: Record<string, boolean>
      ) => Record<string, boolean>
      expect(updater({ vocals: true })).toEqual({ vocals: false })
    })
  })

  it('joins a stem into the live mix once it finishes decoding after playback already started', async () => {
    const createdSources: TrackedSource[] = []
    stubTrackingAudioContext(createdSources)

    const notifyStemDecodedRef = { current: vi.fn() }
    // 'drums' has no url yet, so it can't decode until a later render supplies one.
    const initialParams = buildParams({
      notifyStemDecodedRef,
      urls: { vocals: 'http://127.0.0.1:1234/vocals.wav' },
      active: { vocals: true, drums: true },
      masterPlaying: false
    })
    const { result, rerender } = renderHook((p) => useAudioContextEngine(p), {
      initialProps: initialParams
    })

    await waitFor(() => expect(notifyStemDecodedRef.current).toHaveBeenCalledWith('vocals'))
    expect(createdSources).toHaveLength(0)

    act(() => {
      result.current.toggleMasterPlay()
    })
    // Only 'vocals' had a decoded buffer when playback started.
    expect(createdSources).toHaveLength(1)

    act(() => {
      rerender(
        buildParams({
          notifyStemDecodedRef,
          urls: {
            vocals: 'http://127.0.0.1:1234/vocals.wav',
            drums: 'http://127.0.0.1:1234/drums.wav'
          },
          active: { vocals: true, drums: true },
          masterPlaying: true
        })
      )
    })

    await waitFor(() => expect(notifyStemDecodedRef.current).toHaveBeenCalledWith('drums'))
    // 'drums' joined the already-playing mix without needing a restart/seek.
    expect(createdSources).toHaveLength(2)
  })
})

// Regression coverage for "every Stop -> Play cycle re-activated every stem,
// undoing mutes the user just set" (see fix-stem-mutes-reset-on-replay).
describe('useAudioContextEngine - toggleMasterPlay preserves mute state', () => {
  beforeEach(() => {
    vi.stubGlobal('AudioContext', FakeAudioContext)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(16) }))
    )
  })

  it('activates every stem on the very first play (empty active map)', () => {
    const setActive = vi.fn()
    const params = buildParams({ active: {}, masterPlaying: false, setActive })
    const { result } = renderHook(() => useAudioContextEngine(params))

    act(() => {
      result.current.toggleMasterPlay()
    })

    expect(setActive).toHaveBeenCalledWith({ vocals: true, drums: true })
  })

  it('preserves an explicitly muted stem across a stopped -> playing transition', () => {
    const setActive = vi.fn()
    const params = buildParams({
      active: { vocals: true, drums: false },
      masterPlaying: false,
      setActive
    })
    const { result } = renderHook(() => useAudioContextEngine(params))

    act(() => {
      result.current.toggleMasterPlay()
    })

    expect(setActive).toHaveBeenCalledWith({ vocals: true, drums: false })
  })

  it('defaults only the stems with no prior entry, leaving existing entries untouched', () => {
    const setActive = vi.fn()
    const params = buildParams({
      allStems: ['/song/vocals.wav', '/song/drums.wav', '/song/bass.wav'],
      urls: {
        vocals: 'http://127.0.0.1:1234/vocals.wav',
        drums: 'http://127.0.0.1:1234/drums.wav',
        bass: 'http://127.0.0.1:1234/bass.wav'
      },
      // 'bass' has never been touched (e.g. just added); vocals/drums have explicit state.
      active: { vocals: false, drums: true },
      masterPlaying: false,
      setActive
    })
    const { result } = renderHook(() => useAudioContextEngine(params))

    act(() => {
      result.current.toggleMasterPlay()
    })

    expect(setActive).toHaveBeenCalledWith({ vocals: false, drums: true, bass: true })
  })
})

describe('useAudioContextEngine - handleRestart respects trimStart', () => {
  beforeEach(() => {
    vi.stubGlobal('AudioContext', FakeAudioContext)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(16) }))
    )
  })

  it('seeks to 0 when no trim is set (unchanged default behavior)', () => {
    const positionRef = { current: 42 }
    const params = buildParams({ positionRef, masterPlaying: false })
    const { result } = renderHook(() => useAudioContextEngine(params))

    act(() => {
      result.current.handleRestart()
    })

    expect(positionRef.current).toBe(0)
  })

  it('seeks to trimStart instead of 0 when a trim start is set', () => {
    const positionRef = { current: 42 }
    const params = buildParams({ positionRef, trimStart: 17.5, masterPlaying: false })
    const { result } = renderHook(() => useAudioContextEngine(params))

    act(() => {
      result.current.handleRestart()
    })

    expect(positionRef.current).toBe(17.5)
  })
})

describe('useAudioContextEngine - master mix pan', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(16) }))
    )
  })

  afterEach(() => {
    window.localStorage.clear()
  })

  it('defaults masterPan to 0', () => {
    vi.stubGlobal('AudioContext', FakeAudioContext)
    const { result } = renderHook(() => useAudioContextEngine(buildParams()))
    expect(result.current.masterPan).toBe(0)
  })

  it('creates the master pan node between masterGain and destination, and updates its value on setMasterPan', () => {
    // ensureCtx creates the master pan node first (before any per-stem
    // ensureNodes calls), so the first StereoPannerNode created after
    // starting playback is reliably the master one.
    const panNodes: { pan: { value: number }; connect: ReturnType<typeof vi.fn> }[] = []
    const gainNodes: { connect: ReturnType<typeof vi.fn> }[] = []
    class TrackingAudioContext extends FakeAudioContext {
      createStereoPanner(): { pan: { value: number }; connect: ReturnType<typeof vi.fn> } {
        const node = { pan: { value: 0 }, connect: vi.fn() }
        panNodes.push(node)
        return node
      }
      createGain(): { connect: ReturnType<typeof vi.fn>; gain: unknown } {
        const node = {
          connect: vi.fn(),
          gain: { setValueAtTime: vi.fn(), setTargetAtTime: vi.fn() }
        }
        gainNodes.push(node)
        return node
      }
    }
    vi.stubGlobal('AudioContext', TrackingAudioContext)

    const { result } = renderHook(() => useAudioContextEngine(buildParams()))

    act(() => {
      result.current.toggleMasterPlay()
    })

    expect(panNodes.length).toBeGreaterThan(0)
    const masterPanNode = panNodes[0]
    const masterGainNode = gainNodes[0]
    expect(masterGainNode.connect).toHaveBeenCalledWith(masterPanNode)
    expect(masterPanNode.connect).toHaveBeenCalledWith(expect.anything())

    act(() => {
      result.current.setMasterPan(0.5)
    })

    expect(result.current.masterPan).toBe(0.5)
    expect(masterPanNode.pan.value).toBe(0.5)
    expect(window.localStorage.getItem('velody:masterPan')).toBe('0.5')
  })
})

describe('useAudioContextEngine - stem url resolution', () => {
  afterEach(() => {
    delete (window as { api?: VelodyAPI }).api
  })

  it('resolves all stem urls concurrently, not sequentially', async () => {
    const getAudioUrl = vi.fn(
      () =>
        new Promise<string>(() => {
          /* never resolves — proves every call fired without waiting on the previous one */
        })
    )
    window.api = { getAudioUrl } as unknown as VelodyAPI

    const params = buildParams({
      allStems: ['/song/vocals.wav', '/song/drums.wav', '/song/bass.wav']
    })
    renderHook(() => useAudioContextEngine(params))

    await waitFor(() => expect(getAudioUrl).toHaveBeenCalledTimes(3))
  })

  it('keeps successfully resolved stem urls when another stem fails to resolve', async () => {
    const getAudioUrl = vi.fn((filePath: string) =>
      filePath.includes('drums')
        ? Promise.reject(new Error('boom'))
        : Promise.resolve(`http://127.0.0.1:1234${filePath}`)
    )
    window.api = { getAudioUrl } as unknown as VelodyAPI
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const setUrls = vi.fn()
    const params = buildParams({
      setUrls,
      allStems: ['/song/vocals.wav', '/song/drums.wav']
    })
    renderHook(() => useAudioContextEngine(params))

    await waitFor(() => expect(setUrls).toHaveBeenCalled())
    expect(setUrls).toHaveBeenCalledWith({ vocals: 'http://127.0.0.1:1234/song/vocals.wav' })

    errorSpy.mockRestore()
  })
})

// Regression coverage for fix-count-in-handoff-precision: toggleMasterPlay
// accepts an optional `when` (this engine's own AudioContext.currentTime
// scale) to pre-schedule the song's actual first sample at an exact future
// instant, instead of always starting "as soon as possible" reactively
// once a count-in is detected to have finished.
describe('useAudioContextEngine - pre-scheduled playback (count-in handoff)', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(16) }))
    )
  })

  it('starts sources at the given future `when` instead of immediately', async () => {
    const createdSources: TrackedSource[] = []
    stubTrackingAudioContext(createdSources)

    const notifyStemDecodedRef = { current: vi.fn() }
    const params = buildParams({ notifyStemDecodedRef, masterPlaying: false })
    const { result } = renderHook(() => useAudioContextEngine(params))

    await waitFor(() => expect(notifyStemDecodedRef.current).toHaveBeenCalledTimes(2))

    act(() => {
      result.current.toggleMasterPlay(5.0)
    })

    expect(createdSources).toHaveLength(2)
    for (const src of createdSources) {
      expect(src.start).toHaveBeenCalledWith(5.0, 0)
    }
  })

  it('starts sources immediately (start(0, ...)) when no `when` is given', async () => {
    const createdSources: TrackedSource[] = []
    stubTrackingAudioContext(createdSources)

    const notifyStemDecodedRef = { current: vi.fn() }
    const params = buildParams({ notifyStemDecodedRef, masterPlaying: false })
    const { result } = renderHook(() => useAudioContextEngine(params))

    await waitFor(() => expect(notifyStemDecodedRef.current).toHaveBeenCalledTimes(2))

    act(() => {
      result.current.toggleMasterPlay()
    })

    for (const src of createdSources) {
      expect(src.start).toHaveBeenCalledWith(0, 0)
    }
  })

  it('marks playback as pending while a future `when` hasn’t arrived yet, and not pending for an immediate start', async () => {
    stubTrackingAudioContext([])
    const notifyStemDecodedRef = { current: vi.fn() }

    // Future `when` -> pending.
    const playbackPendingRef = { current: false }
    const params = buildParams({ notifyStemDecodedRef, masterPlaying: false, playbackPendingRef })
    const { result } = renderHook(() => useAudioContextEngine(params))
    await waitFor(() => expect(notifyStemDecodedRef.current).toHaveBeenCalledTimes(2))

    act(() => {
      result.current.toggleMasterPlay(5.0)
    })
    expect(playbackPendingRef.current).toBe(true)
  })

  it('does not mark playback as pending for an immediate (no `when`) start', async () => {
    stubTrackingAudioContext([])
    const notifyStemDecodedRef = { current: vi.fn() }
    const playbackPendingRef = { current: true } // starts true to prove it gets cleared
    const params = buildParams({ notifyStemDecodedRef, masterPlaying: false, playbackPendingRef })
    const { result } = renderHook(() => useAudioContextEngine(params))
    await waitFor(() => expect(notifyStemDecodedRef.current).toHaveBeenCalledTimes(2))

    act(() => {
      result.current.toggleMasterPlay()
    })
    expect(playbackPendingRef.current).toBe(false)
  })

  it('does not mark playback as pending when `when` is not actually in the future', async () => {
    stubTrackingAudioContext([])
    const notifyStemDecodedRef = { current: vi.fn() }
    const playbackPendingRef = { current: true }
    const params = buildParams({ notifyStemDecodedRef, masterPlaying: false, playbackPendingRef })
    const { result } = renderHook(() => useAudioContextEngine(params))
    await waitFor(() => expect(notifyStemDecodedRef.current).toHaveBeenCalledTimes(2))

    act(() => {
      // FakeAudioContext.currentTime is 0 — a `when` of 0 is "now", not future.
      result.current.toggleMasterPlay(0)
    })
    expect(playbackPendingRef.current).toBe(false)
  })
})

describe('useAudioContextEngine - practice speed + transpose', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(16) }))
    )
    for (const fn of Object.values(shifterNode)) fn.mockClear()
  })

  async function startPlaying(
    createdSources: TrackedSource[],
    overrides: Partial<Parameters<typeof useAudioContextEngine>[0]> = {}
  ): Promise<{
    result: { current: ReturnType<typeof useAudioContextEngine> }
    rerender: (p: Parameters<typeof useAudioContextEngine>[0]) => void
    params: Parameters<typeof useAudioContextEngine>[0]
  }> {
    stubTrackingAudioContext(createdSources)
    const notifyStemDecodedRef = { current: vi.fn() }
    const params = buildParams({ notifyStemDecodedRef, masterPlaying: false, ...overrides })
    const { result, rerender } = renderHook((p) => useAudioContextEngine(p), {
      initialProps: params
    })
    await waitFor(() => expect(notifyStemDecodedRef.current).toHaveBeenCalledTimes(2))
    act(() => {
      result.current.toggleMasterPlay()
    })
    return { result, rerender, params }
  }

  it('starts every source at the practice speed and advances position at that rate', async () => {
    const createdSources: TrackedSource[] = []
    const { result } = await startPlaying(createdSources, { speed: 0.5 })

    expect(createdSources).toHaveLength(2)
    for (const src of createdSources) expect(src.playbackRate.value).toBe(0.5)

    const ctx = result.current.audioCtxRef.current as unknown as { currentTime: number }
    ctx.currentTime = 4
    expect(result.current.getLivePosition()).toBeCloseTo(2, 5)
    expect(result.current.getRate()).toBe(0.5)
  })

  it('changing speed mid-play re-anchors the clock and switches all sources together', async () => {
    const createdSources: TrackedSource[] = []
    const { result, rerender, params } = await startPlaying(createdSources)
    const ctx = result.current.audioCtxRef.current as unknown as { currentTime: number }

    ctx.currentTime = 10 // 10s of song played at 1x
    act(() => {
      rerender({ ...params, masterPlaying: true, speed: 0.8 })
    })
    for (const src of createdSources) {
      expect(src.playbackRate.setValueAtTime).toHaveBeenCalledWith(0.8, 10)
    }
    ctx.currentTime = 15 // 5 more real seconds at 0.8x -> 4 song seconds
    expect(result.current.getLivePosition()).toBeCloseTo(14, 5)
  })

  it('inserts the pitch shifter only when needed and reports its latency as output delay', async () => {
    const createdSources: TrackedSource[] = []
    const { result } = await startPlaying(createdSources, { semitones: -2 })

    await waitFor(() => expect(result.current.getOutputDelay()).toBeCloseTo(0.15, 5))
    expect(shifterNode.schedule).toHaveBeenCalledWith({ semitones: -2 })
    expect(shifterNode.connect).toHaveBeenCalled()
  })

  it('compensates the pitch change introduced by slowing down', async () => {
    const createdSources: TrackedSource[] = []
    await startPlaying(createdSources, { speed: 0.5 })
    // playbackRate 0.5 drops pitch an octave; the shifter raises it back.
    await waitFor(() => expect(shifterNode.schedule).toHaveBeenCalledWith({ semitones: 12 }))
  })

  it('keeps the shifter bypassed at normal speed and pitch', async () => {
    const createdSources: TrackedSource[] = []
    const { result } = await startPlaying(createdSources)
    await Promise.resolve()
    expect(shifterNode.schedule).not.toHaveBeenCalled()
    expect(result.current.getOutputDelay()).toBe(0)
  })
})
