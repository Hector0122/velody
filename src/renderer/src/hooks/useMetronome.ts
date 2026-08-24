import { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react'
import useClickPreset from './useClickPreset'
import { type ClickPreset, CLICK_PRESETS } from './clickPresets'

const LOOKAHEAD = 0.3

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
  lastScheduledBeatRef: React.MutableRefObject<number>
  bpmRef: React.MutableRefObject<number>
  playClick: (accent: boolean, scheduledTime: number) => void
} {
  const [metronomeOn, setMetronomeOn] = useState(false)
  const [bpm, setBpm] = useState(120)
  const [metroVolume, setMetroVolume] = useState(0.5)
  const [clickPreset, setClickPreset] = useClickPreset()

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

  useLayoutEffect(() => {
    metronomeOnRef.current = metronomeOn
    bpmRef.current = bpm
    metroVolumeRef.current = metroVolume
    clickPresetRef.current = clickPreset
  })

  const getAudioCtx = useCallback((): AudioContext | null => {
    if (!audioCtxRef.current) {
      try {
        audioCtxRef.current = new AudioContext()
      } catch {
        return null
      }
    }
    if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume()
    return audioCtxRef.current
  }, [])

  const playClick = useCallback((accent: boolean, scheduledTime: number): void => {
    const ctx = audioCtxRef.current
    if (!ctx) return
    CLICK_PRESETS[clickPresetRef.current](ctx, accent, scheduledTime, metroVolumeRef.current)
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
      getAudioCtx()
      lastScheduledBeatRef.current = -1
      const id = window.setInterval(schedulerTick, 25)
      return () => clearInterval(id)
    }
    return
  }, [metronomeOn, masterPlaying, getAudioCtx, schedulerTick])

  return {
    bpm,
    setBpm,
    metronomeOn,
    setMetronomeOn,
    metroVolume,
    setMetroVolume,
    clickPreset,
    setClickPreset,
    lastScheduledBeatRef,
    bpmRef,
    playClick
  }
}
