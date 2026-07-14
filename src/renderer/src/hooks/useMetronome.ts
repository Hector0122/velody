import { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react'

const LOOKAHEAD = 0.3

export function useMetronome(
  masterPlaying: boolean,
  masterPlayingRef: React.MutableRefObject<boolean>,
  positionRef: React.MutableRefObject<number>,
  firstBeatOffsetRef: React.MutableRefObject<number>
): {
  bpm: number
  setBpm: (v: number | ((prev: number) => number)) => void
  metronomeOn: boolean
  setMetronomeOn: (v: boolean | ((prev: boolean) => boolean)) => void
  metroVolume: number
  setMetroVolume: (v: number) => void
  lastScheduledBeatRef: React.MutableRefObject<number>
  bpmRef: React.MutableRefObject<number>
  playClick: (accent: boolean, scheduledTime: number) => void
} {
  const [metronomeOn, setMetronomeOn] = useState(false)
  const [bpm, setBpm] = useState(120)
  const [metroVolume, setMetroVolume] = useState(0.5)

  const metronomeOnRef = useRef(metronomeOn)
  const bpmRef = useRef(bpm)
  const metroVolumeRef = useRef(metroVolume)
  const lastScheduledBeatRef = useRef(-1)
  const audioCtxRef = useRef<AudioContext | null>(null)

  useLayoutEffect(() => {
    metronomeOnRef.current = metronomeOn
    bpmRef.current = bpm
    metroVolumeRef.current = metroVolume
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
  }, [])

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
    const offset = firstBeatOffsetRef.current
    const tAdj = Math.max(0, t - offset)
    let beat = Math.max(Math.floor((tAdj * currentBpm) / 60) + 1, lastScheduledBeatRef.current + 1)

    while ((beat * 60) / currentBpm - tAdj < LOOKAHEAD) {
      const delaySong = (beat * 60) / currentBpm - tAdj
      playClick(beat % 4 === 1, ctx.currentTime + Math.max(0, delaySong))
      lastScheduledBeatRef.current = beat
      beat++
    }
  }, [masterPlayingRef, positionRef, firstBeatOffsetRef, playClick])

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
    lastScheduledBeatRef,
    bpmRef,
    playClick
  }
}
