import { useState, useMemo, useCallback, useRef, useLayoutEffect, useEffect } from 'react'
import ExportModal from './ExportModal'
import MarkerLabelInput from './MarkerLabelInput'
import RecordingConfirmationModal from './RecordingConfirmationModal'
import StemGrid from './StemGrid'
import MasterPanel from './MasterPanel'
import TimelinePanel from './TimelinePanel'
import { useMetronome } from '../hooks/useMetronome'
import { useRecording } from '../hooks/useRecording'
import useSongAnalysis from '../hooks/useSongAnalysis'
import useMarkers from '../hooks/useMarkers'
import useTrim from '../hooks/useTrim'
import useSongCountIn from '../hooks/useSongCountIn'
import useCountIn from '../hooks/useCountIn'
import { useExportState } from '../hooks/useExportState'
import { useWaveSurfers } from '../hooks/useWaveSurfers'
import { useAudioContextEngine } from '../hooks/useAudioContextEngine'
import {
  stemNameFromPath,
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
  hasNextSong
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
  const lastScheduledBeatRef = useRef(-1)
  const seekRef = useRef<(time: number) => void>(() => {})
  // Break the useWaveSurfers <-> useAudioContextEngine circular dependency the
  // same way seekRef does: a stable ref box owned by StemPlayer, written by one
  // hook's return value and read by the other's params (see design.md - Ordering).
  const getDecodedBufferRef = useRef<(key: string) => AudioBuffer | undefined>(() => undefined)
  const notifyStemDecodedRef = useRef<(key: string) => void>(() => {})

  const masterPlayingRef = useRef(masterPlaying)
  const durationRef = useRef(0)
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
    bpm,
    setBpm,
    metronomeOn,
    setMetronomeOn,
    metroVolume,
    setMetroVolume,
    clickPreset,
    setClickPreset,
    metroPan,
    setMetroPan,
    playClick,
    ensureAudioCtx: ensureMetronomeAudioCtx
  } = useMetronome(
    masterPlaying,
    masterPlayingRef,
    positionRef,
    firstBeatOffsetRef,
    originalBpmRef,
    beatTimesRef
  )

  useSongAnalysis(urls, stems, setBpm, firstBeatOffsetRef, originalBpmRef, beatTimesRef)

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
    bpm,
    stemMeta: STEM_META,
    trimStart,
    trimEnd,
    clickPreset
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

  const handleToggleMasterPlayWithCountIn = useCallback((): void => {
    if (playbackCounting) {
      playbackCountIn.cancel()
      setPlaybackCounting(false)
      return
    }
    if (!masterPlaying && playbackCountInBars > 0) {
      setPlaybackCounting(true)
      playbackCountIn.start(
        playbackCountInBars,
        bpm,
        (remaining) => setPlaybackCountRemaining(remaining),
        () => {
          setPlaybackCounting(false)
          toggleMasterPlay()
        }
      )
      return
    }
    toggleMasterPlay()
  }, [playbackCounting, masterPlaying, playbackCountInBars, bpm, playbackCountIn, toggleMasterPlay])

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
        onStartRecording: () => handleStartRecording(key),
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
    handleStemVolume,
    handleStemPanning,
    handleDeleteRecording
  ])

  const handleBpmDecrement = useCallback((): void => {
    setBpm((prev) => {
      const next = Math.max(BPM_MIN, prev - 1)
      lastScheduledBeatRef.current = -1
      return next
    })
  }, [setBpm])
  const handleBpmIncrement = useCallback((): void => {
    setBpm((prev) => {
      const next = Math.min(BPM_MAX, prev + 1)
      lastScheduledBeatRef.current = -1
      return next
    })
  }, [setBpm])
  const handleBpmChange = useCallback(
    (v: number): void => {
      setBpm(v)
      lastScheduledBeatRef.current = -1
    },
    [setBpm]
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
          <div className="bg-neutral-900/80 rounded-md border border-neutral-800 p-5">
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
          clickPreset={clickPreset}
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
          onMetronomeToggle={handleMetronomeToggle}
          onMetroVolumeChange={handleMetroVolumeChange}
          onMetroPanChange={setMetroPan}
          onClickPresetChange={setClickPreset}
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
