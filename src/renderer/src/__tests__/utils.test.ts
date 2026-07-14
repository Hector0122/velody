import { describe, it, expect } from 'vitest'
import {
  stemNameFromPath,
  formatTime,
  extForFormat,
  formatFilter,
  BPM_MIN,
  BPM_MAX,
  PITCH_SHIFT_MIN,
  PITCH_SHIFT_MAX,
  DEFAULT_SAMPLE_RATE,
  AUDIO_START_THRESHOLD,
  AUDIO_START_MAX_SCAN_SECS,
  MASTER_WAVEFORM_HEIGHT,
  MASTER_MIN_PX_PER_SEC,
  STEM_WAVEFORM_HEIGHT
} from '../utils'

describe('stemNameFromPath', () => {
  it('extracts stem name from Unix path', () => {
    expect(stemNameFromPath('/output/stems/song/vocals.wav')).toBe('vocals')
  })

  it('extracts stem name from Windows path', () => {
    expect(stemNameFromPath('C:\\output\\stems\\song\\drums.mp3')).toBe('drums')
  })

  it('extracts stem name without extension', () => {
    expect(stemNameFromPath('/some/path/bass')).toBe('bass')
  })

  it('returns original path if no separator found', () => {
    expect(stemNameFromPath('guitar.wav')).toBe('guitar')
  })

  it('handles nested directories', () => {
    expect(stemNameFromPath('/a/b/c/d/e/f/other.flac')).toBe('other')
  })
})

describe('formatTime', () => {
  it('formats 0 seconds', () => {
    expect(formatTime(0)).toBe('0:00')
  })

  it('formats seconds under a minute', () => {
    expect(formatTime(45)).toBe('0:45')
  })

  it('formats exactly one minute', () => {
    expect(formatTime(60)).toBe('1:00')
  })

  it('formats minutes and seconds', () => {
    expect(formatTime(125)).toBe('2:05')
  })

  it('formats large time values', () => {
    expect(formatTime(3661)).toBe('61:01')
  })

  it('pads single digit seconds', () => {
    expect(formatTime(61)).toBe('1:01')
  })

  it('handles fractional seconds (floors)', () => {
    expect(formatTime(90.9)).toBe('1:30')
  })
})

describe('extForFormat', () => {
  it('returns .mp3 for mp3 format', () => {
    expect(extForFormat('mp3')).toBe('.mp3')
  })

  it('returns .wav for wav format', () => {
    expect(extForFormat('wav')).toBe('.wav')
  })

  it('returns .wav for unknown format', () => {
    expect(extForFormat('flac')).toBe('.wav')
  })
})

describe('formatFilter', () => {
  it('returns MP3 filter for mp3', () => {
    expect(formatFilter('mp3')).toEqual({ name: 'MP3 Audio', extensions: ['mp3'] })
  })

  it('returns WAV filter for wav', () => {
    expect(formatFilter('wav')).toEqual({ name: 'WAV Audio', extensions: ['wav'] })
  })

  it('returns WAV filter for unknown format', () => {
    expect(formatFilter('ogg')).toEqual({ name: 'WAV Audio', extensions: ['wav'] })
  })
})

describe('constants', () => {
  it('has correct BPM range', () => {
    expect(BPM_MIN).toBe(40)
    expect(BPM_MAX).toBe(280)
    expect(BPM_MIN).toBeLessThan(BPM_MAX)
  })

  it('has correct pitch shift range', () => {
    expect(PITCH_SHIFT_MIN).toBe(-12)
    expect(PITCH_SHIFT_MAX).toBe(12)
    expect(PITCH_SHIFT_MIN).toBeLessThan(PITCH_SHIFT_MAX)
  })

  it('has correct sample rate', () => {
    expect(DEFAULT_SAMPLE_RATE).toBe(44100)
  })

  it('has valid audio start threshold', () => {
    expect(AUDIO_START_THRESHOLD).toBeGreaterThan(0)
    expect(AUDIO_START_THRESHOLD).toBeLessThan(1)
  })

  it('has valid scan duration', () => {
    expect(AUDIO_START_MAX_SCAN_SECS).toBeGreaterThan(0)
  })

  it('has valid waveform heights', () => {
    expect(MASTER_WAVEFORM_HEIGHT).toBeGreaterThan(STEM_WAVEFORM_HEIGHT)
    expect(STEM_WAVEFORM_HEIGHT).toBeGreaterThan(0)
  })

  it('has valid min px per sec', () => {
    expect(MASTER_MIN_PX_PER_SEC).toBeGreaterThan(0)
  })
})
