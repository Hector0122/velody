import { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react'
import useClickPreset from './useClickPreset'
import useLocalStoragePreference from './useLocalStoragePreference'
import { type ClickPreset, CLICK_PRESETS } from './clickPresets'

const LOOKAHEAD = 0.3

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

// First index in `sortedTimes` whose value is >= target (binary search).
// `beatTimes` is sorted ascending and typically a few hundred entries for a
// full song, so this is negligible cost on the 25ms scheduler tick, and it
// naturally handles arbitrary seeks/loops without a persistent cursor.
function lowerBound(sortedTimes: number[], target: number): number {
  let lo = 0
  let hi = sortedTimes.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (sortedTimes[mid] < target) lo = mid + 1
    else hi = mid
  }
  return lo
}

export function useMetronome(
  masterPlaying: boolean,
  masterPlayingRef: React.MutableRefObject<boolean>,
  positionRef: React.MutableRefObject<number>,
  firstBeatOffsetRef: React.MutableRefObject<number>,
  originalBpmRef: React.MutableRefObject<number>,
  beatTimesRef: React.MutableRefObject<number[]>
): {
  bpm: number
  setBpm: (v: number | ((prev: number) => number)) => void
  metronomeOn: boolean
  setMetronomeOn: (v: boolean | ((prev: boolean) => boolean)) => void
  metroVolume: number
  setMetroVolume: (v: number) => void
  clickPreset: ClickPreset
  setClickPreset: (v: ClickPreset) => void
  metroPan: number
  setMetroPan: (v: number) => void
  lastScheduledBeatRef: React.MutableRefObject<number>
  bpmRef: React.MutableRefObject<number>
  playClick: (accent: boolean, scheduledTime: number) => void
  // Creates the metronome's own AudioContext if it doesn't exist yet (and
  // resumes it if suspended) — playClick silently no-ops without this
  // having been called at least once. Exposed so callers that need to
  // schedule clicks before playback (recording pre-roll, playback
  // count-in) can guarantee a context exists first; the in-song scheduler
  // (below) already calls it itself once metronomeOn && masterPlaying.
  ensureAudioCtx: () => AudioContext | null
} {
  const [metronomeOn, setMetronomeOn] = useState(false)
  const [bpm, setBpm] = useState(120)
  const [metroVolume, setMetroVolume] = useState(0.5)
  const [clickPreset, setClickPreset] = useClickPreset()
  // Global (not per-song) preference, like clickPreset — see
  // openspec/changes/add-metronome-and-mix-panning: lets the click be
  // panned hard to one channel (e.g. to a drummer's monitor via a
  // stereo-splitter cable) independent of the overall mix's pan.
  const [metroPan, setMetroPan] = useLocalStoragePreference('velody:metroPan', 0, isFiniteNumber)

  const metronomeOnRef = useRef(metronomeOn)
  const bpmRef = useRef(bpm)
  const metroVolumeRef = useRef(metroVolume)
  const clickPresetRef = useRef(clickPreset)
  // Dual-purpose dedup counter: "last scheduled beat number" in constant-tempo
  // mode, "last scheduled beat-grid index" in grid mode. The two modes are
  // mutually exclusive per tick, and every transition between them (song
  // change, manual BPM change) already resets this to -1 via external code
  // (StemPlayer, useWaveSurfers, useRecording), so reinterpreting its stored
  // value between modes is safe — see design.md, "use-detected-beat-grid-for-
  // metronome" change.
  const lastScheduledBeatRef = useRef(-1)
  const audioCtxRef = useRef<AudioContext | null>(null)
  // Persistent — created once alongside audioCtxRef, not per click like the
  // short-lived oscillator/gain/noise nodes each preset creates. Every
  // click connects through it instead of straight to ctx.destination, so
  // metroPan applies uniformly without needing to thread it into each
  // preset's own node graph.
  const panNodeRef = useRef<StereoPannerNode | null>(null)

  useLayoutEffect(() => {
    metronomeOnRef.current = metronomeOn
    bpmRef.current = bpm
    metroVolumeRef.current = metroVolume
    clickPresetRef.current = clickPreset
    if (panNodeRef.current) panNodeRef.current.pan.value = metroPan
  })

  const ensureAudioCtx = useCallback((): AudioContext | null => {
    if (!audioCtxRef.current) {
      try {
        audioCtxRef.current = new AudioContext()
        panNodeRef.current = audioCtxRef.current.createStereoPanner()
        panNodeRef.current.pan.value = metroPan
        panNodeRef.current.connect(audioCtxRef.current.destination)
      } catch {
        return null
      }
    }
    if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume()
    return audioCtxRef.current
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const playClick = useCallback((accent: boolean, scheduledTime: number): void => {
    const ctx = audioCtxRef.current
    if (!ctx) return
    const destination = panNodeRef.current ?? ctx.destination
    CLICK_PRESETS[clickPresetRef.current](
      ctx,
      accent,
      scheduledTime,
      metroVolumeRef.current,
      destination
    )
  }, [])

  // Constant-tempo extrapolation from `offset`/beat 0 — today's algorithm,
  // used when no detected beat grid applies (none available, or the tempo was
  // manually overridden).
  const scheduleConstantTempo = useCallback(
    (ctx: AudioContext, t: number, bpmValue: number, offset: number): void => {
      const tAdj = Math.max(0, t - offset)
      let beat = Math.max(Math.floor((tAdj * bpmValue) / 60) + 1, lastScheduledBeatRef.current + 1)

      while ((beat * 60) / bpmValue - tAdj < LOOKAHEAD) {
        const delaySong = (beat * 60) / bpmValue - tAdj
        playClick(beat % 4 === 1, ctx.currentTime + Math.max(0, delaySong))
        lastScheduledBeatRef.current = beat
        beat++
      }
    },
    [playClick]
  )

  // Schedules from the real detected beat-time grid. Once playback advances
  // past the last detected beat, falls back to the same constant-tempo
  // formula as above, anchored at the last real beat's time/index instead of
  // the song start (see design.md - Decisions).
  const scheduleFromGrid = useCallback(
    (ctx: AudioContext, t: number, beatTimes: number[], bpmValue: number): void => {
      let idx = Math.max(lowerBound(beatTimes, t), lastScheduledBeatRef.current + 1)

      while (idx < beatTimes.length && beatTimes[idx] - t < LOOKAHEAD) {
        const delaySong = beatTimes[idx] - t
        playClick(idx % 4 === 0, ctx.currentTime + Math.max(0, delaySong))
        lastScheduledBeatRef.current = idx
        idx++
      }

      if (idx >= beatTimes.length) {
        const lastIdx = beatTimes.length - 1
        const lastTime = beatTimes[lastIdx]
        const tAdj = t - lastTime
        let n = Math.max(
          Math.floor((tAdj * bpmValue) / 60) + 1,
          lastScheduledBeatRef.current - lastIdx + 1
        )

        while ((n * 60) / bpmValue - tAdj < LOOKAHEAD) {
          const delaySong = (n * 60) / bpmValue - tAdj
          playClick((lastIdx + n) % 4 === 0, ctx.currentTime + Math.max(0, delaySong))
          lastScheduledBeatRef.current = lastIdx + n
          n++
        }
      }
    },
    [playClick]
  )

  const schedulerTick = useCallback((): void => {
    if (!metronomeOnRef.current || !masterPlayingRef.current) return
    const ctx = audioCtxRef.current
    if (!ctx || ctx.state === 'closed') return
    if (ctx.state === 'suspended') {
      ctx.resume()
      return
    }

    const t = positionRef.current
    const currentBpm = bpmRef.current
    // Defensive fallback in case anything ever hands this ref a non-array
    // (e.g. a stale caller) — degrade to constant-tempo rather than throw.
    const beatTimes = Array.isArray(beatTimesRef.current) ? beatTimesRef.current : []
    // The detected grid corresponds to the originally detected tempo; once
    // the user asks for a different BPM, the grid's timings no longer match
    // what's displayed, so fall back to constant-tempo at the chosen BPM.
    const usingGrid = beatTimes.length > 0 && currentBpm === originalBpmRef.current

    if (usingGrid) {
      scheduleFromGrid(ctx, t, beatTimes, currentBpm)
    } else {
      scheduleConstantTempo(ctx, t, currentBpm, firstBeatOffsetRef.current)
    }
  }, [
    masterPlayingRef,
    positionRef,
    firstBeatOffsetRef,
    originalBpmRef,
    beatTimesRef,
    scheduleFromGrid,
    scheduleConstantTempo
  ])

  useEffect(() => {
    if (metronomeOn && masterPlaying) {
      ensureAudioCtx()
      lastScheduledBeatRef.current = -1
      const id = window.setInterval(schedulerTick, 25)
      return () => clearInterval(id)
    }
    return
  }, [metronomeOn, masterPlaying, ensureAudioCtx, schedulerTick])

  return {
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
    lastScheduledBeatRef,
    bpmRef,
    playClick,
    ensureAudioCtx
  }
}
