// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import useLivePresets from '../hooks/useLivePresets'
import type { LivePreset } from '../hooks/livePresets'
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

const preset: LivePreset = {
  id: 'preset-1',
  name: 'Acoustic Set',
  active: { vocals: true, drums: false },
  stemVolumes: { vocals: 0.8 },
  stemPannings: { vocals: -0.2 },
  metronomeOn: true,
  masterVolume: 0.9,
  updatedAt: 1000
}

function setup(overrides: Partial<Parameters<typeof useLivePresets>[0]> = {}): {
  setters: {
    setActive: ReturnType<typeof vi.fn>
    setStemVolumes: ReturnType<typeof vi.fn>
    setStemPannings: ReturnType<typeof vi.fn>
    setMetronomeOn: ReturnType<typeof vi.fn>
    setMasterVolume: ReturnType<typeof vi.fn>
  }
  result: ReturnType<typeof renderHook<ReturnType<typeof useLivePresets>, unknown>>['result']
} {
  const setters = {
    setActive: vi.fn(),
    setStemVolumes: vi.fn(),
    setStemPannings: vi.fn(),
    setMetronomeOn: vi.fn(),
    setMasterVolume: vi.fn()
  }
  const { result } = renderHook(() =>
    useLivePresets({
      stems: ['/song/vocals.wav'],
      active: {},
      stemVolumes: {},
      stemPannings: {},
      metronomeOn: false,
      masterVolume: 1,
      ...setters,
      ...overrides
    })
  )
  return { setters, result }
}

describe('useLivePresets', () => {
  afterEach(() => {
    delete (window as { api?: VelodyAPI }).api
  })

  it('starts with no presets and no active preset when nothing is cached', async () => {
    stubApi()
    const { result } = setup()

    await waitFor(() => expect(result.current.presets).toEqual([]))
    expect(result.current.activePresetId).toBeNull()
  })

  it('loads saved presets without auto-applying when there is no lastAppliedLivePresetId', async () => {
    stubApi({ loadMeta: vi.fn(async () => ({ livePresets: [preset] })) })
    const { setters, result } = setup()

    await waitFor(() => expect(result.current.presets).toEqual([preset]))
    expect(result.current.activePresetId).toBeNull()
    expect(setters.setActive).not.toHaveBeenCalled()
  })

  it('auto-applies the last-used preset on load', async () => {
    stubApi({
      loadMeta: vi.fn(async () => ({
        livePresets: [preset],
        lastAppliedLivePresetId: 'preset-1'
      }))
    })
    const { setters, result } = setup()

    await waitFor(() => expect(result.current.activePresetId).toBe('preset-1'))
    expect(setters.setActive).toHaveBeenCalledWith(preset.active)
    expect(setters.setStemVolumes).toHaveBeenCalledWith(preset.stemVolumes)
    expect(setters.setStemPannings).toHaveBeenCalledWith(preset.stemPannings)
    expect(setters.setMetronomeOn).toHaveBeenCalledWith(preset.metronomeOn)
    expect(setters.setMasterVolume).toHaveBeenCalledWith(preset.masterVolume)
  })

  it('does not auto-apply (and does not crash) when lastAppliedLivePresetId points at a preset that no longer exists', async () => {
    stubApi({
      loadMeta: vi.fn(async () => ({
        livePresets: [preset],
        lastAppliedLivePresetId: 'deleted-preset'
      }))
    })
    const { setters, result } = setup()

    await waitFor(() => expect(result.current.presets).toEqual([preset]))
    expect(result.current.activePresetId).toBeNull()
    expect(setters.setActive).not.toHaveBeenCalled()
  })

  it('handleSavePreset saves the current live values (not the initial ones) as a new preset', async () => {
    const api = stubApi()
    const { result, rerender } = renderHook(
      (props: Parameters<typeof useLivePresets>[0]) => useLivePresets(props),
      {
        initialProps: {
          stems: ['/song/vocals.wav'],
          active: { vocals: true },
          stemVolumes: {},
          stemPannings: {},
          metronomeOn: false,
          masterVolume: 1,
          setActive: vi.fn(),
          setStemVolumes: vi.fn(),
          setStemPannings: vi.fn(),
          setMetronomeOn: vi.fn(),
          setMasterVolume: vi.fn()
        }
      }
    )
    await waitFor(() => expect(result.current.presets).toEqual([]))

    // Live values change (e.g. the user muted a stem) before saving.
    rerender({
      stems: ['/song/vocals.wav'],
      active: { vocals: false },
      stemVolumes: {},
      stemPannings: {},
      metronomeOn: true,
      masterVolume: 0.7,
      setActive: vi.fn(),
      setStemVolumes: vi.fn(),
      setStemPannings: vi.fn(),
      setMetronomeOn: vi.fn(),
      setMasterVolume: vi.fn()
    })

    act(() => {
      result.current.handleSavePreset('Show Ready')
    })

    expect(result.current.presets).toHaveLength(1)
    expect(result.current.presets[0].active).toEqual({ vocals: false })
    expect(result.current.presets[0].metronomeOn).toBe(true)
    expect(result.current.presets[0].masterVolume).toBe(0.7)
    expect(result.current.activePresetId).toBe(result.current.presets[0].id)
    expect(api.saveMeta).toHaveBeenCalledWith('/song', {
      livePresets: result.current.presets,
      lastAppliedLivePresetId: result.current.presets[0].id
    })
  })

  it('handleApplyPreset applies the preset and persists it as the last-used one', async () => {
    stubApi({ loadMeta: vi.fn(async () => ({ livePresets: [preset] })) })
    const api = window.api as VelodyAPI
    const { setters, result } = setup()
    await waitFor(() => expect(result.current.presets).toEqual([preset]))

    act(() => {
      result.current.handleApplyPreset('preset-1')
    })

    expect(setters.setActive).toHaveBeenCalledWith(preset.active)
    expect(result.current.activePresetId).toBe('preset-1')
    expect(api.saveMeta).toHaveBeenCalledWith('/song', {
      livePresets: [preset],
      lastAppliedLivePresetId: 'preset-1'
    })
  })

  it('handleDeletePreset removes the preset and clears activePresetId if it was active', async () => {
    stubApi({
      loadMeta: vi.fn(async () => ({
        livePresets: [preset],
        lastAppliedLivePresetId: 'preset-1'
      }))
    })
    const api = window.api as VelodyAPI
    const { result } = setup()
    await waitFor(() => expect(result.current.activePresetId).toBe('preset-1'))

    act(() => {
      result.current.handleDeletePreset('preset-1')
    })

    expect(result.current.presets).toEqual([])
    expect(result.current.activePresetId).toBeNull()
    expect(api.saveMeta).toHaveBeenCalledWith('/song', {
      livePresets: [],
      lastAppliedLivePresetId: null
    })
  })
})
