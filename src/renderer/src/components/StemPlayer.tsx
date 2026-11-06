import { useState, useMemo, useCallback, useRef, useLayoutEffect, useEffect } from 'react'
import ExportModal from './ExportModal'
import MarkerLabelInput from './MarkerLabelInput'
import RecordingConfirmationModal from './RecordingConfirmationModal'
import StemGrid from './StemGrid'
import MasterPanel from './MasterPanel'
import TimelinePanel from './TimelinePanel'
import LivePresetBar from './LivePresetBar'
import { useMetronome, RESET_SCHEDULED_BEAT, type PlaybackClock } from '../hooks/useMetronome'
import { useRecording } from '../hooks/useRecording'
import useSongAnalysis, { CACHE_VERSION } from '../hooks/useSongAnalysis'
import { correctTempoOctave, type TempoOctaveDirection } from '../hooks/tempoOctaveCorrection'
import useMarkers from '../hooks/useMarkers'
import useTrim from '../hooks/useTrim'
import useSongCountIn from '../hooks/useSongCountIn'
import useDownbeatShift from '../hooks/useDownbeatShift'
import useSongSpeedPitch from '../hooks/useSongSpeedPitch'
import { downbeatShiftAt, metronomeClicks, planCountIn, smoothBeatGrid } from '../hooks/downbeat'
import useLivePresets from '../hooks/useLivePresets'
import useCountIn, { COUNT_IN_LEAD_IN } from '../hooks/useCountIn'
import { useExportState } from '../hooks/useExportState'
import { useWaveSurfers } from '../hooks/useWaveSurfers'
import { useAudioContextEngine } from '../hooks/useAudioContextEngine'
import {
  stemNameFromPath,
  songDirFromStemPath,
  pickBeatTrackingStem,
  formatTime,
  BPM_MIN,
  BPM_MAX,
  updateTimeDisplays,
  updateCursors,
  invalidateLiveUICache
} from '../utils'

interface StemPlayerProps {
  stems: string[]
  songName: string
  onToast?: (message: string, type?: 'error' | 'success') => void
  // Present only when this song was opened from an active setlist (see
  // openspec/changes/add-song-setlists) — advances to the next song in
  // that setlist's order.
  onNextSong?: () => void
  hasNextSong?: boolean
  // Shows Live Presets (and auto-applies the last one) only when on.
  liveMode?: boolean
}

const STEM_META: Record<string, { color: string; label: string }> = {
  vocals: { color: '#22c55e', label: 'Vocals' },
  drums: { color: '#3b82f6', label: 'Drums' },
  bass: { color: '#f97316', label: 'Bass' },
  other: { color: '#a855f7', label: 'Other' },
  piano: { color: '#f43f5e', label: 'Piano' },
  guitar: { color: '#eab308', label: 'Guitar' }
}

const RECORDING_COLORS = [
  '#ef4444',
  '#ec4899',
  '#f59e0b',
  '#14b8a6',
  '#8b5cf6',
  '#06b6d4',
  '#84cc16',
  '#f97316'
]

