export function stemNameFromPath(path: string): string {
  return (
    path
      .split(/[/\\]/)
      .pop()
      ?.replace(/\.[^.]+$/, '') || path
  )
}

// A song's stem paths all share one directory (the song's own folder under
// output/stems/) — this is where the .velody metadata sidecar (BPM, beat
// grid, markers, trim points) lives. Strips just the last path segment
// (the filename) rather than assuming any particular stem name.
export { pickBeatTrackingStem } from '../../shared/analysis'

export function songDirFromStemPath(stemPath: string): string {
  return stemPath.replace(/[/\\][^/\\]+$/, '')
}

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

// Case-insensitive substring filter for the sidebar song list. An empty
// (or whitespace-only) query returns `songs` unchanged, preserving whatever
// order the caller already had.
export function filterSongsByQuery<T extends { name: string }>(songs: T[], query: string): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return songs
  return songs.filter((song) => song.name.toLowerCase().includes(q))
}

// Swaps the song at `index` with its neighbor in `direction` (-1 = up,
// 1 = down). Returns the original array reference unchanged when the move
// would go out of bounds, so callers can skip persisting a no-op.
// See openspec/changes/add-song-setlists.
export function reorderSetlistSongs(
  songNames: string[],
  index: number,
  direction: -1 | 1
): string[] {
  const target = index + direction
  if (target < 0 || target >= songNames.length) return songNames
  const next = [...songNames]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

interface SetlistLike {
  id: string
  songNames: string[]
}

interface SongLike {
  name: string
}

export type NextSetlistSongResult<T extends SongLike> =
  | { type: 'none'; skipped: string[] }
  | { type: 'found'; song: T; index: number; skipped: string[] }

// Resolves what "Next song" should do given the setlist the current song
// was opened from, the index it was opened at, and the current library.
// Skips forward past any entry that no longer resolves to a library song
// (e.g. deleted outside the setlist-aware delete flow) instead of getting
// stuck on it — `skipped` lists those names so the caller can toast about
// them. Pure — no state mutation, no IPC — so the setlist-traversal logic
// is directly testable without rendering Home.tsx.
export function resolveNextSetlistSong<T extends SongLike>(
  setlists: SetlistLike[],
  context: { setlistId: string; index: number } | null,
  songs: T[]
): NextSetlistSongResult<T> {
  if (!context) return { type: 'none', skipped: [] }
  const setlist = setlists.find((sl) => sl.id === context.setlistId)
  if (!setlist) return { type: 'none', skipped: [] }

  const skipped: string[] = []
  for (let i = context.index + 1; i < setlist.songNames.length; i++) {
    const name = setlist.songNames[i]
    const song = songs.find((s) => s.name === name)
    if (song) return { type: 'found', song, index: i, skipped }
    skipped.push(name)
  }
  return { type: 'none', skipped }
}

export const extForFormat = (fmt: string): string => (fmt === 'mp3' ? '.mp3' : '.wav')

export const formatFilter = (fmt: string): { name: string; extensions: string[] } =>
  fmt === 'mp3'
    ? { name: 'MP3 Audio', extensions: ['mp3'] }
    : { name: 'WAV Audio', extensions: ['wav'] }

// Constants
export const BPM_MIN = 40
export const BPM_MAX = 280
export const DEFAULT_SAMPLE_RATE = 44100
export const AUDIO_START_THRESHOLD = 0.008
export const AUDIO_START_MAX_SCAN_SECS = 30
export const MASTER_WAVEFORM_HEIGHT = 64
export const MASTER_MIN_PX_PER_SEC = 20
export const STEM_WAVEFORM_HEIGHT = 32

let cachedTimeEls: Element[] | null = null
let cachedCursorEls: HTMLElement[] | null = null

export function invalidateLiveUICache(): void {
  cachedTimeEls = null
  cachedCursorEls = null
}

export function updateTimeDisplays(time: number): void {
  if (!cachedTimeEls) {
    cachedTimeEls = Array.from(document.querySelectorAll('[data-live-time]'))
  }
  const timeStr = formatTime(time)
  for (let i = 0; i < cachedTimeEls.length; i++) {
    cachedTimeEls[i].textContent = timeStr
  }
}

export function updateCursors(time: number, duration: number): void {
  if (!cachedCursorEls) {
    cachedCursorEls = Array.from(document.querySelectorAll<HTMLElement>('[data-stem-cursor]'))
  }
  const pct = duration > 0 ? (time / duration) * 100 : 0
  for (let i = 0; i < cachedCursorEls.length; i++) {
    cachedCursorEls[i].style.left = pct + '%'
  }
}

// Small pre-roll before the first sound so the attack of the first note isn't
// clipped when playback starts exactly there.
export const AUDIO_START_PREROLL_SECS = 0.03

type PcmBuffer = Pick<AudioBuffer, 'sampleRate' | 'numberOfChannels' | 'getChannelData'>

/**
 * Where the music actually starts: the earliest sample across all stems that
 * rises above AUDIO_START_THRESHOLD (~-42 dBFS), minus a tiny pre-roll.
 * Scans at most AUDIO_START_MAX_SCAN_SECS; returns 0 if nothing is found (or
 * the song starts right away), so callers can treat 0 as "no skip".
 */
export function findMusicStart(
  buffers: PcmBuffer[],
  threshold = AUDIO_START_THRESHOLD,
  maxScanSecs = AUDIO_START_MAX_SCAN_SECS
): number {
  let earliest = Infinity
  for (const buf of buffers) {
    const limit = Math.floor(Math.min(maxScanSecs, earliest) * buf.sampleRate)
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const data = buf.getChannelData(ch)
      const end = Math.min(limit, data.length)
      for (let i = 0; i < end; i++) {
        if (Math.abs(data[i]) > threshold) {
          earliest = Math.min(earliest, i / buf.sampleRate)
          break
        }
      }
    }
  }
  if (!Number.isFinite(earliest)) return 0
  return Math.max(0, earliest - AUDIO_START_PREROLL_SECS)
}

export type SongCloudAction = 'upload' | 'download' | 'delete'

/**
 * Row actions for a library song by cloud sync state (cloud-library-sync).
 * `sync` is undefined while cloud sync is off: the plain local delete.
 * "delete" on a synced/cloud song opens the remove-vs-delete-everywhere dialog.
 */
export function songCloudActions(song: { sync?: 'local' | 'cloud' | 'synced' }): SongCloudAction[] {
  switch (song.sync) {
    case 'local':
      return ['upload', 'delete']
    case 'cloud':
      return ['download', 'delete']
    case 'synced':
    default:
      return ['delete']
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = bytes / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v >= 10 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`
}
