// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useRef } from 'react'

// Mock the wavesurfer.js module entirely: these tests exercise how the hook
// calls WaveSurfer's API (does it pass channelData/duration or a bare url?),
// not WaveSurfer's own internal fetch/decode behavior (already confirmed by
// reading node_modules/wavesurfer.js/dist/wavesurfer.js — see design.md).
interface FakeWaveSurfer {
  load: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
  seekTo: ReturnType<typeof vi.fn>
  getDuration: ReturnType<typeof vi.fn>
}

const createMock = vi.fn<() => FakeWaveSurfer>()
vi.mock('wavesurfer.js', () => ({
  default: {
    create: (...args: unknown[]) => (createMock as (...a: unknown[]) => FakeWaveSurfer)(...args)
  }
}))

function makeFakeWs(): FakeWaveSurfer {
  return {
    load: vi.fn(),
    on: vi.fn(),
    destroy: vi.fn(),
    seekTo: vi.fn(),
    getDuration: vi.fn(() => 0)
  }
}

function makeFakeAudioBuffer(): AudioBuffer {
  return {
    numberOfChannels: 2,
    duration: 3.5,
    getChannelData: () => new Float32Array(8)
  } as unknown as AudioBuffer
}

// Import after the mock is registered.
import { useWaveSurfers } from '../hooks/useWaveSurfers'

function renderUseWaveSurfers(
  overrides: Partial<Parameters<typeof useWaveSurfers>[0]> = {}
): ReturnType<typeof renderHook<ReturnType<typeof useWaveSurfers>, unknown>> {
  return renderHook(() => {
    const seekRef = useRef<(time: number) => void>(() => {})
    const durationRef = useRef(0)
    const positionRef = useRef(0)
    const lastScheduledBeatRef = useRef(-1)
    const progressRef = useRef(0)
    const getDecodedBufferRef = useRef<(key: string) => AudioBuffer | undefined>(() => undefined)
    return useWaveSurfers({
      stemItems: [{ key: 'vocals', meta: { color: '#111', label: 'Vocals' } }],
      urls: { vocals: 'http://127.0.0.1:1234/vocals.wav' },
      seekRef,
      durationRef,
      positionRef,
      lastScheduledBeatRef,
      progressRef,
      getDecodedBufferRef,
      ...overrides
    })
  })
}

describe('useWaveSurfers - decoded buffer reuse', () => {
  beforeEach(() => {
    createMock.mockReset()
    createMock.mockImplementation(() => makeFakeWs())
    document.body.innerHTML = '<div data-stem-container="vocals"></div>'
  })

  it('loads with channelData/duration when a decoded buffer is already available', () => {
    const buffer = makeFakeAudioBuffer()
    const getDecodedBufferRef = {
      current: (key: string) => (key === 'vocals' ? buffer : undefined)
    }

    const { result } = renderUseWaveSurfers({ getDecodedBufferRef })

    let ws: FakeWaveSurfer | undefined
    act(() => {
      ws = result.current.ensureWaveSurfer('vocals') as unknown as FakeWaveSurfer
    })

    expect(ws).toBeDefined()
    expect(ws!.load).toHaveBeenCalledTimes(1)
    // channelData + duration passed (not a bare url) — this is what lets
    // WaveSurfer skip its own fetch+decode (see loadAudio() in wavesurfer.js).
    const [, channelData, duration] = ws!.load.mock.calls[0]
    expect(channelData).toHaveLength(2)
    expect(duration).toBe(3.5)
  })

  it('defers loading (does not call ws.load) when no decoded buffer is available yet', () => {
    const getDecodedBufferRef = { current: () => undefined }

    const { result } = renderUseWaveSurfers({ getDecodedBufferRef })

    let ws: FakeWaveSurfer | undefined
    act(() => {
      ws = result.current.ensureWaveSurfer('vocals') as unknown as FakeWaveSurfer
    })

    expect(ws).toBeDefined()
    expect(ws!.load).not.toHaveBeenCalled()
  })

  it('loads the pending waveform once handleStemDecoded fires with a ready buffer', () => {
    const buffer = makeFakeAudioBuffer()
    let decoded = false
    const getDecodedBufferRef = {
      current: (key: string) => (decoded && key === 'vocals' ? buffer : undefined)
    }

    const { result } = renderUseWaveSurfers({ getDecodedBufferRef })

    let ws: FakeWaveSurfer | undefined
    act(() => {
      ws = result.current.ensureWaveSurfer('vocals') as unknown as FakeWaveSurfer
    })
    expect(ws!.load).not.toHaveBeenCalled()

    // Decoding completes in the engine; it notifies via handleStemDecoded.
    decoded = true
    act(() => {
      result.current.handleStemDecoded('vocals')
    })

    expect(ws!.load).toHaveBeenCalledTimes(1)
    const [, channelData, duration] = ws!.load.mock.calls[0]
    expect(channelData).toHaveLength(2)
    expect(duration).toBe(3.5)
  })

  it('falls back to an independent url load when decode failed for a pending stem', () => {
    // getDecodedBufferRef never resolves a buffer for this key — simulates a
    // decode failure in the engine (see decodeStems's try/catch/finally).
    const getDecodedBufferRef = { current: () => undefined }

    const { result } = renderUseWaveSurfers({ getDecodedBufferRef })

    let ws: FakeWaveSurfer | undefined
    act(() => {
      ws = result.current.ensureWaveSurfer('vocals') as unknown as FakeWaveSurfer
    })
    expect(ws!.load).not.toHaveBeenCalled()

    act(() => {
      result.current.handleStemDecoded('vocals')
    })

    // Fallback path: bare url, no channelData/duration.
    expect(ws!.load).toHaveBeenCalledTimes(1)
    expect(ws!.load).toHaveBeenCalledWith('http://127.0.0.1:1234/vocals.wav')
  })
})
