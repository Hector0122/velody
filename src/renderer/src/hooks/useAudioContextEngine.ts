import { useEffect, useLayoutEffect, useCallback, useRef } from 'react'
import type WaveSurfer from 'wavesurfer.js'
import { stemNameFromPath } from '../utils'

interface UseAudioContextEngineParams {
  allStems: string[]
  urls: Record<string, string>
  setUrls: (
    v: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>)
  ) => void
  active: Record<string, boolean>
  solo: Record<string, boolean>
  stemVolumes: Record<string, number>
  stemPannings: Record<string, number>
  masterVolume: number
  masterPlaying: boolean
  loopEnabled: boolean
  loopStart: number | null
  loopEnd: number | null
  masterWaveDuration: number
  duration: number

  positionRef: React.MutableRefObject<number>
  masterPlayingRef: React.MutableRefObject<boolean>
  durationRef: React.MutableRefObject<number>
  onAudioTimeRef: React.MutableRefObject<(time: number) => void>
  lastScheduledBeatRef: React.MutableRefObject<number>

  progressRef: React.MutableRefObject<number>
  setMasterPlaying: (v: boolean | ((prev: boolean) => boolean)) => void
  setActive: (
    v: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>)
  ) => void
  setSolo: (
    v: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>)
  ) => void
  setMasterVolume: (v: number | ((prev: number) => number)) => void
  setStemVolumes: (
    v: Record<string, number> | ((prev: Record<string, number>) => Record<string, number>)
  ) => void
  setStemPannings: (
    v: Record<string, number> | ((prev: Record<string, number>) => Record<string, number>)
  ) => void
  setRecordedStems: (v: string[] | ((prev: string[]) => string[])) => void

  ensureWaveSurfer: (key: string) => WaveSurfer | undefined
  stemWaves: React.MutableRefObject<Record<string, WaveSurfer>>
  waveUrlsRef: React.MutableRefObject<Record<string, string>>
  mediaStreamRef: React.MutableRefObject<MediaStream | null>
  // Written by useWaveSurfers (mirrors the seekRef pattern) so decodeStems can
  // notify the waveform renderer as each stem finishes decoding, without the
  // two hooks depending on each other's return values directly.
  notifyStemDecodedRef: React.MutableRefObject<(key: string) => void>
}

