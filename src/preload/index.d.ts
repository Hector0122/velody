export interface SetupProgress {
  step: string
  progress: number
  status: 'working' | 'done' | 'error'
  message: string
}

export interface VelodyAPI {
  openFileDialog: () => Promise<string | null>
  startSeparation: (songPath: string) => Promise<string[]>
  readAudioFile: (filePath: string) => Promise<Uint8Array>
  getAudioUrl: (filePath: string) => Promise<string>
  getSetupStatus: () => Promise<{ complete: boolean }>
  startSetup: () => Promise<{ success: boolean; error?: string }>
  getPythonPath: () => Promise<string>
  getFfmpegPath: () => Promise<string>
  onSetupProgress: (callback: (progress: SetupProgress) => void) => void
}

declare global {
  interface Window {
    api: VelodyAPI
  }
}
