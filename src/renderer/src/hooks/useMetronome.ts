import { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react'
import useLocalStoragePreference from './useLocalStoragePreference'
import { CLICK_PRESETS } from './clickPresets'
import { medianBeatGap, isConstantAccent, isGridAccent } from './downbeat'

const LOOKAHEAD = 0.3

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

// Bridge to the playback engine's clock (filled in by StemPlayer once
// useAudioContextEngine exists — it's created after this hook). When set,
// clicks are scheduled on the *same* AudioContext as the stems, against a
// position read from that context's clock at scheduling time, so every click
// lands sample-accurately on the beat. Without it (tests, or before the engine
// is wired) the metronome falls back to its own AudioContext + positionRef.
export interface PlaybackClock {
  ensureCtx: () => AudioContext | null
  getPosition: () => number
  // Song seconds per real second (practice speed). Defaults to 1.
  getRate?: () => number
  // Latency the engine adds after its sources (pitch shifter); every click
  // is delayed by this so it lines up with what's actually heard.
  getOutputDelay?: () => number
}

// Sentinel for lastScheduledBeatRef meaning "nothing scheduled yet this
// playback session" — reset here and by every seek/loop/restart/BPM-change
// site elsewhere (useAudioContextEngine, useWaveSurfers, StemPlayer's BPM
// handlers; they all must share this exact ref instance, returned below).
// Must be smaller than any real index the scheduler can produce. -1 used to
// suffice when the smallest real index was 0 (scheduleFromGrid) or 1
// (scheduleConstantTempo) — now that scheduleFromGrid extrapolates
// *backward* from the first detected beat with negative indices (see
// fix-count-in-song-start-timing), a fresh -1 could be less-negative than a
// legitimate backward-extrapolated starting index, wrongly clamping it away
// via the `Math.max(computed, lastScheduledBeatRef.current + 1)` ratchet.
export const RESET_SCHEDULED_BEAT = -Infinity

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
  beatTimesRef: React.MutableRefObject<number[]>,
  // Owned/written by useAudioContextEngine — true while playback has been
  // pre-scheduled (a future `when`) but that instant hasn't arrived yet, so
  // positionRef is still clamped at the starting position rather than
  // genuinely advancing. Without checking this, a song whose first real
  // beat lands within LOOKAHEAD of the start/trim position (common — see
  // add-song-trim-points) would get a click wrongly scheduled during a
  // count-in's wait, consuming the dedup ratchet so the real beat at the
  // correct moment then gets skipped. See fix-count-in-handoff-precision.
  playbackPendingRef: React.MutableRefObject<boolean>,
  playbackClockRef?: React.MutableRefObject<PlaybackClock | null>,
  // Which beat is the bar's "1" (0–3, per song — see downbeat.ts).
  downbeatShiftRef?: React.MutableRefObject<number>
): {
  bpm: number
  setBpm: (v: number | ((prev: number) => number)) => void
  metronomeOn: boolean
  setMetronomeOn: (v: boolean | ((prev: boolean) => boolean)) => void
  metroVolume: number
  setMetroVolume: (v: number) => void
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
  // Global (not per-song) preference, persisted like metroPan below —
  // previously a plain useState defaulting to 0.5 and reset every launch,
  // which meant "turn it up louder" never stuck; reported as feeling
  // perpetually quiet even after raising it. Default raised to 0.85 (was
  // 0.5) so a fresh install/cleared storage also starts loud enough to
  // actually hear over a full band — see
  // simplify-metronome-to-woodblock-only.
  const [metroVolume, setMetroVolume] = useLocalStoragePreference(
    'velody:metroVolume',
    0.85,
    isFiniteNumber
  )
  // Global (not per-song) preference — see
  // openspec/changes/add-metronome-and-mix-panning: lets the click be
  // panned hard to one channel (e.g. to a drummer's monitor via a
  // stereo-splitter cable) independent of the overall mix's pan.
  const [metroPan, setMetroPan] = useLocalStoragePreference('velody:metroPan', 0, isFiniteNumber)

  const metronomeOnRef = useRef(metronomeOn)
  const bpmRef = useRef(bpm)
  const metroVolumeRef = useRef(metroVolume)
  const metroPanRef = useRef(metroPan)
  // Dual-purpose dedup counter: "last scheduled beat number" in constant-tempo
  // mode, "last scheduled beat-grid index" in grid mode. The two modes are
  // mutually exclusive per tick, and every transition between them (song
  // change, manual BPM change) already resets this to -1 via external code
  // (StemPlayer, useWaveSurfers, useRecording), so reinterpreting its stored
  // value between modes is safe — see design.md, "use-detected-beat-grid-for-
  // metronome" change.
  const lastScheduledBeatRef = useRef(RESET_SCHEDULED_BEAT)
  const audioCtxRef = useRef<AudioContext | null>(null)
  // Persistent — created once alongside audioCtxRef, not per click like the
  // short-lived oscillator/gain/noise nodes each preset creates. Every
  // click connects through it instead of straight to ctx.destination, so
  // metroPan applies uniformly without needing to thread it into each
  // preset's own node graph.
  const panNodeRef = useRef<StereoPannerNode | null>(null)
  // Whether audioCtxRef is our own context (we must close it on unmount) or
  // the engine's shared one (the engine owns and closes it).
  const ownsCtxRef = useRef(false)
  // Beat positions are in song time; at practice speed `r`, song time passes
  // r× faster than real time, so a song-time delay d is d / r real seconds.
  const currentRate = useCallback((): number => {
    if (ownsCtxRef.current) return 1
    const rate = playbackClockRef?.current?.getRate?.() ?? 1
    return rate > 0 ? rate : 1
  }, [playbackClockRef])

  useLayoutEffect(() => {
    metronomeOnRef.current = metronomeOn
    bpmRef.current = bpm
    metroVolumeRef.current = metroVolume
    metroPanRef.current = metroPan
    if (panNodeRef.current) panNodeRef.current.pan.value = metroPan
  })

  const ensureAudioCtx = useCallback((): AudioContext | null => {
    const shared = playbackClockRef?.current?.ensureCtx() ?? null
    if (shared && audioCtxRef.current !== shared) {
      // Switch to the engine's context (first use, or the engine recreated it).
      if (ownsCtxRef.current) audioCtxRef.current?.close()
      audioCtxRef.current = shared
      ownsCtxRef.current = false
      panNodeRef.current = null
    }
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      try {
        audioCtxRef.current = new AudioContext()
        ownsCtxRef.current = true
        panNodeRef.current = null
      } catch {
        return null
      }
    }
    const ctx = audioCtxRef.current
    if (!panNodeRef.current) {
      // Straight to destination — the click deliberately bypasses the
      // engine's master gain/pan so it keeps its own volume/pan controls.
      panNodeRef.current = ctx.createStereoPanner()
      panNodeRef.current.pan.value = metroPanRef.current
      // Limiter: lets the volume slider go past 100% for a click that cuts
      // through a loud mix, without the click clipping into distortion.
      const limiter = ctx.createDynamicsCompressor()
      limiter.threshold.value = -3
      limiter.knee.value = 0
      limiter.ratio.value = 20
      limiter.attack.value = 0.001
      limiter.release.value = 0.05
      panNodeRef.current.connect(limiter)
      limiter.connect(ctx.destination)
    }
    if (ctx.state === 'suspended') ctx.resume()
    return ctx
  }, [playbackClockRef])

  // Close our own context when the song (StemPlayer) unmounts — it's keyed
  // per song, so leaking one AudioContext per opened song used to pile up
  // audio threads until clicks glitched or the context failed to open.
  useEffect(
    () => () => {
      if (ownsCtxRef.current) audioCtxRef.current?.close()
      audioCtxRef.current = null
      panNodeRef.current = null
    },
    []
  )

  const playClick = useCallback(
    (accent: boolean, scheduledTime: number): void => {
      const ctx = audioCtxRef.current
      if (!ctx) return
      const destination = panNodeRef.current ?? ctx.destination
      // Only on the shared engine context — our own context has no shifter.
      const delay = ownsCtxRef.current ? 0 : (playbackClockRef?.current?.getOutputDelay?.() ?? 0)
      CLICK_PRESETS.woodblock(
        ctx,
        accent,
        scheduledTime + delay,
        metroVolumeRef.current,
        destination
      )
    },
    [playbackClockRef]
  )

  // Constant-tempo extrapolation from `offset`/beat 0 — today's algorithm,
  // used when no detected beat grid applies (none available, or the tempo was
  // manually overridden).
  const scheduleConstantTempo = useCallback(
    (ctx: AudioContext, t: number, bpmValue: number, offset: number): void => {
      const tAdj = Math.max(0, t - offset)
      let beat = Math.max(Math.floor((tAdj * bpmValue) / 60) + 1, lastScheduledBeatRef.current + 1)

      while ((beat * 60) / bpmValue - tAdj < LOOKAHEAD) {
        const delaySong = (beat * 60) / bpmValue - tAdj
        playClick(
          isConstantAccent(beat, downbeatShiftRef?.current ?? 0),
          ctx.currentTime + Math.max(0, delaySong) / currentRate()
        )
        lastScheduledBeatRef.current = beat
        beat++
      }
    },
    [playClick, downbeatShiftRef, currentRate]
  )

  // Schedules from the real detected beat-time grid. Once playback advances
  // past the last detected beat, falls back to the same constant-tempo
  // formula as above, anchored at the last real beat's time/index instead of
  // the song start (see design.md - Decisions).
  //
  // Before the first detected beat (e.g. a song with a long intro before
  // the drums/downbeat), beatTimeAt(idx) extrapolates *backward* from
  // beatTimes[0] at constant tempo for negative idx, instead of the
  // scheduler staying silent for the whole intro — beatTimes[idx] - t was
  // never < LOOKAHEAD that far out, so nothing ever got scheduled until the
  // real grid began, which is exactly "the metronome goes quiet and only
  // picks back up once the drums come in" (see
  // fix-count-in-song-start-timing). idx still advances through negative
  // values into the real [0, beatTimes.length) range via the same single
  // loop/ratchet below, so the handoff from extrapolated to real beats is
  // seamless — no separate branch, no double-scheduling at the boundary.
  const scheduleFromGrid = useCallback(
    (ctx: AudioContext, t: number, beatTimes: number[], bpmValue: number): void => {
      const interval = medianBeatGap(beatTimes, 60 / bpmValue)
      const beatTimeAt = (i: number): number => (i < 0 ? beatTimes[0] + i * interval : beatTimes[i])

      let idx =
        t < beatTimes[0]
          ? Math.max(Math.ceil((t - beatTimes[0]) / interval), lastScheduledBeatRef.current + 1)
          : Math.max(lowerBound(beatTimes, t), lastScheduledBeatRef.current + 1)

      while (idx < beatTimes.length && beatTimeAt(idx) - t < LOOKAHEAD) {
        const beatTime = beatTimeAt(idx)
        // A backward-extrapolated beat can land before the song's own
        // start (idx very negative, small beatTimes[0]) — never click at a
        // negative audio position, just consume the ratchet past it.
        if (beatTime >= 0) {
          const delaySong = beatTime - t
          playClick(
            isGridAccent(idx, downbeatShiftRef?.current ?? 0),
            ctx.currentTime + Math.max(0, delaySong) / currentRate()
          )
        }
        lastScheduledBeatRef.current = idx
        idx++
      }

      if (idx >= beatTimes.length) {
        const lastIdx = beatTimes.length - 1
        const lastTime = beatTimes[lastIdx]
        const tAdj = t - lastTime
        const after = medianBeatGap(beatTimes, 60 / bpmValue)
        let n = Math.max(Math.floor(tAdj / after) + 1, lastScheduledBeatRef.current - lastIdx + 1)

        while (n * after - tAdj < LOOKAHEAD) {
          const delaySong = n * after - tAdj
          playClick(
            isGridAccent(lastIdx + n, downbeatShiftRef?.current ?? 0),
            ctx.currentTime + Math.max(0, delaySong) / currentRate()
          )
          lastScheduledBeatRef.current = lastIdx + n
          n++
        }
      }
    },
    [playClick, downbeatShiftRef, currentRate]
  )

  const schedulerTick = useCallback((): void => {
    if (!metronomeOnRef.current || !masterPlayingRef.current) return
    // Playback has been pre-scheduled but hasn't actually started yet
    // (count-in handoff) — positionRef is still clamped at the starting
    // position, not genuinely advancing, so there's nothing real to
    // schedule against yet. See the param's doc comment.
    if (playbackPendingRef.current) return
    const ctx = audioCtxRef.current
    if (!ctx || ctx.state === 'closed') return
    if (ctx.state === 'suspended') {
      ctx.resume()
      return
    }

    // On the shared engine context, read the position from its clock right
    // now so `ctx.currentTime + (beat - t)` is exact; otherwise use the
    // RAF-sampled positionRef.
    const clock = playbackClockRef?.current
    const t = clock && !ownsCtxRef.current ? clock.getPosition() : positionRef.current
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
    playbackPendingRef,
    playbackClockRef,
    scheduleFromGrid,
    scheduleConstantTempo
  ])

  useEffect(() => {
    if (metronomeOn && masterPlaying) {
      ensureAudioCtx()
      lastScheduledBeatRef.current = RESET_SCHEDULED_BEAT
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
    metroPan,
    setMetroPan,
    lastScheduledBeatRef,
    bpmRef,
    playClick,
    ensureAudioCtx
  }
}
