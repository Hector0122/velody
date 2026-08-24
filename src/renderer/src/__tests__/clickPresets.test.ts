import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CLICK_PRESETS, isClickPreset, DEFAULT_CLICK_PRESET } from '../hooks/clickPresets'

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

interface TrackedNoiseSource {
  buffer: AudioBuffer | null
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
  noiseSources: TrackedNoiseSource[]
  gains: TrackedGain[]
  filters: { type: string; frequency: { value: number } }[]
} {
  const oscillators: TrackedOsc[] = []
  const noiseSources: TrackedNoiseSource[] = []
  const gains: TrackedGain[] = []
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

  return { ctx, destination, oscillators, noiseSources, gains, filters }
}

describe('isClickPreset', () => {
  it('accepts every known preset id', () => {
    expect(isClickPreset('pingpong')).toBe(true)
    expect(isClickPreset('woodblock')).toBe(true)
    expect(isClickPreset('rimclick')).toBe(true)
    expect(isClickPreset('beep')).toBe(true)
  })

  it('rejects anything else', () => {
    expect(isClickPreset('kick')).toBe(false)
    expect(isClickPreset(42)).toBe(false)
    expect(isClickPreset(null)).toBe(false)
    expect(isClickPreset(undefined)).toBe(false)
  })
})

describe('CLICK_PRESETS', () => {
  let env: ReturnType<typeof makeFakeAudioContext>

  beforeEach(() => {
    env = makeFakeAudioContext()
  })

  it('DEFAULT_CLICK_PRESET is a valid preset id', () => {
    expect(isClickPreset(DEFAULT_CLICK_PRESET)).toBe(true)
  })

  it('pingpong: sine oscillator sweep plus a bandpass noise burst, both routed to the given destination', () => {
    CLICK_PRESETS.pingpong(env.ctx, true, 0, 1, env.destination)

    expect(env.oscillators).toHaveLength(1)
    expect(env.oscillators[0].type).toBe('sine')
    expect(env.oscillators[0].frequency.setValueAtTime).toHaveBeenCalledWith(2000, 0)
    expect(env.oscillators[0].frequency.exponentialRampToValueAtTime).toHaveBeenCalledWith(
      1200,
      expect.closeTo(0.012, 5)
    )
    expect(env.noiseSources).toHaveLength(1)
    expect(env.filters).toHaveLength(1)
    expect(env.filters[0].type).toBe('bandpass')
    expect(env.filters[0].frequency.value).toBe(2500)
    // Both the tone gain and the noise gain connect to `destination`, not
    // ctx.destination directly.
    expect(env.gains).toHaveLength(2)
    for (const gain of env.gains) {
      expect(gain.connect).toHaveBeenCalledWith(env.destination)
    }
  })

  it('pingpong: regular (non-accent) beat uses lower sweep frequencies', () => {
    CLICK_PRESETS.pingpong(env.ctx, false, 0, 1, env.destination)

    expect(env.oscillators[0].frequency.setValueAtTime).toHaveBeenCalledWith(1400, 0)
    expect(env.oscillators[0].frequency.exponentialRampToValueAtTime).toHaveBeenCalledWith(
      900,
      expect.closeTo(0.012, 5)
    )
  })

  it('woodblock: triangle oscillator sweep, no noise burst, routed to the given destination', () => {
    CLICK_PRESETS.woodblock(env.ctx, true, 0, 1, env.destination)

    expect(env.oscillators).toHaveLength(1)
    expect(env.oscillators[0].type).toBe('triangle')
    expect(env.oscillators[0].frequency.setValueAtTime).toHaveBeenCalledWith(900, 0)
    expect(env.noiseSources).toHaveLength(0)
    expect(env.gains[0].connect).toHaveBeenCalledWith(env.destination)
  })

  it('rimclick: noise burst only, no oscillator, routed to the given destination', () => {
    CLICK_PRESETS.rimclick(env.ctx, true, 0, 1, env.destination)

    expect(env.oscillators).toHaveLength(0)
    expect(env.noiseSources).toHaveLength(1)
    expect(env.filters[0].frequency.value).toBe(3500)
    expect(env.gains[0].connect).toHaveBeenCalledWith(env.destination)
  })

  it('beep: triangle oscillator at a fixed frequency, matching the original implementation', () => {
    CLICK_PRESETS.beep(env.ctx, true, 0, 1, env.destination)

    expect(env.oscillators).toHaveLength(1)
    expect(env.oscillators[0].type).toBe('triangle')
    expect(env.oscillators[0].frequency.value).toBe(1600)
    expect(env.noiseSources).toHaveLength(0)
    expect(env.gains[0].connect).toHaveBeenCalledWith(env.destination)
  })

  it('beep: non-accent beat uses the lower fixed frequency', () => {
    CLICK_PRESETS.beep(env.ctx, false, 0, 1, env.destination)
    expect(env.oscillators[0].frequency.value).toBe(900)
  })

  it('every preset schedules its nodes to start at the given scheduledTime', () => {
    for (const preset of Object.values(CLICK_PRESETS)) {
      const e = makeFakeAudioContext()
      preset(e.ctx, true, 1.5, 1, e.destination)
      const started = [...e.oscillators, ...e.noiseSources]
      expect(started.length).toBeGreaterThan(0)
      for (const node of started) {
        expect(node.start).toHaveBeenCalledWith(1.5)
      }
    }
  })
})
