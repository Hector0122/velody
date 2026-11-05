// Metronome click sound — see openspec/changes/add-metronome-click-sounds
// for the original multi-preset rationale, and
// openspec/changes/simplify-metronome-to-woodblock-only for why it's now a
// single fixed sound. Pure Web Audio synthesis (no sample files).

export type ClickPreset = 'woodblock'

// A short burst of filtered white noise is what gives the click a
// percussive "attack" transient a pure oscillator can't produce on its
// own — raising raw gain alone (see the comment on `woodblock` below) ran
// out of safe headroom before it read as loud/punchy enough; human hearing
// weighs a sharp transient's perceived loudness well above a sustained
// tone's at the same peak level, so this buys "cuts through the mix"
// without pushing peak amplitude past what's safe. The buffer is generated
// once per AudioContext and reused (noise perceptually doesn't need to
// differ click to click), not regenerated on every call.
let noiseBufferCache: AudioBuffer | null = null
let noiseBufferCacheCtx: AudioContext | null = null

function getNoiseBuffer(ctx: AudioContext): AudioBuffer {
  if (noiseBufferCache && noiseBufferCacheCtx === ctx) return noiseBufferCache
  const length = Math.ceil(ctx.sampleRate * 0.02) // 20ms — enough headroom for the burst
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
  gainValue: number,
  destination: AudioNode
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
  gain.connect(destination)
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
  gainValue: number,
  destination: AudioNode
): void {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = oscType
  osc.frequency.setValueAtTime(startFreq, scheduledTime)
  osc.frequency.exponentialRampToValueAtTime(endFreq, scheduledTime + sweepDurationSec)
  gain.gain.setValueAtTime(gainValue, scheduledTime)
  gain.gain.exponentialRampToValueAtTime(0.001, scheduledTime + decaySec)
  osc.connect(gain)
  gain.connect(destination)
  osc.start(scheduledTime)
  osc.stop(scheduledTime + decaySec)
}

// Rounder, lower-pitched knock: a fast downward pitch sweep plus a brief
// filtered-noise "attack" transient (see playNoiseBurst above). Simply
// maxing out the tone's own gain (tried first — see
// simplify-metronome-to-woodblock-only, 0.5/0.35 raised to 0.95/0.75)
// still read as too soft/dull: a sustained triangle-wave tone doesn't cut
// through a live band mix the way a sharp transient does, no matter how
// loud its peak amplitude is. Rebalanced here so tone + noise together
// still land at (not past) the same safe combined peak — 1.0 at full
// volume for the accent, comfortably under for the regular beat — while
// shifting more of that budget toward the noise burst's perceptual punch.
function woodblock(
  ctx: AudioContext,
  accent: boolean,
  scheduledTime: number,
  volume: number,
  destination: AudioNode
): void {
  const [start, end] = accent ? [900, 500] : [650, 400]
  playToneSweep(
    ctx,
    'triangle',
    start,
    end,
    0.03,
    0.07, // longer tail = more body at the same peak, so it isn't buried by the mix
    scheduledTime,
    volume * (accent ? 0.7 : 0.55),
    destination
  )
  playNoiseBurst(ctx, scheduledTime, 0.005, 2000, volume * (accent ? 0.3 : 0.2), destination)
}

export const CLICK_PRESETS: Record<ClickPreset, typeof woodblock> = {
  woodblock
}
