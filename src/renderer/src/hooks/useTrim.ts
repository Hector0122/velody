import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react'

interface UseTrimReturn {
  trimStart: number
  trimEnd: number | null
  handleSetTrimStart: (time: number) => void
  // Returns false (and does not save) when `time` is earlier than the
  // current trim start — callers surface a toast on false.
  handleSetTrimEnd: (time: number) => boolean
  handleClearTrim: () => void
}

// Persists a song's trim range (playback start/end) in its .velody sidecar
// via the existing song:saveMeta/loadMeta IPC — the same generic per-song
// key-value store useSongAnalysis already uses for the BPM/key cache.
// Unlike useMarkers' loop points, this is deliberately persisted: the whole
// point is to skip a long intro once, before a show, and have it still be
// skipped the next time the song is opened (see openspec/changes/
// add-song-trim-points).
export default function useTrim(stems: string[]): UseTrimReturn {
  const [trimStart, setTrimStart] = useState(0)
  const [trimEnd, setTrimEnd] = useState<number | null>(null)
  const trimStartRef = useRef(trimStart)
  const trimEndRef = useRef(trimEnd)
  const loadedRef = useRef(false)
  const songDirRef = useRef<string>('')

  useLayoutEffect(() => {
    trimStartRef.current = trimStart
    trimEndRef.current = trimEnd
  })

  useEffect(() => {
    if (loadedRef.current) return
    if (stems.length === 0) return
    loadedRef.current = true

    const songDir = stems[0].replace(/[/\\][^/\\]+$/, '')
    songDirRef.current = songDir
    ;(async (): Promise<void> => {
      if (!window.api) return
      const cached = (await window.api.loadMeta(songDir)) as {
        trimStart?: number
        trimEnd?: number | null
      } | null
      if (cached) {
        if (typeof cached.trimStart === 'number') setTrimStart(cached.trimStart)
        if (typeof cached.trimEnd === 'number' || cached.trimEnd === null) {
          setTrimEnd(cached.trimEnd ?? null)
        }
      }
    })()
  }, [stems])

  const persist = useCallback((next: { trimStart: number; trimEnd: number | null }): void => {
    if (!window.api || !songDirRef.current) return
    window.api.saveMeta(songDirRef.current, next)
  }, [])

  const handleSetTrimStart = useCallback(
    (time: number): void => {
      setTrimStart(time)
      persist({ trimStart: time, trimEnd: trimEndRef.current })
    },
    [persist]
  )

  const handleSetTrimEnd = useCallback(
    (time: number): boolean => {
      if (time <= trimStartRef.current) return false
      setTrimEnd(time)
      persist({ trimStart: trimStartRef.current, trimEnd: time })
      return true
    },
    [persist]
  )

  const handleClearTrim = useCallback((): void => {
    setTrimStart(0)
    setTrimEnd(null)
    persist({ trimStart: 0, trimEnd: null })
  }, [persist])

  return { trimStart, trimEnd, handleSetTrimStart, handleSetTrimEnd, handleClearTrim }
}
