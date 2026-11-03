export interface SetupProgress {
  step: string
  progress: number
  status: 'working' | 'done' | 'error'
  message: string
}

export interface SongItem {
  name: string
  stems: string[]
}

// Named, ordered references to library songs by name — never a copy of
// song data. See openspec/changes/add-song-setlists.
export interface Setlist {
  id: string
  name: string
  songNames: string[]
  updatedAt: number
}

export interface ExportResult {
  success: boolean
  error?: string
}

export interface SeparationProgressEvent {
  jobId: string
  percent: number
}

export interface SeparationCompleteEvent {
  jobId: string
  stems: string[]
}

export interface SeparationFailedEvent {
  jobId: string
  error: string
}

export interface SeparationCancelledEvent {
  jobId: string
}

export interface DownloadProgressEvent {
  jobId: string
  percent: number
  title?: string
}

export interface DownloadFailedEvent {
  jobId: string
  error: string
}

/** MP3 bitrate (kbps) Demucs encodes stems with — chosen per song at import time. */
export type StemBitrate = 128 | 192 | 320

export interface SeparationJob {
  id: string
  songPath: string
  songName: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  progress: number
  stems?: string[]
  error?: string
}

/** Auto-update state (packaged builds only — see src/main/updater.ts). */
export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'ready'; version: string }

export interface VelodyAPI {
  openFileDialog: () => Promise<string | null>
  startSeparation: (
    songPath: string,
    bitrate?: StemBitrate
  ) => Promise<{ jobId: string; songName: string }>
  cancelSeparation: (jobId: string) => Promise<boolean>
  listSeparationJobs: () => Promise<SeparationJob[]>

  onSeparationProgress: (callback: (e: SeparationProgressEvent) => void) => () => void
  onSeparationComplete: (callback: (e: SeparationCompleteEvent) => void) => () => void
  onSeparationFailed: (callback: (e: SeparationFailedEvent) => void) => () => void
  onSeparationCancelled: (callback: (e: SeparationCancelledEvent) => void) => () => void
  onSeparationJobsChanged: (callback: (jobs: SeparationJob[]) => void) => () => void

  listSongs: () => Promise<SongItem[]>
  deleteSong: (songName: string) => Promise<{ success: boolean; error?: string }>
  listSetlists: () => Promise<Setlist[]>
  saveSetlist: (setlist: Setlist) => Promise<Setlist>
  deleteSetlist: (id: string) => Promise<{ success: boolean }>
  getAudioUrl: (filePath: string) => Promise<string>
  getSetupStatus: () => Promise<{ complete: boolean }>
  startSetup: () => Promise<{ success: boolean; error?: string }>
  saveFileDialog: (
    defaultName: string,
    filters?: { name: string; extensions: string[] }[]
  ) => Promise<string | null>
  exportMix: (
    filePaths: string[],
    outputPath: string,
    options?: {
      bpm?: number
      trimStart?: number
      trimEnd?: number
      clickPreset?: 'woodblock'
    }
  ) => Promise<ExportResult>
  exportSingle: (
    filePath: string,
    outputPath: string,
    options?: { trimStart?: number; trimEnd?: number }
  ) => Promise<ExportResult>
  saveRecording: (
    songDir: string,
    data: number[],
    name: string,
    format: string,
    offset: number
  ) => Promise<ExportResult & { path?: string }>
  onSetupProgress: (callback: (progress: SetupProgress) => void) => void
  saveMeta: (songDir: string, meta: Record<string, unknown>) => Promise<{ success: boolean }>
  loadMeta: (songDir: string) => Promise<Record<string, unknown> | null>
  detectBpm: (
    stemPath: string,
    // Re-runs beat tracking at a caller-supplied tempo instead of
    // TempoCNN's own estimate — used to correct a tempo-octave detection
    // error while keeping the beat grid onset-aligned to the real audio.
    // See add-tempo-octave-correction.
    bpmHint?: number
  ) => Promise<{ bpm: number; firstBeatOffset: number; beatTimes: number[] } | null>
  openExternal: (url: string) => Promise<void>
  deleteFile: (filePath: string) => Promise<{ success: boolean; error?: string }>
  importFromUrl: (
    url: string,
    bitrate?: StemBitrate
  ) => Promise<{ jobId: string; songName: string }>
  onDownloadProgress: (callback: (e: DownloadProgressEvent) => void) => () => void
  onDownloadFailed: (callback: (e: DownloadFailedEvent) => void) => () => void
  updateYtDlp: () => Promise<{ success: boolean; error?: string }>
  getUpdateStatus: () => Promise<UpdateStatus>
  onUpdateStatus: (callback: (s: UpdateStatus) => void) => () => void
  installUpdate: () => Promise<void>
}
