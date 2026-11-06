import { describe, it, expect } from 'vitest'
import {
  stemNameFromPath,
  chordIndexAt,
  songDirFromStemPath,
  formatTime,
  filterSongsByQuery,
  reorderSetlistSongs,
  resolveNextSetlistSong,
  extForFormat,
  formatFilter,
  BPM_MIN,
  BPM_MAX,
  DEFAULT_SAMPLE_RATE,
  AUDIO_START_THRESHOLD,
  AUDIO_START_MAX_SCAN_SECS,
  MASTER_WAVEFORM_HEIGHT,
  MASTER_MIN_PX_PER_SEC,
  STEM_WAVEFORM_HEIGHT,
  pickBeatTrackingStem,
  findMusicStart
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

describe('songDirFromStemPath', () => {
  it('strips the filename from a Unix path', () => {
    expect(songDirFromStemPath('/output/stems/My Song/vocals.wav')).toBe('/output/stems/My Song')
  })

  it('strips the filename from a Windows path', () => {
    expect(songDirFromStemPath('C:\\output\\stems\\My Song\\drums.mp3')).toBe(
      'C:\\output\\stems\\My Song'
    )
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

describe('filterSongsByQuery', () => {
  const songs = [{ name: 'La Flaca' }, { name: 'Flaca (Calamaro)' }, { name: 'Zombie' }]

  it('returns every song unchanged for an empty query', () => {
    expect(filterSongsByQuery(songs, '')).toEqual(songs)
  })

  it('returns every song unchanged for a whitespace-only query', () => {
    expect(filterSongsByQuery(songs, '   ')).toEqual(songs)
  })

  it('filters by case-insensitive substring match', () => {
    expect(filterSongsByQuery(songs, 'flaca')).toEqual([
      { name: 'La Flaca' },
      { name: 'Flaca (Calamaro)' }
    ])
    expect(filterSongsByQuery(songs, 'ZOMBIE')).toEqual([{ name: 'Zombie' }])
  })

  it('returns an empty array when nothing matches', () => {
    expect(filterSongsByQuery(songs, 'nonexistent')).toEqual([])
  })

  it('preserves the input order among matches', () => {
    expect(filterSongsByQuery(songs, 'a')).toEqual([
      { name: 'La Flaca' },
      { name: 'Flaca (Calamaro)' }
    ])
  })
})

describe('reorderSetlistSongs', () => {
  it('swaps a song with its previous neighbor on direction -1', () => {
    expect(reorderSetlistSongs(['A', 'B', 'C'], 1, -1)).toEqual(['B', 'A', 'C'])
  })

  it('swaps a song with its next neighbor on direction 1', () => {
    expect(reorderSetlistSongs(['A', 'B', 'C'], 1, 1)).toEqual(['A', 'C', 'B'])
  })

  it('returns the same array reference when moving the first song up', () => {
    const songNames = ['A', 'B', 'C']
    expect(reorderSetlistSongs(songNames, 0, -1)).toBe(songNames)
  })

  it('returns the same array reference when moving the last song down', () => {
    const songNames = ['A', 'B', 'C']
    expect(reorderSetlistSongs(songNames, 2, 1)).toBe(songNames)
  })

  it('does not mutate the input array', () => {
    const songNames = ['A', 'B', 'C']
    reorderSetlistSongs(songNames, 0, 1)
    expect(songNames).toEqual(['A', 'B', 'C'])
  })
})

describe('resolveNextSetlistSong', () => {
  const songs = [{ name: 'Song A' }, { name: 'Song B' }, { name: 'Song C' }]
  const setlists = [
    { id: 'sl1', songNames: ['Song A', 'Song B', 'Song C'] },
    { id: 'sl2', songNames: ['Song A'] }
  ]

  it('returns none when context is null', () => {
    expect(resolveNextSetlistSong(setlists, null, songs)).toEqual({ type: 'none', skipped: [] })
  })

  it('returns none when the setlist no longer exists', () => {
    const result = resolveNextSetlistSong(setlists, { setlistId: 'gone', index: 0 }, songs)
    expect(result).toEqual({ type: 'none', skipped: [] })
  })

  it('finds the immediate next song when it resolves', () => {
    const result = resolveNextSetlistSong(setlists, { setlistId: 'sl1', index: 0 }, songs)
    expect(result).toEqual({ type: 'found', song: songs[1], index: 1, skipped: [] })
  })

  it('returns none with no skips at the end of the setlist', () => {
    const result = resolveNextSetlistSong(setlists, { setlistId: 'sl2', index: 0 }, songs)
    expect(result).toEqual({ type: 'none', skipped: [] })
  })

  it('skips entries that no longer resolve to a library song and finds the next one that does', () => {
    const setlistsWithGap = [{ id: 'sl1', songNames: ['Song A', 'Deleted Song', 'Song C'] }]
    const result = resolveNextSetlistSong(setlistsWithGap, { setlistId: 'sl1', index: 0 }, songs)
    expect(result).toEqual({ type: 'found', song: songs[2], index: 2, skipped: ['Deleted Song'] })
  })

  it('returns none with the skipped names when every remaining entry is missing', () => {
    const setlistsAllGone = [{ id: 'sl1', songNames: ['Song A', 'Deleted 1', 'Deleted 2'] }]
    const result = resolveNextSetlistSong(setlistsAllGone, { setlistId: 'sl1', index: 0 }, songs)
    expect(result).toEqual({ type: 'none', skipped: ['Deleted 1', 'Deleted 2'] })
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

describe('pickBeatTrackingStem', () => {
  it('prefers the drums stem regardless of listing order', () => {
    const stems = ['/s/song/bass.mp3', '/s/song/vocals.mp3', '/s/song/drums.mp3']
    expect(pickBeatTrackingStem(stems)).toBe('/s/song/drums.mp3')
  })

  it('ignores recordings that merely start with a stem name', () => {
    const stems = ['/s/song/drums_take1.wav', '/s/song/bass.mp3']
    expect(pickBeatTrackingStem(stems)).toBe('/s/song/bass.mp3')
  })

  it('falls back to the first stem when no known stem is present', () => {
    expect(pickBeatTrackingStem(['/s/song/x.mp3'])).toBe('/s/song/x.mp3')
    expect(pickBeatTrackingStem([])).toBeUndefined()
  })
})

describe('findMusicStart', () => {
  const sr = 1000
  function buf(channels: number[][]): {
    sampleRate: number
    numberOfChannels: number
    getChannelData: (c: number) => Float32Array<ArrayBuffer>
  } {
    return {
      sampleRate: sr,
      numberOfChannels: channels.length,
      getChannelData: (c: number) => new Float32Array(channels[c])
    }
  }
  const silence = (n: number): number[] => new Array(n).fill(0)

  it('returns the earliest sound across all stems and channels, minus the pre-roll', () => {
    const drums = buf([[...silence(2000), 0.5, ...silence(10)]]) // 2.0s
    const bass = buf([silence(3000), [...silence(1500), 0.2, ...silence(10)]]) // 1.5s, ch 1
    expect(findMusicStart([drums, bass])).toBeCloseTo(1.5 - 0.03, 5)
  })

  it('ignores noise below the threshold', () => {
    const quiet = buf([[...silence(500).map(() => 0.001), ...silence(500), 0.3]])
    expect(findMusicStart([quiet])).toBeCloseTo(1.0 - 0.03, 5)
  })

  it('returns 0 for songs that start immediately or are silent within the scan window', () => {
    expect(findMusicStart([buf([[0.5, 0, 0]])])).toBe(0)
    expect(findMusicStart([buf([silence(100)])])).toBe(0)
    expect(findMusicStart([buf([[...silence(5000), 0.5]])], 0.008, 2)).toBe(0)
  })
})

describe('chordIndexAt', () => {
  const chords = [
    { time: 1, chord: 'Em' },
    { time: 3, chord: 'D' },
    { time: 5, chord: 'G' }
  ]

  it('finds the chord sounding at a time, including exactly on a change', () => {
    expect(chordIndexAt(chords, 0.5)).toBe(-1)
    expect(chordIndexAt(chords, 1)).toBe(0)
    expect(chordIndexAt(chords, 4.9)).toBe(1)
    expect(chordIndexAt(chords, 99)).toBe(2)
    expect(chordIndexAt([], 2)).toBe(-1)
  })
})
