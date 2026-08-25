// A "Live Preset" captures exactly the state that resets every time a song
// is reopened but shouldn't have to be redone by hand before a show — which
// stems are muted, their volume/pan, whether the metronome click is on,
// and the master volume. Deliberately excludes BPM, trim points, and
// playback count-in bars: those are already independently persisted per
// song (not per performance context) via their own existing mechanisms
// (useSongAnalysis, useTrim, useSongCountIn) — duplicating them here would
// just create two competing places writing the same .velody keys. See
// openspec/changes/add-live-presets.

export interface LivePreset {
  id: string
  name: string
  active: Record<string, boolean>
  stemVolumes: Record<string, number>
  stemPannings: Record<string, number>
  metronomeOn: boolean
  masterVolume: number
  updatedAt: number
}

export type LivePresetSnapshot = Omit<LivePreset, 'id' | 'name' | 'updatedAt'>

// Saving under a name that already exists updates that preset in place
// (same id, refreshed values/timestamp) instead of creating a duplicate —
// lets the user re-save e.g. "Acoustic Set" after tweaking the mix without
// piling up near-identical presets under slightly different names.
export function upsertLivePreset(
  presets: LivePreset[],
  name: string,
  snapshot: LivePresetSnapshot,
  now: number,
  makeId: () => string
): { presets: LivePreset[]; id: string } {
  const existing = presets.find((p) => p.name === name)
  const id = existing?.id ?? makeId()
  const updated: LivePreset = { id, name, ...snapshot, updatedAt: now }
  const nextPresets = existing
    ? presets.map((p) => (p.id === id ? updated : p))
    : [...presets, updated]
  return { presets: nextPresets, id }
}

export function removeLivePreset(presets: LivePreset[], id: string): LivePreset[] {
  return presets.filter((p) => p.id !== id)
}

export function renameLivePreset(
  presets: LivePreset[],
  id: string,
  name: string,
  now: number
): LivePreset[] {
  return presets.map((p) => (p.id === id ? { ...p, name, updatedAt: now } : p))
}
