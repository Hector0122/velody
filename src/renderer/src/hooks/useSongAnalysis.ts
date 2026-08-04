import { useEffect, useRef } from 'react'

// Bumped from 16: older caches never stored firstBeatOffset, so they must be
// treated as stale rather than silently reused with an incorrect offset.
const CACHE_VERSION = 17
export { CACHE_VERSION }

export interface SongAnalysis {
  originalBpmRef: React.MutableRefObject<number>
  firstBeatOffsetRef: React.MutableRefObject<number>
}

export default function useSongAnalysis(
  urls: Record<string, string>,
  stems: string[],
  setBpm: (bpm: number) => void,
  firstBeatOffsetRef: React.MutableRefObject<number>
): SongAnalysis {
  const originalBpmRef = useRef(120)
  const detectedRef = useRef(false)

  useEffect(() => {
    if (detectedRef.current) return
    const allUrls = Object.values(urls)
    if (allUrls.length === 0 || stems.length === 0) return

    detectedRef.current = true
    ;(async (): Promise<void> => {
      if (!window.api) return

      const songDir = stems[0].replace(/[/\\][^/\\]+$/, '')
      const cached = (await window.api.loadMeta(songDir)) as {
        bpm?: number
        firstBeatOffset?: number
        _version?: number
      } | null
      if (
        cached &&
        cached.bpm &&
        typeof cached.firstBeatOffset === 'number' &&
        cached._version === CACHE_VERSION
      ) {
        originalBpmRef.current = cached.bpm
        firstBeatOffsetRef.current = cached.firstBeatOffset
        setBpm(cached.bpm)
        return
      }

      try {
        const firstStem = stems[0]
        const result = await window.api.detectBpm(firstStem)
        if (result) {
          originalBpmRef.current = result.bpm
          firstBeatOffsetRef.current = result.firstBeatOffset
          setBpm(result.bpm)
          window.api.saveMeta(songDir, {
            bpm: result.bpm,
            firstBeatOffset: result.firstBeatOffset,
            _version: CACHE_VERSION
          })
        }
      } catch {
        /* detection failed — do NOT cache fallback */
      }
    })()
  }, [urls, stems, setBpm, firstBeatOffsetRef])

  return { originalBpmRef, firstBeatOffsetRef }
}
