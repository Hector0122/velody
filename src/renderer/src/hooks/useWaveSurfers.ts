import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import WaveSurfer from 'wavesurfer.js'
import {
  STEM_WAVEFORM_HEIGHT,
  MASTER_WAVEFORM_HEIGHT,
  MASTER_MIN_PX_PER_SEC,
  updateTimeDisplays,
  updateCursors
} from '../utils'
import { RESET_SCHEDULED_BEAT } from './useMetronome'

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
  // Written by useAudioContextEngine (mirrors the seekRef pattern) so waveform
  // creation/loading can reuse an already-decoded buffer instead of independently
  // fetching and decoding the same audio a second time.
  getDecodedBufferRef: React.MutableRefObject<(key: string) => AudioBuffer | undefined>
}

interface UseWaveSurfersReturn {
  stemWaves: React.MutableRefObject<Record<string, WaveSurfer>>
  waveUrlsRef: React.MutableRefObject<Record<string, string>>
  masterWaveContainer: React.MutableRefObject<HTMLDivElement | null>
  masterWaveDuration: number
  duration: number
  ensureWaveSurfer: (key: string) => WaveSurfer | undefined
  seekMasterFraction: (fraction: number) => void
  // Called by useAudioContextEngine (via notifyStemDecodedRef) once a stem's
  // buffer finishes decoding (or fails to), so any waveform that was created
  // before the buffer was ready can load its audio.
  handleStemDecoded: (key: string) => void
}

/** Hand WaveSurfer an already-decoded buffer's channel data so it skips its own
 * fetch + decode (see design.md - Decisions) while still computing its own peaks. */
function loadDecodedStem(ws: WaveSurfer, url: string, buffer: AudioBuffer): void {
  const channelData: Float32Array[] = []
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    channelData.push(buffer.getChannelData(ch))
  }
  ws.load(url, channelData, buffer.duration)
}

export function useWaveSurfers({
  stemItems,
  urls,
  seekRef,
  durationRef,
  positionRef,
  lastScheduledBeatRef,
  progressRef,
  onMasterDblClick,
  getDecodedBufferRef
}: UseWaveSurfersParams): UseWaveSurfersReturn {
  const stemWaves = useRef<Record<string, WaveSurfer>>({})
  const waveUrlsRef = useRef<Record<string, string>>({})
  // Keys whose WaveSurfer instance exists but is waiting on the engine's decode
  // (see decision in design.md - Risks/Trade-offs: race between ensureWaveSurfer
  // and decodeStems completing).
  const pendingRef = useRef<Set<string>>(new Set())
  const masterWaveContainer = useRef<HTMLDivElement | null>(null)
  const masterWaveRef = useRef<WaveSurfer | null>(null)
  const masterWaveReady = useRef(false)
  const masterPendingRef = useRef(false)
  const [masterWaveDuration, setMasterWaveDuration] = useState(0)
  const [duration, setDuration] = useState(0)

  useEffect(() => {
    const validKeys = new Set(stemItems.map((s) => s.key))
    for (const [key, ws] of Object.entries(stemWaves.current)) {
      if (!validKeys.has(key)) {
        ws.destroy()
        delete stemWaves.current[key]
        delete waveUrlsRef.current[key]
        pendingRef.current.delete(key)
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
        const buffer = getDecodedBufferRef.current(key)
        if (buffer) {
          loadDecodedStem(ws, url, buffer)
          waveUrlsRef.current[key] = url
        } else {
          // Not decoded yet — handleStemDecoded will load it once the engine
          // finishes (or falls back to an independent load if decode failed).
          pendingRef.current.add(key)
        }
      }

      return ws
    },
    [urls, stemItems, getDecodedBufferRef]
  )

  useEffect(() => {
    for (const [key, ws] of Object.entries(stemWaves.current)) {
      const url = urls[key]
      if (!ws || !url) continue
      if (waveUrlsRef.current[key] === url) continue
      if (pendingRef.current.has(key)) continue // handleStemDecoded will load it

      // A url change for an already-loaded key (e.g. a fresh recording) means
      // new audio content for this stem; the engine's decoded buffer for this
      // key may be stale relative to the new url (decodeStems never re-decodes
      // a key it has already decoded once), so fetch and decode independently
      // here rather than risk a mismatched waveform.
      ws.load(url)
      waveUrlsRef.current[key] = url
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

    const masterKey = Object.keys(urls)[0]
    const masterBuffer = masterKey ? getDecodedBufferRef.current(masterKey) : undefined
    if (masterBuffer) {
      loadDecodedStem(ws, masterUrl, masterBuffer)
      masterPendingRef.current = false
    } else {
      // Not decoded yet — handleStemDecoded reloads with the decoded buffer
      // once the engine finishes (falling back to this independent load's
      // result if decode failed).
      ws.load(masterUrl)
      masterPendingRef.current = true
    }

    ws.on('ready', () => {
      masterWaveReady.current = true
      setMasterWaveDuration(ws.getDuration())
      setDuration(ws.getDuration())
    })

    ws.on('click', (relativeX: number) => {
      const d = masterWaveReady.current ? ws.getDuration() : durationRef.current
      const clickTime = relativeX * d
      lastScheduledBeatRef.current = RESET_SCHEDULED_BEAT
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

  const handleStemDecoded = useCallback(
    (key: string): void => {
      if (pendingRef.current.has(key)) {
        const ws = stemWaves.current[key]
        const url = urls[key]
        if (ws && url) {
          const buffer = getDecodedBufferRef.current(key)
          if (buffer) {
            loadDecodedStem(ws, url, buffer)
          } else {
            // Engine decode failed for this key — fall back to WaveSurfer's own
            // independent fetch+decode so the waveform still appears instead of
            // staying blank forever.
            ws.load(url)
          }
          waveUrlsRef.current[key] = url
          pendingRef.current.delete(key)
        }
      }

      if (masterPendingRef.current && masterWaveRef.current && masterUrl) {
        const masterKey = Object.keys(urls)[0]
        if (key === masterKey) {
          const buffer = getDecodedBufferRef.current(key)
          if (buffer) {
            loadDecodedStem(masterWaveRef.current, masterUrl, buffer)
          }
          // On decode failure the master waveform already has its fallback
          // `ws.load(masterUrl)` result from the creation effect above.
          masterPendingRef.current = false
        }
      }
    },
    [urls, masterUrl, getDecodedBufferRef]
  )

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
    seekMasterFraction,
    handleStemDecoded
  }
}
