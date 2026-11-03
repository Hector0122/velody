import { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react'
import { normalizeDownbeatShift } from './downbeat'
import { songDirFromStemPath } from '../utils'

interface UseDownbeatShiftReturn {
  downbeatShift: number
  setDownbeatShift: (shift: number) => void
  // Read by the metronome scheduler on every tick (see useMetronome).
  downbeatShiftRef: React.MutableRefObject<number>
}

// Per-song "which beat is the 1" (see downbeat.ts), saved in the song's
// .velody sidecar like the playback count-in (useSongCountIn).
export default function useDownbeatShift(stems: string[]): UseDownbeatShiftReturn {
  const [downbeatShift, setShift] = useState(0)
  const downbeatShiftRef = useRef(0)
  const loadedRef = useRef(false)
  const songDirRef = useRef('')

  useLayoutEffect(() => {
    downbeatShiftRef.current = downbeatShift
  })

  useEffect(() => {
    if (loadedRef.current || stems.length === 0) return
    loadedRef.current = true
    const songDir = songDirFromStemPath(stems[0])
    songDirRef.current = songDir
    ;(async (): Promise<void> => {
      if (!window.api) return
      const cached = (await window.api.loadMeta(songDir)) as { downbeatShift?: number } | null
      if (cached && typeof cached.downbeatShift === 'number') {
        setShift(normalizeDownbeatShift(cached.downbeatShift))
      }
    })()
  }, [stems])

  const setDownbeatShift = useCallback((shift: number): void => {
    const next = normalizeDownbeatShift(shift)
    // Update the ref immediately so already-playing clicks pick it up on the
    // very next scheduler tick, not after React re-renders.
    downbeatShiftRef.current = next
    setShift(next)
    if (window.api && songDirRef.current) {
      window.api.saveMeta(songDirRef.current, { downbeatShift: next })
    }
  }, [])

  return { downbeatShift, setDownbeatShift, downbeatShiftRef }
}
