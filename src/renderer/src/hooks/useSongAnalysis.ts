import { useEffect, useRef } from 'react'

// Bumped from 17: older caches never stored the detected beat-time grid, so
// they must be treated as stale rather than silently falling back to
// constant-tempo scheduling for songs whose grid was already detected once.
const CACHE_VERSION = 18
export { CACHE_VERSION }

export interface SongAnalysis {
  originalBpmRef: React.MutableRefObject<number>
  firstBeatOffsetRef: React.MutableRefObject<number>
  beatTimesRef: React.MutableRefObject<number[]>
}

export default function useSongAnalysis(
  urls: Record<string, string>,
  stems: string[],
  setBpm: (bpm: number) => void,
  firstBeatOffsetRef: React.MutableRefObject<number>
): SongAnalysis {
  const originalBpmRef = useRef(120)
  const beatTimesRef = useRef<number[]>([])
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
        beatTimes?: number[]
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
        beatTimesRef.current = Array.isArray(cached.beatTimes) ? cached.beatTimes : []
        setBpm(cached.bpm)
        return
      }

      try {
        const firstStem = stems[0]
        const result = await window.api.detectBpm(firstStem)
        if (result) {
          originalBpmRef.current = result.bpm
          firstBeatOffsetRef.current = result.firstBeatOffset
          beatTimesRef.current = result.beatTimes
          setBpm(result.bpm)
          window.api.saveMeta(songDir, {
            bpm: result.bpm,
            firstBeatOffset: result.firstBeatOffset,
            beatTimes: result.beatTimes,
            _version: CACHE_VERSION
          })
        }
      } catch {
        /* detection failed — do NOT cache fallback */
      }
    })()
  }, [urls, stems, setBpm, firstBeatOffsetRef])

  return { originalBpmRef, firstBeatOffsetRef, beatTimesRef }
}
