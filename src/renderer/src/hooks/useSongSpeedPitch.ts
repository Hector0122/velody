import { useState, useRef, useEffect, useCallback } from 'react'
import { clampSemitones, clampSpeed } from './pitchShifter'
import { songDirFromStemPath } from '../utils'

interface UseSongSpeedPitchReturn {
  speed: number
  semitones: number
  setSpeed: (speed: number) => void
  setSemitones: (semitones: number) => void
}

// Per-song practice speed + transpose, saved in the .velody sidecar (like
// useSongCountIn) so a song you always practice at 80% / -2 opens that way.
export default function useSongSpeedPitch(stems: string[]): UseSongSpeedPitchReturn {
  const [speed, setSpeedState] = useState(1)
  const [semitones, setSemitonesState] = useState(0)
  const loadedRef = useRef(false)
  const songDirRef = useRef('')

  useEffect(() => {
    if (loadedRef.current || stems.length === 0) return
    loadedRef.current = true
    const songDir = songDirFromStemPath(stems[0])
    songDirRef.current = songDir
    ;(async (): Promise<void> => {
      if (!window.api) return
      const cached = (await window.api.loadMeta(songDir)) as {
        practiceSpeed?: number
        transposeSemitones?: number
      } | null
      if (typeof cached?.practiceSpeed === 'number') setSpeedState(clampSpeed(cached.practiceSpeed))
      if (typeof cached?.transposeSemitones === 'number') {
        setSemitonesState(clampSemitones(cached.transposeSemitones))
      }
    })()
  }, [stems])

  const setSpeed = useCallback((value: number): void => {
    const next = clampSpeed(value)
    setSpeedState(next)
    if (window.api && songDirRef.current) {
      window.api.saveMeta(songDirRef.current, { practiceSpeed: next })
    }
  }, [])

  const setSemitones = useCallback((value: number): void => {
    const next = clampSemitones(value)
    setSemitonesState(next)
    if (window.api && songDirRef.current) {
      window.api.saveMeta(songDirRef.current, { transposeSemitones: next })
    }
  }, [])

  return { speed, semitones, setSpeed, setSemitones }
}
