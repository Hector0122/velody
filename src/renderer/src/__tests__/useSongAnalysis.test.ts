// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import useSongAnalysis, { CACHE_VERSION } from '../hooks/useSongAnalysis'
import type { VelodyAPI } from '../../../shared/types'

function stubApi(overrides: Partial<VelodyAPI> = {}): VelodyAPI {
  const api = {
    loadMeta: vi.fn(async () => null),
    saveMeta: vi.fn(async () => ({ success: true })),
    detectBpm: vi.fn(async () => ({ bpm: 128, firstBeatOffset: 0.42 })),
    ...overrides
  } as unknown as VelodyAPI
  window.api = api
  return api
}

describe('useSongAnalysis - cached first-beat offset', () => {
  afterEach(() => {
    delete (window as { api?: VelodyAPI }).api
  })

  it('caches both bpm and firstBeatOffset on a fresh detection', async () => {
    const api = stubApi()
    const setBpm = vi.fn()
    const firstBeatOffsetRef = { current: 0 }

    renderHook(() =>
      useSongAnalysis(
        { vocals: 'http://127.0.0.1:1234/vocals.wav' },
        ['/song/vocals.wav'],
        setBpm,
        firstBeatOffsetRef
      )
    )

    await waitFor(() => expect(setBpm).toHaveBeenCalledWith(128))
    expect(firstBeatOffsetRef.current).toBe(0.42)
    expect(api.saveMeta).toHaveBeenCalledWith('/song', {
      bpm: 128,
      firstBeatOffset: 0.42,
      _version: CACHE_VERSION
    })
  })

  it('reuses the cached firstBeatOffset instead of resetting it to 0', async () => {
    stubApi({
      loadMeta: vi.fn(async () => ({ bpm: 95, firstBeatOffset: 1.23, _version: CACHE_VERSION })),
      detectBpm: vi.fn(async () => {
        throw new Error('should not be called — cache should be used')
      })
    })
    const setBpm = vi.fn()
    const firstBeatOffsetRef = { current: 0 }

    renderHook(() =>
      useSongAnalysis(
        { vocals: 'http://127.0.0.1:1234/vocals.wav' },
        ['/song/vocals.wav'],
        setBpm,
        firstBeatOffsetRef
      )
    )

    await waitFor(() => expect(setBpm).toHaveBeenCalledWith(95))
    expect(firstBeatOffsetRef.current).toBe(1.23)
  })

  it('re-detects instead of reusing a cache from an older version without an offset', async () => {
    const api = stubApi({
      // Old-shaped cache: only bpm + a stale _version, no firstBeatOffset.
      loadMeta: vi.fn(async () => ({ bpm: 100, _version: CACHE_VERSION - 1 })),
      detectBpm: vi.fn(async () => ({ bpm: 130, firstBeatOffset: 0.55 }))
    })
    const setBpm = vi.fn()
    const firstBeatOffsetRef = { current: 0 }

    renderHook(() =>
      useSongAnalysis(
        { vocals: 'http://127.0.0.1:1234/vocals.wav' },
        ['/song/vocals.wav'],
        setBpm,
        firstBeatOffsetRef
      )
    )

    await waitFor(() => expect(api.detectBpm).toHaveBeenCalled())
    expect(setBpm).toHaveBeenCalledWith(130)
    expect(firstBeatOffsetRef.current).toBe(0.55)
  })
})
