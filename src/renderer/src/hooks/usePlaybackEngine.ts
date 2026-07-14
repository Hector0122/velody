import { useEffect, useLayoutEffect, useCallback, useRef } from 'react'
import type WaveSurfer from 'wavesurfer.js'
import {
  stemNameFromPath,
  PROGRESS_THROTTLE_MS,
  CURSOR_THROTTLE_MS,
  DRIFT_THRESHOLD,
  DRIFT_CORRECTION_INTERVAL_MS
} from '../utils'

interface UsePlaybackEngineParams {
  audioEls: React.MutableRefObject<Record<string, HTMLAudioElement>>
  audioCtxRef: React.MutableRefObject<AudioContext | null>
  positionRef: React.MutableRefObject<number>
  activeRef: React.MutableRefObject<Record<string, boolean>>
  stemsRef: React.MutableRefObject<string[]>
  lastSeekRef: React.MutableRefObject<number>
  masterPlayingRef: React.MutableRefObject<boolean>
  playbackRateRef: React.MutableRefObject<number>
  durationRef: React.MutableRefObject<number>
  onAudioTimeRef: React.MutableRefObject<(time: number) => void>

  setProgress: (v: number | ((prev: number) => number)) => void
  masterPlaying: boolean
  setMasterPlaying: (v: boolean | ((prev: boolean) => boolean)) => void
  masterVolume: number
  setMasterVolume: (v: number | ((prev: number) => number)) => void
  active: Record<string, boolean>
  setActive: (
    v: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>)
  ) => void
  solo: Record<string, boolean>
  setSolo: (
    v: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>)
  ) => void
  urls: Record<string, string>
  setUrls: (
    v: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>)
  ) => void
  stemVolumes: Record<string, number>
  setStemVolumes: (
    v: Record<string, number> | ((prev: Record<string, number>) => Record<string, number>)
  ) => void
  setStemPannings: (
    v: Record<string, number> | ((prev: Record<string, number>) => Record<string, number>)
  ) => void

  allStems: string[]
  bpmRef: React.MutableRefObject<number>
  originalBpmRef: React.MutableRefObject<number>
  loopEnabled: boolean
  loopStart: number | null
  loopEnd: number | null
  lastScheduledBeatRef: React.MutableRefObject<number>
  setRecordedStems: (v: string[] | ((prev: string[]) => string[])) => void
  masterWaveDuration: number
  duration: number

  ensureWaveSurfer: (key: string) => WaveSurfer | undefined
  ensureAudioContext: () => AudioContext | null
  setupAllPanning: () => void
  setupPanningForKey: (key: string) => void
  panNodesRef: React.MutableRefObject<
    Record<string, { source: MediaElementAudioSourceNode; panner: StereoPannerNode }>
  >
  stemWaves: React.MutableRefObject<Record<string, WaveSurfer>>
  waveUrlsRef: React.MutableRefObject<Record<string, string>>
  disconnectPanner: (key: string) => void
  disconnectAllPanners: () => void
  syncStemCursors: (time: number, dur: number) => void
  mediaStreamRef: React.MutableRefObject<MediaStream | null>
}

