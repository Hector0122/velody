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

interface VelodyAPI {
  openFileDialog: () => Promise<string | null>
  startSeparation: (songPath: string) => Promise<string[]>
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
    format: string
  ) => Promise<ExportResult & { path?: string }>
  transposeStems: (stemPaths: string[], semitones: number) => Promise<string[]>
  onSetupProgress: (callback: (progress: SetupProgress) => void) => void
  saveMeta: (songDir: string, meta: Record<string, unknown>) => Promise<{ success: boolean }>
  loadMeta: (songDir: string) => Promise<Record<string, unknown> | null>
  detectKey: (songDir: string, stemPaths: string[]) => Promise<string | null>
  openInBrowser: (url: string) => void
}

interface Window {
  api: VelodyAPI
}
