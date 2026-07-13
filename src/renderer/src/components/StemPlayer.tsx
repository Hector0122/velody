import { useState, useMemo, useCallback, useRef } from 'react'
import ExportModal from './ExportModal'
import JamZone from './JamZone'
import MarkerLabelInput from './MarkerLabelInput'
import RecordingConfirmationModal from './RecordingConfirmationModal'
import StemGrid from './StemGrid'
import MasterPanel from './MasterPanel'
import TimelinePanel from './TimelinePanel'
import { useMetronome } from '../hooks/useMetronome'
import { useRecording } from '../hooks/useRecording'
import useSongAnalysis from '../hooks/useSongAnalysis'
import useKeyPitch from '../hooks/useKeyPitch'
import useMarkers from '../hooks/useMarkers'
import { useExportState } from '../hooks/useExportState'
import { usePanningGraph } from '../hooks/usePanningGraph'
import { useWaveSurfers } from '../hooks/useWaveSurfers'
import { usePlaybackEngine } from '../hooks/usePlaybackEngine'
import { stemNameFromPath, formatTime, BPM_MIN, BPM_MAX } from '../utils'

interface StemPlayerProps {
  stems: string[]
  songName: string
  onExportAll: () => Promise<void>
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

function StemPlayer({ stems, songName, onExportAll }: StemPlayerProps): React.JSX.Element {
  const [progress, setProgress] = useState(0)
  const [masterVolume, setMasterVolume] = useState(1)
  const [masterPlaying, setMasterPlaying] = useState(false)
  const [active, setActive] = useState<Record<string, boolean>>({})
  const [solo, setSolo] = useState<Record<string, boolean>>({})
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [stemVolumes, setStemVolumes] = useState<Record<string, number>>({})
  const [stemPannings, setStemPannings] = useState<Record<string, number>>({})

  // Recording — state owned by hook; recordedStems stays here for UI
  const [recordedStems, setRecordedStems] = useState<string[]>([])

  // Key (detectedKey owned here — passed to useSongAnalysis + useKeyPitch)
  const [detectedKey, setDetectedKey] = useState<string | null>(null)

  const allStems = useMemo(() => [...stems, ...recordedStems], [stems, recordedStems])

  const audioEls = useRef<Record<string, HTMLAudioElement>>({})
  const positionRef = useRef(0)
  const activeRef = useRef<Record<string, boolean>>({})
  const onAudioTimeRef = useRef<(time: number) => void>(() => {})
  const stemsRef = useRef<string[]>([])
  const lastSeekRef = useRef(0)

  const audioStartRef = useRef<number | null>(null)

  // Shared refs (used by metronome + recording hooks)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const masterPlayingRef = useRef(masterPlaying)
  const playbackRateRef = useRef(1)
  const durationRef = useRef(0)

  // Metronome hook
  const {
    bpm,
    setBpm,
    metronomeOn,
    setMetronomeOn,
    metroVolume,
    setMetroVolume,
    lastScheduledBeatRef,
    bpmRef,
    playClick
  } = useMetronome(
    audioCtxRef,
    audioEls,
    playbackRateRef,
    masterPlaying,
    masterPlayingRef,
    positionRef
  )

  // Song analysis (BPM + key detection) — must come before stemItems
  const originalBpmRef = useSongAnalysis(urls, stems, setBpm, setDetectedKey)
  const {
    manualKey,
    effectiveKey,
    pitchShift,
    shiftedPaths,
    transposing,
    showKeyPicker,
    showJamZone,
    selectedScaleIdx,
    scalesMaxH,
    fretboardColRef,
    setShowJamZone,
    setSelectedScaleIdx,
    handleKeySelect,
    handleKeyReset,
    handlePitchShift,
    handleToggleKeyPicker
  } = useKeyPitch(stems, allStems, detectedKey)
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

  // Export state
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
  } = useExportState({ allStems, songName, bpm, stemMeta: STEM_META })

  // Panning graph (AudioContext + StereoPannerNode routing)
  const {
    ensureAudioContext,
    setupPanningForKey,
    setupAllPanning,
    panNodesRef,
    disconnectPanner,
    disconnectAllPanners
  } = usePanningGraph({ audioCtxRef, audioEls, stemPannings })

