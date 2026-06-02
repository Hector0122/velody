import { useEffect, useRef } from 'react'
import { DEFAULT_SAMPLE_RATE } from '../utils'

const CACHE_VERSION = 9
export { CACHE_VERSION }

export default function useSongAnalysis(
  urls: Record<string, string>,
  stems: string[],
  setBpm: (bpm: number) => void,
  setDetectedKey: (key: string) => void
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
      if (window.api) {
        const cached = (await window.api.loadMeta(songDir)) as {
          bpm?: number
          key?: string
          _version?: number
        } | null
        if (cached && cached.bpm && cached._version === CACHE_VERSION) {
          originalBpmRef.current = cached.bpm
          setBpm(cached.bpm)
          if (cached.key) setDetectedKey(cached.key)
          runKeyDetection(cached.bpm)
          return
        }
      }
      try {
        const bufferMap: Record<string, Float32Array> = {}
        let sampleRate = DEFAULT_SAMPLE_RATE
        let maxLen = 0
        for (const [, url] of Object.entries(urls)) {
          const resp = await fetch(url)
          const buf = await resp.arrayBuffer()
          const offlineCtx = new OfflineAudioContext(1, 1, DEFAULT_SAMPLE_RATE)
          const decoded = await offlineCtx.decodeAudioData(buf)
          const ch = decoded.getChannelData(0)
          sampleRate = decoded.sampleRate
          if (ch.length > maxLen) maxLen = ch.length
          bufferMap[url] = ch
        }

        const mixed = new Float32Array(maxLen)
        for (const ch of Object.values(bufferMap)) {
          for (let i = 0; i < ch.length; i++) mixed[i] += ch[i]
        }
        let peak = 0
        for (let i = 0; i < mixed.length; i++) {
          const a = Math.abs(mixed[i])
          if (a > peak) peak = a
        }
        if (peak > 1) for (let i = 0; i < mixed.length; i++) mixed[i] /= peak

        const worker = new Worker(new URL('../workers/bpm.worker.ts', import.meta.url), {
          type: 'module'
        })

        const bpmVal = await new Promise<number>((resolveBpm) => {
          worker.onmessage = (e: MessageEvent<{ bpm: number }>) => {
            resolveBpm(e.data.bpm)
            worker.terminate()
          }
          worker.onerror = () => {
            resolveBpm(120)
            worker.terminate()
          }
          worker.postMessage({ mixed, sampleRate }, [mixed.buffer])
        })

        originalBpmRef.current = bpmVal
        setBpm(bpmVal)
        runKeyDetection(bpmVal)
      } catch {
        /* detection failed */
      }
    })()
  }, [urls, stems, setBpm, setDetectedKey])

  return originalBpmRef
}
