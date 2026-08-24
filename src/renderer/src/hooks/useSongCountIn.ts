import { useState, useRef, useEffect, useCallback } from 'react'

interface UseSongCountInReturn {
  playbackCountInBars: number
  setPlaybackCountInBars: (bars: number) => void
}

// Persists a song's playback count-in setting (0 = off, 1 or 2 bars) in its
// .velody sidecar via song:saveMeta/loadMeta — same mechanism and rationale
// as useTrim: set once ahead of a show, still applied on show day, unlike
// the (session-only) recording count-in in useRecording. See
// openspec/changes/add-song-count-in.
export default function useSongCountIn(stems: string[]): UseSongCountInReturn {
  const [playbackCountInBars, setBars] = useState(0)
  const loadedRef = useRef(false)
  const songDirRef = useRef<string>('')

  useEffect(() => {
    if (loadedRef.current) return
    if (stems.length === 0) return
    loadedRef.current = true

    const songDir = stems[0].replace(/[/\\][^/\\]+$/, '')
    songDirRef.current = songDir
    ;(async (): Promise<void> => {
      if (!window.api) return
      const cached = (await window.api.loadMeta(songDir)) as {
        playbackCountInBars?: number
      } | null
      if (cached && typeof cached.playbackCountInBars === 'number') {
        setBars(cached.playbackCountInBars)
      }
    })()
  }, [stems])

  const setPlaybackCountInBars = useCallback((bars: number): void => {
    setBars(bars)
    if (!window.api || !songDirRef.current) return
    window.api.saveMeta(songDirRef.current, { playbackCountInBars: bars })
  }, [])

  return { playbackCountInBars, setPlaybackCountInBars }
}
