import { useEffect, useRef, useState, useCallback } from 'react'
import WaveSurfer from 'wavesurfer.js'

interface StemPlayerProps {
  stems: string[]
  originalPath: string
  songName: string
  onReset: () => void
}

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

function StemPlayer({ stems, originalPath, songName, onReset }: StemPlayerProps): React.JSX.Element {
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(0)
  const [masterVolume, setMasterVolume] = useState(1)
  const [muted, setMuted] = useState<Record<string, boolean>>({})
  const [solo, setSolo] = useState<Record<string, boolean>>({})
  const [playing, setPlaying] = useState<Record<string, boolean>>({})
  const [urls, setUrls] = useState<Record<string, string>>({})

  const origWave = useRef<WaveSurfer | null>(null)
  const origContainer = useRef<HTMLDivElement>(null)
  const audioEls = useRef<Record<string, HTMLAudioElement>>({})
  const positionRef = useRef(0)
  const isSeeking = useRef(false)

  // Load audio URLs from HTTP server
  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      if (!window.api) return
      const result: Record<string, string> = {}
      result['original'] = await window.api.getAudioUrl(originalPath)
      for (const stem of stems) {
        result[stemNameFromPath(stem)] = await window.api.getAudioUrl(stem)
      }
      if (!cancelled) setUrls(result)
    }
    load()
    return () => { cancelled = true }
  }, [stems, originalPath])

  // Init original WaveSurfer (1 instance only)
  useEffect(() => {
    if (!urls['original'] || !origContainer.current) return

    const ws = WaveSurfer.create({
      container: origContainer.current,
      waveColor: '#ef444440',
      progressColor: '#ef4444',
      cursorColor: 'transparent',
      barWidth: 2,
      barGap: 1,
      height: 48,
      normalize: true
    })

    ws.load(urls['original'])

    ws.on('ready', () => setDuration(ws.getDuration()))
    ws.on('timeupdate', (t) => {
      if (!isSeeking.current) positionRef.current = t
      setProgress(t)
    })
    ws.on('seeking', () => {
      const t = ws.getCurrentTime()
      positionRef.current = t
      for (const el of Object.values(audioEls.current)) {
        el.currentTime = t
      }
    })
    ws.on('finish', () => {
      for (const el of Object.values(audioEls.current)) el.pause()
      setPlaying({})
    })

    origWave.current = ws
    return () => { ws.destroy(); origWave.current = null }
  }, [urls])

  // Audio element timeupdate handler
  const onAudioTime = useCallback((time: number): void => {
    if (!isSeeking.current) {
      positionRef.current = time
      setProgress(time)
    }
  }, [])

  // Toggle individual stem play/pause
  const toggleStem = useCallback((key: string): void => {
    const el = audioEls.current[key]
    if (!el) return
    if (el.paused) {
      el.currentTime = positionRef.current
      el.play()
      setPlaying((p) => ({ ...p, [key]: true }))
    } else {
      el.pause()
      setPlaying((p) => ({ ...p, [key]: false }))
    }
  }, [])

  // Play/pause all stems
  const toggleMasterPlay = useCallback((): void => {
    const anyPlaying = Object.values(playing).some(Boolean)
    if (anyPlaying) {
      for (const el of Object.values(audioEls.current)) el.pause()
      setPlaying({})
    } else {
      for (const el of Object.values(audioEls.current)) {
        el.currentTime = positionRef.current
        el.play()
      }
      const all: Record<string, boolean> = {}
      for (const key of Object.keys(audioEls.current)) all[key] = true
      setPlaying(all)
    }
  }, [playing])

  // Mute toggle
  const toggleMute = useCallback((key: string): void => {
    setMuted((prev) => {
      const next = { ...prev, [key]: !prev[key] }
      const el = audioEls.current[key]
      if (el) el.volume = next[key] ? 0 : effectiveVolume(key, next, solo, masterVolume)
      return next
    })
  }, [solo, masterVolume])

  // Solo toggle
  const toggleSolo = useCallback((key: string): void => {
    setSolo((prev) => {
      const next = { ...prev, [key]: !prev[key] }
      const anySolo = Object.values(next).some(Boolean)
      for (const k of Object.keys(audioEls.current)) {
        const el = audioEls.current[k]
        if (!el) continue
        el.volume = anySolo ? (next[k] ? masterVolume : 0) : (muted[k] ? 0 : masterVolume)
      }
      return next
    })
  }, [muted, masterVolume])

  const effectiveVolume = (
    key: string,
    m: Record<string, boolean>,
    s: Record<string, boolean>,
    vol: number
  ): number => {
    if (m[key]) return 0
    const anySolo = Object.values(s).some(Boolean)
    if (anySolo && !s[key]) return 0
    return vol
  }

  // Master volume changed
  const handleMasterVolume = useCallback((e: React.ChangeEvent<HTMLInputElement>): void => {
    const vol = parseFloat(e.target.value)
    setMasterVolume(vol)
    for (const key of Object.keys(audioEls.current)) {
      audioEls.current[key].volume = effectiveVolume(key, muted, solo, vol)
    }
  }, [muted, solo])

  const formatTime = (seconds: number): string => {
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  const stemItems = stems.map((path) => ({
    key: stemNameFromPath(path),
    meta: STEM_META[stemNameFromPath(path)] || { color: '#6b7280', icon: '🎵', label: stemNameFromPath(path) }
  }))

  return (
    <div className="flex gap-5 w-full">
      <div className="flex-1 space-y-6 min-w-0 order-0">
        {/* Original track header */}
        <div className="bg-neutral-900/80 rounded-xl border border-neutral-800 p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-4">
              <button
                onClick={() => origWave.current?.playPause()}
                className="w-10 h-10 rounded-full flex items-center justify-center bg-red-600/20 hover:bg-red-600/30 transition-colors"
              >
                <span className="text-red-400 text-sm ml-0.5">▶</span>
              </button>
              <div>
                <h2 className="text-xl font-bold text-white">{songName}</h2>
                <p className="text-xs text-neutral-500">
                  {duration > 0 ? formatTime(progress) : '--:--'} /{' '}
                  {duration > 0 ? formatTime(duration) : '--:--'} &middot; {stems.length} stems
                </p>
              </div>
            </div>
            <button
              onClick={onReset}
              className="px-4 py-2 text-sm text-neutral-400 hover:text-white border border-neutral-700 rounded-lg hover:border-neutral-500 transition-colors"
            >
              New separation
            </button>
          </div>
          <div ref={origContainer} className="h-12 rounded-lg overflow-hidden cursor-pointer" />
        </div>

        {/* Stem cards */}
        <div className="grid grid-cols-2 gap-4">
          {stemItems.map(({ key, meta }) => {
            const isPlaying = playing[key]
            return (
              <div
                key={key}
                className={`rounded-xl border p-4 space-y-3 transition-all ${
                  muted[key] ? 'opacity-40 border-neutral-700 bg-neutral-900/20' : 'border-neutral-700 bg-neutral-900/50'
                }`}
                style={{ borderColor: muted[key] ? undefined : meta.color + '40' }}
              >
                <audio
                  ref={(el) => {
                    if (el) {
                      audioEls.current[key] = el
                      el.volume = masterVolume
                      el.preload = 'auto'
                      el.src = urls[key] || ''
                      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
                      el.ontimeupdate = () => onAudioTime(el.currentTime)
                    }
                  }}
                />
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{meta.icon}</span>
                    <span className="font-semibold capitalize" style={{ color: meta.color }}>{meta.label}</span>
                  </div>
                  {isPlaying && (
                    <span className="flex gap-0.5">
                      {[1, 2, 3].map((i) => (
                        <span key={i} className="w-0.5 bg-white rounded-full"
                          style={{ height: 8 + i * 4, animation: `pulse 0.8s ease-in-out ${i * 0.15}s infinite` }} />
                      ))}
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-neutral-500 text-right">
                  {formatTime(progress)} / {formatTime(duration)}
                </div>
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => toggleStem(key)}
                    className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                      isPlaying ? 'bg-green-600/30 hover:bg-green-600/40' : 'bg-white/10 hover:bg-white/20'
                    }`}
                  >
                    {isPlaying ? (
                      <span className="text-green-400 text-sm">⏸</span>
                    ) : (
                      <span className="text-white text-sm ml-0.5">▶</span>
                    )}
                  </button>
                  <div className="flex gap-2">
                    <button
                      onClick={() => toggleMute(key)}
                      className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                        muted[key] ? 'bg-red-600 text-white' : 'bg-neutral-800 text-neutral-400 hover:text-white'
                      }`}
                    >M</button>
                    <button
                      onClick={() => toggleSolo(key)}
                      className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                        solo[key] ? 'bg-yellow-600 text-white' : 'bg-neutral-800 text-neutral-400 hover:text-white'
                      }`}
                    >S</button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Sidebar: Master */}
      <div className="w-44 shrink-0 bg-neutral-900/80 rounded-xl border border-neutral-800 p-4 flex flex-col items-center gap-5 self-start order-1">
        <h3 className="text-sm font-semibold text-neutral-400 uppercase tracking-wide">Master</h3>
        <button
          onClick={toggleMasterPlay}
          className="w-14 h-14 rounded-full flex items-center justify-center bg-blue-600/20 hover:bg-blue-600/30 transition-colors"
        >
          {Object.values(playing).some(Boolean) ? (
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
      </div>
    </div>
  )
}

export default StemPlayer