export function usePlaybackEngine(params: UsePlaybackEngineParams): {
  toggleStem: (key: string) => void
  toggleMasterPlay: () => void
  handleRestart: () => void
  toggleSolo: (key: string) => void
  handleDeleteRecording: (path: string) => Promise<void>
  handleMasterVolume: (e: React.ChangeEvent<HTMLInputElement>) => void
  handleStemVolume: (key: string, value: number) => void
  handleStemPanning: (key: string, value: number) => void
} {
  const {
    audioEls,
    audioCtxRef,
    positionRef,
    activeRef,
    stemsRef,
    lastSeekRef,
    masterPlayingRef,
    playbackRateRef,
    durationRef,
    onAudioTimeRef,
    setProgress,
    masterPlaying,
    setMasterPlaying,
    masterVolume,
    setMasterVolume,
    active,
    setActive,
    solo,
    setSolo,
    urls,
    setUrls,
    stemVolumes,
    setStemVolumes,
    setStemPannings,
    allStems,
    bpmRef,
    originalBpmRef,
    loopEnabled,
    loopStart,
    loopEnd,
    lastScheduledBeatRef,
    setRecordedStems,
    masterWaveDuration,
    duration,
    ensureWaveSurfer,
    ensureAudioContext,
    setupAllPanning,
    setupPanningForKey,
    panNodesRef,
    stemWaves,
    waveUrlsRef,
    disconnectPanner,
    disconnectAllPanners,
    syncStemCursors,
    mediaStreamRef
  } = params

  // Sync shared refs to state
  useLayoutEffect(() => {
    stemsRef.current = allStems
    activeRef.current = active
    masterPlayingRef.current = masterPlaying
    playbackRateRef.current = masterPlaying ? bpmRef.current / originalBpmRef.current : 1
    durationRef.current = masterWaveDuration || duration
  })

  // Load audio URLs (use shifted paths if transposed)
  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      if (!window.api) return
      const result: Record<string, string> = {}
      for (const stem of allStems) {
        const key = stemNameFromPath(stem)
        result[key] = await window.api.getAudioUrl(stem)
      }
      if (!cancelled) setUrls(result)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [allStems]) // eslint-disable-line react-hooks/exhaustive-deps

  // Assign audio src once URLs are ready
  useEffect(() => {
    for (const [key, el] of Object.entries(audioEls.current)) {
      if (urls[key] && el.src !== urls[key]) {
        el.src = urls[key]
      }
    }
  }, [urls, audioEls])

  // Compute volume: solo overrides active (only soloed stem is heard)
  const computeVolume = useCallback(
    (key: string): number => {
      if (!masterPlaying) return 0
      if (!activeRef.current[key]) return 0
      const stemVol = stemVolumes[key] ?? 1
      const soloed = Object.keys(solo).find((k) => solo[k])
      if (soloed) return soloed === key ? stemVol * masterVolume : 0
      return stemVol * masterVolume
    },
    [masterPlaying, solo, masterVolume, stemVolumes, activeRef]
  )

  const applyVolume = useCallback(
    (key: string): void => {
      const el = audioEls.current[key]
      if (el) el.volume = computeVolume(key)
    },
    [computeVolume, audioEls]
  )

  const applyAllVolumes = useCallback((): void => {
    for (const key of Object.keys(audioEls.current)) applyVolume(key)
  }, [applyVolume, audioEls])

  // Apply volumes reactively
  useEffect(() => {
    applyAllVolumes()
  }, [masterPlaying, active, solo, masterVolume, applyAllVolumes])

  // Always play at original speed; no real-time BPM change
  useEffect(() => {
    for (const el of Object.values(audioEls.current)) {
      el.playbackRate = 1
    }
  })

  // Clean up unused audio elements on stem change
  useEffect(() => {
    const validKeys = new Set(allStems.map(stemNameFromPath))
    for (const key of Object.keys(audioEls.current)) {
      if (!validKeys.has(key)) {
        const el = audioEls.current[key]
        if (el) {
          el.pause()
          el.src = ''
        }
        delete audioEls.current[key]
      }
    }
  }, [allStems, audioEls])

  // Close AudioContext on unmount
  useEffect(() => {
    return () => {
      disconnectAllPanners()
      audioCtxRef.current?.close()
      audioCtxRef.current = null
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop())
        mediaStreamRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Audio timeupdate → update counter + WaveSurfer cursors
  const lastCursorSyncRef = useRef(0)
  const onAudioTime = useCallback(
    (time: number): void => {
      positionRef.current = time

      if (loopEnabled && loopStart !== null && loopEnd !== null && time >= loopEnd) {
        const seekTime = loopStart
        lastScheduledBeatRef.current = -1
        positionRef.current = seekTime
        for (const el of Object.values(audioEls.current)) {
          el.currentTime = seekTime
        }
        setProgress(seekTime)
        return
      }

      const now = Date.now()
      if (now - lastCursorSyncRef.current >= CURSOR_THROTTLE_MS) {
        lastCursorSyncRef.current = now
        const d = durationRef.current || duration || 1
        syncStemCursors(time, d)
      }

      if (now - lastSeekRef.current < PROGRESS_THROTTLE_MS) return
      lastSeekRef.current = now
      setProgress(time)
    },
    [
      duration,
      loopEnabled,
      loopStart,
      loopEnd,
      syncStemCursors,
      audioEls,
      durationRef,
      lastSeekRef,
      lastScheduledBeatRef,
      positionRef,
      setProgress
    ]
  )

  useLayoutEffect(() => {
    onAudioTimeRef.current = onAudioTime
  })

  // Drift correction: periodically check if audio elements are in sync
  useEffect(() => {
    if (!masterPlaying) return
    const id = window.setInterval(() => {
      const els = Object.values(audioEls.current)
      if (els.length < 2) return
      const ref = els[0]
      if (!ref || ref.paused) return
      const refTime = ref.currentTime
      for (let i = 1; i < els.length; i++) {
        const el = els[i]
        if (!el || el.paused) continue
        const drift = el.currentTime - refTime
        if (Math.abs(drift) > DRIFT_THRESHOLD) {
          el.currentTime = refTime
        }
      }
    }, DRIFT_CORRECTION_INTERVAL_MS)
    return () => clearInterval(id)
  }, [masterPlaying, audioEls])

  // Toggle stem active
  const toggleStem = useCallback(
    (key: string): void => {
      const el = audioEls.current[key]
      if (!el) return

      const isActive = !!activeRef.current[key]

      if (!masterPlaying) {
        if (isActive) return
        lastScheduledBeatRef.current = -1
        ensureAudioContext()
        setupAllPanning()
        ensureWaveSurfer(key)
        setActive({ [key]: true })
        for (const k of Object.keys(audioEls.current)) {
          const e = audioEls.current[k]
          if (e) {
            e.currentTime = positionRef.current
            e.play()
          }
        }
        setMasterPlaying(true)
      } else {
        setActive((prev) => ({ ...prev, [key]: !prev[key] }))
      }
    },

    [
      masterPlaying,
      ensureWaveSurfer,
      audioEls,
      positionRef,
      setMasterPlaying,
      setActive,
      lastScheduledBeatRef,
      activeRef,
      ensureAudioContext,
      setupAllPanning
    ]
  )

  // Master play: enable all / Master stop: disable all
  const toggleMasterPlay = useCallback((): void => {
    if (masterPlaying) {
      for (const el of Object.values(audioEls.current)) el.pause()
      setActive({})
      setMasterPlaying(false)
    } else {
      lastScheduledBeatRef.current = -1
      ensureAudioContext()
      setupAllPanning()
      const all: Record<string, boolean> = {}
      for (const path of stemsRef.current) {
        const key = stemNameFromPath(path)
        all[key] = true
        ensureWaveSurfer(key)
      }
      setActive(all)
      for (const key of Object.keys(audioEls.current)) {
        const el = audioEls.current[key]
        if (el) {
          el.volume = masterVolume
          el.currentTime = positionRef.current
          el.play()
        }
      }
      setMasterPlaying(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ensureAudioContext/setupAllPanning/ensureWaveSurfer recreated frequently
  }, [
    masterPlaying,
    ensureWaveSurfer,
    audioEls,
    positionRef,
    setMasterPlaying,
    setActive,
    lastScheduledBeatRef,
    stemsRef,
    ensureAudioContext,
    setupAllPanning
  ])

  const handleRestart = useCallback((): void => {
    lastScheduledBeatRef.current = -1
    positionRef.current = 0
    setProgress(0)
    for (const el of Object.values(audioEls.current)) {
      el.currentTime = 0
    }
    for (const sw of Object.values(stemWaves.current)) {
      sw.seekTo(0)
    }
  }, [stemWaves, audioEls, positionRef, setProgress, lastScheduledBeatRef])

  const toggleSolo = useCallback(
    (key: string): void => {
      setSolo((prev) => {
        if (prev[key]) return {}
        return { [key]: true }
      })
    },
    [setSolo]
  )

  const handleDeleteRecording = useCallback(
    async (path: string): Promise<void> => {
      const key = stemNameFromPath(path)
      const el = audioEls.current[key]
      if (el) {
        el.pause()
        el.src = ''
        el.onerror = null
        delete audioEls.current[key]
      }
      if (stemWaves.current[key]) {
        stemWaves.current[key].destroy()
        delete stemWaves.current[key]
        delete waveUrlsRef.current[key]
      }
      disconnectPanner(key)
      setRecordedStems((prev) => prev.filter((p) => p !== path))
      setActive((prev) => {
        const next = { ...prev }
        delete next[key]
        return next
      })
      if (window.api) {
        window.api.deleteFile(path)
      }
    },
    [disconnectPanner, stemWaves, waveUrlsRef, audioEls, setRecordedStems, setActive]
  )

  const handleMasterVolume = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>): void => {
      setMasterVolume(parseFloat(e.target.value))
    },
    [setMasterVolume]
  )

  const handleStemVolume = useCallback(
    (key: string, value: number): void => {
      setStemVolumes((prev) => ({ ...prev, [key]: value }))
    },
    [setStemVolumes]
  )

  const handleStemPanning = useCallback(
    (key: string, value: number): void => {
      setStemPannings((prev) => ({ ...prev, [key]: value }))
      if (!panNodesRef.current[key]) {
        ensureAudioContext()
        setupPanningForKey(key)
      }
    },
    [ensureAudioContext, setupPanningForKey, panNodesRef, setStemPannings]
  )

  return {
    toggleStem,
    toggleMasterPlay,
    handleRestart,
    toggleSolo,
    handleDeleteRecording,
    handleMasterVolume,
    handleStemVolume,
    handleStemPanning
  }
}