export function useAudioContextEngine(params: UseAudioContextEngineParams): {
  toggleStem: (key: string) => void
  toggleMasterPlay: () => void
  handleRestart: () => void
  toggleSolo: (key: string) => void
  handleDeleteRecording: (path: string) => Promise<void>
  handleMasterVolume: (e: React.ChangeEvent<HTMLInputElement>) => void
  handleStemVolume: (key: string, value: number) => void
  handleStemPanning: (key: string, value: number) => void
  seek: (time: number) => void
  audioCtxRef: React.MutableRefObject<AudioContext | null>
  getDecodedBuffer: (key: string) => AudioBuffer | undefined
} {
  const {
    allStems,
    urls,
    setUrls,
    active,
    solo,
    stemVolumes,
    stemPannings,
    masterVolume,
    masterPlaying,
    loopEnabled,
    loopStart,
    loopEnd,
    masterWaveDuration,
    duration,
    positionRef,
    masterPlayingRef,
    durationRef,
    onAudioTimeRef,
    lastScheduledBeatRef,
    progressRef,
    setMasterPlaying,
    setActive,
    setSolo,
    setMasterVolume,
    setStemVolumes,
    setStemPannings,
    setRecordedStems,
    ensureWaveSurfer,
    stemWaves,
    waveUrlsRef,
    mediaStreamRef,
    notifyStemDecodedRef
  } = params

  const audioCtxRef = useRef<AudioContext | null>(null)
  const buffersRef = useRef<Record<string, AudioBuffer>>({})
  const gainNodesRef = useRef<Record<string, GainNode>>({})
  const panNodesRef = useRef<Record<string, StereoPannerNode>>({})
  const masterGainRef = useRef<GainNode | null>(null)
  const sourcesRef = useRef<Record<string, AudioBufferSourceNode>>({})
  const isPlayingRef = useRef(false)
  const startRef = useRef(0)
  const startTimeRef = useRef(0)
  const rafRef = useRef(0)

  const activeRef = useRef(active)
  const soloRef = useRef(solo)
  const stemVolumesRef = useRef(stemVolumes)
  const stemPanningsRef = useRef(stemPannings)
  const masterVolumeRef = useRef(masterVolume)
  const loopRef = useRef({ enabled: loopEnabled, start: loopStart, end: loopEnd })

  useLayoutEffect(() => {
    activeRef.current = active
    soloRef.current = solo
    stemVolumesRef.current = stemVolumes
    stemPanningsRef.current = stemPannings
    masterVolumeRef.current = masterVolume
    loopRef.current = { enabled: loopEnabled, start: loopStart, end: loopEnd }
    masterPlayingRef.current = masterPlaying
    durationRef.current = masterWaveDuration || duration
  })

  const ensureCtx = useCallback((): AudioContext => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext()
      masterGainRef.current = audioCtxRef.current.createGain()
      masterGainRef.current.connect(audioCtxRef.current.destination)
    }
    if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume()
    return audioCtxRef.current
  }, [])

  const computeGain = useCallback((key: string): number => {
    if (!masterPlayingRef.current) return 0
    if (!activeRef.current[key]) return 0
    const stemVol = stemVolumesRef.current[key] ?? 1
    const hasSolo = Object.values(soloRef.current).some((v) => v)
    if (hasSolo && !soloRef.current[key]) return 0
    return stemVol * masterVolumeRef.current
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const ensureNodes = useCallback((key: string): void => {
    const ctx = audioCtxRef.current
    if (!ctx || !masterGainRef.current) return
    if (gainNodesRef.current[key]) return

    const gain = ctx.createGain()
    const pan = ctx.createStereoPanner()
    pan.pan.value = stemPanningsRef.current[key] ?? 0
    gain.connect(pan)
    pan.connect(masterGainRef.current)
    gainNodesRef.current[key] = gain
    panNodesRef.current[key] = pan
  }, [])

  const getDecodedBuffer = useCallback(
    (key: string): AudioBuffer | undefined => buffersRef.current[key],
    []
  )

  // Creates and starts a live source for one stem at `position` (seconds into
  // the buffer). Always calls `source.start()`, even when the stem is
  // currently muted (gain 0) — muting only ever sets gain to 0 afterwards, it
  // never stops/recreates the source (see CLAUDE.md). A source that is never
  // started can't be un-muted later by ramping its gain back up, which is
  // what made a stem stay silent after its first mute/unmute cycle: if it
  // wasn't part of the initial active set (or wasn't decoded yet) when
  // playback began, it either got a dormant, never-started source or no
  // source at all.
  const startSourceForKey = useCallback(
    (key: string, buffer: AudioBuffer, position: number): void => {
      const ctx = audioCtxRef.current
      if (!ctx) return
      ensureNodes(key)
      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.connect(gainNodesRef.current[key])

      const gain = computeGain(key)
      gainNodesRef.current[key].gain.setValueAtTime(gain, ctx.currentTime)

      source.start(0, Math.max(0, position))
      sourcesRef.current[key] = source
    },
    [computeGain, ensureNodes]
  )

  const startSources = useCallback(
    (position: number): void => {
      const ctx = audioCtxRef.current
      if (!ctx) return

      startTimeRef.current = ctx.currentTime
      startRef.current = position
      positionRef.current = position

      for (const [key, buffer] of Object.entries(buffersRef.current)) {
        if (!buffer) continue
        startSourceForKey(key, buffer, position)
      }

      isPlayingRef.current = true
    },
    [startSourceForKey, positionRef]
  )

  // A stem that finishes decoding after playback has already started never
  // gets picked up by `startSources` (it already ran without this stem's
  // buffer). Join it into the currently playing mix now, at the correct
  // elapsed position, instead of leaving it silent until the next seek/loop/
  // restart recreates all sources from scratch.
  const joinLateDecodedStem = useCallback(
    (key: string, buffer: AudioBuffer): void => {
      const ctx = audioCtxRef.current
      if (!ctx || !isPlayingRef.current || sourcesRef.current[key]) return
      const position = startRef.current + (ctx.currentTime - startTimeRef.current)
      startSourceForKey(key, buffer, position)
    },
    [startSourceForKey]
  )

  const decodeStems = useCallback(async (): Promise<void> => {
    const ctx = ensureCtx()
    await Promise.all(
      allStems.map(async (stemPath) => {
        const key = stemNameFromPath(stemPath)
        if (buffersRef.current[key]) return
        const url = urls[key]
        if (!url) return
        try {
          const res = await fetch(url)
          const buf = await res.arrayBuffer()
          const audioBuf = await ctx.decodeAudioData(buf)
          buffersRef.current[key] = audioBuf
          ensureNodes(key)
          joinLateDecodedStem(key, audioBuf)
        } catch (err) {
          console.error('[audioEngine] decode failed for', key, err)
        } finally {
          // Notify the waveform renderer regardless of outcome: on success it
          // can switch from a pending state to the decoded buffer; on failure
          // it still needs the signal to fall back to its own independent
          // fetch+decode instead of staying blank forever (see useWaveSurfers).
          notifyStemDecodedRef.current(key)
        }
      })
    )
  }, [allStems, urls, ensureCtx, ensureNodes, joinLateDecodedStem, notifyStemDecodedRef])

  useEffect(() => {
    decodeStems()
  }, [decodeStems])

  const stopSources = useCallback((): void => {
    for (const source of Object.values(sourcesRef.current)) {
      try {
        source.stop()
      } catch {
        /* already stopped */
      }
    }
    sourcesRef.current = {}
  }, [])

  const seek = useCallback(
    (time: number): void => {
      positionRef.current = time
      if (isPlayingRef.current) {
        stopSources()
        startSources(time)
      }
    },
    [positionRef, stopSources, startSources]
  )

  const tick = useCallback((): void => {
    const ctx = audioCtxRef.current
    if (!ctx || !isPlayingRef.current) return

    const position = startRef.current + (ctx.currentTime - startTimeRef.current)

    const loop = loopRef.current
    if (loop.enabled && loop.start !== null && loop.end !== null && position >= loop.end) {
      lastScheduledBeatRef.current = -1
      stopSources()
      startSources(loop.start)
      positionRef.current = loop.start
      onAudioTimeRef.current(loop.start)
      rafRef.current = requestAnimationFrame(tick)
      return
    }

    positionRef.current = position
    onAudioTimeRef.current(position)

    rafRef.current = requestAnimationFrame(tick)
  }, [stopSources, startSources, onAudioTimeRef, lastScheduledBeatRef, positionRef])

  useEffect(() => {
    if (!masterPlaying && isPlayingRef.current) {
      stopSources()
      isPlayingRef.current = false
      cancelAnimationFrame(rafRef.current)
    }
  }, [masterPlaying, stopSources])

  useEffect(() => {
    if (!audioCtxRef.current || !isPlayingRef.current) return
    for (const [key, gainNode] of Object.entries(gainNodesRef.current)) {
      const targetGain = computeGain(key)
      gainNode.gain.setTargetAtTime(targetGain, audioCtxRef.current.currentTime, 0.01)
    }
  }, [active, solo, stemVolumes, masterVolume, computeGain])

  useEffect(() => {
    for (const [key, panNode] of Object.entries(panNodesRef.current)) {
      panNode.pan.value = stemPannings[key] ?? 0
    }
  }, [stemPannings])

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      const api = window.api
      if (!api) return
      // Resolve every stem's url concurrently — each getAudioUrl call is an
      // independent IPC round-trip, so there's no reason to wait for one
      // stem's url before requesting the next. A single stem's resolution
      // failing (allSettled, not all) doesn't drop the others.
      const entries = await Promise.allSettled(
        allStems.map(async (stem) => {
          const key = stemNameFromPath(stem)
          const url = await api.getAudioUrl(stem)
          return [key, url] as const
        })
      )
      const result: Record<string, string> = {}
      for (const entry of entries) {
        if (entry.status === 'fulfilled') {
          const [key, url] = entry.value
          result[key] = url
        } else {
          console.error('[audioEngine] failed to resolve stem url', entry.reason)
        }
      }
      if (!cancelled) setUrls(result)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [allStems, setUrls])

  useEffect(() => {
    return () => {
      stopSources()
      cancelAnimationFrame(rafRef.current)
      if (masterGainRef.current) {
        try {
          masterGainRef.current.disconnect()
        } catch {
          /* ignore */
        }
      }
      audioCtxRef.current?.close()
      audioCtxRef.current = null
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop())
        mediaStreamRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggleStem = useCallback(
    (key: string): void => {
      if (!masterPlayingRef.current) {
        if (activeRef.current[key]) return
        lastScheduledBeatRef.current = -1
        ensureCtx()
        ensureWaveSurfer(key)
        isPlayingRef.current = true
        activeRef.current = { ...activeRef.current, [key]: true }
        masterPlayingRef.current = true
        startSources(positionRef.current)
        rafRef.current = requestAnimationFrame(tick)
        setActive({ [key]: true })
        setMasterPlaying(true)
      } else {
        setActive((prev) => ({ ...prev, [key]: !prev[key] }))
      }
    },
    [
      ensureCtx,
      ensureWaveSurfer,
      startSources,
      tick,
      setActive,
      setMasterPlaying,
      lastScheduledBeatRef,
      positionRef,
      masterPlayingRef
    ]
  )

  const toggleMasterPlay = useCallback((): void => {
    if (masterPlaying) {
      setMasterPlaying(false)
    } else {
      lastScheduledBeatRef.current = -1
      ensureCtx()
      const all: Record<string, boolean> = {}
      for (const path of allStems) {
        const key = stemNameFromPath(path)
        all[key] = true
        ensureWaveSurfer(key)
      }
      isPlayingRef.current = true
      activeRef.current = all
      masterPlayingRef.current = true
      startSources(positionRef.current)
      rafRef.current = requestAnimationFrame(tick)
      setActive(all)
      setMasterPlaying(true)
    }
  }, [
    masterPlaying,
    ensureCtx,
    ensureWaveSurfer,
    startSources,
    tick,
    setActive,
    setMasterPlaying,
    lastScheduledBeatRef,
    allStems,
    positionRef,
    masterPlayingRef
  ])

  const handleRestart = useCallback((): void => {
    lastScheduledBeatRef.current = -1
    if (isPlayingRef.current) {
      stopSources()
      startSources(0)
    } else {
      positionRef.current = 0
    }
    progressRef.current = 0
    onAudioTimeRef.current(0)
    for (const sw of Object.values(stemWaves.current)) {
      sw.seekTo(0)
    }
  }, [
    stopSources,
    startSources,
    positionRef,
    progressRef,
    onAudioTimeRef,
    lastScheduledBeatRef,
    stemWaves
  ])

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

      if (sourcesRef.current[key]) {
        try {
          sourcesRef.current[key].stop()
        } catch {
          /* already stopped */
        }
        delete sourcesRef.current[key]
      }

      if (gainNodesRef.current[key]) {
        gainNodesRef.current[key].disconnect()
        delete gainNodesRef.current[key]
      }
      if (panNodesRef.current[key]) {
        panNodesRef.current[key].disconnect()
        delete panNodesRef.current[key]
      }

      delete buffersRef.current[key]

      if (stemWaves.current[key]) {
        stemWaves.current[key].destroy()
        delete stemWaves.current[key]
        delete waveUrlsRef.current[key]
      }

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
    [stemWaves, waveUrlsRef, setRecordedStems, setActive]
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
      ensureNodes(key)
    },
    [ensureNodes, setStemPannings]
  )

  return {
    toggleStem,
    toggleMasterPlay,
    handleRestart,
    toggleSolo,
    handleDeleteRecording,
    handleMasterVolume,
    handleStemVolume,
    handleStemPanning,
    seek,
    audioCtxRef,
    getDecodedBuffer
  }
}
