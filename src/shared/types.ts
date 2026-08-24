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

export interface SeparationJob {
  id: string
  songPath: string
  songName: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  progress: number
  stems?: string[]
  error?: string
}

export interface VelodyAPI {
  openFileDialog: () => Promise<string | null>
  startSeparation: (songPath: string) => Promise<{ jobId: string; songName: string }>
  cancelSeparation: (jobId: string) => Promise<boolean>
  listSeparationJobs: () => Promise<SeparationJob[]>

  onSeparationProgress: (callback: (e: SeparationProgressEvent) => void) => () => void
  onSeparationComplete: (callback: (e: SeparationCompleteEvent) => void) => () => void
  onSeparationFailed: (callback: (e: SeparationFailedEvent) => void) => () => void
  onSeparationCancelled: (callback: (e: SeparationCancelledEvent) => void) => () => void
  onSeparationJobsChanged: (callback: (jobs: SeparationJob[]) => void) => () => void

  listSongs: () => Promise<SongItem[]>
  deleteSong: (songName: string) => Promise<{ success: boolean; error?: string }>
  readAudioFile: (filePath: string) => Promise<Uint8Array>
  getAudioUrl: (filePath: string) => Promise<string>
  getSetupStatus: () => Promise<{ complete: boolean }>
  startSetup: () => Promise<{ success: boolean; error?: string }>
  getPythonPath: () => Promise<string>
  getFfmpegPath: () => Promise<string>
  saveFileDialog: (
    defaultName: string,
    filters?: { name: string; extensions: string[] }[]
  ) => Promise<string | null>
  openDirectoryDialog: () => Promise<string | null>
  exportMix: (
    filePaths: string[],
    outputPath: string,
    options?: { bpm?: number; trimStart?: number; trimEnd?: number }
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
  transposeStems: (stemPaths: string[], semitones: number) => Promise<string[]>
  onSetupProgress: (callback: (progress: SetupProgress) => void) => void
  saveMeta: (songDir: string, meta: Record<string, unknown>) => Promise<{ success: boolean }>
  loadMeta: (songDir: string) => Promise<Record<string, unknown> | null>
  detectBpm: (
    stemPath: string
  ) => Promise<{ bpm: number; firstBeatOffset: number; beatTimes: number[] } | null>
  openExternal: (url: string) => Promise<void>
  deleteFile: (filePath: string) => Promise<{ success: boolean; error?: string }>
  importFromUrl: (url: string) => Promise<{ jobId: string; songName: string }>
  onDownloadProgress: (callback: (e: DownloadProgressEvent) => void) => () => void
  onDownloadFailed: (callback: (e: DownloadFailedEvent) => void) => () => void
  checkYtDlp: () => Promise<{ available: boolean }>
  updateYtDlp: () => Promise<{ success: boolean; error?: string }>
}
