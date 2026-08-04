// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useAudioContextEngine } from '../hooks/useAudioContextEngine'

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
    return { connect: vi.fn(), pan: { value: 0 } }
  }
  createBufferSource(): unknown {
    return { connect: vi.fn(), start: vi.fn(), stop: vi.fn() }
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
    masterWaveDuration: 0,
    duration: 0,
    positionRef: { current: 0 },
    masterPlayingRef: { current: false },
    durationRef: { current: 0 },
    onAudioTimeRef: { current: () => {} },
    lastScheduledBeatRef: { current: -1 },
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
}

function stubTrackingAudioContext(createdSources: TrackedSource[]): void {
  class TrackingAudioContext extends FakeAudioContext {
    createBufferSource(): TrackedSource {
      const src: TrackedSource = { connect: vi.fn(), start: vi.fn(), stop: vi.fn() }
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

  it('starts a live source even for a stem that begins inactive (muted)', async () => {
    const createdSources: TrackedSource[] = []
    stubTrackingAudioContext(createdSources)

    const notifyStemDecodedRef = { current: vi.fn() }
    const params = buildParams({ notifyStemDecodedRef, active: {}, masterPlaying: false })
    const { result } = renderHook(() => useAudioContextEngine(params))

    await waitFor(() => {
      expect(notifyStemDecodedRef.current).toHaveBeenCalledTimes(2)
    })

    act(() => {
      // Starts playback with only 'vocals' active; 'drums' stays inactive (muted).
      result.current.toggleStem('vocals')
    })

    // Both stems get a live source — the inactive one just starts at gain 0,
    // it is not skipped, so a later un-mute only needs to ramp its gain.
    expect(createdSources).toHaveLength(2)
    for (const src of createdSources) {
      expect(src.start).toHaveBeenCalledTimes(1)
    }
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
