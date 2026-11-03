import { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react'
import { songDirFromStemPath } from '../utils'
import {
  type LivePreset,
  type LivePresetSnapshot,
  upsertLivePreset,
  removeLivePreset,
  renameLivePreset
} from './livePresets'

interface UseLivePresetsParams {
  stems: string[]
  active: Record<string, boolean>
  stemVolumes: Record<string, number>
  stemPannings: Record<string, number>
  metronomeOn: boolean
  masterVolume: number
  setActive: (v: Record<string, boolean>) => void
  setStemVolumes: (v: Record<string, number>) => void
  setStemPannings: (v: Record<string, number>) => void
  setMetronomeOn: (v: boolean) => void
  setMasterVolume: (v: number) => void
  // Re-apply the last-used preset when a song opens. Off while live mode is
  // hidden, so a preset nobody can see doesn't silently change the mix.
  autoApply?: boolean
}

interface UseLivePresetsReturn {
  presets: LivePreset[]
  activePresetId: string | null
  handleSavePreset: (name: string) => void
  handleApplyPreset: (id: string) => void
  handleDeletePreset: (id: string) => void
  handleRenamePreset: (id: string, name: string) => void
}

// Named, per-song "ready to play" mix snapshots — see livePresets.ts for
// exactly what's captured and why. Persisted in the song's .velody sidecar
// (same file/mechanism as BPM/trim/markers) under `livePresets` +
// `lastAppliedLivePresetId`; the latter is auto-applied on song open so a
// song with a saved preset needs zero clicks to be performance-ready
// (confirmed with the user — the alternative, always starting neutral and
// requiring an explicit pick, was considered and declined).
export default function useLivePresets({
  stems,
  active,
  stemVolumes,
  stemPannings,
  metronomeOn,
  masterVolume,
  setActive,
  setStemVolumes,
  setStemPannings,
  setMetronomeOn,
  setMasterVolume,
  autoApply = true
}: UseLivePresetsParams): UseLivePresetsReturn {
  const [presets, setPresets] = useState<LivePreset[]>([])
  const [activePresetId, setActivePresetId] = useState<string | null>(null)

  // Mirrors the current live values so handleSavePreset (a stable
  // useCallback) always reads the latest snapshot without needing every
  // one of them in its own dependency array — same pattern as
  // useAudioContextEngine's activeRef/stemVolumesRef/etc.
  const liveRef = useRef<LivePresetSnapshot>({
    active,
    stemVolumes,
    stemPannings,
    metronomeOn,
    masterVolume
  })
  useLayoutEffect(() => {
    liveRef.current = { active, stemVolumes, stemPannings, metronomeOn, masterVolume }
  })

  // Guards against reloading/reapplying on every render — only once per
  // distinct song, same rationale as useSongAnalysis's detectedRef.
  const loadedForRef = useRef<string | null>(null)

  useEffect(() => {
    if (stems.length === 0) return
    const songDir = songDirFromStemPath(stems[0])
    if (loadedForRef.current === songDir) return
    loadedForRef.current = songDir
    ;(async (): Promise<void> => {
      if (!window.api) return
      const cached = (await window.api.loadMeta(songDir)) as {
        livePresets?: LivePreset[]
        lastAppliedLivePresetId?: string
      } | null
      const loaded = Array.isArray(cached?.livePresets) ? cached.livePresets : []
      setPresets(loaded)

      const lastId = cached?.lastAppliedLivePresetId
      const toApply = autoApply && lastId ? loaded.find((p) => p.id === lastId) : undefined
      if (toApply) {
        setActive(toApply.active)
        setStemVolumes(toApply.stemVolumes)
        setStemPannings(toApply.stemPannings)
        setMetronomeOn(toApply.metronomeOn)
        setMasterVolume(toApply.masterVolume)
        setActivePresetId(toApply.id)
      } else {
        setActivePresetId(null)
      }
    })()
  }, [
    stems,
    setActive,
    setStemVolumes,
    setStemPannings,
    setMetronomeOn,
    setMasterVolume,
    autoApply
  ])

  const persist = useCallback(
    (nextPresets: LivePreset[], lastAppliedId: string | null): void => {
      if (stems.length === 0 || !window.api) return
      const songDir = songDirFromStemPath(stems[0])
      window.api.saveMeta(songDir, {
        livePresets: nextPresets,
        lastAppliedLivePresetId: lastAppliedId
      })
    },
    [stems]
  )

  const handleSavePreset = useCallback(
    (name: string): void => {
      const trimmed = name.trim()
      if (!trimmed) return
      const { presets: next, id } = upsertLivePreset(
        presets,
        trimmed,
        liveRef.current,
        Date.now(),
        () => crypto.randomUUID()
      )
      setPresets(next)
      setActivePresetId(id)
      persist(next, id)
    },
    [presets, persist]
  )

  const handleApplyPreset = useCallback(
    (id: string): void => {
      const preset = presets.find((p) => p.id === id)
      if (!preset) return
      setActive(preset.active)
      setStemVolumes(preset.stemVolumes)
      setStemPannings(preset.stemPannings)
      setMetronomeOn(preset.metronomeOn)
      setMasterVolume(preset.masterVolume)
      setActivePresetId(id)
      persist(presets, id)
    },
    [presets, persist, setActive, setStemVolumes, setStemPannings, setMetronomeOn, setMasterVolume]
  )

  const handleDeletePreset = useCallback(
    (id: string): void => {
      const next = removeLivePreset(presets, id)
      setPresets(next)
      const nextActiveId = activePresetId === id ? null : activePresetId
      setActivePresetId(nextActiveId)
      persist(next, nextActiveId)
    },
    [presets, activePresetId, persist]
  )

  const handleRenamePreset = useCallback(
    (id: string, name: string): void => {
      const trimmed = name.trim()
      if (!trimmed) return
      const next = renameLivePreset(presets, id, trimmed, Date.now())
      setPresets(next)
      persist(next, activePresetId)
    },
    [presets, activePresetId, persist]
  )

  return {
    presets,
    activePresetId,
    handleSavePreset,
    handleApplyPreset,
    handleDeletePreset,
    handleRenamePreset
  }
}
