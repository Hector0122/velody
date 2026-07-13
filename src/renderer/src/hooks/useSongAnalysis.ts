import { useEffect, useRef } from 'react'

const CACHE_VERSION = 11
export { CACHE_VERSION }

export default function useSongAnalysis(
  urls: Record<string, string>,
  stems: string[],
  setBpm: (bpm: number) => void,
  setDetectedKey: (key: string) => void,
  firstBeatOffsetRef: React.MutableRefObject<number>
): React.MutableRefObject<number> {
  const originalBpmRef = useRef(120)

  useEffect(() => {
    const allUrls = Object.values(urls)
    if (allUrls.length === 0 || stems.length === 0) return
    const songDir = stems[0].replace(/[/\\][^/\\]+$/, '')

    const runKeyDetection = (bpmVal: number): void => {
      if (window.api) {
        window.api.detectKey(songDir, stems).then((key) => {
          if (key) {
            setDetectedKey(key)
            window.api.saveMeta(songDir, { bpm: bpmVal, key, _version: CACHE_VERSION })
          }
        })
      }
    }

    ;(async (): Promise<void> => {
      if (!window.api) return

      const cached = (await window.api.loadMeta(songDir)) as {
        bpm?: number
        key?: string
        firstBeatOffset?: number
        _version?: number
      } | null
      if (cached && cached.bpm && cached._version === CACHE_VERSION) {
        originalBpmRef.current = cached.bpm
        firstBeatOffsetRef.current = cached.firstBeatOffset ?? 0
        setBpm(cached.bpm)
        if (cached.key) setDetectedKey(cached.key)
        runKeyDetection(cached.bpm)
        return
      }

      try {
        const firstStem = stems[0]
        const result = await window.api.detectBpm(firstStem)
        const finalBpm = result?.bpm ?? 120
        const offset = result?.firstBeatOffset ?? 0
        originalBpmRef.current = finalBpm
        firstBeatOffsetRef.current = offset
        setBpm(finalBpm)
        runKeyDetection(finalBpm)
      } catch {
        /* detection failed */
      }
    })()
  }, [urls, stems, setBpm, setDetectedKey, firstBeatOffsetRef])

  return originalBpmRef
}
