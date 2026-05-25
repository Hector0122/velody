import { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo } from 'react'
import WaveSurfer from 'wavesurfer.js'
import ExportModal from './ExportModal'
import JamZone from './JamZone'
import RecordingConfirmationModal from './RecordingConfirmationModal'
import TimelineMarkers from './TimelineMarkers'
import StemCard from './StemCard'
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

  const keyPickerRef = useRef<HTMLDivElement | null>(null)

  // Close key picker on click outside
  useEffect(() => {
    if (!showKeyPicker) return
    const handler = (e: MouseEvent): void => {
      if (keyPickerRef.current && !keyPickerRef.current.contains(e.target as Node)) {
        setShowKeyPicker(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showKeyPicker])

  const audioEls = useRef<Record<string, HTMLAudioElement>>({})
  const stemWaves = useRef<Record<string, WaveSurfer>>({})
  const waveUrlsRef = useRef<Record<string, string>>({})
  const stemContainers = useRef<Record<string, HTMLDivElement | null>>({})
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

  // Init WaveSurfers — selective: only create/destroy what changed
  useEffect(() => {
    if (Object.keys(urls).length === 0) return

    const currentWaves = stemWaves.current
    const newWaves: Record<string, WaveSurfer> = {}
    let firstReady = false

    for (const { key, meta } of stemItems) {
      const container = stemContainers.current[key]
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

      ws.on('ready', () => {
        if (!firstReady) {
          setDuration(ws.getDuration())
          firstReady = true
        }
      })

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
      for (const path of stemsRef.current) all[stemNameFromPath(path)] = true
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

  const extForFormat = (fmt: string): string => (fmt === 'mp3' ? '.mp3' : '.wav')
  const formatFilter = (fmt: string): { name: string; extensions: string[] } =>
    fmt === 'mp3'
      ? { name: 'MP3 Audio', extensions: ['mp3'] }
      : { name: 'WAV Audio', extensions: ['wav'] }

  const handleExportSingle = async (key: string): Promise<void> => {
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
  }

  const handleExportMix = async (): Promise<void> => {
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
  }

  const handlePitchShift = async (delta: number): Promise<void> => {
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
  }

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

  const toggleExportSelection = (key: string): void => {
    setExportSelection((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const handleDeleteRecording = async (path: string): Promise<void> => {
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
  }

  const handleMasterVolume = useCallback((e: React.ChangeEvent<HTMLInputElement>): void => {
    setMasterVolume(parseFloat(e.target.value))
  }, [])

  const formatTime = (seconds: number): string => {
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }

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
          <div className="bg-neutral-900/80 rounded-xl border border-neutral-800 p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-neutral-400 uppercase tracking-wide">
                  Timeline
                </span>
                <span className="text-[10px] font-mono text-neutral-500">
                  {formatTime(progress)} / {formatTime(masterWaveDuration || duration)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {markers.length > 0 && (
                  <>
                    <select
                      value={
                        loopStart !== null
                          ? markers.findIndex((m) => m.time === loopStart).toString()
                          : ''
                      }
                      onChange={(e) => {
                        const idx = parseInt(e.target.value)
                        if (!isNaN(idx) && markers[idx]) setLoopStart(markers[idx].time)
                        else setLoopStart(null)
                      }}
                      className="bg-neutral-800 text-neutral-300 text-[10px] border border-neutral-700 rounded px-1 py-0.5"
                    >
                      <option value="">A—</option>
                      {markers.map((m, i) => (
                        <option key={i} value={i}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                    <select
                      value={
                        loopEnd !== null
                          ? markers.findIndex((m) => m.time === loopEnd).toString()
                          : ''
                      }
                      onChange={(e) => {
                        const idx = parseInt(e.target.value)
                        if (!isNaN(idx) && markers[idx]) setLoopEnd(markers[idx].time)
                        else setLoopEnd(null)
                      }}
                      className="bg-neutral-800 text-neutral-300 text-[10px] border border-neutral-700 rounded px-1 py-0.5"
                    >
                      <option value="">B—</option>
                      {markers.map((m, i) => (
                        <option key={i} value={i}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => setLoopEnabled(!loopEnabled)}
                      disabled={loopStart === null || loopEnd === null}
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-colors ${
                        loopEnabled
                          ? 'bg-green-600 text-white'
                          : 'bg-neutral-800 text-neutral-500 hover:text-white disabled:opacity-30'
                      }`}
                    >
                      Loop
                    </button>
                  </>
                )}
                <button
                  onClick={() => setMarkers([])}
                  className="px-2 py-0.5 rounded text-[10px] font-medium bg-neutral-800 text-neutral-500 hover:text-white transition-colors"
                >
                  Clear
                </button>
              </div>
            </div>
            <div className="relative">
              <div
                ref={(el) => {
                  masterWaveContainer.current = el
                }}
                className="w-full rounded overflow-hidden cursor-pointer h-16"
              />
              {/* Marker overlays + loop highlight */}
              <TimelineMarkers
                markers={markers}
                loopStart={loopStart}
                loopEnd={loopEnd}
                loopEnabled={loopEnabled}
                duration={masterWaveDuration || duration}
                onMarkerClick={(m) => {
                  if (loopStart === m.time) setLoopStart(null)
                  else if (loopEnd === m.time) setLoopEnd(null)
                  else if (loopStart === null) setLoopStart(m.time)
                  else if (loopEnd === null) setLoopEnd(m.time)
                  else {
                    setLoopStart(m.time)
                    setLoopEnd(null)
                  }
                }}
                onMarkerContextMenu={(i) => {
                  const m = markers[i]
                  setMarkers((prev) => prev.filter((_, idx) => idx !== i))
                  if (loopStart === m.time) setLoopStart(null)
                  if (loopEnd === m.time) setLoopEnd(null)
                }}
              />
            </div>
            <div className="flex items-center justify-between mt-1">
              <span className="text-[10px] text-neutral-600">
                Double-click to add marker • Click marker to set A/B • Right-click to remove
              </span>
              <span className="text-[10px] text-neutral-600">
                {markers.length} marker{markers.length !== 1 ? 's' : ''}
              </span>
            </div>
          </div>

          {showJamZone && effectiveKey && (
            <JamZone
              effectiveKey={effectiveKey}
              selectedScaleIdx={selectedScaleIdx}
              scalesMaxH={scalesMaxH}
              fretboardColRef={fretboardColRef}
              onSelectScale={setSelectedScaleIdx}
            />
          )}

          <div className="grid grid-cols-2 gap-4">
            {stemItems.map(({ key, meta, isRecording }) => {
              const isAudible = masterPlaying && active[key]
              const isInactive = !active[key] && !masterPlaying
              const canTab = ['guitar', 'bass', 'piano'].includes(key)
              const canRecord = recording === 'idle' && !isRecording
              const isRecordingThis = recordingKey === key && recording === 'recording'

              return (
                <StemCard
                  key={key}
                  meta={meta}
                  isRecording={isRecording}
                  isAudible={isAudible}
                  isInactive={isInactive}
                  isActive={!!active[key]}
                  isSolo={!!solo[key]}
                  progress={progress}
                  duration={duration}
                  exporting={exporting}
                  isRecordingThis={isRecordingThis}
                  recordingElapsed={recordingElapsed}
                  canTab={canTab}
                  canRecord={canRecord}
                  formatTime={formatTime}
                  onToggle={() => toggleStem(key)}
                  onSolo={() => toggleSolo(key)}
                  onExport={() => handleExportSingle(key)}
                  onOpenTab={() => handleOpenTab(key)}
                  onStartRecording={() => handleStartRecording(key)}
                  onStopRecording={handleStopRecording}
                  onDeleteRecording={() => {
                    const recPath = allStems.find((p) => stemNameFromPath(p) === key)
                    if (recPath) handleDeleteRecording(recPath)
                  }}
                >
                  <audio
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
                  <div
                    ref={(el) => {
                      stemContainers.current[key] = el
                    }}
                    className="h-8 rounded overflow-hidden cursor-pointer"
                  />
                </StemCard>
              )
            })}
          </div>
        </div>

        <div className="w-44 shrink-0 bg-neutral-900/80 rounded-xl border border-neutral-800 p-4 flex flex-col items-center gap-5 self-start order-1">
          <h3 className="text-sm font-semibold text-neutral-400 uppercase tracking-wide">Master</h3>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleMasterPlay}
              className="w-12 h-12 rounded-full flex items-center justify-center bg-blue-600/20 hover:bg-blue-600/30 transition-colors"
            >
              {masterPlaying ? (
                <span className="text-blue-400 text-base font-bold">| |</span>
              ) : (
                <span className="text-blue-400 text-base ml-0.5">&#9654;</span>
              )}
            </button>
            <button
              onClick={handleRestart}
              className="w-10 h-10 rounded-full flex items-center justify-center bg-neutral-800 hover:bg-neutral-700 transition-colors text-neutral-400 hover:text-white"
              title="Restart"
            >
              &#9664;&#9664;
            </button>
          </div>
          <span className="text-[10px] font-mono text-neutral-500 -mt-2">
            {formatTime(progress)} / {formatTime(duration)}
          </span>
          <div className="flex flex-col items-center gap-2 w-full">
            <span className="text-xs text-neutral-500">Volume</span>
            <input
              type="range"
              aria-label="Master volume"
              min="0"
              max="1"
              step="0.01"
              value={masterVolume}
              onChange={handleMasterVolume}
              className="accent-blue-500 cursor-pointer h-[120px] w-6 [writing-mode:vertical-lr] [direction:rtl]"
            />
            <span className="text-xs text-neutral-500">{Math.round(masterVolume * 100)}%</span>
          </div>

          <div className="border-t border-neutral-800 pt-4 w-full flex flex-col gap-3">
            <h3 className="text-sm font-semibold text-neutral-400 uppercase tracking-wide text-center">
              Record
            </h3>
            <div className="flex flex-col gap-2 w-full">
              <span className="text-[10px] text-neutral-500 text-center">Monitor volume</span>
              <input
                type="range"
                aria-label="Monitor volume"
                min="0"
                max="1"
                step="0.01"
                value={monitorVolume}
                onChange={(e) => setMonitorVolume(parseFloat(e.target.value))}
                className="accent-red-500 cursor-pointer w-full"
              />
            </div>
            <div className="flex items-center justify-center gap-2">
              <button
                onClick={() => setRecordingFormat('wav')}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                  recordingFormat === 'wav'
                    ? 'bg-red-600 text-white'
                    : 'bg-neutral-800 text-neutral-400'
                }`}
              >
                WAV
              </button>
              <button
                onClick={() => setRecordingFormat('mp3')}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                  recordingFormat === 'mp3'
                    ? 'bg-red-600 text-white'
                    : 'bg-neutral-800 text-neutral-400'
                }`}
              >
                MP3
              </button>
            </div>
            <div className="flex items-center justify-center gap-1.5">
              <span className="text-[10px] text-neutral-500">Count-in</span>
              {[0, 1, 2, 4].map((bars) => (
                <button
                  key={bars}
                  onClick={() => setCountInBars(bars)}
                  className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                    countInBars === bars
                      ? 'bg-red-600 text-white'
                      : 'bg-neutral-800 text-neutral-400'
                  }`}
                >
                  {bars === 0 ? 'OFF' : `${bars}`}
                </button>
              ))}
            </div>
          </div>

          <div className="border-t border-neutral-800 pt-3 w-full">
            <button
              onClick={() => setShowExportModal(true)}
              className="w-full px-2 py-1.5 rounded text-[10px] font-semibold bg-blue-600 hover:bg-blue-500 text-white transition-colors"
            >
              Export Mix...
            </button>
          </div>

          <div className="border-t border-neutral-800 pt-4 w-full flex flex-col gap-3">
            <h3 className="text-sm font-semibold text-neutral-400 uppercase tracking-wide text-center">
              Key
            </h3>
            <div className="text-center relative">
              <button
                onClick={() => setShowKeyPicker(!showKeyPicker)}
                className="text-lg font-bold text-white hover:text-orange-400 transition-colors cursor-pointer"
                title="Click to change key"
              >
                {effectiveKey || '...'}
                {manualKey && <span className="text-[10px] text-orange-400 ml-1">✎</span>}
              </button>
              {showKeyPicker && (
                <div
                  ref={keyPickerRef}
                  className="absolute z-50 top-full mt-2 left-1/2 -translate-x-1/2 bg-neutral-900 border border-neutral-700 rounded-xl p-3 shadow-2xl w-48 max-h-64 overflow-y-auto"
                >
                  <div className="grid grid-cols-2 gap-1">
                    {(() => {
                      const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
                      const types = ['Major', 'Minor']
                      const keys: string[] = []
                      for (const n of NOTE) for (const t of types) keys.push(`${n} ${t}`)
                      return keys.map((k) => (
                        <button
                          key={k}
                          onClick={() => {
                            setManualKey(k)
                            setShowKeyPicker(false)
                            const songDir =
                              stems.length > 0 ? stems[0].replace(/[/\\][^/\\]+$/, '') : ''
                            if (window.api && songDir) {
                              window.api.saveMeta(songDir, {
                                key: k,
                                _version: CACHE_VERSION
                              } as Record<string, unknown>)
                            }
                          }}
                          className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                            effectiveKey === k
                              ? 'bg-orange-600 text-white'
                              : 'bg-neutral-800 text-neutral-400 hover:text-white hover:bg-neutral-700'
                          }`}
                        >
                          {k}
                        </button>
                      ))
                    })()}
                  </div>
                  {manualKey && (
                    <button
                      onClick={() => {
                        setManualKey(null)
                        setShowKeyPicker(false)
                      }}
                      className="w-full mt-2 px-2 py-1 rounded text-xs font-medium bg-neutral-800 text-neutral-500 hover:text-white transition-colors"
                    >
                      Reset to detected ({detectedKey ?? '...'})
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center justify-center gap-1.5">
              <button
                onClick={() => handlePitchShift(-1)}
                disabled={transposing || pitchShift <= -12}
                className="w-8 h-8 rounded bg-neutral-800 text-neutral-400 hover:text-white disabled:text-neutral-600 disabled:cursor-not-allowed text-sm flex items-center justify-center"
              >
                −
              </button>
              <span className="w-14 text-center text-sm font-mono text-orange-400">
                {pitchShift === 0 ? '±0' : pitchShift > 0 ? `+${pitchShift}` : `${pitchShift}`}
              </span>
              <button
                onClick={() => handlePitchShift(1)}
                disabled={transposing || pitchShift >= 12}
                className="w-8 h-8 rounded bg-neutral-800 text-neutral-400 hover:text-white disabled:text-neutral-600 disabled:cursor-not-allowed text-sm flex items-center justify-center"
              >
                +
              </button>
            </div>
            <span className="text-[10px] text-neutral-500 text-center">
              {transposing ? 'Transposing...' : 'semitone steps'}
            </span>
          </div>

          <div className="border-t border-neutral-800 pt-4 w-full flex flex-col gap-3">
            <h3 className="text-sm font-semibold text-neutral-400 uppercase tracking-wide text-center">
              Metronome
            </h3>
            {/* Row 1: BPM controls */}
            <div className="flex items-center justify-center gap-1.5">
              <span className="text-xs text-neutral-500">BPM</span>
              <button
                onClick={() => {
                  setBpm((prev) => Math.max(40, prev - 1))
                  lastScheduledBeatRef.current = -1
                }}
                className="w-6 h-6 rounded bg-neutral-800 text-neutral-400 hover:text-white text-xs flex items-center justify-center"
              >
                −
              </button>
              <input
                type="number"
                aria-label="BPM"
                min="40"
                max="280"
                value={bpm}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10)
                  if (!isNaN(v) && v >= 40 && v <= 280) {
                    setBpm(v)
                    lastScheduledBeatRef.current = -1
                  }
                }}
                className="w-12 h-6 text-center text-xs font-mono text-white bg-neutral-800 border border-neutral-700 rounded focus:outline-none focus:border-orange-500 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
              <button
                onClick={() => {
                  setBpm((prev) => Math.min(280, prev + 1))
                  lastScheduledBeatRef.current = -1
                }}
                className="w-6 h-6 rounded bg-neutral-800 text-neutral-400 hover:text-white text-xs flex items-center justify-center"
              >
                +
              </button>
            </div>
            {/* Row 2: ON/OFF + Volume */}
            <div className="flex items-center justify-between px-1">
              <button
                onClick={() => setMetronomeOn((prev) => !prev)}
                className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  metronomeOn
                    ? 'bg-orange-600 text-white'
                    : 'bg-neutral-800 text-neutral-400 hover:text-white'
                }`}
              >
                {metronomeOn ? 'ON' : 'OFF'}
              </button>
              <div className="flex flex-col items-center gap-1.5">
                <span className="text-xs text-neutral-500">Vol</span>
                <input
                  type="range"
                  aria-label="Metronome volume"
                  min="0"
                  max="1"
                  step="0.01"
                  value={metroVolume}
                  onChange={(e) => setMetroVolume(parseFloat(e.target.value))}
                  className="accent-orange-500 cursor-pointer h-[60px] w-5 [writing-mode:vertical-lr] [direction:rtl]"
                />
                <span className="text-xs text-neutral-500">{Math.round(metroVolume * 100)}%</span>
              </div>
            </div>
          </div>
        </div>
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
