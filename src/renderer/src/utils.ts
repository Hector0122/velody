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

export function updateTimeDisplays(time: number): void {
  const timeStr = formatTime(time)
  const els = document.querySelectorAll('[data-live-time]')
  for (let i = 0; i < els.length; i++) {
    els[i].textContent = timeStr
  }
}

export function updateCursors(time: number, duration: number): void {
  const pct = duration > 0 ? (time / duration) * 100 : 0
  const els = document.querySelectorAll<HTMLElement>('[data-stem-cursor]')
  for (let i = 0; i < els.length; i++) {
    els[i].style.left = pct + '%'
  }
}
