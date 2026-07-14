import { useEffect, useRef } from 'react'

const CACHE_VERSION = 15
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

  useEffect(() => {
    const allUrls = Object.values(urls)
    if (allUrls.length === 0 || stems.length === 0) return
    ;(async (): Promise<void> => {
      if (!window.api) return

      const songDir = stems[0].replace(/[/\\][^/\\]+$/, '')
      const cached = (await window.api.loadMeta(songDir)) as {
        bpm?: number
        _version?: number
      } | null
      if (cached && cached.bpm && cached._version === CACHE_VERSION) {
        originalBpmRef.current = cached.bpm
        firstBeatOffsetRef.current = 0
        setBpm(cached.bpm)
        return
      }

      try {
        const firstStem = stems[0]
        const result = await window.api.detectBpm(firstStem)
        const finalBpm = result?.bpm ?? 120
        firstBeatOffsetRef.current = result?.firstBeatOffset ?? 0
        originalBpmRef.current = finalBpm
        setBpm(finalBpm)
        window.api.saveMeta(songDir, { bpm: finalBpm, _version: CACHE_VERSION })
      } catch {
        /* detection failed */
      }
    })()
  }, [urls, stems, setBpm, firstBeatOffsetRef])

  return { originalBpmRef, firstBeatOffsetRef }
}