  // Stem item metadata (computed early for WaveSurfers)
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

  // WaveSurfers (master + stem waveform lifecycle)
  const {
    stemWaves,
    waveUrlsRef,
    masterWaveContainer,
    masterWaveDuration,
    duration,
    ensureWaveSurfer,
    syncStemCursors
  } = useWaveSurfers({
    stemItems,
    urls,
    audioEls,
    durationRef,
    positionRef,
    lastSeekRef,
    progress,
    setProgress,
    onMasterDblClick: (time) => {
      setPendingMarkerTime(time)
      setShowMarkerInput(true)
    }
  })

  // Recording hook (needs stemWaves + waveUrlsRef from useWaveSurfers)
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
    mediaStreamRef,
    handleStartRecording,
    handleStopRecording,
    handleDiscardRecording,
    handleSaveRecording
  } = useRecording({
    audioCtxRef,
    audioEls,
    stemWaves,
    waveUrlsRef,
    playbackRateRef,
    bpm,
    positionRef,
    audioStartRef,
    stems,
    stemMeta: STEM_META,
    playClick,
    setRecordedStems,
    setProgress
  })

  // Playback engine (audio elements, volume, play/pause, timeupdate, cleanup)
  const engine = usePlaybackEngine({
    // Shared refs
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
    // State + setters
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
    // Other state
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
    // Other hook outputs
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
  })

  const {
    toggleStem,
    toggleMasterPlay,
    handleRestart,
    toggleSolo,
    handleDeleteRecording,
    handleMasterVolume,
    handleStemVolume,
    handleStemPanning
  } = engine

  const handleOpenTab = useCallback(
    (stemKey: string): void => {
      if (!window.api) return
      const label = STEM_META[stemKey]?.label ?? stemKey
      const query = encodeURIComponent(`${songName} ${label} tab`)
      const url = `https://www.ultimate-guitar.com/search.php?search_type=title&value=${query}`
      window.api.openInBrowser(url)
    },
    [songName]
  )

  // BPM callbacks
  const handleBpmDecrement = useCallback((): void => {
    setBpm((prev) => {
      const next = Math.max(BPM_MIN, prev - 1)
      lastScheduledBeatRef.current = -1
      return next
    })
  }, [setBpm, lastScheduledBeatRef])
  const handleBpmIncrement = useCallback((): void => {
    setBpm((prev) => {
      const next = Math.min(BPM_MAX, prev + 1)
      lastScheduledBeatRef.current = -1
      return next
    })
  }, [setBpm, lastScheduledBeatRef])
  const handleBpmChange = useCallback(
    (v: number): void => {
      setBpm(v)
      lastScheduledBeatRef.current = -1
    },
    [setBpm, lastScheduledBeatRef]
  )

  // Search for "setBpm" calls to also handle lastScheduledBeatRef
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

  return (
    <>
      <div className="flex gap-5 w-full">
        <div className="flex-1 space-y-6 min-w-0 order-0">
          <div className="bg-neutral-900/80 rounded-xl border border-neutral-800 p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-white">{songName}</h2>
              <div className="flex items-center gap-2">
                {effectiveKey && (
                  <button
                    onClick={() => setShowJamZone(!showJamZone)}
                    className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors ${
                      showJamZone
                        ? 'bg-orange-600 text-white'
                        : 'bg-neutral-800 text-neutral-400 hover:text-white hover:bg-neutral-700'
                    }`}
                  >
                    Jam Zone {showJamZone ? '▲' : '▼'}
                  </button>
                )}
                <button
                  onClick={onExportAll}
                  className="px-4 py-2 text-sm font-semibold bg-green-600 hover:bg-green-500 text-white rounded-lg transition-colors"
                >
                  Export All
                </button>
              </div>
            </div>
          </div>

          {/* Master Timeline */}
          <TimelinePanel
            markers={markers}
            loopStart={loopStart}
            loopEnd={loopEnd}
            loopEnabled={loopEnabled}
            masterWaveDuration={masterWaveDuration}
            duration={duration}
            progress={progress}
            masterWaveContainerRef={masterWaveContainer}
            onSetLoopStart={handleSetLoopStart}
            onSetLoopEnd={handleSetLoopEnd}
            onToggleLoop={handleToggleLoop}
            onClearMarkers={handleClearMarkers}
            onRemoveMarker={handleRemoveMarker}
          />

          {showJamZone && effectiveKey && (
            <JamZone
              effectiveKey={effectiveKey}
              selectedScaleIdx={selectedScaleIdx}
              scalesMaxH={scalesMaxH}
              fretboardColRef={fretboardColRef}
              onSelectScale={setSelectedScaleIdx}
            />
          )}

          <StemGrid
            items={stemItems}
            masterPlaying={masterPlaying}
            active={active}
            solo={solo}
            progress={progress}
            duration={duration}
            exporting={exporting}
            recording={recording}
            recordingKey={recordingKey}
            recordingElapsed={recordingElapsed}
            formatTime={formatTime}
            allStems={allStems}
            stemVolumes={stemVolumes}
            stemPannings={stemPannings}
            onToggleStem={toggleStem}
            onToggleSolo={toggleSolo}
            onExportSingle={handleExportSingle}
            onOpenTab={handleOpenTab}
            onStartRecording={handleStartRecording}
            onStopRecording={handleStopRecording}
            onDeleteRecording={handleDeleteRecording}
            onStemVolume={handleStemVolume}
            onStemPanning={handleStemPanning}
          />
        </div>

        <MasterPanel
          masterPlaying={masterPlaying}
          masterVolume={masterVolume}
          progress={progress}
          duration={duration}
          effectiveKey={effectiveKey}
          manualKey={manualKey}
          detectedKey={detectedKey}
          pitchShift={pitchShift}
          transposing={transposing}
          bpm={bpm}
          metronomeOn={metronomeOn}
          metroVolume={metroVolume}
          monitorVolume={monitorVolume}
          recordingFormat={recordingFormat}
          countInBars={countInBars}
          showKeyPicker={showKeyPicker}
          onToggleMasterPlay={toggleMasterPlay}
          onRestart={handleRestart}
          onMasterVolumeChange={handleMasterVolume}
          onPitchShift={handlePitchShift}
          onBpmDecrement={handleBpmDecrement}
          onBpmChange={handleBpmChange}
          onBpmIncrement={handleBpmIncrement}
          onMetronomeToggle={handleMetronomeToggle}
          onMetroVolumeChange={handleMetroVolumeChange}
          onMonitorVolumeChange={handleMonitorVolumeChange}
          onRecordingFormatChange={handleRecordingFormatChange}
          onCountInBarsChange={handleCountInBarsChange}
          onShowExportModal={() => setShowExportModal(true)}
          onToggleKeyPicker={handleToggleKeyPicker}
          onKeySelect={handleKeySelect}
          onKeyReset={handleKeyReset}
        />
      </div>

      {/* Countdown overlay */}
      {recording === 'countdown' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <span className="text-8xl font-bold text-white animate-pulse drop-shadow-2xl">
            {recordingCount > 0 ? recordingCount : ''}
          </span>
        </div>
      )}

      {/* Confirmation modal */}
      {recording === 'confirming' && (
        <RecordingConfirmationModal
          elapsed={recordingElapsed}
          stemLabel={recordingKey ? (STEM_META[recordingKey]?.label ?? recordingKey) : ''}
          formatTime={formatTime}
          onDiscard={handleDiscardRecording}
          onSave={handleSaveRecording}
        />
      )}

      {/* Export Mix modal */}
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

      {/* Audio elements (always mounted, not virtualized) */}
      <div className="hidden" aria-hidden="true">
        {stemItems.map(({ key, isRecording }) => (
          <audio
            key={key}
            ref={(el) => {
              if (el) {
                audioEls.current[key] = el
                el.preload = 'none'
                el.crossOrigin = 'anonymous'
                if (!isRecording) {
                  el.ontimeupdate = () => onAudioTimeRef.current(el.currentTime)
                }
              }
            }}
          />
        ))}
      </div>

      {/* Marker label input */}
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
