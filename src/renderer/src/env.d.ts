/// <reference types="vite/client" />

interface SongItem {
  name: string
  stems: string[]
}

interface SetupProgress {
  step: string
  progress: number
  status: 'working' | 'done' | 'error'
  message: string
}

interface ExportResult {
  success: boolean
  error?: string
}

interface SeparationProgressEvent {
  jobId: string
  percent: number
}

interface SeparationCompleteEvent {
  jobId: string
  stems: string[]
}

interface SeparationFailedEvent {
  jobId: string
  error: string
}

interface SeparationCancelledEvent {
  jobId: string
}

interface SeparationJob {
  id: string
  songPath: string
  songName: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  progress: number
  stems?: string[]
  error?: string
}

interface VelodyAPI {
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
    options?: { bpm?: number }
  ) => Promise<ExportResult>
  exportSingle: (filePath: string, outputPath: string) => Promise<ExportResult>
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
  detectKey: (songDir: string, stemPaths: string[]) => Promise<string | null>
  openInBrowser: (url: string) => void
  deleteFile: (filePath: string) => Promise<{ success: boolean; error?: string }>
}

interface Window {
  api: VelodyAPI
}
