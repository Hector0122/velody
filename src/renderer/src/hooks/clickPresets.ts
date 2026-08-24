// Metronome click sound — see openspec/changes/add-metronome-click-sounds
// for the original multi-preset rationale, and
// openspec/changes/simplify-metronome-to-woodblock-only for why it's now a
// single fixed sound. Pure Web Audio synthesis (no sample files).

export type ClickPreset = 'woodblock'

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

// Rounder, lower-pitched knock: a fast downward pitch sweep, no noise layer,
// so it reads as woody/dull rather than sharp. Gain multipliers boosted well
// above the original 0.5/0.35 (see simplify-metronome-to-woodblock-only) —
// reported as too quiet even at the volume slider's max; 0.95/0.75 uses
// nearly all of the available headroom without risking hard clipping when
// the slider itself is also maxed.
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
    0.03,
    scheduledTime,
    volume * (accent ? 0.95 : 0.75),
    destination
  )
}

export const CLICK_PRESETS: Record<ClickPreset, typeof woodblock> = {
  woodblock
}
