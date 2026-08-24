// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import useSongCountIn from '../hooks/useSongCountIn'
import type { VelodyAPI } from '../../../shared/types'

function stubApi(overrides: Partial<VelodyAPI> = {}): VelodyAPI {
  const api = {
    loadMeta: vi.fn(async () => null),
    saveMeta: vi.fn(async () => ({ success: true })),
    ...overrides
  } as unknown as VelodyAPI
  window.api = api
  return api
}

describe('useSongCountIn', () => {
  afterEach(() => {
    delete (window as { api?: VelodyAPI }).api
  })

  it('defaults to 0 (off) when no cache exists', async () => {
    stubApi()
    const { result } = renderHook(() => useSongCountIn(['/song/vocals.wav']))

    await waitFor(() => {
      expect(result.current.playbackCountInBars).toBe(0)
    })
  })

  it('loads a previously saved value from .velody', async () => {
    stubApi({ loadMeta: vi.fn(async () => ({ playbackCountInBars: 2 })) })
    const { result } = renderHook(() => useSongCountIn(['/song/vocals.wav']))

    await waitFor(() => {
      expect(result.current.playbackCountInBars).toBe(2)
    })
  })

  it('setting a value updates state and persists to the song dir', async () => {
    const api = stubApi()
    const { result } = renderHook(() => useSongCountIn(['/song/vocals.wav']))
    await waitFor(() => expect(result.current.playbackCountInBars).toBe(0))

    act(() => {
      result.current.setPlaybackCountInBars(1)
    })

    expect(result.current.playbackCountInBars).toBe(1)
    expect(api.saveMeta).toHaveBeenCalledWith('/song', { playbackCountInBars: 1 })
  })
})
