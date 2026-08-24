// Metronome click sound presets — see openspec/changes/
// add-metronome-click-sounds/design.md for the rationale and exact
// parameters. All four are pure Web Audio synthesis (no sample files).

export type ClickPreset = 'pingpong' | 'woodblock' | 'rimclick' | 'beep'

export const CLICK_PRESET_LABELS: Record<ClickPreset, string> = {
  pingpong: 'Ping Pong',
  woodblock: 'Wood Block',
  rimclick: 'Rim Click',
  beep: 'Beep'
}

export const DEFAULT_CLICK_PRESET: ClickPreset = 'pingpong'

export function isClickPreset(value: unknown): value is ClickPreset {
  return value === 'pingpong' || value === 'woodblock' || value === 'rimclick' || value === 'beep'
}

type ClickFn = (ctx: AudioContext, accent: boolean, scheduledTime: number, volume: number) => void

// A short burst of white noise is what gives pingpong/rimclick their
// percussive "impact" transient — a pure oscillator can't produce that on
// its own. The buffer is generated once per AudioContext and reused (noise
// perceptually doesn't need to differ click to click), not regenerated on
// every call.
let noiseBufferCache: AudioBuffer | null = null
let noiseBufferCacheCtx: AudioContext | null = null

function getNoiseBuffer(ctx: AudioContext): AudioBuffer {
  if (noiseBufferCache && noiseBufferCacheCtx === ctx) return noiseBufferCache
  const length = Math.ceil(ctx.sampleRate * 0.02) // 20ms — enough headroom for any preset's burst
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
  noiseBufferCache = buffer
  noiseBufferCacheCtx = ctx
  return buffer
}

function playNoiseBurst(
  ctx: AudioContext,
  scheduledTime: number,
  durationSec: number,
  filterFreq: number,
  gainValue: number
): void {
  const source = ctx.createBufferSource()
  source.buffer = getNoiseBuffer(ctx)
  const filter = ctx.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = filterFreq
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(gainValue, scheduledTime)
  gain.gain.exponentialRampToValueAtTime(0.001, scheduledTime + durationSec)
  source.connect(filter)
  filter.connect(gain)
  gain.connect(ctx.destination)
  source.start(scheduledTime)
  source.stop(scheduledTime + durationSec)
}

function playToneSweep(
  ctx: AudioContext,
  oscType: OscillatorType,
  startFreq: number,
  endFreq: number,
  sweepDurationSec: number,
  decaySec: number,
  scheduledTime: number,
  gainValue: number
): void {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = oscType
  osc.frequency.setValueAtTime(startFreq, scheduledTime)
  osc.frequency.exponentialRampToValueAtTime(endFreq, scheduledTime + sweepDurationSec)
  gain.gain.setValueAtTime(gainValue, scheduledTime)
  gain.gain.exponentialRampToValueAtTime(0.001, scheduledTime + decaySec)
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start(scheduledTime)
  osc.stop(scheduledTime + decaySec)
}

// Short, percussive "knock" — a fast downward pitch sweep plus a brief
// filtered-noise transient. The new default (was "beep").
function pingpong(ctx: AudioContext, accent: boolean, scheduledTime: number, volume: number): void {
  const [start, end] = accent ? [2000, 1200] : [1400, 900]
  playToneSweep(
    ctx,
    'sine',
    start,
    end,
    0.012,
    0.018,
    scheduledTime,
    volume * (accent ? 0.5 : 0.35)
  )
  playNoiseBurst(ctx, scheduledTime, 0.004, 2500, volume * (accent ? 0.18 : 0.12))
}

// Rounder, lower-pitched knock — same sweep-and-decay shape as pingpong but
// no noise layer, so it reads as duller/woodier rather than sharp.
function woodblock(
  ctx: AudioContext,
  accent: boolean,
  scheduledTime: number,
  volume: number
): void {
  const [start, end] = accent ? [900, 500] : [650, 400]
  playToneSweep(
    ctx,
    'triangle',
    start,
    end,
    0.03,
    0.03,
    scheduledTime,
    volume * (accent ? 0.5 : 0.35)
  )
}

// Dry, high, noise-only stick click — no tonal/pitch content, sits above a
// full band mix without adding a note.
function rimclick(ctx: AudioContext, accent: boolean, scheduledTime: number, volume: number): void {
  playNoiseBurst(ctx, scheduledTime, 0.006, 3500, volume * (accent ? 0.6 : 0.4))
}

// Today's original click, kept as an option: triangle oscillator, fixed
// frequency, 60ms decay — a softer, longer tone than the other three.
function beep(ctx: AudioContext, accent: boolean, scheduledTime: number, volume: number): void {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'triangle'
  osc.frequency.value = accent ? 1600 : 900
  gain.gain.setValueAtTime(volume * (accent ? 0.5 : 0.35), scheduledTime)
  gain.gain.exponentialRampToValueAtTime(0.001, scheduledTime + 0.06)
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start(scheduledTime)
  osc.stop(scheduledTime + 0.06)
}

export const CLICK_PRESETS: Record<ClickPreset, ClickFn> = {
  pingpong,
  woodblock,
  rimclick,
  beep
}
