// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import useTrim from '../hooks/useTrim'
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

describe('useTrim', () => {
  afterEach(() => {
    delete (window as { api?: VelodyAPI }).api
  })

  it('defaults to trimStart 0, trimEnd null when no cache exists', async () => {
    stubApi()
    const { result } = renderHook(() => useTrim(['/song/vocals.wav']))

    await waitFor(() => {
      expect(result.current.trimStart).toBe(0)
      expect(result.current.trimEnd).toBeNull()
    })
  })

  it('loads a previously saved trim range from .velody', async () => {
    stubApi({ loadMeta: vi.fn(async () => ({ trimStart: 12.5, trimEnd: 190 })) })
    const { result } = renderHook(() => useTrim(['/song/vocals.wav']))

    await waitFor(() => {
      expect(result.current.trimStart).toBe(12.5)
      expect(result.current.trimEnd).toBe(190)
    })
  })

  it('setting trim start updates state and persists to the song dir', async () => {
    const api = stubApi()
    const { result } = renderHook(() => useTrim(['/song/vocals.wav']))
    await waitFor(() => expect(result.current.trimStart).toBe(0))

    act(() => {
      result.current.handleSetTrimStart(15)
    })

    expect(result.current.trimStart).toBe(15)
    expect(api.saveMeta).toHaveBeenCalledWith('/song', { trimStart: 15, trimEnd: null })
  })

  it('setting a valid trim end updates state and persists', async () => {
    const api = stubApi()
    const { result } = renderHook(() => useTrim(['/song/vocals.wav']))
    await waitFor(() => expect(result.current.trimStart).toBe(0))

    act(() => {
      result.current.handleSetTrimStart(10)
    })
    let accepted = false
    act(() => {
      accepted = result.current.handleSetTrimEnd(200)
    })

    expect(accepted).toBe(true)
    expect(result.current.trimEnd).toBe(200)
    expect(api.saveMeta).toHaveBeenLastCalledWith('/song', { trimStart: 10, trimEnd: 200 })
  })

  it('rejects a trim end at or before the current trim start, without saving', async () => {
    const api = stubApi()
    const { result } = renderHook(() => useTrim(['/song/vocals.wav']))
    await waitFor(() => expect(result.current.trimStart).toBe(0))

    act(() => {
      result.current.handleSetTrimStart(50)
    })
    api.saveMeta = vi.fn(async () => ({ success: true }))

    let accepted = true
    act(() => {
      accepted = result.current.handleSetTrimEnd(50)
    })
    expect(accepted).toBe(false)
    expect(result.current.trimEnd).toBeNull()

    act(() => {
      accepted = result.current.handleSetTrimEnd(10)
    })
    expect(accepted).toBe(false)
    expect(result.current.trimEnd).toBeNull()
    expect(api.saveMeta).not.toHaveBeenCalled()
  })

  it('clearing the trim range resets to defaults and persists', async () => {
    const api = stubApi({ loadMeta: vi.fn(async () => ({ trimStart: 30, trimEnd: 120 })) })
    const { result } = renderHook(() => useTrim(['/song/vocals.wav']))
    await waitFor(() => expect(result.current.trimStart).toBe(30))

    act(() => {
      result.current.handleClearTrim()
    })

    expect(result.current.trimStart).toBe(0)
    expect(result.current.trimEnd).toBeNull()
    expect(api.saveMeta).toHaveBeenLastCalledWith('/song', { trimStart: 0, trimEnd: null })
  })
})
