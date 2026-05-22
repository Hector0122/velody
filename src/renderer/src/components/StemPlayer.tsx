import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import WaveSurfer from 'wavesurfer.js'

interface StemPlayerProps {
  stems: string[]
  songName: string
  onReset: () => void
  analysisData?: AnalysisData | null
}

const NOTE_NAMES = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#']

const STEM_META: Record<string, { color: string; icon: string; label: string }> = {
  vocals: { color: '#22c55e', icon: '🎤', label: 'Vocals' },
  drums: { color: '#3b82f6', icon: '🥁', label: 'Drums' },
  bass: { color: '#f97316', icon: '🎸', label: 'Bass' },
  other: { color: '#a855f7', icon: '🎹', label: 'Other' },
  piano: { color: '#f43f5e', icon: '🎹', label: 'Piano' },
  guitar: { color: '#eab308', icon: '🎸', label: 'Guitar' }
}

function stemNameFromPath(path: string): string {
  return path.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, '') || path
}

const TAB_PX_PER_SEC = 60
const TAB_STRING_HEIGHT = 48
const TAB_STRING_NAMES = ['G', 'D', 'A', 'E']

function StemPlayer({ stems, songName, onReset, analysisData }: StemPlayerProps): React.JSX.Element {
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(0)
  const [masterVolume, setMasterVolume] = useState(1)
  const [masterPlaying, setMasterPlaying] = useState(false)
  const [active, setActive] = useState<Record<string, boolean>>({})
  const [solo, setSolo] = useState<Record<string, boolean>>({})
  const [urls, setUrls] = useState<Record<string, string>>({})

  // Metronome
  const [metronomeOn, setMetronomeOn] = useState(false)
  const [bpm, setBpm] = useState(120)
  const [metroVolume, setMetroVolume] = useState(0.5)

  const audioEls = useRef<Record<string, HTMLAudioElement>>({})
  const stemWaves = useRef<Record<string, WaveSurfer>>({})
  const stemContainers = useRef<Record<string, HTMLDivElement | null>>({})
  const positionRef = useRef(0)
  const ctxTimeAtStartRef = useRef(0)
  const audioTimeAtStartRef = useRef(0)
  const mixedAudioRef = useRef<Float32Array | null>(null)
  const mixedSampleRateRef = useRef(44100)
  const harmonicAudioRef = useRef<Float32Array | null>(null)
  const activeRef = useRef<Record<string, boolean>>({})
  const onAudioTimeRef = useRef<(time: number) => void>(() => {})
  const stemsRef = useRef(stems)
  stemsRef.current = stems
  const lastSeekRef = useRef(0)

  // Metronome refs
  const audioCtxRef = useRef<AudioContext | null>(null)
  const lastScheduledBeatRef = useRef(-1)
  const metronomeOnRef = useRef(metronomeOn)
  const bpmRef = useRef(bpm)
  const metroVolumeRef = useRef(metroVolume)
  const masterPlayingRef = useRef(masterPlaying)
  const originalBpmRef = useRef(120)
  const playbackRateRef = useRef(1)

  activeRef.current = active
  metronomeOnRef.current = metronomeOn
  bpmRef.current = bpm
  metroVolumeRef.current = metroVolume
  masterPlayingRef.current = masterPlaying
  playbackRateRef.current = masterPlaying ? bpm / originalBpmRef.current : 1

  const stemItems = useMemo(() => stems.map((path) => ({
    key: stemNameFromPath(path),
    meta: STEM_META[stemNameFromPath(path)] || { color: '#6b7280', icon: '🎵', label: stemNameFromPath(path) }
  })), [stems])

  // Load audio URLs
  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      if (!window.api) return
      const result: Record<string, string> = {}
      for (const stem of stems) {
        result[stemNameFromPath(stem)] = await window.api.getAudioUrl(stem)
      }
      if (!cancelled) setUrls(result)
    }
    load()
    return () => { cancelled = true }
  }, [stems])

  // Reset on new stems
  useEffect(() => {
    setActive({})
    setSolo({})
    setMasterPlaying(false)
  }, [stems])

  // Assign audio src
  useEffect(() => {
    for (const [key, el] of Object.entries(audioEls.current)) {
      if (urls[key] && el.src !== urls[key]) {
        el.src = urls[key]
      }
    }
  }, [urls])

  // Auto-detect BPM — mix all stems for a full-song analysis
  useEffect(() => {
    const allUrls = Object.values(urls)
    if (allUrls.length === 0) return
    ;(async (): Promise<void> => {
      try {
        // 1. Fetch and decode all stems (tracked by stem key)
        const bufferMap: Record<string, Float32Array> = {}
        let sampleRate = 44100
        let maxLen = 0
        for (const [stemKey, url] of Object.entries(urls)) {
          const resp = await fetch(url)
          const buf = await resp.arrayBuffer()
          const offlineCtx = new OfflineAudioContext(1, 1, 44100)
          const decoded = await offlineCtx.decodeAudioData(buf)
          const ch = decoded.getChannelData(0)
          bufferMap[stemKey] = ch
          sampleRate = decoded.sampleRate
          if (ch.length > maxLen) maxLen = ch.length
        }
        // 2. Full mix (all stems — for BPM)
        const mixed = new Float32Array(maxLen)
        for (const ch of Object.values(bufferMap)) {
          for (let i = 0; i < ch.length; i++) mixed[i] += ch[i]
        }
        let peak = 0
        for (let i = 0; i < mixed.length; i++) { const a = Math.abs(mixed[i]); if (a > peak) peak = a }
        if (peak > 1) for (let i = 0; i < mixed.length; i++) mixed[i] /= peak
        mixedAudioRef.current = mixed
        mixedSampleRateRef.current = sampleRate

        // 3. Harmonic-only mix (bass + other/guitar/piano — no drums/vocals)
        const harmonic = new Float32Array(maxLen)
        const harmonicKeys = ['bass', 'other', 'guitar', 'piano']
        for (const [key, ch] of Object.entries(bufferMap)) {
          if (harmonicKeys.includes(key)) {
            const w = key === 'bass' ? 1.5 : 1.0
            for (let i = 0; i < ch.length; i++) harmonic[i] += ch[i] * w
          }
        }
        let hPeak = 0
        for (let i = 0; i < harmonic.length; i++) { const a = Math.abs(harmonic[i]); if (a > hPeak) hPeak = a }
        if (hPeak > 1) for (let i = 0; i < harmonic.length; i++) harmonic[i] /= hPeak
        harmonicAudioRef.current = harmonic

        // 4. BPM detection
        // (chord timeline comes from analysisData, not JS DSP)
        const sr = sampleRate
        const hop = Math.floor(sr * 0.02)
        const frames = Math.floor(Math.min(mixed.length, sr * 60) / hop)

        // RMS envelope
        const rms = new Float32Array(frames)
        for (let i = 0; i < frames; i++) {
          const start = i * hop; const end = Math.min(start + hop, mixed.length)
          let sum = 0
          for (let j = start; j < end; j++) sum += mixed[j] * mixed[j]
          rms[i] = Math.sqrt(sum / (end - start))
        }

        // Smooth with 80ms window
        const sw = Math.floor(0.08 / (hop / sr))
        const env = new Float32Array(frames)
        for (let i = 0; i < frames; i++) {
          let s = 0, c = 0
          for (let j = i - sw; j <= i + sw; j++) { if (j >= 0 && j < frames) { s += rms[j]; c++ } }
          env[i] = s / c
        }

        // Onset: positive diff
        const onset = new Float32Array(frames)
        for (let i = 1; i < frames; i++) onset[i] = Math.max(0, env[i] - env[i - 1])

        // Autocorrelation
        const minLag = Math.floor(60 / 240 * sr / hop)
        const maxLag = Math.ceil(60 / 40 * sr / hop)
        const acf = new Float32Array(maxLag + 1)
        for (let lag = minLag; lag <= maxLag; lag++) {
          let corr = 0
          for (let i = 0; i < frames - lag; i++) corr += onset[i] * onset[i + lag]
          acf[lag] = corr / (frames - lag)
        }
        const a0 = acf[0] || 1
        for (let lag = minLag; lag <= maxLag; lag++) acf[lag] /= a0

        // Score candidates with harmonic support
        let bestBpm = 120, bestScore = 0
        for (let lag = minLag; lag <= maxLag; lag++) {
          const bpm = Math.round(60 / (lag * hop / sr))
          if (bpm < 40 || bpm > 280) continue
          let score = acf[lag]
          for (const mult of [0.5, 2, 3]) {
            const ml = Math.round(lag * mult)
            if (ml >= minLag && ml <= maxLag && acf[ml] > 0) score += acf[ml] * 0.4
          }
          const weight = bpm >= 60 && bpm <= 180 ? 1.2 : 0.8
          score *= weight
          if (score > bestScore) { bestScore = score; bestBpm = bpm }
        }

        originalBpmRef.current = bestBpm
        setBpm(bestBpm)
      } catch { /* detection failed */ }
    })()
  }, [urls])

  // Init WaveSurfers
  useEffect(() => {
    if (Object.keys(urls).length === 0) return

    const waves: Record<string, WaveSurfer> = {}
    let firstReady = false

    for (const { key, meta } of stemItems) {
      const container = stemContainers.current[key]
      const url = urls[key]
      if (!container || !url) continue

      const ws = WaveSurfer.create({
        container,
        waveColor: meta.color + '30',
        progressColor: meta.color,
        cursorColor: 'transparent',
        barWidth: 2,
        barGap: 1,
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

      waves[key] = ws
    }

    stemWaves.current = waves
    return () => {
      for (const ws of Object.values(waves)) ws.destroy()
      stemWaves.current = {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urls])

  // Compute volume: solo overrides active (only soloed stem is heard)
  const computeVolume = useCallback((key: string): number => {
    if (!masterPlaying) return 0
    if (!activeRef.current[key]) return 0
    const soloed = Object.keys(solo).find((k) => solo[k])
    if (soloed) return soloed === key ? masterVolume : 0
    return masterVolume
  }, [masterPlaying, solo, masterVolume])

  const applyVolume = useCallback((key: string): void => {
    const el = audioEls.current[key]
    if (el) el.volume = computeVolume(key)
  }, [computeVolume])

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

  // --- Note / Chord display ---
  const [showNotes, setShowNotes] = useState(false)
  const [currentChord, setCurrentChord] = useState('')
  const [liveChroma, setLiveChroma] = useState<number[]>(new Array(12).fill(0))
  const chromaRef = useRef<number[]>(new Array(12).fill(0))
  const chordRef = useRef('')

  // FFT chroma for animated bars (same as before)
  const fftAt = (data: Float32Array, sr: number, pos: number, fftSize: number): Float32Array => {
    const st = Math.max(0, Math.min(data.length - fftSize, Math.floor(pos * sr)))
    const w = new Float32Array(fftSize)
    for (let i = 0; i < fftSize; i++) w[i] = data[st + i] * (0.54 - 0.46 * Math.cos(2 * Math.PI * i / fftSize))
    const real = new Float32Array(w); const imag = new Float32Array(fftSize)
    const bits = Math.log2(fftSize)
    for (let i = 0; i < fftSize; i++) {
      let j = 0; for (let b = 0; b < bits; b++) if (i & (1 << b)) j |= (1 << (bits - 1 - b))
      if (j > i) { [real[i], real[j]] = [real[j], real[i]]; [imag[i], imag[j]] = [imag[j], imag[i]] }
    }
    for (let s = 1; s <= bits; s++) {
      const m = 1 << s; const mH = m >> 1
      for (let k = 0; k < fftSize; k += m) for (let j = 0; j < mH; j++) {
        const wr = Math.cos(-2 * Math.PI * j / m); const wi = Math.sin(-2 * Math.PI * j / m)
        const tr = real[k + j + mH] * wr - imag[k + j + mH] * wi
        const ti = real[k + j + mH] * wi + imag[k + j + mH] * wr
        real[k + j + mH] = real[k + j] - tr; imag[k + j + mH] = imag[k + j] - ti
        real[k + j] += tr; imag[k + j] += ti
      }
    }
    const mags = new Float32Array(fftSize / 2)
    for (let bin = 0; bin < fftSize / 2; bin++) mags[bin] = Math.sqrt(real[bin] * real[bin] + imag[bin] * imag[bin])
    const wHalf = 3
    for (let bin = 0; bin < fftSize / 2; bin++) {
      let avg = 0, c = 0
      for (let j = Math.max(0, bin - wHalf); j <= Math.min(fftSize / 2 - 1, bin + wHalf); j++) { avg += mags[j]; c++ }
      avg /= c
      if (avg > 0 && mags[bin] > 0) mags[bin] = Math.min(mags[bin] / avg, 3)
      else mags[bin] = 0
    }
    const chroma = new Float32Array(12)
    for (let bin = 0; bin < fftSize / 2; bin++) {
      const freq = bin * sr / fftSize; if (freq < 55 || freq > 2500) continue
      let weight = 1
      if (freq >= 60 && freq <= 400) weight = 3
      else if (freq > 400 && freq <= 2000) weight = 2
      chroma[((Math.round(69 + 12 * Math.log2(freq / 440)) % 12) + 12) % 12] += mags[bin] * weight
    }
    let m = 0; for (let i = 0; i < 12; i++) if (chroma[i] > m) m = chroma[i]
    if (m > 0) for (let i = 0; i < 12; i++) chroma[i] /= m
    return chroma
  }

  const computeLiveChroma = (data: Float32Array, sr: number, pos: number): number[] => {
    const raw = fftAt(data, sr, pos, 2048)
    const prev = chromaRef.current
    for (let i = 0; i < 12; i++) raw[i] = raw[i] * 0.4 + prev[i] * 0.6
    const out = Array.from(raw); chromaRef.current = out
    return out
  }

  // Chord timeline populated from analysisData (set by Python/essentia analysis)
  const chordTimelineRef = useRef<{ start: number; end: number; chord: string }[]>([])

  useEffect(() => {
    if (!analysisData?.chords?.length) return
    chordTimelineRef.current = analysisData.chords
    setCurrentChord(analysisData.chords[0]?.chord ?? '')
  }, [analysisData])

  // rAF: chord timeline lookup (always runs)
  const animRef = useRef(0)
  const frameCountRef = useRef(0)
  useEffect(() => {
    const tick = (): void => {
      frameCountRef.current++
      const harmBuf = harmonicAudioRef.current; const sr = mixedSampleRateRef.current
      const playing = masterPlayingRef.current

      if (showNotes && harmBuf && playing && frameCountRef.current % 4 === 0) {
        setLiveChroma(computeLiveChroma(harmBuf, sr, positionRef.current))
      }
      if (playing) {
        const pos = positionRef.current; const segs = chordTimelineRef.current
        let chord = ''
        for (let i = segs.length - 1; i >= 0; i--) { if (pos >= segs[i].start) { chord = segs[i].chord; break } }
        if (chord && chord !== chordRef.current) { chordRef.current = chord; setCurrentChord(chord) }
      }
      animRef.current = requestAnimationFrame(tick)
    }
    animRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(animRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // --- Bass Tablature ---
  const [tabModalOpen, setTabModalOpen] = useState(false)
  const tabScrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll tab timeline to keep playhead in view
  useEffect(() => {
    if (!tabModalOpen || !tabScrollRef.current) return
    const el = tabScrollRef.current
    el.scrollLeft = Math.max(0, progress * TAB_PX_PER_SEC - el.clientWidth * 0.3)
  }, [progress, tabModalOpen])

  // --- BPM detection ---

  // --- Metronome (lookahead scheduler) ---
  const LOOKAHEAD = 0.3

  const getAudioCtx = (): AudioContext | null => {
    if (!audioCtxRef.current) {
      try { audioCtxRef.current = new AudioContext() } catch { return null }
    }
    if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume()
    return audioCtxRef.current
  }

  const playClick = (accent: boolean, scheduledTime: number): void => {
    const ctx = audioCtxRef.current
    if (!ctx) return
    const vol = metroVolumeRef.current
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'triangle'
    osc.frequency.value = accent ? 1600 : 900
    gain.gain.setValueAtTime(vol * (accent ? 0.5 : 0.35), scheduledTime)
    gain.gain.exponentialRampToValueAtTime(0.001, scheduledTime + 0.06)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(scheduledTime)
    osc.stop(scheduledTime + 0.06)
  }

  const schedulerTick = (): void => {
    if (!metronomeOnRef.current || !masterPlayingRef.current) return
    const ctx = audioCtxRef.current
    if (!ctx || ctx.state === 'closed') return
    if (ctx.state === 'suspended') { ctx.resume(); return }

    // Read audio position directly from the element — most accurate, no drift
    const els = Object.values(audioEls.current)
    const t = els.length > 0 ? els[0].currentTime : positionRef.current
    const currentBpm = bpmRef.current
    let beat = Math.max(Math.floor(t * currentBpm / 60) + 1, lastScheduledBeatRef.current + 1)

    while (beat * 60 / currentBpm - t < LOOKAHEAD) {
      const delaySong = beat * 60 / currentBpm - t          // delta in media-time seconds
      const delayReal = delaySong / playbackRateRef.current  // convert to wall-clock seconds
      playClick(beat % 4 === 1, ctx.currentTime + Math.max(0, delayReal))
      lastScheduledBeatRef.current = beat
      beat++
    }
  }

  // Start/stop scheduler based on metronome+playback state
  useEffect(() => {
    if (metronomeOn && masterPlaying) {
      getAudioCtx()
      lastScheduledBeatRef.current = -1
      const id = window.setInterval(schedulerTick, 25)
      return () => clearInterval(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metronomeOn, masterPlaying])

  // Audio timeupdate → update counter + WaveSurfer cursors
  const onAudioTime = useCallback((time: number): void => {
    positionRef.current = time
    setProgress(time)

    const now = Date.now()
    if (now - lastSeekRef.current < 16) return
    lastSeekRef.current = now

    const d = duration || 1
    for (const sw of Object.values(stemWaves.current)) {
      sw.seekTo(time / d)
    }
  }, [duration])

  onAudioTimeRef.current = onAudioTime

  const recordAudioCtxSync = (): void => {
    const ctx = audioCtxRef.current
    if (ctx && ctx.state !== 'closed') {
      ctxTimeAtStartRef.current = ctx.currentTime
      audioTimeAtStartRef.current = positionRef.current
    }
  }

  // Toggle stem active
  const toggleStem = useCallback((key: string): void => {
    const el = audioEls.current[key]
    if (!el) return

    const isActive = !!activeRef.current[key]

    if (!masterPlaying) {
      if (isActive) return // stopped + already active → nothing
      lastScheduledBeatRef.current = -1
      recordAudioCtxSync()
      // Start with only this stem
      setActive({ [key]: true })
      for (const k of Object.keys(audioEls.current)) {
        const e = audioEls.current[k]
        if (e) { e.currentTime = positionRef.current; e.play() }
      }
      setMasterPlaying(true)
    } else {
      // Toggle while playing
      setActive((prev) => ({ ...prev, [key]: !prev[key] }))
    }
  }, [masterPlaying])

  // Master play: enable all / Master stop: disable all
  const toggleMasterPlay = useCallback((): void => {
    if (masterPlaying) {
      for (const el of Object.values(audioEls.current)) el.pause()
      setActive({})
      setMasterPlaying(false)
    } else {
      lastScheduledBeatRef.current = -1
      getAudioCtx()        // create/resume AudioContext on user gesture
      recordAudioCtxSync()
      const all: Record<string, boolean> = {}
      for (const path of stemsRef.current) all[stemNameFromPath(path)] = true
      setActive(all)
      for (const key of Object.keys(audioEls.current)) {
        const el = audioEls.current[key]
        if (el) { el.currentTime = positionRef.current; el.play() }
      }
      setMasterPlaying(true)
    }
  }, [masterPlaying])

  // Solo: only one stem at a time, toggle on/off
  const toggleSolo = useCallback((key: string): void => {
    setSolo((prev) => {
      if (prev[key]) return {} // un-solo
      return { [key]: true } // solo this one, clear others
    })
  }, [])

  const handleMasterVolume = useCallback((e: React.ChangeEvent<HTMLInputElement>): void => {
    setMasterVolume(parseFloat(e.target.value))
  }, [])

  const formatTime = (seconds: number): string => {
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  return (
    <><div className="flex gap-5 w-full">
      <div className="flex-1 space-y-6 min-w-0 order-0">
        <div className="bg-neutral-900/80 rounded-xl border border-neutral-800 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-white">{songName}</h2>
            <button
              onClick={onReset}
              className="px-4 py-2 text-sm text-neutral-400 hover:text-white border border-neutral-700 rounded-lg hover:border-neutral-500 transition-colors"
            >
              New separation
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {stemItems.map(({ key, meta }) => {
            const isAudible = masterPlaying && active[key]
            const isSoloed = solo[key]
            const isInactive = !active[key] && !masterPlaying
            return (
              <div
                key={key}
                className={`rounded-xl border p-4 space-y-3 transition-all ${
                  isInactive ? 'opacity-50 border-neutral-700 bg-neutral-900/20' : 'border-neutral-700 bg-neutral-900/50'
                }`}
                style={{ borderColor: isInactive ? undefined : meta.color + '40' }}
              >
                <audio
                  ref={(el) => {
                    if (el) {
                      audioEls.current[key] = el
                      el.preload = 'auto'
                      el.ontimeupdate = () => onAudioTimeRef.current(el.currentTime)
                    }
                  }}
                />
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{meta.icon}</span>
                    <span className="font-semibold capitalize" style={{ color: meta.color }}>{meta.label}</span>
                  </div>
                  {isAudible && (
                    <span className="flex gap-0.5">
                      {[1, 2, 3].map((i) => (
                        <span key={i} className="w-0.5 bg-white rounded-full"
                          style={{ height: 8 + i * 4, animation: `pulse 0.8s ease-in-out ${i * 0.15}s infinite` }} />
                      ))}
                    </span>
                  )}
                </div>
                <div
                  ref={(el) => { stemContainers.current[key] = el }}
                  className="h-8 rounded overflow-hidden cursor-pointer"
                />
                <div className="flex items-center justify-between text-[10px] text-neutral-500">
                  <span>{formatTime(progress)}</span>
                  <span>{duration > 0 ? formatTime(duration) : '0:00'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => toggleStem(key)}
                    className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                      active[key] ? 'bg-green-600/30 hover:bg-green-600/40' : 'bg-white/10 hover:bg-white/20'
                    }`}
                  >
                    {active[key] ? (
                      <span className="text-green-400 text-sm">⏸</span>
                    ) : (
                      <span className="text-white text-sm ml-0.5">▶</span>
                    )}
                  </button>
                  <button
                    onClick={() => toggleSolo(key)}
                    className={`px-4 py-1 rounded-lg text-xs font-medium transition-colors ${
                      solo[key] ? 'bg-yellow-600 text-white' : 'bg-neutral-800 text-neutral-400 hover:text-white'
                    }`}
                  >S</button>
                  {key === 'bass' && (
                    <button
                      onClick={() => setTabModalOpen(true)}
                      className="px-3 py-1 rounded-lg text-xs font-medium bg-neutral-800 text-neutral-400 hover:text-white hover:bg-neutral-700 transition-colors"
                    >Tab</button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="w-44 shrink-0 bg-neutral-900/80 rounded-xl border border-neutral-800 p-4 flex flex-col items-center gap-5 self-start order-1">
        <h3 className="text-sm font-semibold text-neutral-400 uppercase tracking-wide">Master</h3>
        <button
          onClick={toggleMasterPlay}
          className="w-14 h-14 rounded-full flex items-center justify-center bg-blue-600/20 hover:bg-blue-600/30 transition-colors"
        >
          {masterPlaying ? (
            <span className="text-blue-400 text-lg">⏸</span>
          ) : (
            <span className="text-blue-400 text-lg ml-1">▶</span>
          )}
        </button>
        <div className="flex flex-col items-center gap-2 w-full">
          <span className="text-xs text-neutral-500">Volume</span>
          <input
            type="range" min="0" max="1" step="0.01" value={masterVolume}
            onChange={handleMasterVolume}
            className="accent-blue-500 cursor-pointer"
            style={{ writingMode: 'vertical-lr', direction: 'rtl', height: 120, width: 24 }}
          />
          <span className="text-xs text-neutral-500">{Math.round(masterVolume * 100)}%</span>
        </div>

        <div className="border-t border-neutral-800 pt-4 w-full flex flex-col items-center gap-3">
          <h3 className="text-sm font-semibold text-neutral-400 uppercase tracking-wide">Notes</h3>
          <div className="flex items-center gap-3 w-full justify-between">
            <button
              onClick={() => setShowNotes(prev => !prev)}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                showNotes ? 'bg-purple-600 text-white' : 'bg-neutral-800 text-neutral-400 hover:text-white'
              }`}
            >
              {showNotes ? 'ON' : 'OFF'}
            </button>
          </div>
          {showNotes && (
            <>
              <div className="flex gap-0.5 w-full justify-center items-end h-8">
                {liveChroma.map((v, i) => (
                  <div key={i} className="flex flex-col items-center gap-0.5 flex-1">
                    <div
                      className="w-full rounded-sm transition-all duration-75"
                      style={{
                        height: Math.max(2, v * 28),
                        backgroundColor: v > 0.5 ? `hsl(${i * 30}, 80%, 60%)` : '#333'
                      }}
                    />
                    <span className="text-[5px] text-neutral-600">{NOTE_NAMES[i]}</span>
                  </div>
                ))}
              </div>
              {currentChord && (
                <span className="text-white text-sm font-bold tracking-wide">{currentChord}</span>
              )}
            </>
          )}
        </div>

        <div className="border-t border-neutral-800 pt-4 w-full flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-neutral-400 uppercase tracking-wide text-center">Metronome</h3>
          {/* Row 1: BPM controls */}
          <div className="flex items-center justify-center gap-1.5">
            <span className="text-xs text-neutral-500">BPM</span>
            <button
              onClick={() => { setBpm(prev => Math.max(40, prev - 1)); lastScheduledBeatRef.current = -1 }}
              className="w-6 h-6 rounded bg-neutral-800 text-neutral-400 hover:text-white text-xs flex items-center justify-center"
            >−</button>
            <input
              type="number" min="40" max="280" value={bpm}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10)
                if (!isNaN(v) && v >= 40 && v <= 280) { setBpm(v); lastScheduledBeatRef.current = -1 }
              }}
              className="w-12 text-center text-xs font-mono text-white bg-neutral-800 border border-neutral-700 rounded focus:outline-none focus:border-orange-500 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              style={{ height: 24 }}
            />
            <button
              onClick={() => { setBpm(prev => Math.min(280, prev + 1)); lastScheduledBeatRef.current = -1 }}
              className="w-6 h-6 rounded bg-neutral-800 text-neutral-400 hover:text-white text-xs flex items-center justify-center"
            >+</button>
          </div>
          {/* Row 2: ON/OFF + Volume */}
          <div className="flex items-center justify-between px-1">
            <button
              onClick={() => setMetronomeOn(prev => !prev)}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                metronomeOn ? 'bg-orange-600 text-white' : 'bg-neutral-800 text-neutral-400 hover:text-white'
              }`}
            >
              {metronomeOn ? 'ON' : 'OFF'}
            </button>
            <div className="flex flex-col items-center gap-1.5">
              <span className="text-xs text-neutral-500">Vol</span>
              <input
                type="range" min="0" max="1" step="0.01" value={metroVolume}
                onChange={(e) => setMetroVolume(parseFloat(e.target.value))}
                className="accent-orange-500 cursor-pointer"
                style={{ writingMode: 'vertical-lr', direction: 'rtl', height: 60, width: 20 }}
              />
              <span className="text-xs text-neutral-500">{Math.round(metroVolume * 100)}%</span>
            </div>
          </div>
        </div>
      </div>
    </div>
    {tabModalOpen && (
      <div className="fixed inset-0 z-50 flex flex-col bg-neutral-950">
        <div className="flex items-center justify-between px-5 py-3 border-b border-neutral-800 shrink-0">
          <h3 className="text-sm font-semibold text-neutral-400 uppercase tracking-wide">Bass Tab — {songName}</h3>
          <div className="flex items-center gap-4">
            <span className="text-xs font-mono text-neutral-500">{formatTime(progress)} / {formatTime(duration)}</span>
            <button
              onClick={() => setTabModalOpen(false)}
              className="text-neutral-500 hover:text-white text-lg leading-none"
            >✕</button>
          </div>
        </div>
        {!analysisData?.bass_tab?.length ? (
          <div className="flex-1 flex items-center justify-center text-neutral-500 text-sm">
            Bass tab not available — analysis hasn&apos;t completed yet.
          </div>
        ) : (
          <div className="flex-1 flex flex-col justify-center overflow-hidden px-2 py-4">
            <div className="flex">
              {/* Fixed string labels */}
              <div className="shrink-0 flex flex-col" style={{ width: 36 }}>
                {TAB_STRING_NAMES.map((name) => (
                  <div
                    key={name}
                    className="flex items-center justify-center text-xs font-mono font-bold text-neutral-400"
                    style={{ height: TAB_STRING_HEIGHT }}
                  >
                    {name}
                  </div>
                ))}
              </div>
              {/* Scrollable tab area */}
              <div
                ref={tabScrollRef}
                className="flex-1 overflow-x-auto overflow-y-hidden"
                style={{ scrollBehavior: 'auto' }}
              >
                <div
                  className="relative"
                  style={{
                    width: Math.max((duration + 4) * TAB_PX_PER_SEC, 800),
                    height: TAB_STRING_NAMES.length * TAB_STRING_HEIGHT,
                  }}
                >
                  {/* Horizontal string lines */}
                  {TAB_STRING_NAMES.map((_, idx) => (
                    <div
                      key={idx}
                      className="absolute left-0 bg-neutral-700"
                      style={{
                        top: idx * TAB_STRING_HEIGHT + TAB_STRING_HEIGHT / 2,
                        height: 1,
                        width: Math.max((duration + 4) * TAB_PX_PER_SEC, 800),
                      }}
                    />
                  ))}
                  {/* Note markers */}
                  {(analysisData?.bass_tab ?? []).map((note, idx) => (
                    <div
                      key={idx}
                      className="absolute flex items-center justify-center rounded text-xs font-bold font-mono bg-orange-500 text-white"
                      style={{
                        left: note.time * TAB_PX_PER_SEC - 11,
                        top: note.string * TAB_STRING_HEIGHT + TAB_STRING_HEIGHT / 2 - 11,
                        width: 22,
                        height: 22,
                        zIndex: 2,
                      }}
                    >
                      {note.fret}
                    </div>
                  ))}
                  {/* Playhead */}
                  <div
                    className="absolute top-0 pointer-events-none"
                    style={{
                      left: progress * TAB_PX_PER_SEC,
                      width: 2,
                      height: TAB_STRING_NAMES.length * TAB_STRING_HEIGHT,
                      backgroundColor: 'rgba(255,255,255,0.85)',
                      zIndex: 3,
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    )}</>
  )
}

export default StemPlayer
