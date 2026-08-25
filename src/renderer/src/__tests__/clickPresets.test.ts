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

interface TrackedNoiseSource {
  buffer: AudioBuffer | null
  connect: ReturnType<typeof vi.fn>
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
}

function makeFakeAudioContext(): {
  ctx: AudioContext
  destination: AudioNode
  oscillators: TrackedOsc[]
  gains: TrackedGain[]
  noiseSources: TrackedNoiseSource[]
  filters: { type: string; frequency: { value: number } }[]
} {
  const oscillators: TrackedOsc[] = []
  const gains: TrackedGain[] = []
  const noiseSources: TrackedNoiseSource[] = []
  const filters: { type: string; frequency: { value: number } }[] = []
  // A distinct object (not ctx.destination) — proves the preset connects to
  // whatever `destination` node it's given, not a hardcoded ctx.destination
  // (see add-metronome-and-mix-panning, which routes clicks through its own
  // persistent pan node instead).
  const destination = {} as AudioNode

  const ctx = {
    sampleRate: 44100,
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
    createBuffer: (_channels: number, length: number) => ({
      getChannelData: () => new Float32Array(length)
    }),
    createBufferSource: (): TrackedNoiseSource => {
      const src: TrackedNoiseSource = {
        buffer: null,
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn()
      }
      noiseSources.push(src)
      return src
    },
    createBiquadFilter: () => {
      const filter = { type: '', frequency: { value: 0 }, connect: vi.fn() }
      filters.push(filter)
      return filter
    },
    destination: {}
  } as unknown as AudioContext

  return { ctx, destination, oscillators, gains, noiseSources, filters }
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
  })

  it('regular (non-accent) beat uses lower sweep frequencies', () => {
    CLICK_PRESETS.woodblock(env.ctx, false, 0, 1, env.destination)

    expect(env.oscillators[0].frequency.setValueAtTime).toHaveBeenCalledWith(650, 0)
    expect(env.oscillators[0].frequency.exponentialRampToValueAtTime).toHaveBeenCalledWith(
      400,
      expect.closeTo(0.03, 5)
    )
  })

  // Regression coverage for simplify-metronome-to-woodblock-only (raised
  // 0.5/0.35 to 0.95/0.75 — still reported too quiet/dull) and its
  // follow-up (this one): a tone-only click can't cut through a live mix
  // no matter how loud, so the budget was rebalanced between the tone and
  // a new noise-burst transient (below) rather than just raised further.
  it('uses the rebalanced tone gain (accent louder than non-accent)', () => {
    CLICK_PRESETS.woodblock(env.ctx, true, 0, 1, env.destination)
    expect(env.gains[0].gain.setValueAtTime).toHaveBeenCalledWith(0.7, 0)

    const nonAccentEnv = makeFakeAudioContext()
    CLICK_PRESETS.woodblock(nonAccentEnv.ctx, false, 0, 1, nonAccentEnv.destination)
    expect(nonAccentEnv.gains[0].gain.setValueAtTime).toHaveBeenCalledWith(0.55, 0)
  })

  it('layers a short filtered-noise burst on top of the tone, for perceptual "punch"', () => {
    CLICK_PRESETS.woodblock(env.ctx, true, 0, 1, env.destination)

    expect(env.noiseSources).toHaveLength(1)
    expect(env.noiseSources[0].start).toHaveBeenCalledWith(0)
    expect(env.filters).toHaveLength(1)
    expect(env.filters[0].type).toBe('bandpass')
    expect(env.filters[0].frequency.value).toBe(2000)
    // Tone gain + noise gain: 2 gain nodes total.
    expect(env.gains).toHaveLength(2)
    expect(env.gains[1].gain.setValueAtTime).toHaveBeenCalledWith(0.3, 0)
    for (const gain of env.gains) {
      expect(gain.connect).toHaveBeenCalledWith(env.destination)
    }
  })

  it('noise burst is quieter on a non-accent beat, matching the tone', () => {
    CLICK_PRESETS.woodblock(env.ctx, false, 0, 1, env.destination)
    expect(env.gains[1].gain.setValueAtTime).toHaveBeenCalledWith(0.2, 0)
  })

  // Tone (0.7) + noise (0.3) at full volume = 1.0 combined peak for the
  // accent — right at, not past, full scale.
  it('tone + noise combined peak stays at or under full scale (1.0) even at full volume', () => {
    CLICK_PRESETS.woodblock(env.ctx, true, 0, 1, env.destination)
    const tonePeak = env.gains[0].gain.setValueAtTime.mock.calls[0][0]
    const noisePeak = env.gains[1].gain.setValueAtTime.mock.calls[0][0]
    expect(tonePeak + noisePeak).toBeLessThanOrEqual(1.0)
  })

  it('scales both tone and noise gain by the given volume', () => {
    CLICK_PRESETS.woodblock(env.ctx, true, 0, 0.5, env.destination)
    expect(env.gains[0].gain.setValueAtTime).toHaveBeenCalledWith(0.35, 0)
    expect(env.gains[1].gain.setValueAtTime).toHaveBeenCalledWith(0.15, 0)
  })

  it('schedules the oscillator and the noise burst to start at the given scheduledTime', () => {
    CLICK_PRESETS.woodblock(env.ctx, true, 1.5, 1, env.destination)
    expect(env.oscillators[0].start).toHaveBeenCalledWith(1.5)
    expect(env.noiseSources[0].start).toHaveBeenCalledWith(1.5)
  })
})
