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
  other: { color: '#a855f7', icon: '🎹', label: 'Other' }
}

const MIME_MAP: Record<string, string> = {
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg'
}

function getAudioMime(path: string): string {
  const ext = path.match(/\.[^.]+$/)?.[0]?.toLowerCase() || '.mp3'
  return MIME_MAP[ext] || 'audio/mpeg'
}

function stemNameFromPath(path: string): string {
  return (
    path
      .split(/[/\\]/)
      .pop()
      ?.replace(/\.[^.]+$/, '') || path
  )
}

async function filePathToBlobUrl(path: string): Promise<string> {
  if (!window.api) return ''
  const data = await window.api.readAudioFile(path)
  const blob = new Blob([data as BlobPart], { type: getAudioMime(path) })
  return URL.createObjectURL(blob)
}

function StemPlayer({
  stems,
  originalPath,
  songName,
  onReset
}: StemPlayerProps): React.JSX.Element {
  const [active, setActive] = useState<Record<string, boolean>>({})
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(0)
  const [origPlaying, setOrigPlaying] = useState(false)
  const [stemsPlaying, setStemsPlaying] = useState(false)
  const [masterVolume, setMasterVolume] = useState(1)
  const [muted, setMuted] = useState<Record<string, boolean>>({})
  const [solo, setSolo] = useState<Record<string, boolean>>({})

  const stemWaves = useRef<Record<string, WaveSurfer>>({})
  const origWave = useRef<WaveSurfer | null>(null)
  const origWaveContainer = useRef<HTMLDivElement>(null)
  const stemContainers = useRef<Record<string, HTMLDivElement | null>>({})
  const prevBlobUrls = useRef<Record<string, string>>({})
  const isSyncing = useRef(false)
  const positionRef = useRef(0)
  const isSeekingOrigFromCode = useRef(false)
  const activeRef = useRef(active)
  useEffect(() => {
    activeRef.current = active
  }, [active])
  const mutedRef = useRef(muted)
  useEffect(() => {
    mutedRef.current = muted
  }, [muted])
  const soloRef = useRef(solo)
  useEffect(() => {
    soloRef.current = solo
  }, [solo])
  const masterVolumeRef = useRef(masterVolume)
  useEffect(() => {
    masterVolumeRef.current = masterVolume
  }, [masterVolume])

  // Load blob URLs from file paths
  useEffect(() => {
    let cancelled = false

    const loadAll = async (): Promise<void> => {
      const urls: Record<string, string> = {}
      urls['original'] = await filePathToBlobUrl(originalPath)
      for (const stem of stems) {
        urls[stemNameFromPath(stem)] = await filePathToBlobUrl(stem)
      }

      prevBlobUrls.current = urls

      if (!cancelled) setBlobUrls(urls)
    }

    loadAll()

    return () => {
      cancelled = true
      Object.values(prevBlobUrls.current).forEach((u) => URL.revokeObjectURL(u))
      prevBlobUrls.current = {}
      origWave.current?.destroy()
      origWave.current = null
      Object.values(stemWaves.current).forEach((w) => w.destroy())
      stemWaves.current = {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stems, originalPath])

  const [blobUrls, setBlobUrls] = useState<Record<string, string>>({})

  // Calculate effective volume for a stem based on mute, solo, and master volume
  const stemEffectiveVolume = useCallback((key: string): number => {
    if (mutedRef.current[key]) return 0
    const anySolo = Object.values(soloRef.current).some(Boolean)
    if (anySolo && !soloRef.current[key]) return 0
    return masterVolumeRef.current
  }, [])

  // Apply volume to a single stem based on its mute/solo/master state
  const applyStemVolume = useCallback(
    (key: string): void => {
      const ws = stemWaves.current[key]
      if (!ws) return
      ws.setVolume(stemEffectiveVolume(key))
    },
    [stemEffectiveVolume]
  )

  // Get master position: playing orig or stem, fallback to last known position
  const getMasterTime = useCallback((): number => {
    if (origWave.current?.isPlaying()) return origWave.current.getCurrentTime()
    for (const key of Object.keys(stemWaves.current)) {
      const ws = stemWaves.current[key]
      if (ws?.isPlaying()) return ws.getCurrentTime()
    }
    return positionRef.current
  }, [])

  // Seek all stems and original to the given time
  const seekAll = useCallback((time: number): void => {
    positionRef.current = time
    isSyncing.current = true
    isSeekingOrigFromCode.current = true
    origWave.current?.setTime(time)
    isSeekingOrigFromCode.current = false
    for (const key of Object.keys(stemWaves.current)) {
      stemWaves.current[key]?.setTime(time)
    }
    isSyncing.current = false
    setProgress(time)
  }, [])

  // Init original WaveSurfer
  useEffect(() => {
    const url = blobUrls['original']
    const container = origWaveContainer.current
    if (!url || !container) return

    origWave.current?.destroy()

    const ws = WaveSurfer.create({
      container,
      waveColor: '#ef444440',
      progressColor: '#ef4444',
      cursorColor: 'transparent',
      barWidth: 2,
      barGap: 1,
      height: 48,
      normalize: true
    })

    ws.load(url)

    let origReady = false
    ws.on('ready', () => {
      origReady = true
      setDuration(ws.getDuration())
    })
    ws.on('timeupdate', (t) => {
      if (!isSyncing.current) positionRef.current = t
      setProgress(t)
    })
    ws.on('finish', () => {
      setOrigPlaying(false)
    })
    ws.on('seeking', () => {
      if (!origReady || isSeekingOrigFromCode.current) return
      seekAll(ws.getCurrentTime())
    })

    origWave.current = ws

    return () => {
      ws.destroy()
      if (origWave.current === ws) origWave.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blobUrls])

  // Init stem WaveSurfers
  useEffect(() => {
    if (Object.keys(blobUrls).length === 0) return

    // Destroy any previous stem WaveSurfers that no longer have a matching URL
    for (const existingKey of Object.keys(stemWaves.current)) {
      if (!blobUrls[existingKey]) {
        stemWaves.current[existingKey]?.destroy()
        delete stemWaves.current[existingKey]
      }
    }

    for (const key of Object.keys(blobUrls)) {
      if (key === 'original') continue

      const container = stemContainers.current[key]
      const url = blobUrls[key]
      if (!container || !url) continue

      // Destroy existing instance for this key so it reloads
      if (stemWaves.current[key]) {
        stemWaves.current[key]?.destroy()
        delete stemWaves.current[key]
      }

      const meta = STEM_META[key] || { color: '#6b7280', icon: '🎵', label: key }

      const ws = WaveSurfer.create({
        container,
        waveColor: meta.color + '40',
        progressColor: meta.color,
        cursorColor: 'transparent',
        barWidth: 2,
        barGap: 1,
        height: 64,
        normalize: true
      })

      ws.load(url)
      ws.setVolume(masterVolume)

      let stemReady = false
      let stemJustFinished = false
      ws.on('ready', () => { stemReady = true })

      ws.on('seeking', () => {
        if (!stemReady || isSyncing.current) return
        // Ignore the seek-to-0 that the browser fires after playback ends
        if (stemJustFinished && ws.getCurrentTime() === 0) {
          stemJustFinished = false
          return
        }
        stemJustFinished = false
        seekAll(ws.getCurrentTime())
      })

      ws.on('timeupdate', (currentTime) => {
        if (!isSyncing.current) positionRef.current = currentTime
        setProgress(currentTime)
        if (isSyncing.current) return
        isSyncing.current = true
        for (const k of Object.keys(stemWaves.current)) {
          if (k !== key && stemWaves.current[k]?.isPlaying()) {
            const diff = Math.abs(stemWaves.current[k]!.getCurrentTime() - currentTime)
            if (diff > 0.05) stemWaves.current[k]!.setTime(currentTime)
          }
        }
        isSyncing.current = false
      })

      ws.on('finish', () => {
        stemJustFinished = true
        setActive((prev) => ({ ...prev, [key]: false }))
        const anyPlaying = Object.values(stemWaves.current).some((w) => w?.isPlaying())
        if (!anyPlaying) setStemsPlaying(false)
      })

      stemWaves.current[key] = ws
    }
  }, [blobUrls])

  // Update master volume on all stems without recreating them
  useEffect(() => {
    for (const key of Object.keys(stemWaves.current)) {
      applyStemVolume(key)
    }
  }, [masterVolume, applyStemVolume])

  // Toggle a stem on/off (original is never affected — Option A)
  const toggleStem = useCallback(
    (key: string): void => {
      if (active[key]) {
        stemWaves.current[key]?.pause()
        setActive((prev) => ({ ...prev, [key]: false }))
        const anyStillActive = Object.keys(active).some((k) => k !== key && active[k])
        if (!anyStillActive) setStemsPlaying(false)
      } else {
        const ws = stemWaves.current[key]
        if (!ws) return
        isSyncing.current = true
        ws.setTime(positionRef.current)
        isSyncing.current = false
        ws.play()
        setActive((prev) => ({ ...prev, [key]: true }))
        setStemsPlaying(true)
      }
    },
    [active]
  )

  // Master play/pause for stems
  const toggleMasterPlay = useCallback((): void => {
    if (stemsPlaying) {
      for (const key of Object.keys(stemWaves.current)) {
        stemWaves.current[key]?.pause()
      }
      setActive({})
      setStemsPlaying(false)
    } else {
      const masterTime = getMasterTime()
      const allActive: Record<string, boolean> = {}
      // Seek phase: set all stems to masterTime with guard to prevent timeupdate cascades
      isSyncing.current = true
      for (const key of Object.keys(stemWaves.current)) {
        allActive[key] = true
        stemWaves.current[key]?.setTime(masterTime)
      }
      isSyncing.current = false
      // Play phase: start all stems cleanly after seeking
      for (const key of Object.keys(stemWaves.current)) {
        stemWaves.current[key]?.play()
      }
      setActive(allActive)
      setStemsPlaying(true)
    }
  }, [stemsPlaying, getMasterTime])

  // Toggle original play/pause (independent of stems — Option A)
  const toggleOrigPlay = useCallback((): void => {
    const ws = origWave.current
    if (!ws) return

    if (ws.isPlaying()) {
      ws.pause()
      setOrigPlaying(false)
    } else {
      // Always start from the shared position reference
      isSeekingOrigFromCode.current = true
      ws.setTime(positionRef.current)
      isSeekingOrigFromCode.current = false
      ws.play()
      setOrigPlaying(true)
    }
  }, [])

  const handleMasterVolume = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>): void => {
      const vol = parseFloat(e.target.value)
      setMasterVolume(vol)
      for (const key of Object.keys(stemWaves.current)) {
        applyStemVolume(key)
      }
    },
    [applyStemVolume]
  )

  const toggleMute = useCallback((key: string): void => {
    setMuted((prev) => {
      const next = { ...prev, [key]: !prev[key] }
      // After state update, recalculate volume for this stem
      const vol =
        next[key] || (Object.values(soloRef.current).some(Boolean) && !soloRef.current[key])
          ? 0
          : masterVolumeRef.current
      stemWaves.current[key]?.setVolume(vol)
      return next
    })
  }, [])

  const toggleSolo = useCallback((key: string): void => {
    setSolo((prev) => {
      const next = { ...prev, [key]: !prev[key] }
      const anySolo = Object.values(next).some(Boolean)
      for (const k of Object.keys(stemWaves.current)) {
        const ws = stemWaves.current[k]
        if (!ws) continue
        if (anySolo) {
          ws.setVolume(next[k] ? masterVolumeRef.current : 0)
        } else {
          ws.setVolume(mutedRef.current[k] ? 0 : masterVolumeRef.current)
        }
      }
      return next
    })
  }, [])

  const formatTime = (seconds: number): string => {
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  const stemItems = stems.map((path) => {
    const name = stemNameFromPath(path)
    return {
      key: name,
      path,
      meta: STEM_META[name] || { color: '#6b7280', icon: '🎵', label: name }
    }
  })

  return (
    <div className="flex gap-5 w-full">
      {/* Main area */}
      <div className="flex-1 space-y-6 min-w-0 order-0">
        {/* Original track header */}
        <div className="bg-neutral-900/80 rounded-xl border border-neutral-800 p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-4">
              <button
                onClick={toggleOrigPlay}
                className="w-10 h-10 rounded-full flex items-center justify-center bg-red-600/20 hover:bg-red-600/30 transition-colors"
              >
                {origPlaying ? (
                  <span className="text-red-400 text-sm">⏸</span>
                ) : (
                  <span className="text-red-400 text-sm ml-0.5">▶</span>
                )}
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

          <div
            ref={origWaveContainer}
            className="h-12 rounded-lg overflow-hidden cursor-pointer"
            onClick={() => {
              if (!origPlaying && !stemsPlaying) toggleOrigPlay()
            }}
          />
        </div>

        {/* Stems grid */}
        <div className="grid grid-cols-2 gap-4">
          {stemItems.map(({ key, meta }) => {
            const isActive = active[key]

            return (
              <div
                key={key}
                className={`rounded-xl border p-4 space-y-3 transition-all ${
                  muted[key]
                    ? 'opacity-40 border-neutral-700 bg-neutral-900/20'
                    : isActive
                      ? 'border-neutral-600 bg-neutral-900/70'
                      : 'border-neutral-700 bg-neutral-900/50'
                }`}
                style={{
                  borderColor: muted[key]
                    ? undefined
                    : isActive
                      ? meta.color + '80'
                      : meta.color + '40'
                }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{meta.icon}</span>
                    <span className="font-semibold capitalize" style={{ color: meta.color }}>
                      {meta.label}
                    </span>
                  </div>
                  {isActive && (
                    <span className="flex gap-0.5">
                      {[1, 2, 3].map((i) => (
                        <span
                          key={i}
                          className="w-0.5 bg-white rounded-full"
                          style={{
                            height: 8 + i * 4,
                            animation: `pulse 0.8s ease-in-out ${i * 0.15}s infinite`
                          }}
                        />
                      ))}
                    </span>
                  )}
                </div>

                <div
                  ref={(el) => {
                    stemContainers.current[key] = el
                  }}
                  className="h-16 rounded-lg overflow-hidden"
                />

                <div className="text-[10px] text-neutral-500 text-right">
                  {formatTime(progress)} / {formatTime(duration)}
                </div>

                <div className="flex items-center justify-between">
                  <button
                    onClick={() => toggleStem(key)}
                    className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                      isActive
                        ? 'bg-green-600/30 hover:bg-green-600/40'
                        : 'bg-white/10 hover:bg-white/20'
                    }`}
                  >
                    {isActive ? (
                      <span className="text-green-400 text-sm">⏸</span>
                    ) : (
                      <span className="text-white text-sm ml-0.5">▶</span>
                    )}
                  </button>
                  <div className="flex gap-2">
                    <button
                      onClick={() => toggleMute(key)}
                      className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                        muted[key]
                          ? 'bg-red-600 text-white'
                          : 'bg-neutral-800 text-neutral-400 hover:text-white'
                      }`}
                    >
                      M
                    </button>
                    <button
                      onClick={() => toggleSolo(key)}
                      className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                        solo[key]
                          ? 'bg-yellow-600 text-white'
                          : 'bg-neutral-800 text-neutral-400 hover:text-white'
                      }`}
                    >
                      S
                    </button>
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
          {stemsPlaying ? (
            <span className="text-blue-400 text-lg">⏸</span>
          ) : (
            <span className="text-blue-400 text-lg ml-1">▶</span>
          )}
        </button>

        <div className="flex flex-col items-center gap-2 w-full">
          <span className="text-xs text-neutral-500">Volume</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={masterVolume}
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
