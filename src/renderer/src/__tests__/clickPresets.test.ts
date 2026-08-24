import { describe, it, expect, beforeEach, vi } from 'vitest'
import { CLICK_PRESETS } from '../hooks/clickPresets'

interface TrackedOsc {
  type: string
  frequency: {
    value: number
    setValueAtTime: ReturnType<typeof vi.fn>
    exponentialRampToValueAtTime: ReturnType<typeof vi.fn>
  }
  connect: ReturnType<typeof vi.fn>
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
}

interface TrackedGain {
  connect: ReturnType<typeof vi.fn>
  gain: {
    setValueAtTime: ReturnType<typeof vi.fn>
    exponentialRampToValueAtTime: ReturnType<typeof vi.fn>
  }
}

function makeFakeAudioContext(): {
  ctx: AudioContext
  destination: AudioNode
  oscillators: TrackedOsc[]
  gains: TrackedGain[]
} {
  const oscillators: TrackedOsc[] = []
  const gains: TrackedGain[] = []
  // A distinct object (not ctx.destination) — proves the preset connects to
  // whatever `destination` node it's given, not a hardcoded ctx.destination
  // (see add-metronome-and-mix-panning, which routes clicks through its own
  // persistent pan node instead).
  const destination = {} as AudioNode

  const ctx = {
    createOscillator: (): TrackedOsc => {
      const osc: TrackedOsc = {
        type: '',
        frequency: { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn()
      }
      oscillators.push(osc)
      return osc
    },
    createGain: (): TrackedGain => {
      const gain: TrackedGain = {
        connect: vi.fn(),
        gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }
      }
      gains.push(gain)
      return gain
    },
    destination: {}
  } as unknown as AudioContext

  return { ctx, destination, oscillators, gains }
}

describe('CLICK_PRESETS.woodblock', () => {
  let env: ReturnType<typeof makeFakeAudioContext>

  beforeEach(() => {
    env = makeFakeAudioContext()
  })

  it('triangle oscillator sweep, routed to the given destination', () => {
    CLICK_PRESETS.woodblock(env.ctx, true, 0, 1, env.destination)

    expect(env.oscillators).toHaveLength(1)
    expect(env.oscillators[0].type).toBe('triangle')
    expect(env.oscillators[0].frequency.setValueAtTime).toHaveBeenCalledWith(900, 0)
    expect(env.oscillators[0].frequency.exponentialRampToValueAtTime).toHaveBeenCalledWith(
      500,
      expect.closeTo(0.03, 5)
    )
    expect(env.gains[0].connect).toHaveBeenCalledWith(env.destination)
  })

  it('regular (non-accent) beat uses lower sweep frequencies', () => {
    CLICK_PRESETS.woodblock(env.ctx, false, 0, 1, env.destination)

    expect(env.oscillators[0].frequency.setValueAtTime).toHaveBeenCalledWith(650, 0)
    expect(env.oscillators[0].frequency.exponentialRampToValueAtTime).toHaveBeenCalledWith(
      400,
      expect.closeTo(0.03, 5)
    )
  })

  // Regression coverage for simplify-metronome-to-woodblock-only: reported
  // too quiet even at the volume slider's max — gain multipliers boosted
  // from the original 0.5/0.35 to 0.95/0.75.
  it('uses the boosted gain multipliers (accent louder than non-accent, both well above the old 0.5/0.35)', () => {
    CLICK_PRESETS.woodblock(env.ctx, true, 0, 1, env.destination)
    expect(env.gains[0].gain.setValueAtTime).toHaveBeenCalledWith(0.95, 0)

    const nonAccentEnv = makeFakeAudioContext()
    CLICK_PRESETS.woodblock(nonAccentEnv.ctx, false, 0, 1, nonAccentEnv.destination)
    expect(nonAccentEnv.gains[0].gain.setValueAtTime).toHaveBeenCalledWith(0.75, 0)
  })

  it('scales gain by the given volume', () => {
    CLICK_PRESETS.woodblock(env.ctx, true, 0, 0.5, env.destination)
    expect(env.gains[0].gain.setValueAtTime).toHaveBeenCalledWith(0.475, 0)
  })

  it('schedules the oscillator to start at the given scheduledTime', () => {
    CLICK_PRESETS.woodblock(env.ctx, true, 1.5, 1, env.destination)
    expect(env.oscillators[0].start).toHaveBeenCalledWith(1.5)
  })
})
