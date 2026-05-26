import { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo } from 'react'
import WaveSurfer from 'wavesurfer.js'
import ExportModal from './ExportModal'
import JamZone from './JamZone'
import RecordingConfirmationModal from './RecordingConfirmationModal'
import StemGrid from './StemGrid'
import MasterPanel from './MasterPanel'
import TimelinePanel from './TimelinePanel'
import { useMetronome } from '../hooks/useMetronome'
import { useRecording } from '../hooks/useRecording'

const CACHE_VERSION = 9
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

function stemNameFromPath(path: string): string {
  return (
    path
      .split(/[/\\]/)
      .pop()
      ?.replace(/\.[^.]+$/, '') || path
  )
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

const extForFormat = (fmt: string): string => (fmt === 'mp3' ? '.mp3' : '.wav')
const formatFilter = (fmt: string): { name: string; extensions: string[] } =>
  fmt === 'mp3'
    ? { name: 'MP3 Audio', extensions: ['mp3'] }
    : { name: 'WAV Audio', extensions: ['wav'] }

function StemPlayer({ stems, songName, onExportAll }: StemPlayerProps): React.JSX.Element {
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(0)
  const [masterVolume, setMasterVolume] = useState(1)
  const [masterPlaying, setMasterPlaying] = useState(false)
  const [active, setActive] = useState<Record<string, boolean>>({})
  const [solo, setSolo] = useState<Record<string, boolean>>({})
  const [urls, setUrls] = useState<Record<string, string>>({})

  // Export
  const [showExportModal, setShowExportModal] = useState(false)
  const [exportSelection, setExportSelection] = useState<Record<string, boolean>>({})
  const [exportFormat, setExportFormat] = useState<'wav' | 'mp3'>('wav')
  const [exportWithMetronome, setExportWithMetronome] = useState(false)
  const [exporting, setExporting] = useState(false)

  // Recording — state owned by hook; recordedStems stays here for UI
  const [recordedStems, setRecordedStems] = useState<string[]>([])

  // Key & Pitch
  const [detectedKey, setDetectedKey] = useState<string | null>(null)
  const [manualKey, setManualKey] = useState<string | null>(null)
  const [showKeyPicker, setShowKeyPicker] = useState(false)
  const effectiveKey = manualKey ?? detectedKey
  const [pitchShift, setPitchShift] = useState(0)
  const [shiftedPaths, setShiftedPaths] = useState<Record<string, string>>({})
  const [transposing, setTransposing] = useState(false)
  const [showJamZone, setShowJamZone] = useState(false)
  const [selectedScaleIdx, setSelectedScaleIdx] = useState(0)

  // Markers & Loop
  const [markers, setMarkers] = useState<{ time: number; label: string }[]>([])
  const [loopStart, setLoopStart] = useState<number | null>(null)
  const [loopEnd, setLoopEnd] = useState<number | null>(null)
  const [loopEnabled, setLoopEnabled] = useState(false)
  const [pendingMarkerTime, setPendingMarkerTime] = useState(0)
  const [showMarkerInput, setShowMarkerInput] = useState(false)
  const fretboardColRef = useRef<HTMLDivElement | null>(null)
  const [scalesMaxH, setScalesMaxH] = useState<number>(400)

  // Sync scales list height to fretboard column height
  useLayoutEffect(() => {
    const el = fretboardColRef.current
    if (!showJamZone || !el) return
    const update = (): void => {
      setScalesMaxH(el.offsetHeight)
    }
    update()
    const obs = new ResizeObserver(update)
    obs.observe(el)
    return () => obs.disconnect()
  }, [showJamZone])

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

  // We create stem WaveSurfers eagerly when URLs load so mini-waveforms
  // are ready before the user presses play.

  // Shared refs (used by metronome + recording hooks)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const masterPlayingRef = useRef(masterPlaying)
  const originalBpmRef = useRef(120)
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

  // Auto-detect BPM + key — cache results to avoid re-processing
  useEffect(() => {
    const allUrls = Object.values(urls)
    if (allUrls.length === 0 || stems.length === 0) return
    const songDir = stems[0].replace(/[/\\][^/\\]+$/, '')

    const runKeyDetection = (bpmVal: number): void => {
      if (window.api) {
        window.api.detectKey(songDir, stems).then((key) => {
          if (key) {
            setDetectedKey(key)
            window.api.saveMeta(songDir, { bpm: bpmVal, key, _version: CACHE_VERSION })
          }
        })
      }
    }

    ;(async (): Promise<void> => {
      if (window.api) {
        const cached = (await window.api.loadMeta(songDir)) as {
          bpm?: number
          key?: string
          _version?: number
        } | null
        if (cached && cached.bpm && cached._version === CACHE_VERSION) {
          originalBpmRef.current = cached.bpm
          setBpm(cached.bpm)
          if (cached.key) setDetectedKey(cached.key)
          runKeyDetection(cached.bpm)
          return
        }
      }
      try {
        const bufferMap: Record<string, Float32Array> = {}
        let sampleRate = 44100
        let maxLen = 0
        for (const [, url] of Object.entries(urls)) {
          const resp = await fetch(url)
          const buf = await resp.arrayBuffer()
          const offlineCtx = new OfflineAudioContext(1, 1, 44100)
          const decoded = await offlineCtx.decodeAudioData(buf)
          const ch = decoded.getChannelData(0)
          sampleRate = decoded.sampleRate
          if (ch.length > maxLen) maxLen = ch.length
          bufferMap[url] = ch
        }

        const mixed = new Float32Array(maxLen)
        for (const ch of Object.values(bufferMap)) {
          for (let i = 0; i < ch.length; i++) mixed[i] += ch[i]
        }
        let peak = 0
        for (let i = 0; i < mixed.length; i++) {
          const a = Math.abs(mixed[i])
          if (a > peak) peak = a
        }
        if (peak > 1) for (let i = 0; i < mixed.length; i++) mixed[i] /= peak

        const worker = new Worker(new URL('../workers/bpm.worker.ts', import.meta.url), {
          type: 'module'
        })

        const bpmVal = await new Promise<number>((resolveBpm) => {
          worker.onmessage = (e: MessageEvent<{ bpm: number }>) => {
            resolveBpm(e.data.bpm)
            worker.terminate()
          }
          worker.onerror = () => {
            resolveBpm(120)
            worker.terminate()
          }
          worker.postMessage({ mixed, sampleRate }, [mixed.buffer])
        })

        originalBpmRef.current = bpmVal
        setBpm(bpmVal)
        runKeyDetection(bpmVal)
      } catch {
        /* detection failed */
      }
    })()
  }, [urls, stems, setBpm, originalBpmRef, setDetectedKey])

  // Init WaveSurfers eagerly — mini-waveforms ready before user presses play
  useEffect(() => {
    if (Object.keys(urls).length === 0) return

    const currentWaves = stemWaves.current
    const newWaves: Record<string, WaveSurfer> = {}

    for (const { key, meta } of stemItems) {
      const container = document.querySelector(
        `[data-stem-container="${key}"]`
      ) as HTMLDivElement | null
      const url = urls[key]
      if (!container || !url) continue

      // Keep existing waveform if URL hasn't changed
      if (currentWaves[key] && waveUrlsRef.current[key] === url) {
        newWaves[key] = currentWaves[key]
        continue
      }

      // Destroy old waveform if URL changed
      if (currentWaves[key]) {
        currentWaves[key].destroy()
      }

      const ws = WaveSurfer.create({
        container,
        waveColor: meta.color + '30',
        progressColor: meta.color,
        cursorColor: 'transparent',
        barWidth: 1,
        barGap: 0,
        height: 32,
        normalize: true,
        interact: false
      })
      ws.load(url)

      newWaves[key] = ws
      waveUrlsRef.current[key] = url
    }

    // Destroy waveforms for stems that no longer exist
    for (const [key, ws] of Object.entries(currentWaves)) {
      if (!newWaves[key]) {
        ws.destroy()
        delete waveUrlsRef.current[key]
      }
    }

    stemWaves.current = newWaves
  }, [urls, stemItems])

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
      height: 64,
      normalize: true,
      interact: true,
      minPxPerSec: 20
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
  }, [masterUrl])

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
      const soloed = Object.keys(solo).find((k) => solo[k])
      if (soloed) return soloed === key ? masterVolume : 0
      return masterVolume
    },
    [masterPlaying, solo, masterVolume]
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
  }, [bpm, masterPlaying])

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
      const threshold = 0.008
      const maxFrames = Math.min(ch.length, 30 * sr)
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
      if (now - lastSeekRef.current < 50) return
      lastSeekRef.current = now

      setProgress(time)
    },
    [duration, loopEnabled, loopStart, loopEnd]
  )

  // eslint-disable-next-line react-hooks/refs
  onAudioTimeRef.current = onAudioTime

  // Toggle stem active
  const toggleStem = useCallback(
    (key: string): void => {
      const el = audioEls.current[key]
      if (!el) return

      const isActive = !!activeRef.current[key]

      if (!masterPlaying) {
        if (isActive) return // stopped + already active → nothing
        lastScheduledBeatRef.current = -1
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
    [masterPlaying]
  )

  // Master play: enable all / Master stop: disable all
  const toggleMasterPlay = useCallback((): void => {
    if (masterPlaying) {
      for (const el of Object.values(audioEls.current)) el.pause()
      setActive({})
      setMasterPlaying(false)
    } else {
      lastScheduledBeatRef.current = -1
      // Ensure AudioContext exists (needed for clicks playback)
      if (!audioCtxRef.current) {
        try {
          audioCtxRef.current = new AudioContext()
        } catch {
          /* ignore */
        }
      }
      // Master play: enable all stems
      const all: Record<string, boolean> = {}
      for (const path of stemsRef.current) {
        const key = stemNameFromPath(path)
        all[key] = true
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
  }, [masterPlaying])

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

  const handlePitchShift = useCallback(
    async (delta: number): Promise<void> => {
      if (!window.api) return
      const newShift = pitchShift + delta
      if (newShift < -12 || newShift > 12) return
      if (newShift === 0) {
        setPitchShift(0)
        setShiftedPaths({})
        return
      }
      setTransposing(true)
      try {
        const paths = await window.api.transposeStems(allStems, newShift)
        const map: Record<string, string> = {}
        for (const p of paths) map[stemNameFromPath(p)] = p
        setShiftedPaths(map)
        setPitchShift(newShift)
      } catch {
        /* transpose failed */
      }
      setTransposing(false)
    },
    [pitchShift, allStems]
  )

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

  const handleKeySelect = useCallback(
    (key: string): void => {
      setManualKey(key)
      setShowKeyPicker(false)
      const songDir = stems.length > 0 ? stems[0].replace(/[/\\][^/\\]+$/, '') : ''
      if (window.api && songDir) {
        window.api.saveMeta(songDir, { key, _version: CACHE_VERSION } as Record<string, unknown>)
      }
    },
    [stems]
  )

  const handleKeyReset = useCallback((): void => {
    setManualKey(null)
    setShowKeyPicker(false)
  }, [])

  // Memoized marker callbacks for TimelinePanel
  const handleSetLoopStart = useCallback((time: number | null): void => {
    setLoopStart(time)
  }, [])
  const handleSetLoopEnd = useCallback((time: number | null): void => {
    setLoopEnd(time)
  }, [])
  const handleToggleLoop = useCallback((): void => {
    setLoopEnabled((prev) => !prev)
  }, [])
  const handleClearMarkers = useCallback((): void => {
    setMarkers([])
  }, [])
  const handleRemoveMarker = useCallback((i: number): void => {
    setMarkers((prev) => prev.filter((_, idx) => idx !== i))
  }, [])

  const handleToggleKeyPicker = useCallback((): void => {
    setShowKeyPicker((prev) => !prev)
  }, [])

  // BPM callbacks
  const handleBpmDecrement = useCallback((): void => {
    setBpm((prev) => {
      const next = Math.max(40, prev - 1)
      lastScheduledBeatRef.current = -1
      return next
    })
  }, [setBpm, lastScheduledBeatRef])
  const handleBpmIncrement = useCallback((): void => {
    setBpm((prev) => {
      const next = Math.min(280, prev + 1)
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
            onToggleStem={toggleStem}
            onToggleSolo={toggleSolo}
            onExportSingle={handleExportSingle}
            onOpenTab={handleOpenTab}
            onStartRecording={handleStartRecording}
            onStopRecording={handleStopRecording}
            onDeleteRecording={handleDeleteRecording}
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

function MarkerLabelInput({
  time,
  formatTime,
  onSave,
  onCancel
}: {
  time: number
  formatTime: (s: number) => string
  onSave: (label: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const [label, setLabel] = useState(() => {
    const sec = Math.floor(time % 60)
    const min = Math.floor(time / 60)
    return `Section ${min}:${sec.toString().padStart(2, '0')}`
  })
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-neutral-900 border border-neutral-700 rounded-2xl p-5 w-72 shadow-2xl flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-neutral-400 uppercase tracking-wide">
          New Marker
        </h3>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-neutral-500">Position: {formatTime(time)}</span>
          <input
            ref={inputRef}
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Verse, Chorus, Bridge..."
            className="w-full px-3 py-2 rounded-lg text-sm bg-neutral-800 border border-neutral-700 text-white placeholder-neutral-600 focus:outline-none focus:border-orange-500"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && label.trim()) onSave(label.trim())
              if (e.key === 'Escape') onCancel()
            }}
          />
        </div>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2 rounded-lg text-xs font-medium bg-neutral-800 text-neutral-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => label.trim() && onSave(label.trim())}
            disabled={!label.trim()}
            className="flex-1 px-4 py-2 rounded-lg text-xs font-semibold bg-orange-600 hover:bg-orange-500 text-white transition-colors disabled:opacity-50"
          >
            Add Marker
          </button>
        </div>
      </div>
    </div>
  )
}
