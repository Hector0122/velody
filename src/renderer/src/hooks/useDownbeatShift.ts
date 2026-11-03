import { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react'
import { normalizeDownbeatShift } from './downbeat'
import { songDirFromStemPath } from '../utils'

interface UseDownbeatShiftReturn {
  downbeatShift: number
  // Manual choice ("This is the 1" / ◀ ▶) — saved per song, always wins.
  setDownbeatShift: (shift: number) => void
  // Automatic estimate from beat detection (detect_bpm.py → downbeat.py).
  // Used only while the user hasn't set one manually.
  applyDetectedDownbeat: (shift: number) => void
  // Forget the manual choice (e.g. after a tempo-octave correction rebuilt
  // the beat grid, which makes the old index meaningless).
  clearManualDownbeat: () => void
  // Read by the metronome scheduler on every tick (see useMetronome).
  downbeatShiftRef: React.MutableRefObject<number>
}

// Per-song "which beat is the 1" (see downbeat.ts). The manual value lives in
// the song's .velody sidecar as `downbeatShift`; the detected one comes from
// the analysis cache (useSongAnalysis).
export default function useDownbeatShift(stems: string[]): UseDownbeatShiftReturn {
  const [downbeatShift, setShift] = useState(0)
  const downbeatShiftRef = useRef(0)
  const songDirRef = useRef('')
  const loadedRef = useRef(false) // sidecar read finished
  const manualRef = useRef(false) // user has a saved manual choice
  const detectedRef = useRef<number | null>(null)

  useLayoutEffect(() => {
    downbeatShiftRef.current = downbeatShift
  })

  const show = useCallback((shift: number): void => {
    // Ref first so an already-playing metronome picks it up on its next tick.
    downbeatShiftRef.current = shift
    setShift(shift)
  }, [])

  useEffect(() => {
    if (songDirRef.current || stems.length === 0) return
    const songDir = songDirFromStemPath(stems[0])
    songDirRef.current = songDir
    ;(async (): Promise<void> => {
      const cached = window.api
        ? ((await window.api.loadMeta(songDir)) as { downbeatShift?: number | null } | null)
        : null
      loadedRef.current = true
      if (typeof cached?.downbeatShift === 'number') {
        manualRef.current = true
        show(normalizeDownbeatShift(cached.downbeatShift))
      } else if (detectedRef.current !== null) {
        show(detectedRef.current)
      }
    })()
  }, [stems, show])

  const setDownbeatShift = useCallback(
    (shift: number): void => {
      const next = normalizeDownbeatShift(shift)
      manualRef.current = true
      show(next)
      if (window.api && songDirRef.current) {
        window.api.saveMeta(songDirRef.current, { downbeatShift: next })
      }
    },
    [show]
  )

  const applyDetectedDownbeat = useCallback(
    (shift: number): void => {
      detectedRef.current = normalizeDownbeatShift(shift)
      if (loadedRef.current && !manualRef.current) show(detectedRef.current)
    },
    [show]
  )

  const clearManualDownbeat = useCallback((): void => {
    manualRef.current = false
    if (window.api && songDirRef.current) {
      window.api.saveMeta(songDirRef.current, { downbeatShift: null })
    }
    show(detectedRef.current ?? 0)
  }, [show])

  return {
    downbeatShift,
    setDownbeatShift,
    applyDetectedDownbeat,
    clearManualDownbeat,
    downbeatShiftRef
  }
}
