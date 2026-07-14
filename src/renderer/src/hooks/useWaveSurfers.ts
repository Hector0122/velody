import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import WaveSurfer from 'wavesurfer.js'
import {
  STEM_WAVEFORM_HEIGHT,
  MASTER_WAVEFORM_HEIGHT,
  MASTER_MIN_PX_PER_SEC,
  updateTimeDisplays,
  updateCursors
} from '../utils'

interface StemItem {
  key: string
  meta: { color: string; label: string }
}

interface UseWaveSurfersParams {
  stemItems: StemItem[]
  urls: Record<string, string>
  seekRef: React.MutableRefObject<(time: number) => void>
  durationRef: React.MutableRefObject<number>
  positionRef: React.MutableRefObject<number>
  lastScheduledBeatRef: React.MutableRefObject<number>
  progressRef: React.MutableRefObject<number>
  onMasterDblClick?: (time: number) => void
}

interface UseWaveSurfersReturn {
  stemWaves: React.MutableRefObject<Record<string, WaveSurfer>>
  waveUrlsRef: React.MutableRefObject<Record<string, string>>
  masterWaveContainer: React.MutableRefObject<HTMLDivElement | null>
  masterWaveDuration: number
  duration: number
  ensureWaveSurfer: (key: string) => WaveSurfer | undefined
  seekMasterFraction: (fraction: number) => void
}

export function useWaveSurfers({
  stemItems,
  urls,
  seekRef,
  durationRef,
  positionRef,
  lastScheduledBeatRef,
  progressRef,
  onMasterDblClick
}: UseWaveSurfersParams): UseWaveSurfersReturn {
  const stemWaves = useRef<Record<string, WaveSurfer>>({})
  const waveUrlsRef = useRef<Record<string, string>>({})
  const masterWaveContainer = useRef<HTMLDivElement | null>(null)
  const masterWaveRef = useRef<WaveSurfer | null>(null)
  const masterWaveReady = useRef(false)
  const [masterWaveDuration, setMasterWaveDuration] = useState(0)
  const [duration, setDuration] = useState(0)

  useEffect(() => {
    const validKeys = new Set(stemItems.map((s) => s.key))
    for (const [key, ws] of Object.entries(stemWaves.current)) {
      if (!validKeys.has(key)) {
        ws.destroy()
        delete stemWaves.current[key]
        delete waveUrlsRef.current[key]
      }
    }
  }, [stemItems])

  const ensureWaveSurfer = useCallback(
    (key: string): WaveSurfer | undefined => {
      if (stemWaves.current[key]) return stemWaves.current[key]

      const container = document.querySelector(
        `[data-stem-container="${key}"]`
      ) as HTMLDivElement | null
      if (!container) return undefined

      const item = stemItems.find((s) => s.key === key)
      const color = item?.meta.color ?? '#6b7280'

      const ws = WaveSurfer.create({
        container,
        waveColor: color + '30',
        progressColor: color,
        cursorColor: 'transparent',
        barWidth: 1,
        barGap: 0,
        height: STEM_WAVEFORM_HEIGHT,
        normalize: true,
        interact: false
      })

      stemWaves.current[key] = ws

      const url = urls[key]
      if (url) {
        ws.load(url)
        waveUrlsRef.current[key] = url
      }

      return ws
    },
    [urls, stemItems]
  )

  useEffect(() => {
    for (const [key] of Object.entries(stemWaves.current)) {
      const ws = stemWaves.current[key]
      const url = urls[key]
      if (ws && url && waveUrlsRef.current[key] !== url) {
        ws.load(url)
        waveUrlsRef.current[key] = url
      }
    }
  }, [urls])

  const masterUrl = useMemo(() => {
    const firstKey = Object.keys(urls)[0]
    return firstKey ? urls[firstKey] : null
  }, [urls])

  useEffect(() => {
    if (!masterUrl || !masterWaveContainer.current) return

    if (masterWaveRef.current) {
      masterWaveRef.current.destroy()
      masterWaveRef.current = null
    }
    masterWaveReady.current = false

    const ws = WaveSurfer.create({
      container: masterWaveContainer.current,
      waveColor: '#555',
      progressColor: '#f97316',
      cursorColor: '#f97316',
      cursorWidth: 2,
      barWidth: 2,
      barGap: 1,
      height: MASTER_WAVEFORM_HEIGHT,
      normalize: true,
      interact: true,
      minPxPerSec: MASTER_MIN_PX_PER_SEC
    })
    ws.load(masterUrl)

    ws.on('ready', () => {
      masterWaveReady.current = true
      setMasterWaveDuration(ws.getDuration())
      setDuration(ws.getDuration())
    })

    ws.on('click', (relativeX: number) => {
      const d = masterWaveReady.current ? ws.getDuration() : durationRef.current
      const clickTime = relativeX * d
      lastScheduledBeatRef.current = -1
      positionRef.current = clickTime
      seekRef.current(clickTime)
      for (const sw of Object.values(stemWaves.current)) {
        sw.seekTo(clickTime / d)
      }
      progressRef.current = clickTime
      updateTimeDisplays(clickTime)
      updateCursors(clickTime, d)
    })

    ws.on('dblclick', (relativeX: number) => {
      const d = ws.getDuration()
      const clickTime = relativeX * d
      onMasterDblClick?.(clickTime)
    })

    masterWaveRef.current = ws

    return () => {
      ws.destroy()
      masterWaveRef.current = null
      masterWaveReady.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [masterUrl])

  const seekMasterFraction = useCallback((fraction: number): void => {
    if (masterWaveReady.current) {
      masterWaveRef.current?.seekTo(fraction)
    }
  }, [])

  return {
    stemWaves,
    waveUrlsRef,
    masterWaveContainer,
    masterWaveDuration,
    duration,
    ensureWaveSurfer,
    seekMasterFraction
  }
}
