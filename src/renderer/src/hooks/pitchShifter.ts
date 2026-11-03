import type { StretchNode } from 'signalsmith-stretch'

// Practice speed + transpose.
//
// Speed is applied natively on every stem's AudioBufferSourceNode
// (`playbackRate`) — sample-accurate, keeps all stems locked together, but
// resamples, so pitch moves with speed. A single Signalsmith Stretch node on
// the master bus (live-input mode) then shifts the whole mix back by that
// amount plus the user's transpose. One node for the mix instead of one per
// stem: less CPU, and the stems can't drift apart.

export const SPEED_MIN = 0.5
export const SPEED_MAX = 1.5
export const SPEED_STEP = 0.05
export const SEMITONES_MIN = -12
export const SEMITONES_MAX = 12

export function clampSpeed(speed: number): number {
  if (!Number.isFinite(speed)) return 1
  // Snap to the step grid so 0.95 + 0.05 is exactly 1 (no float residue that
  // would keep the shifter needlessly active).
  const snapped = Math.round(speed / SPEED_STEP) * SPEED_STEP
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, Number(snapped.toFixed(2))))
}

export function clampSemitones(semitones: number): number {
  if (!Number.isFinite(semitones)) return 0
  return Math.min(SEMITONES_MAX, Math.max(SEMITONES_MIN, Math.round(semitones)))
}

/** Pitch shift the master-bus node must apply: transpose minus the pitch
 * change that `playbackRate = speed` already introduced. */
export function compensatingSemitones(speed: number, semitones: number): number {
  return semitones - 12 * Math.log2(speed)
}

/** Whether the shifter is needed at all (otherwise it's bypassed: no CPU, no latency). */
export function needsPitchShifter(speed: number, semitones: number): boolean {
  return Math.abs(compensatingSemitones(speed, semitones)) > 1e-3
}

export async function createPitchShifter(ctx: AudioContext): Promise<StretchNode> {
  const { default: SignalsmithStretch } = await import('signalsmith-stretch')
  return SignalsmithStretch(ctx, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2]
  })
}
