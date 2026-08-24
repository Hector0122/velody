import { useEffect, useLayoutEffect, useCallback, useRef } from 'react'
import type WaveSurfer from 'wavesurfer.js'
import { stemNameFromPath } from '../utils'
import useLocalStoragePreference from './useLocalStoragePreference'
import { RESET_SCHEDULED_BEAT } from './useMetronome'

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

export type TickAction =
  | { type: 'loop'; to: number }
  | { type: 'trimStop'; at: number }
  | { type: 'continue' }

// Pure decision logic for what the RAF playback tick should do at the
// current position — kept separate from the side-effecting bits (stopping/
// starting audio nodes, refs) so it's directly unit-testable without an
// AudioContext. Loop wins over trim when both would apply at the same
// position (a loop entirely inside the trimmed range must keep looping
// unaffected by trimEnd) — see openspec/changes/add-song-trim-points.
export function resolveTickAction(
  position: number,
  loop: { enabled: boolean; start: number | null; end: number | null },
  trim: { start: number; end: number | null }
): TickAction {
  if (loop.enabled && loop.start !== null && loop.end !== null && position >= loop.end) {
    return { type: 'loop', to: loop.start }
  }
  if (!loop.enabled && trim.end !== null && position >= trim.end) {
    return { type: 'trimStop', at: trim.end }
  }
  return { type: 'continue' }
}

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
  // Song's persisted playback range (see openspec/changes/add-song-trim-
  // points) — trimStart is where Restart seeks to instead of 0; reaching
  // trimEnd (when set and loop isn't active) stops playback instead of
  // continuing into the rest of the file. Manual seeking is unaffected.
  trimStart: number
  trimEnd: number | null
  masterWaveDuration: number
  duration: number

  positionRef: React.MutableRefObject<number>
  masterPlayingRef: React.MutableRefObject<boolean>
  durationRef: React.MutableRefObject<number>
  onAudioTimeRef: React.MutableRefObject<(time: number) => void>
  lastScheduledBeatRef: React.MutableRefObject<number>
  // True from the moment playback is pre-scheduled with a future `when`
  // (see startSources) until that instant actually arrives — read by
  // useMetronome to keep its in-song scheduler from firing while
  // positionRef is still clamped at the starting position (see
  // fix-count-in-handoff-precision: without this, a song whose first real
  // beat lands within the metronome's LOOKAHEAD window of the start/trim
  // position — common exactly because add-song-trim-points exists to make
  // songs start right on the beat — would get an extra, wrongly-timed
  // click scheduled during the count-in wait, and the real beat at the
  // correct moment would then be skipped by the dedup ratchet).
  playbackPendingRef: React.MutableRefObject<boolean>

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
  toggleMasterPlay: (when?: number) => void
  handleRestart: () => void
  toggleSolo: (key: string) => void
  handleDeleteRecording: (path: string) => Promise<void>
  handleMasterVolume: (e: React.ChangeEvent<HTMLInputElement>) => void
  handleStemVolume: (key: string, value: number) => void
  handleStemPanning: (key: string, value: number) => void
  seek: (time: number) => void
  audioCtxRef: React.MutableRefObject<AudioContext | null>
  // Creates this engine's own AudioContext if it doesn't exist yet (and
  // resumes it if suspended), returning it. Exposed (mirrors useMetronome's
  // own ensureAudioCtx) so callers that need to read this context's
  // currentTime *before* actually starting playback — e.g. the count-in
  // handoff, to compute a future `when` — can guarantee it exists first.
  ensureAudioCtx: () => AudioContext
  getDecodedBuffer: (key: string) => AudioBuffer | undefined
  masterPan: number
  setMasterPan: (v: number) => void
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
    trimStart,
    trimEnd,
    masterWaveDuration,
    duration,
    positionRef,
    masterPlayingRef,
    durationRef,
    onAudioTimeRef,
    lastScheduledBeatRef,
    playbackPendingRef,
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

  // Global (not per-song) preference, like the metronome's own metroPan —
  // see openspec/changes/add-metronome-and-mix-panning: lets the whole mix
  // be panned independent of the metronome click (and independent of
  // per-stem panning, which is applied *before* this stage — see ensureCtx).
  const [masterPan, setMasterPan] = useLocalStoragePreference('velody:masterPan', 0, isFiniteNumber)
  const masterPanRef = useRef(masterPan)

  const audioCtxRef = useRef<AudioContext | null>(null)
  const buffersRef = useRef<Record<string, AudioBuffer>>({})
  const gainNodesRef = useRef<Record<string, GainNode>>({})
  const panNodesRef = useRef<Record<string, StereoPannerNode>>({})
  const masterGainRef = useRef<GainNode | null>(null)
  const masterPanNodeRef = useRef<StereoPannerNode | null>(null)
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
  const trimRef = useRef({ start: trimStart, end: trimEnd })

  useLayoutEffect(() => {
    activeRef.current = active
    soloRef.current = solo
    stemVolumesRef.current = stemVolumes
    stemPanningsRef.current = stemPannings
    masterVolumeRef.current = masterVolume
    loopRef.current = { enabled: loopEnabled, start: loopStart, end: loopEnd }
    trimRef.current = { start: trimStart, end: trimEnd }
    masterPlayingRef.current = masterPlaying
    durationRef.current = masterWaveDuration || duration
    masterPanRef.current = masterPan
    if (masterPanNodeRef.current) masterPanNodeRef.current.pan.value = masterPan
  })

  const ensureCtx = useCallback((): AudioContext => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext()
      masterGainRef.current = audioCtxRef.current.createGain()
      masterPanNodeRef.current = audioCtxRef.current.createStereoPanner()
      masterPanNodeRef.current.pan.value = masterPanRef.current
      // masterGain -> masterPan -> destination: per-stem gain/pan (ensureNodes
      // below) already feeds into masterGain, so this is an additional stage
      // after them, not a replacement — per-stem panning still positions each
      // stem relative to wherever masterPan places the overall mix.
      masterGainRef.current.connect(masterPanNodeRef.current)
      masterPanNodeRef.current.connect(audioCtxRef.current.destination)
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
  //
  // `when` (this AudioContext's own `currentTime` scale), if given, defers
  // the actual start to that exact future sample-accurate instant instead
  // of "as soon as possible" (`start(0)`) — used by the count-in handoff
  // (see fix-count-in-handoff-precision) to pre-schedule the song's first
  // sample up front, rather than reactively triggering it once the count-in
  // is *detected* to have finished, which is bounded by JS polling
  // granularity (rAF/setTimeout) rather than being truly sample-accurate.
  const startSourceForKey = useCallback(
    (key: string, buffer: AudioBuffer, position: number, when?: number): void => {
      const ctx = audioCtxRef.current
      if (!ctx) return
      ensureNodes(key)
      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.connect(gainNodesRef.current[key])

      const gain = computeGain(key)
      gainNodesRef.current[key].gain.setValueAtTime(gain, ctx.currentTime)

      source.start(when ?? 0, Math.max(0, position))
      sourcesRef.current[key] = source
    },
    [computeGain, ensureNodes]
  )

  const startSources = useCallback(
    (position: number, when?: number): void => {
      const ctx = audioCtxRef.current
      if (!ctx) return

      startTimeRef.current = when ?? ctx.currentTime
      startRef.current = position
      positionRef.current = position
      // Set synchronously here (not left solely to tick()'s next RAF frame)
      // so there's no window where a stale previous value could let
      // useMetronome's scheduler fire even once before the real pending
      // state is reflected — see the field's doc comment.
      playbackPendingRef.current = typeof when === 'number' && when > ctx.currentTime

      for (const [key, buffer] of Object.entries(buffersRef.current)) {
        if (!buffer) continue
        startSourceForKey(key, buffer, position, when)
      }

      isPlayingRef.current = true
    },
    [startSourceForKey, positionRef, playbackPendingRef]
  )

  // A stem that finishes decoding after playback has already started never
  // gets picked up by `startSources` (it already ran without this stem's
  // buffer). Join it into the currently playing mix now, at the correct
  // elapsed position, instead of leaving it silent until the next seek/loop/
  // restart recreates all sources from scratch.
  //
  // Clamped at 0: if playback was pre-scheduled to start in the future
  // (`startTimeRef.current` is a `when` still ahead of `ctx.currentTime` —
  // e.g. a stem finishes decoding during a count-in's lead-in), elapsed
  // would otherwise go negative.
  const joinLateDecodedStem = useCallback(
    (key: string, buffer: AudioBuffer): void => {
      const ctx = audioCtxRef.current
      if (!ctx || !isPlayingRef.current || sourcesRef.current[key]) return
      const elapsed = Math.max(0, ctx.currentTime - startTimeRef.current)
      const position = startRef.current + elapsed
      const when = ctx.currentTime < startTimeRef.current ? startTimeRef.current : undefined
      startSourceForKey(key, buffer, position, when)
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

    // Clamped at 0 elapsed: playback may have been pre-scheduled to start
    // at a future `when` (see startSources/startSourceForKey) — before
    // that instant arrives, position must hold at startRef.current, not go
    // negative.
    const elapsed = Math.max(0, ctx.currentTime - startTimeRef.current)
    const position = startRef.current + elapsed
    // Self-correcting each frame (cheap): stays true while still waiting
    // for a pre-scheduled `when`, flips false the first frame it's
    // actually passed — see the field's doc comment.
    playbackPendingRef.current = ctx.currentTime < startTimeRef.current

    const action = resolveTickAction(position, loopRef.current, trimRef.current)

    if (action.type === 'loop') {
      lastScheduledBeatRef.current = RESET_SCHEDULED_BEAT
      stopSources()
      startSources(action.to)
      positionRef.current = action.to
      onAudioTimeRef.current(action.to)
      rafRef.current = requestAnimationFrame(tick)
      return
    }

    if (action.type === 'trimStop') {
      // Matches the masterPlaying watcher effect below (stop sources, flip
      // isPlayingRef, cancel the RAF loop implicitly by not scheduling the
      // next frame) plus setMasterPlaying(false) so UI state (play/pause
      // icon) stays consistent with playback actually having stopped.
      stopSources()
      isPlayingRef.current = false
      positionRef.current = action.at
      onAudioTimeRef.current(action.at)
      setMasterPlaying(false)
      return
    }

    positionRef.current = position
    onAudioTimeRef.current(position)

    rafRef.current = requestAnimationFrame(tick)
  }, [
    stopSources,
    startSources,
    onAudioTimeRef,
    lastScheduledBeatRef,
    positionRef,
    setMasterPlaying,
    playbackPendingRef
  ])

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
        lastScheduledBeatRef.current = RESET_SCHEDULED_BEAT
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

  // `when` (this AudioContext's own currentTime scale), if given, defers
  // the actual audio start to that exact future instant — see
  // startSourceForKey's comment. Omitted for the plain "press Play, start
  // now" case; passed by the count-in handoff (StemPlayer) to pre-schedule
  // playback up front instead of reactively starting it once the count-in
  // is detected to have finished.
  const toggleMasterPlay = useCallback(
    (when?: number): void => {
      if (masterPlaying) {
        setMasterPlaying(false)
      } else {
        lastScheduledBeatRef.current = RESET_SCHEDULED_BEAT
        ensureCtx()
        // Preserve any mute/solo choice the user already made — only default a
        // stem to active if it has no entry yet (first-ever play for this
        // song, or a stem that was just added, e.g. a new recording). Without
        // this, every Stop -> Play cycle silently re-activated every stem,
        // undoing mutes the user had just set (see fix-stem-mutes-reset-on-
        // replay).
        const merged: Record<string, boolean> = { ...activeRef.current }
        for (const path of allStems) {
          const key = stemNameFromPath(path)
          if (!(key in merged)) merged[key] = true
          ensureWaveSurfer(key)
        }
        isPlayingRef.current = true
        activeRef.current = merged
        masterPlayingRef.current = true
        startSources(positionRef.current, when)
        rafRef.current = requestAnimationFrame(tick)
        setActive(merged)
        setMasterPlaying(true)
      }
    },
    [
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
    ]
  )

  const handleRestart = useCallback((): void => {
    lastScheduledBeatRef.current = RESET_SCHEDULED_BEAT
    // Restart jumps to the song's trim start (0 when no trim is set — same
    // as before this existed) rather than always hardcoded 0, so a song
    // with a long intro trimmed off skips it every time the user restarts
    // (see openspec/changes/add-song-trim-points).
    const restartTo = trimRef.current.start
    if (isPlayingRef.current) {
      stopSources()
      startSources(restartTo)
    } else {
      positionRef.current = restartTo
    }
    progressRef.current = restartTo
    onAudioTimeRef.current(restartTo)
    const fraction = durationRef.current > 0 ? restartTo / durationRef.current : 0
    for (const sw of Object.values(stemWaves.current)) {
      sw.seekTo(fraction)
    }
  }, [
    stopSources,
    startSources,
    positionRef,
    progressRef,
    onAudioTimeRef,
    lastScheduledBeatRef,
    stemWaves,
    durationRef
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
    ensureAudioCtx: ensureCtx,
    getDecodedBuffer,
    masterPan,
    setMasterPan
  }
}
