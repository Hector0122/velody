export function stemNameFromPath(path: string): string {
  return (
    path
      .split(/[/\\]/)
      .pop()
      ?.replace(/\.[^.]+$/, '') || path
  )
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

export const extForFormat = (fmt: string): string => (fmt === 'mp3' ? '.mp3' : '.wav')

export const formatFilter = (fmt: string): { name: string; extensions: string[] } =>
  fmt === 'mp3'
    ? { name: 'MP3 Audio', extensions: ['mp3'] }
    : { name: 'WAV Audio', extensions: ['wav'] }

// Constants
export const BPM_MIN = 40
export const BPM_MAX = 280
export const PITCH_SHIFT_MIN = -12
export const PITCH_SHIFT_MAX = 12
export const DEFAULT_SAMPLE_RATE = 44100
export const AUDIO_START_THRESHOLD = 0.008
export const AUDIO_START_MAX_SCAN_SECS = 30
export const DRIFT_THRESHOLD = 0.05
export const DRIFT_CORRECTION_INTERVAL_MS = 500
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
