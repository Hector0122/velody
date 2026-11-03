// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import useDownbeatShift from '../hooks/useDownbeatShift'
import type { VelodyAPI } from '../../../shared/types'

function stubApi(meta: Record<string, unknown> | null): { saveMeta: ReturnType<typeof vi.fn> } {
  const saveMeta = vi.fn(async () => ({ success: true }))
  window.api = { loadMeta: vi.fn(async () => meta), saveMeta } as unknown as VelodyAPI
  return { saveMeta }
}

const stems = ['/lib/song/drums.mp3']

describe('useDownbeatShift', () => {
  it('uses the detected downbeat when the user has not chosen one', async () => {
    stubApi({})
    const { result } = renderHook(() => useDownbeatShift(stems))
    act(() => result.current.applyDetectedDownbeat(2))
    await waitFor(() => expect(result.current.downbeatShift).toBe(2))
    expect(result.current.downbeatShiftRef.current).toBe(2)
  })

  it('applies a detection that arrives before the sidecar finished loading', async () => {
    stubApi({})
    const { result } = renderHook(() => useDownbeatShift(stems))
    act(() => result.current.applyDetectedDownbeat(3)) // sidecar load still pending
    await waitFor(() => expect(result.current.downbeatShift).toBe(3))
  })

  it("never overrides the user's saved manual choice", async () => {
    stubApi({ downbeatShift: 1 })
    const { result } = renderHook(() => useDownbeatShift(stems))
    await waitFor(() => expect(result.current.downbeatShift).toBe(1))
    act(() => result.current.applyDetectedDownbeat(3))
    expect(result.current.downbeatShift).toBe(1)
  })

  it('a manual choice is saved and wins over later detections', async () => {
    const { saveMeta } = stubApi({})
    const { result } = renderHook(() => useDownbeatShift(stems))
    await waitFor(() => expect(window.api.loadMeta).toHaveBeenCalled())
    act(() => result.current.setDownbeatShift(5)) // normalized to 1
    expect(saveMeta).toHaveBeenCalledWith('/lib/song', { downbeatShift: 1 })
    act(() => result.current.applyDetectedDownbeat(3))
    expect(result.current.downbeatShift).toBe(1)
  })

  it('clearing the manual choice falls back to the detected one and forgets it on disk', async () => {
    const { saveMeta } = stubApi({ downbeatShift: 1 })
    const { result } = renderHook(() => useDownbeatShift(stems))
    await waitFor(() => expect(result.current.downbeatShift).toBe(1))
    act(() => result.current.applyDetectedDownbeat(2))
    act(() => result.current.clearManualDownbeat())
    expect(result.current.downbeatShift).toBe(2)
    expect(saveMeta).toHaveBeenCalledWith('/lib/song', { downbeatShift: null })
  })
})
