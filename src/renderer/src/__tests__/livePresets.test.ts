import { describe, it, expect } from 'vitest'
import {
  type LivePreset,
  type LivePresetSnapshot,
  upsertLivePreset,
  removeLivePreset,
  renameLivePreset
} from '../hooks/livePresets'

const snapshot: LivePresetSnapshot = {
  active: { vocals: true, drums: false },
  stemVolumes: { vocals: 0.8 },
  stemPannings: { vocals: -0.2 },
  metronomeOn: true,
  masterVolume: 0.9
}

describe('upsertLivePreset', () => {
  it('creates a new preset when no existing preset has that name', () => {
    const { presets, id } = upsertLivePreset([], 'Acoustic Set', snapshot, 1000, () => 'id-1')

    expect(presets).toHaveLength(1)
    expect(id).toBe('id-1')
    expect(presets[0]).toEqual({ id: 'id-1', name: 'Acoustic Set', updatedAt: 1000, ...snapshot })
  })

  it('updates the existing preset in place (same id) when the name already exists', () => {
    const existing: LivePreset[] = [
      { id: 'id-1', name: 'Acoustic Set', updatedAt: 1000, ...snapshot }
    ]
    const newSnapshot: LivePresetSnapshot = { ...snapshot, masterVolume: 0.5 }

    const { presets, id } = upsertLivePreset(
      existing,
      'Acoustic Set',
      newSnapshot,
      2000,
      () => 'id-should-not-be-used'
    )

    expect(presets).toHaveLength(1)
    expect(id).toBe('id-1') // reused, not a fresh id
    expect(presets[0].masterVolume).toBe(0.5)
    expect(presets[0].updatedAt).toBe(2000)
  })

  it('does not disturb other presets when updating one by name', () => {
    const existing: LivePreset[] = [
      { id: 'id-1', name: 'Acoustic Set', updatedAt: 1000, ...snapshot },
      { id: 'id-2', name: 'Full Band', updatedAt: 1000, ...snapshot }
    ]

    const { presets } = upsertLivePreset(existing, 'Full Band', snapshot, 2000, () => 'id-3')

    expect(presets).toHaveLength(2)
    expect(presets.find((p) => p.id === 'id-1')).toEqual(existing[0])
  })

  it('appends (does not replace) when the name is different from any existing preset', () => {
    const existing: LivePreset[] = [
      { id: 'id-1', name: 'Acoustic Set', updatedAt: 1000, ...snapshot }
    ]

    const { presets, id } = upsertLivePreset(existing, 'Full Band', snapshot, 2000, () => 'id-2')

    expect(presets).toHaveLength(2)
    expect(id).toBe('id-2')
    expect(presets[0]).toEqual(existing[0])
  })
})

describe('removeLivePreset', () => {
  it('removes only the preset with the given id', () => {
    const existing: LivePreset[] = [
      { id: 'id-1', name: 'A', updatedAt: 1000, ...snapshot },
      { id: 'id-2', name: 'B', updatedAt: 1000, ...snapshot }
    ]

    expect(removeLivePreset(existing, 'id-1')).toEqual([existing[1]])
  })

  it('is a no-op (same shape) when the id does not exist', () => {
    const existing: LivePreset[] = [{ id: 'id-1', name: 'A', updatedAt: 1000, ...snapshot }]
    expect(removeLivePreset(existing, 'nonexistent')).toEqual(existing)
  })
})

describe('renameLivePreset', () => {
  it('renames only the matching preset and refreshes updatedAt', () => {
    const existing: LivePreset[] = [
      { id: 'id-1', name: 'Old Name', updatedAt: 1000, ...snapshot },
      { id: 'id-2', name: 'Untouched', updatedAt: 1000, ...snapshot }
    ]

    const result = renameLivePreset(existing, 'id-1', 'New Name', 2000)

    expect(result[0].name).toBe('New Name')
    expect(result[0].updatedAt).toBe(2000)
    expect(result[1]).toEqual(existing[1])
  })
})