function StemPlayer({
  stems,
  songName,
  onToast,
  onNextSong,
  hasNextSong,
  liveMode = false
}: StemPlayerProps): React.JSX.Element {
  const progressRef = useRef(0)
  const [masterVolume, setMasterVolume] = useState(1)
  const [masterPlaying, setMasterPlaying] = useState(false)
  const [active, setActive] = useState<Record<string, boolean>>({})
  const [solo, setSolo] = useState<Record<string, boolean>>({})
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [stemVolumes, setStemVolumes] = useState<Record<string, number>>({})
  const [stemPannings, setStemPannings] = useState<Record<string, number>>({})
  const [recordedStems, setRecordedStems] = useState<string[]>([])

  const allStems = useMemo(() => [...stems, ...recordedStems], [stems, recordedStems])

  const positionRef = useRef(0)
  const onAudioTimeRef = useRef<(time: number) => void>(() => {})
  const seekRef = useRef<(time: number) => void>(() => {})
  // Break the useWaveSurfers <-> useAudioContextEngine circular dependency the
  // same way seekRef does: a stable ref box owned by StemPlayer, written by one
  // hook's return value and read by the other's params (see design.md - Ordering).
  const getDecodedBufferRef = useRef<(key: string) => AudioBuffer | undefined>(() => undefined)
  const notifyStemDecodedRef = useRef<(key: string) => void>(() => {})

  const masterPlayingRef = useRef(masterPlaying)
  const durationRef = useRef(0)
  // Written by useAudioContextEngine, read by useMetronome — same
  // shared-ref pattern as firstBeatOffsetRef/originalBpmRef below. True
  // while playback has been pre-scheduled (a count-in's stem-engine
  // handoff) but the scheduled instant hasn't arrived yet, so
  // useMetronome's in-song scheduler doesn't fire against a position
  // that's clamped/not really advancing yet. See
  // fix-count-in-handoff-precision.
  const playbackPendingRef = useRef(false)
  // Filled in below once the engine exists: lets the metronome click on the
  // engine's own AudioContext/clock (see PlaybackClock in useMetronome).
  const playbackClockRef = useRef<PlaybackClock | null>(null)
  const firstBeatOffsetRef = useRef(0)
  // originalBpmRef/beatTimesRef are written by useSongAnalysis and read by
  // useMetronome for grid-based scheduling — same shared-ref pattern as
  // firstBeatOffsetRef, avoiding a circular dependency between the two hooks
  // (useMetronome needs the detected grid; useSongAnalysis needs
  // useMetronome's setBpm).
  const originalBpmRef = useRef(120)
  const beatTimesRef = useRef<number[]>([])
  const audioStartRef = useRef<number | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)

  const {
    downbeatShift,
    setDownbeatShift,
    applyDetectedDownbeat,
    clearManualDownbeat,
    downbeatShiftRef
  } = useDownbeatShift(stems)
  const { speed, semitones, setSpeed, setSemitones } = useSongSpeedPitch(stems)

  const {
    bpm,
    setBpm,
    bpmRef,
    metronomeOn,
    setMetronomeOn,
    metroVolume,
    setMetroVolume,
    metroPan,
    setMetroPan,
    playClick,
    ensureAudioCtx: ensureMetronomeAudioCtx,
    // useMetronome owns the *real* scheduling ratchet its own scheduler
    // functions read/write internally — this must be the exact same ref
    // instance threaded into useAudioContextEngine/useWaveSurfers/the BPM
    // handlers below for their "reset on seek/loop/restart/BPM-change"
    // resets to actually reach the scheduler. Before this fix, StemPlayer
    // declared its own separate `useRef(-1)` for this — a different object
    // useMetronome never read, so every one of those resets was a no-op
    // against the metronome's real internal ratchet (see
    // fix-count-in-song-start-timing).
    lastScheduledBeatRef
  } = useMetronome(
    masterPlaying,
    masterPlayingRef,
    positionRef,
    firstBeatOffsetRef,
    originalBpmRef,
    beatTimesRef,
    playbackPendingRef,
    playbackClockRef,
    downbeatShiftRef
  )

  useSongAnalysis(
    urls,
    stems,
    setBpm,
    firstBeatOffsetRef,
    originalBpmRef,
    beatTimesRef,
    applyDetectedDownbeat
  )

  // Named "ready to play" mix snapshots (mute/volume/pan/metronome-on/
  // master-volume) — see openspec/changes/add-live-presets. Applies the
  // last-used preset automatically on song open.
  const {
    presets: livePresets,
    activePresetId,
    handleSavePreset,
    handleApplyPreset,
    handleDeletePreset
  } = useLivePresets({
    stems,
    active,
    stemVolumes,
    stemPannings,
    metronomeOn,
    masterVolume,
    setActive,
    setStemVolumes,
    setStemPannings,
    setMetronomeOn,
    setMasterVolume,
    autoApply: liveMode
  })

  const {
    markers,
    loopStart,
    loopEnd,
    loopEnabled,
    pendingMarkerTime,
    showMarkerInput,
    setShowMarkerInput,
    setMarkers,
    setPendingMarkerTime,
    handleSetLoopStart,
    handleSetLoopEnd,
    handleToggleLoop,
    handleClearMarkers,
    handleRemoveMarker
  } = useMarkers()

  const { trimStart, trimEnd, handleSetTrimStart, handleSetTrimEnd, handleClearTrim } =
    useTrim(stems)

  const handleSetTrimEndWithToast = useCallback(
    (time: number): void => {
      if (!handleSetTrimEnd(time)) {
        onToast?.('Trim end must be after trim start', 'error')
      }
    },
    [handleSetTrimEnd, onToast]
  )

  const {
    showExportModal,
    setShowExportModal,
    exportSelection,
    exportFormat,
    setExportFormat,
    exportWithMetronome,
    setExportWithMetronome,
    exporting,
    handleExportSingle,
    handleExportMix,
    toggleExportSelection
  } = useExportState({
    allStems,
    songName,
    getClicks: () => {
      const beatTimes = Array.isArray(beatTimesRef.current) ? beatTimesRef.current : []
      return metronomeClicks({
        beatTimes,
        usingGrid: beatTimes.length > 0 && bpm === originalBpmRef.current,
        bpm,
        firstBeatOffset: firstBeatOffsetRef.current,
        shift: downbeatShiftRef.current,
        duration: durationRef.current
      })
    },
    stemMeta: STEM_META,
    trimStart,
    trimEnd,
    onToast
  })

  const stemItems = useMemo(() => {
    let recIdx = 0
    return allStems.map((path) => {
      const key = stemNameFromPath(path)
      const isRecording = recordedStems.includes(path)
      if (isRecording) {
        const color = RECORDING_COLORS[recIdx % RECORDING_COLORS.length]
        recIdx++
        return { key, isRecording: true, meta: { color, label: key } }
      }
      return {
        key,
        isRecording: false,
        meta: STEM_META[key] || { color: '#6b7280', label: key }
      }
    })
  }, [allStems, recordedStems])

  useEffect(() => {
    invalidateLiveUICache()
  }, [stemItems])

  const {
    stemWaves,
    waveUrlsRef,
    masterWaveContainer,
    masterWaveDuration,
    duration,
    ensureWaveSurfer,
    seekMasterFraction,
    handleStemDecoded
  } = useWaveSurfers({
    stemItems,
    urls,
    seekRef,
    durationRef,
    positionRef,
    lastScheduledBeatRef,
    progressRef,
    onMasterDblClick: (time) => {
      setPendingMarkerTime(time)
      setShowMarkerInput(true)
    },
    getDecodedBufferRef
  })

  useLayoutEffect(() => {
    notifyStemDecodedRef.current = handleStemDecoded
  })

  const {
    toggleStem,
    toggleMasterPlay,
    handleRestart,
    toggleSolo,
    handleDeleteRecording,
    handleMasterVolume,
    handleStemVolume,
    handleStemPanning,
    seek,
    // Aliased to disambiguate from the metronome's own, separate
    // ensureAudioCtx (destructured below as ensureMetronomeAudioCtx) — see
    // the count-in handoff in handleToggleMasterPlayWithCountIn.
    ensureAudioCtx: ensureStemAudioCtx,
    getLivePosition,
    getRate,
    getOutputDelay,
    pitchShifterError,
    getDecodedBuffer,
    masterPan,
    setMasterPan
  } = useAudioContextEngine({
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
    speed,
    semitones,
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
  })
  useLayoutEffect(() => {
    playbackClockRef.current = {
      ensureCtx: ensureStemAudioCtx,
      getPosition: getLivePosition,
      getRate,
      getOutputDelay
    }
  }, [ensureStemAudioCtx, getLivePosition, getRate, getOutputDelay])

  useLayoutEffect(() => {
    seekRef.current = seek
  })

  useLayoutEffect(() => {
    getDecodedBufferRef.current = getDecodedBuffer
  })

  // Per-song "play a count-in before the song starts" setting — separate
  // from useRecording's own (session-only, 0/1/2/4 bars) count-in, and
  // from its useCountIn instance, so a countdown for one flow never
  // cancels or interferes with the other. See openspec/changes/
  // add-song-count-in.
  const { playbackCountInBars, setPlaybackCountInBars } = useSongCountIn(stems)
  // Must use the metronome's own ensureAudioCtx, not the stem-playback
  // engine's audioCtxRef — playClick only ever plays through the
  // metronome's own (separate) AudioContext. See useCountIn.ts.
  const playbackCountIn = useCountIn(ensureMetronomeAudioCtx, playClick)
  const [playbackCounting, setPlaybackCounting] = useState(false)
  const [playbackCountRemaining, setPlaybackCountRemaining] = useState(0)

  // Pre-schedules the song's actual first sample on the *stem engine's own*
  // AudioContext clock, up front — at the same moment the count-in's clicks
  // get scheduled on the *metronome's* separate AudioContext clock — rather
  // than reactively calling toggleMasterPlay() only once the count-in is
  // *detected* to have finished (the previous design). That reactive
  // trigger, even after being moved off setTimeout onto an rAF poll of
  // ctx.currentTime (fix-count-in-onbeat-handoff-jitter), was still bounded
  // by ~1 animation frame (~16ms) of polling granularity — small, but
  // enough to be perceptible to a musician listening critically for a tight
  // click, and part of why the count-in→song handoff still didn't feel
  // fully locked in.
  //
  // The fix: both AudioContexts tick at the same real-world rate (1 second
  // of ctx.currentTime == 1 real second) even though their `currentTime`
  // values start from unrelated zero-points — so computing "this context's
  // own currentTime + the same real-seconds count-in duration" on *each*
  // context independently, at the same synchronous moment (when Play is
  // pressed), lines the two schedules up without ever needing to convert
  // between the two clocks, and without any reactive polling step at the
  // handoff at all. onComplete (below) becomes purely a UI-state signal for
  // when the on-screen countdown overlay should disappear — no longer
  // gates any audio.
  // See openspec/changes/fix-count-in-handoff-precision.
  const handleToggleMasterPlayWithCountIn = useCallback((): void => {
    if (playbackCounting) {
      playbackCountIn.cancel()
      setPlaybackCounting(false)
      // The stem engine's playback was already pre-scheduled (armed, even
      // if not yet audible) the instant the count-in started — cancelling
      // only the count-in's clicks would leave that scheduled start intact
      // and the song would still begin unexpectedly at the original `when`.
      // toggleMasterPlay() with no args takes its "already playing -> stop"
      // branch here (masterPlaying is already true from the pre-schedule
      // below), which stops every source, including ones scheduled for a
      // still-future start time (AudioBufferSourceNode.stop() before its
      // scheduled start correctly cancels it — see Web Audio spec).
      toggleMasterPlay()
      return
    }
    if (!masterPlaying && playbackCountInBars > 0) {
      // Lay the count-in on the song's own beat grid (planCountIn): exactly
      // N×4 clicks ending one beat before the song's next beat, so it flows
      // into the song (and the in-song metronome) without a gap or phase jump.
      const beatTimes = Array.isArray(beatTimesRef.current) ? beatTimesRef.current : []
      const position = positionRef.current
      const clicks = planCountIn({
        position,
        bars: playbackCountInBars,
        beatTimes,
        usingGrid: beatTimes.length > 0 && bpm === originalBpmRef.current,
        bpm,
        firstBeatOffset: firstBeatOffsetRef.current
      })
      if (clicks.length === 0) {
        toggleMasterPlay()
        return
      }
      setPlaybackCounting(true)

      // Map song time -> AudioContext time at the practice speed: song time
      // `position` plays at `stemWhen`, and every click keeps its distance
      // to it (scaled by speed). The first click lands COUNT_IN_LEAD_IN from now.
      const stemCtx = ensureStemAudioCtx()
      const now = stemCtx.currentTime
      const stemWhen = now + COUNT_IN_LEAD_IN + (position - clicks[0].songTime) / speed
      playbackCountIn.startAt(
        clicks.map((c) => ({ when: stemWhen + (c.songTime - position) / speed, accent: c.accent })),
        (remaining) => setPlaybackCountRemaining(remaining)
      )
      // Display-only: hide the countdown overlay once the song starts.
      setTimeout(() => setPlaybackCounting(false), (stemWhen - now) * 1000)
      toggleMasterPlay(stemWhen)
      return
    }
    toggleMasterPlay()
  }, [
    playbackCounting,
    masterPlaying,
    playbackCountInBars,
    bpm,
    speed,
    playbackCountIn,
    toggleMasterPlay,
    ensureStemAudioCtx,
    beatTimesRef,
    positionRef,
    originalBpmRef,
    firstBeatOffsetRef
  ])

  const onAudioTime = useCallback(
    (time: number): void => {
      progressRef.current = time
      const d = durationRef.current || duration || 1
      seekMasterFraction(time / d)
      updateTimeDisplays(time)
      updateCursors(time, d)
    },
    [duration, seekMasterFraction, durationRef]
  )

  const onAudioTimeRefCurrent = useRef(onAudioTime)
  useLayoutEffect(() => {
    onAudioTimeRefCurrent.current = onAudioTime
  })
  useLayoutEffect(() => {
    onAudioTimeRef.current = (time: number) => onAudioTimeRefCurrent.current(time)
  }, [])

  const {
    recording,
    recordingKey,
    recordingCount,
    recordingElapsed,
    monitorVolume,
    setMonitorVolume,
    recordingFormat,
    setRecordingFormat,
    countInBars,
    setCountInBars,
    handleStartRecording,
    handleStopRecording,
    handleDiscardRecording,
    handleSaveRecording
  } = useRecording({
    ensureAudioCtx: ensureMetronomeAudioCtx,
    seek,
    stemWaves,
    waveUrlsRef,
    bpm,
    positionRef,
    audioStartRef,
    stems,
    stemMeta: STEM_META,
    playClick,
    setRecordedStems,
    progressRef
  })

  const handleOpenTab = useCallback(
    (stemKey: string): void => {
      if (!window.api) return
      const label = STEM_META[stemKey]?.label ?? stemKey
      const query = encodeURIComponent(`${songName} ${label} tab`)
      const url = `https://www.ultimate-guitar.com/search.php?search_type=title&value=${query}`
      window.api.openExternal(url)
    },
    [songName]
  )

  const stemCallbacks = useMemo(() => {
    const map: Record<
      string,
      {
        onToggle: () => void
        onSolo: () => void
        onExport: () => void
        onOpenTab: () => void
        onStartRecording: () => void
        onVolumeChange: (v: number) => void
        onPanningChange: (v: number) => void
        onDeleteRecording: () => void
      }
    > = {}
    for (const stem of stemItems) {
      const { key, isRecording } = stem
      const recPath = isRecording ? allStems.find((p) => stemNameFromPath(p) === key) : undefined
      map[key] = {
        onToggle: () => toggleStem(key),
        onSolo: () => toggleSolo(key),
        onExport: () => handleExportSingle(key),
        onOpenTab: () => handleOpenTab(key),
        onStartRecording: () => {
          // A take recorded against slowed/transposed playback wouldn't line up
          // with the original stems (and the shifter adds latency).
          if (speed !== 1 || semitones !== 0) {
            onToast?.('Set speed to 100% and pitch to 0 to record', 'error')
            return
          }
          handleStartRecording(key)
        },
        onVolumeChange: (v: number) => handleStemVolume(key, v),
        onPanningChange: (v: number) => handleStemPanning(key, v),
        onDeleteRecording: recPath ? () => handleDeleteRecording(recPath) : () => {}
      }
    }
    return map
  }, [
    stemItems,
    allStems,
    toggleStem,
    toggleSolo,
    handleExportSingle,
    handleOpenTab,
    handleStartRecording,
    speed,
    semitones,
    onToast,
    handleStemVolume,
    handleStemPanning,
    handleDeleteRecording
  ])

  const handleBpmDecrement = useCallback((): void => {
    setBpm((prev) => {
      const next = Math.max(BPM_MIN, prev - 1)
      lastScheduledBeatRef.current = RESET_SCHEDULED_BEAT
      return next
    })
  }, [setBpm, lastScheduledBeatRef])
  const handleBpmIncrement = useCallback((): void => {
    setBpm((prev) => {
      const next = Math.min(BPM_MAX, prev + 1)
      lastScheduledBeatRef.current = RESET_SCHEDULED_BEAT
      return next
    })
  }, [setBpm, lastScheduledBeatRef])
  const handleBpmChange = useCallback(
    (v: number): void => {
      setBpm(v)
      lastScheduledBeatRef.current = RESET_SCHEDULED_BEAT
    },
    [setBpm, lastScheduledBeatRef]
  )

  const [correctingTempoOctave, setCorrectingTempoOctave] = useState(false)

  // Applies a tempo-octave correction's result (however it was obtained)
  // and persists it — shared by both the redetected and the arithmetic-
  // fallback paths in handleCorrectTempoOctave below.
  const applyTempoOctaveCorrection = useCallback(
    (correction: {
      bpm: number
      firstBeatOffset: number
      beatTimes: number[]
      downbeatShift?: number
    }): void => {
      beatTimesRef.current = smoothBeatGrid(correction.beatTimes)
      firstBeatOffsetRef.current = correction.firstBeatOffset
      originalBpmRef.current = correction.bpm
      lastScheduledBeatRef.current = RESET_SCHEDULED_BEAT
      setBpm(correction.bpm)
      // The grid was rebuilt, so a manually chosen "1" (a grid index) no
      // longer points at the same beat — fall back to the new estimate.
      clearManualDownbeat()
      if (typeof correction.downbeatShift === 'number') {
        applyDetectedDownbeat(correction.downbeatShift)
      }

      const songDir = songDirFromStemPath(stems[0])
      window.api?.saveMeta(songDir, {
        bpm: correction.bpm,
        firstBeatOffset: correction.firstBeatOffset,
        beatTimes: correction.beatTimes,
        detectedDownbeatShift: correction.downbeatShift,
        tracker: 'corrected',
        _version: CACHE_VERSION
      })
    },
    [
      stems,
      beatTimesRef,
      originalBpmRef,
      firstBeatOffsetRef,
      lastScheduledBeatRef,
      setBpm,
      clearManualDownbeat,
      applyDetectedDownbeat
    ]
  )

  // "This is the 1": make the beat nearest the current playback position the
  // bar's accented downbeat (see downbeat.ts). Works paused too (uses the
  // cursor position).
  const handleMarkDownbeat = useCallback((): void => {
    const beatTimes = Array.isArray(beatTimesRef.current) ? beatTimesRef.current : []
    const bpmNow = bpmRef.current
    setDownbeatShift(
      downbeatShiftAt(getLivePosition(), {
        beatTimes,
        usingGrid: beatTimes.length > 0 && bpmNow === originalBpmRef.current,
        bpm: bpmNow,
        firstBeatOffset: firstBeatOffsetRef.current
      })
    )
  }, [beatTimesRef, bpmRef, originalBpmRef, firstBeatOffsetRef, getLivePosition, setDownbeatShift])

  // Corrects a tempo-octave detection error (detector locked onto half or
  // double the real tempo) while keeping the metronome locked to a real,
  // onset-aligned beat grid — unlike just re-typing a doubled/halved BPM
  // (handleBpmChange above), which would fall out of grid mode into plain
  // constant-tempo scheduling.
  //
  // Doubling re-runs beat detection with the corrected tempo as an explicit prior
  // (detect_bpm.py's --bpm-hint) rather than arithmetically interpolating/
  // decimating the already-detected grid client-side: the original
  // arithmetic-only approach (tempoOctaveCorrection.ts) assumes perfectly
  // uniform spacing between detected beats, which real recordings (natural
  // human timing, non-quantized performances) don't actually have —
  // reported as an audible "se adelanta y se atrasa" (drifts ahead/behind)
  // alternating pattern on doubling, since every other click (the
  // arithmetic midpoint) landed slightly off the real transient while the
  // originally-detected clicks stayed correct. Re-detecting via librosa's
  // beat tracker at the corrected tempo instead finds genuinely
  // onset-aligned positions directly from the audio. Falls back to the
  // arithmetic approach only if redetection itself fails (e.g. the Python
  // worker errors) — an imperfect grid is still better than none.
  // See openspec/changes/add-tempo-octave-correction.
  const handleCorrectTempoOctave = useCallback(
    (direction: TempoOctaveDirection): void => {
      if (stems.length === 0 || correctingTempoOctave) return
      const hintBpm =
        direction === 'double' ? originalBpmRef.current * 2 : originalBpmRef.current / 2

      if (direction === 'halve') {
        // Halving needs no new detection: every other beat of the current
        // (Beat This!) grid is exact, and re-running the drums-only librosa
        // tracker would lose what it follows (e.g. a drumless intro). Keep
        // the half holding the downbeat; old downbeat index s → new s/2.
        const shift = downbeatShiftRef.current
        applyTempoOctaveCorrection({
          ...correctTempoOctave(
            beatTimesRef.current,
            originalBpmRef.current,
            firstBeatOffsetRef.current,
            'halve',
            shift % 2
          ),
          downbeatShift: Math.floor(shift / 2)
        })
        return
      }

      setCorrectingTempoOctave(true)
      ;(async (): Promise<void> => {
        try {
          const redetected = await window.api?.detectBpm(
            pickBeatTrackingStem(stems) ?? stems[0],
            hintBpm
          )
          if (redetected && redetected.beatTimes.length > 0) {
            applyTempoOctaveCorrection(redetected)
            return
          }
        } catch {
          /* fall through to the arithmetic fallback below */
        }
        applyTempoOctaveCorrection(
          correctTempoOctave(
            beatTimesRef.current,
            originalBpmRef.current,
            firstBeatOffsetRef.current,
            direction
          )
        )
      })().finally(() => setCorrectingTempoOctave(false))
    },
    [
      stems,
      correctingTempoOctave,
      originalBpmRef,
      beatTimesRef,
      firstBeatOffsetRef,
      downbeatShiftRef,
      applyTempoOctaveCorrection
    ]
  )

  const handleMetronomeToggle = useCallback((): void => {
    setMetronomeOn((prev) => !prev)
  }, [setMetronomeOn])
  const handleMetroVolumeChange = useCallback(
    (v: number): void => {
      setMetroVolume(v)
    },
    [setMetroVolume]
  )
  const handleMonitorVolumeChange = useCallback(
    (v: number): void => {
      setMonitorVolume(v)
    },
    [setMonitorVolume]
  )
  const handleRecordingFormatChange = useCallback(
    (fmt: 'wav' | 'mp3'): void => {
      setRecordingFormat(fmt)
    },
    [setRecordingFormat]
  )
  const handleCountInBarsChange = useCallback(
    (bars: number): void => {
      setCountInBars(bars)
    },
    [setCountInBars]
  )
  const handleShowExportModal = useCallback((): void => {
    setShowExportModal(true)
  }, [setShowExportModal])

  return (
    <>
      <div className="flex gap-5 w-full">
        <div className="flex-1 space-y-6 min-w-0 order-0">
          <div className="bg-neutral-900/80 rounded-md border border-neutral-800 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-white">{songName}</h2>
              {onNextSong && (
                <button
                  onClick={onNextSong}
                  disabled={!hasNextSong}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-neutral-800 text-neutral-300 hover:text-white hover:bg-neutral-700 transition-colors disabled:opacity-30 disabled:hover:text-neutral-300 disabled:hover:bg-neutral-800 flex items-center gap-1.5"
                  title={hasNextSong ? 'Next song in setlist' : 'End of setlist'}
                >
                  Next Song &#9654;
                </button>
              )}
            </div>
            {liveMode && (
              <LivePresetBar
                presets={livePresets}
                activePresetId={activePresetId}
                onApply={handleApplyPreset}
                onSave={handleSavePreset}
                onDelete={handleDeletePreset}
              />
            )}
          </div>

          <TimelinePanel
            markers={markers}
            loopStart={loopStart}
            loopEnd={loopEnd}
            loopEnabled={loopEnabled}
            trimStart={trimStart}
            trimEnd={trimEnd}
            masterWaveDuration={masterWaveDuration}
            duration={duration}
            masterWaveContainerRef={masterWaveContainer}
            onSetLoopStart={handleSetLoopStart}
            onSetLoopEnd={handleSetLoopEnd}
            onToggleLoop={handleToggleLoop}
            onClearMarkers={handleClearMarkers}
            onRemoveMarker={handleRemoveMarker}
            onSetTrimStart={() => handleSetTrimStart(positionRef.current)}
            onSetTrimEnd={() => handleSetTrimEndWithToast(positionRef.current)}
            onClearTrim={handleClearTrim}
          />

          <StemGrid
            items={stemItems}
            masterPlaying={masterPlaying}
            active={active}
            solo={solo}
            duration={duration}
            exporting={exporting}
            recording={recording}
            recordingKey={recordingKey}
            formatTime={formatTime}
            stemVolumes={stemVolumes}
            stemPannings={stemPannings}
            stemCallbacks={stemCallbacks}
            onStopRecording={handleStopRecording}
          />
        </div>

        <MasterPanel
          masterPlaying={masterPlaying}
          masterVolume={masterVolume}
          masterPan={masterPan}
          duration={duration}
          bpm={bpm}
          metronomeOn={metronomeOn}
          metroVolume={metroVolume}
          metroPan={metroPan}
          monitorVolume={monitorVolume}
          recordingFormat={recordingFormat}
          countInBars={countInBars}
          playbackCountInBars={playbackCountInBars}
          onToggleMasterPlay={handleToggleMasterPlayWithCountIn}
          onPlaybackCountInBarsChange={setPlaybackCountInBars}
          onRestart={handleRestart}
          onMasterVolumeChange={handleMasterVolume}
          onMasterPanChange={setMasterPan}
          onBpmDecrement={handleBpmDecrement}
          onBpmChange={handleBpmChange}
          onBpmIncrement={handleBpmIncrement}
          onCorrectTempoOctave={handleCorrectTempoOctave}
          downbeatShift={downbeatShift}
          speed={speed}
          semitones={semitones}
          onSpeedChange={setSpeed}
          onSemitonesChange={setSemitones}
          pitchShifterError={pitchShifterError}
          onMarkDownbeat={handleMarkDownbeat}
          onDownbeatShiftChange={setDownbeatShift}
          correctingTempoOctave={correctingTempoOctave}
          onMetronomeToggle={handleMetronomeToggle}
          onMetroVolumeChange={handleMetroVolumeChange}
          onMetroPanChange={setMetroPan}
          onMonitorVolumeChange={handleMonitorVolumeChange}
          onRecordingFormatChange={handleRecordingFormatChange}
          onCountInBarsChange={handleCountInBarsChange}
          onShowExportModal={handleShowExportModal}
        />
      </div>

      {recording === 'countdown' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <span className="text-8xl font-bold text-white animate-pulse drop-shadow-2xl">
            {recordingCount > 0 ? recordingCount : ''}
          </span>
        </div>
      )}

      {playbackCounting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <span className="text-8xl font-bold text-brand-primary animate-pulse drop-shadow-2xl">
            {playbackCountRemaining > 0 ? playbackCountRemaining : ''}
          </span>
        </div>
      )}

      {recording === 'confirming' && (
        <RecordingConfirmationModal
          elapsed={recordingElapsed}
          stemLabel={recordingKey ? (STEM_META[recordingKey]?.label ?? recordingKey) : ''}
          formatTime={formatTime}
          onDiscard={handleDiscardRecording}
          onSave={handleSaveRecording}
        />
      )}

      <ExportModal
        show={showExportModal}
        stemItems={stemItems}
        exportSelection={exportSelection}
        exportFormat={exportFormat}
        exportWithMetronome={exportWithMetronome}
        exporting={exporting}
        bpm={bpm}
        onToggleSelection={toggleExportSelection}
        onSetFormat={setExportFormat}
        onSetMetronome={setExportWithMetronome}
        onClose={() => setShowExportModal(false)}
        onExport={() => {
          setShowExportModal(false)
          handleExportMix()
        }}
      />

      {showMarkerInput && (
        <MarkerLabelInput
          time={pendingMarkerTime}
          formatTime={formatTime}
          onSave={(label) => {
            setMarkers((prev) =>
              [...prev, { time: pendingMarkerTime, label }].sort((a, b) => a.time - b.time)
            )
            setShowMarkerInput(false)
          }}
          onCancel={() => setShowMarkerInput(false)}
        />
      )}
    </>
  )
}

export default StemPlayer
