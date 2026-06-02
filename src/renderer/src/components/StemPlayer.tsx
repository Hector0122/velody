import { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo } from 'react'
import WaveSurfer from 'wavesurfer.js'
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
import {
  stemNameFromPath,
  formatTime,
  extForFormat,
  formatFilter,
  BPM_MIN,
  BPM_MAX,
  PROGRESS_THROTTLE_MS,
  AUDIO_START_THRESHOLD,
  AUDIO_START_MAX_SCAN_SECS,
  MASTER_WAVEFORM_HEIGHT,
  MASTER_MIN_PX_PER_SEC,
  STEM_WAVEFORM_HEIGHT
} from '../utils'

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
  const [duration, setDuration] = useState(0)
  const [masterVolume, setMasterVolume] = useState(1)
  const [masterPlaying, setMasterPlaying] = useState(false)
  const [active, setActive] = useState<Record<string, boolean>>({})
  const [solo, setSolo] = useState<Record<string, boolean>>({})
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [stemVolumes, setStemVolumes] = useState<Record<string, number>>({})
  const [stemPannings, setStemPannings] = useState<Record<string, number>>({})

  // Export
  const [showExportModal, setShowExportModal] = useState(false)
  const [exportSelection, setExportSelection] = useState<Record<string, boolean>>({})
  const [exportFormat, setExportFormat] = useState<'wav' | 'mp3'>('wav')
  const [exportWithMetronome, setExportWithMetronome] = useState(false)
  const [exporting, setExporting] = useState(false)

  // Recording — state owned by hook; recordedStems stays here for UI
  const [recordedStems, setRecordedStems] = useState<string[]>([])

  // Key (detectedKey owned here — passed to useSongAnalysis + useKeyPitch)
  const [detectedKey, setDetectedKey] = useState<string | null>(null)

  const allStems = useMemo(() => [...stems, ...recordedStems], [stems, recordedStems])

  const audioEls = useRef<Record<string, HTMLAudioElement>>({})
  const stemWaves = useRef<Record<string, WaveSurfer>>({})
  const waveUrlsRef = useRef<Record<string, string>>({})
  const masterWaveRef = useRef<WaveSurfer | null>(null)
  const masterWaveContainer = useRef<HTMLDivElement | null>(null)
  const masterWaveReady = useRef(false)
  const [masterWaveDuration, setMasterWaveDuration] = useState(0)
  const positionRef = useRef(0)
  const activeRef = useRef<Record<string, boolean>>({})
  const onAudioTimeRef = useRef<(time: number) => void>(() => {})
  const stemsRef = useRef<string[]>([])
  const lastSeekRef = useRef(0)

  const audioStartRef = useRef<number | null>(null)

  // Panning: per-stem graph nodes (source → panner → destination)
  const panNodesRef = useRef<
    Record<string, { source: MediaElementAudioSourceNode; panner: StereoPannerNode }>
  >({})

  // We create stem WaveSurfers eagerly when URLs load so mini-waveforms
  // are ready before the user presses play.

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

  // Recording hook
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

  // Song analysis (BPM + key detection)
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

  // Sync shared refs to state
  useLayoutEffect(() => {
    stemsRef.current = allStems
    activeRef.current = active
    masterPlayingRef.current = masterPlaying
    playbackRateRef.current = masterPlaying ? bpmRef.current / originalBpmRef.current : 1
    durationRef.current = masterWaveDuration || duration
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
  }, [allStems, shiftedPaths])

  // Assign audio src once URLs are ready
  useEffect(() => {
    for (const [key, el] of Object.entries(audioEls.current)) {
      if (urls[key] && el.src !== urls[key]) {
        el.src = urls[key]
      }
    }
  }, [urls])

  // Clean up WaveSurfers for stems that no longer exist
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

  // Create a stem WaveSurfer on demand (lazy)
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

  // Load pending waveform data when URLs become available
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

  // Init master timeline WaveSurfer
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
      positionRef.current = clickTime
      lastSeekRef.current = Date.now()
      for (const el of Object.values(audioEls.current)) {
        el.currentTime = clickTime
      }
      for (const sw of Object.values(stemWaves.current)) {
        sw.seekTo(clickTime / d)
      }
      setProgress(clickTime)
    })

    ws.on('dblclick', (relativeX: number) => {
      const d = ws.getDuration()
      const clickTime = relativeX * d
      setPendingMarkerTime(clickTime)
      setShowMarkerInput(true)
    })

    masterWaveRef.current = ws

    return () => {
      ws.destroy()
      masterWaveRef.current = null
      masterWaveReady.current = false
    }
  }, [masterUrl]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sync master WaveSurfer progress
  useEffect(() => {
    if (!masterWaveReady.current) return
    const d = masterWaveDuration || duration || 1
    masterWaveRef.current?.seekTo(progress / d)
  }, [progress, masterWaveDuration, duration])

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
    [masterPlaying, solo, masterVolume, stemVolumes]
  )

  const applyVolume = useCallback(
    (key: string): void => {
      const el = audioEls.current[key]
      if (el) el.volume = computeVolume(key)
    },
    [computeVolume]
  )

  const applyAllVolumes = useCallback((): void => {
    for (const key of Object.keys(audioEls.current)) applyVolume(key)
  }, [applyVolume])

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
  }, [allStems])

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
    if (!masterUrl) return
    audioStartRef.current = null
    detectAudioStart(masterUrl).then((t) => {
      audioStartRef.current = t
    })
  }, [masterUrl, detectAudioStart])

  // Close AudioContext on unmount
  useEffect(() => {
    return () => {
      for (const nodes of Object.values(panNodesRef.current)) {
        try {
          nodes.panner.disconnect()
        } catch {
          /* ignore */
        }
      }
      panNodesRef.current = {}
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

      // Loop: if enabled and past loopEnd, seek back to loopStart
      if (loopEnabled && loopStart !== null && loopEnd !== null && time >= loopEnd) {
        const seekTime = loopStart
        positionRef.current = seekTime
        for (const el of Object.values(audioEls.current)) {
          el.currentTime = seekTime
        }
        setProgress(seekTime)
        return
      }

      // Sync WaveSurfer cursors every call (Canvas-only, no React render)
      const d = durationRef.current || duration || 1
      for (const sw of Object.values(stemWaves.current)) {
        sw.seekTo(time / d)
      }

      // Throttle React setProgress to ~20fps to reduce re-renders
      const now = Date.now()
      if (now - lastSeekRef.current < PROGRESS_THROTTLE_MS) return
      lastSeekRef.current = now

      setProgress(time)
    },
    [duration, loopEnabled, loopStart, loopEnd]
  )

  // eslint-disable-next-line react-hooks/refs
  onAudioTimeRef.current = onAudioTime

  // --- AudioContext panning helpers ---
  // Ensure AudioContext exists and is running. Must be called from a user-gesture handler.
  const ensureAudioContext = useCallback((): AudioContext | null => {
    if (!audioCtxRef.current) {
      try {
        audioCtxRef.current = new AudioContext()
        console.log('[pan] AudioContext created, state=', audioCtxRef.current.state)
      } catch (e) {
        console.error('[pan] AudioContext creation failed', e)
        return null
      }
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume()
      console.log('[pan] AudioContext resume() called, state=', audioCtxRef.current.state)
    }
    return audioCtxRef.current
  }, [])

  // Set up AudioContext routing for a single stem. Called after ensureAudioContext.
  const setupPanningForKey = useCallback(
    (key: string): void => {
      if (panNodesRef.current[key]) {
        console.log('[pan] setup skipped for', key, '- already wired')
        return
      }
      const ctx = audioCtxRef.current
      if (!ctx) {
        console.log('[pan] setup aborted for', key, '- no AudioContext')
        return
      }
      const el = audioEls.current[key]
      if (!el) {
        console.log('[pan] setup aborted for', key, '- no audio element')
        return
      }
      try {
        const source = ctx.createMediaElementSource(el)
        const panner = ctx.createStereoPanner()
        panner.pan.value = stemPannings[key] ?? 0
        source.connect(panner)
        panner.connect(ctx.destination)
        panNodesRef.current[key] = { source, panner }
        console.log('[pan] SUCCESS for', key, 'pan=', panner.pan.value, 'ctx.state=', ctx.state)
      } catch (err) {
        console.error('[pan] FAILED for', key, err)
      }
    },
    [stemPannings]
  )

  // Set up panning for all stems that have a non-zero pan configured.
  const setupAllPanning = useCallback((): void => {
    for (const key of Object.keys(stemPannings)) {
      setupPanningForKey(key)
    }
  }, [stemPannings, setupPanningForKey])

  // Sync panner values reactively when sliders move after graph is wired.
  useEffect(() => {
    for (const [key, nodes] of Object.entries(panNodesRef.current)) {
      nodes.panner.pan.value = stemPannings[key] ?? 0
    }
  }, [stemPannings])

  // Toggle stem active
  const toggleStem = useCallback(
    (key: string): void => {
      const el = audioEls.current[key]
      if (!el) return

      const isActive = !!activeRef.current[key]

      if (!masterPlaying) {
        if (isActive) return // stopped + already active → nothing
        lastScheduledBeatRef.current = -1
        ensureAudioContext()
        setupAllPanning()
        ensureWaveSurfer(key)
        // Start with only this stem
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
        // Toggle while playing
        setActive((prev) => ({ ...prev, [key]: !prev[key] }))
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [masterPlaying, ensureWaveSurfer]
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
      // Master play: enable all stems
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [masterPlaying, ensureWaveSurfer])

  const handleRestart = useCallback((): void => {
    positionRef.current = 0
    setProgress(0)
    for (const el of Object.values(audioEls.current)) {
      el.currentTime = 0
    }
    for (const sw of Object.values(stemWaves.current)) {
      sw.seekTo(0)
    }
  }, [])

  // Solo: only one stem at a time, toggle on/off
  const toggleSolo = useCallback((key: string): void => {
    setSolo((prev) => {
      if (prev[key]) return {} // un-solo
      return { [key]: true } // solo this one, clear others
    })
  }, [])

  const handleExportSingle = useCallback(
    async (key: string): Promise<void> => {
      if (!window.api) return
      const stemPath = allStems.find((p) => stemNameFromPath(p) === key)
      if (!stemPath) return
      const stemLabel = STEM_META[key]?.label ?? key
      const outPath = await window.api.saveFileDialog(
        `${songName} - ${stemLabel}${extForFormat(exportFormat)}`,
        [formatFilter(exportFormat)]
      )
      if (!outPath) return
      setExporting(true)
      await window.api.exportSingle(stemPath, outPath)
      setExporting(false)
    },
    [allStems, songName, exportFormat]
  )

  const handleExportMix = useCallback(async (): Promise<void> => {
    if (!window.api) return
    const selected = Object.entries(exportSelection)
      .filter(([, v]) => v)
      .map(([k]) => k)
    if (selected.length === 0) return
    const stemPaths = selected
      .map((k) => allStems.find((p) => stemNameFromPath(p) === k))
      .filter((p): p is string => !!p)
    const outPath = await window.api.saveFileDialog(
      `${songName} - Mix${extForFormat(exportFormat)}`,
      [formatFilter(exportFormat)]
    )
    if (!outPath) return
    setExporting(true)
    await window.api.exportMix(stemPaths, outPath, exportWithMetronome ? { bpm } : undefined)
    setExporting(false)
  }, [exportSelection, allStems, songName, exportFormat, exportWithMetronome, bpm])

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

  const toggleExportSelection = useCallback((key: string): void => {
    setExportSelection((prev) => ({ ...prev, [key]: !prev[key] }))
  }, [])

  const handleDeleteRecording = useCallback(async (path: string): Promise<void> => {
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
    if (panNodesRef.current[key]) {
      try {
        panNodesRef.current[key].panner.disconnect()
      } catch {
        /* ignore */
      }
      delete panNodesRef.current[key]
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
  }, [])

  const handleMasterVolume = useCallback((e: React.ChangeEvent<HTMLInputElement>): void => {
    setMasterVolume(parseFloat(e.target.value))
  }, [])

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

  const handleStemVolume = useCallback((key: string, value: number): void => {
    setStemVolumes((prev) => ({ ...prev, [key]: value }))
  }, [])
  const handleStemPanning = useCallback(
    (key: string, value: number): void => {
      setStemPannings((prev) => ({ ...prev, [key]: value }))

      // If graph not yet wired, set it up now (slider change is a user gesture)
      if (!panNodesRef.current[key]) {
        console.log('[pan] wiring graph for', key, 'pan=', value)
        ensureAudioContext()
        setupPanningForKey(key)
      } else {
        console.log('[pan] graph already wired for', key, 'updating to', value)
      }
    },
    [ensureAudioContext, setupPanningForKey]
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
