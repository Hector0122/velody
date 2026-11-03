// Minimal typings for signalsmith-stretch (ships without .d.ts). Only the
// subset Velody uses — see hooks/pitchShifter.ts.
declare module 'signalsmith-stretch' {
  export interface StretchSchedule {
    output?: number
    active?: boolean
    semitones?: number
    tonalityHz?: number
    formantCompensation?: boolean
  }
  export interface StretchNode extends AudioWorkletNode {
    start(when?: number): Promise<unknown>
    stop(when?: number): Promise<unknown>
    schedule(changes: StretchSchedule): Promise<unknown>
    latency(): Promise<number>
  }
  export default function SignalsmithStretch(
    context: BaseAudioContext,
    options?: AudioWorkletNodeOptions
  ): Promise<StretchNode>
}
