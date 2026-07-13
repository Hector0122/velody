import { useEffect, useLayoutEffect, useCallback } from 'react'
import type WaveSurfer from 'wavesurfer.js'
import {
  stemNameFromPath,
  PROGRESS_THROTTLE_MS,
  AUDIO_START_THRESHOLD,
  AUDIO_START_MAX_SCAN_SECS
} from '../utils'

interface UsePlaybackEngineParams {
  audioEls: React.MutableRefObject<Record<string, HTMLAudioElement>>
  audioCtxRef: React.MutableRefObject<AudioContext | null>
  positionRef: React.MutableRefObject<number>
  activeRef: React.MutableRefObject<Record<string, boolean>>
  stemsRef: React.MutableRefObject<string[]>
  lastSeekRef: React.MutableRefObject<number>
  audioStartRef: React.MutableRefObject<number | null>
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
  shiftedPaths: Record<string, string>
  bpm: number
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
    audioStartRef,
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
    shiftedPaths,
    bpm,
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
        const actualPath = shiftedPaths[key] ?? stem
        result[key] = await window.api.getAudioUrl(actualPath)
      }
      if (!cancelled) setUrls(result)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [allStems, shiftedPaths]) // eslint-disable-line react-hooks/exhaustive-deps

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

  // Apply playback rate when BPM changes or play state toggles
  useEffect(() => {
    const rate = masterPlaying ? bpm / originalBpmRef.current : 1
    for (const el of Object.values(audioEls.current)) {
      el.playbackRate = rate
    }
  }, [bpm, masterPlaying]) // eslint-disable-line react-hooks/exhaustive-deps

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

  // --- Audio start detection ---
  const detectAudioStart = useCallback(async (url: string): Promise<number> => {
    try {
      const res = await fetch(url)
      const buf = await res.arrayBuffer()
      const ctx = new AudioContext()
      const ab = await ctx.decodeAudioData(buf)
      await ctx.close()
      const ch = ab.getChannelData(0)
      const sr = ab.sampleRate
      const threshold = AUDIO_START_THRESHOLD
      const maxFrames = Math.min(ch.length, AUDIO_START_MAX_SCAN_SECS * sr)
      for (let i = 0; i < maxFrames; i++) {
        if (Math.abs(ch[i]) > threshold) {
          const t = i / sr
          return t > 0 ? t : 0
        }
      }
      return 0
    } catch {
      return 0
    }
  }, [])

  // Detect audio start when a new song loads
  useEffect(() => {
    const masterUrl = urls[Object.keys(urls)[0]]
    if (!masterUrl) return
    audioStartRef.current = null
    detectAudioStart(masterUrl).then((t) => {
      audioStartRef.current = t
    })
  }, [urls, detectAudioStart, audioStartRef])

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
  const onAudioTime = useCallback(
    (time: number): void => {
      positionRef.current = time

      if (loopEnabled && loopStart !== null && loopEnd !== null && time >= loopEnd) {
        const seekTime = loopStart
        positionRef.current = seekTime
        for (const el of Object.values(audioEls.current)) {
          el.currentTime = seekTime
        }
        setProgress(seekTime)
        return
      }

      const d = durationRef.current || duration || 1
      syncStemCursors(time, d)

      const now = Date.now()
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
      positionRef,
      setProgress
    ]
  )

  useLayoutEffect(() => {
    onAudioTimeRef.current = onAudioTime
  })

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
    positionRef.current = 0
    setProgress(0)
    for (const el of Object.values(audioEls.current)) {
      el.currentTime = 0
    }
    for (const sw of Object.values(stemWaves.current)) {
      sw.seekTo(0)
    }
  }, [stemWaves, audioEls, positionRef, setProgress])

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
