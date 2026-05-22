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

export interface AnalysisChord {
  start: number
  end: number
  chord: string
}

export interface BassTabNote {
  time: number
  midi: number
  string: number
  fret: number
}

export interface AnalysisData {
  key_root: number
  key_mode: 'major' | 'minor'
  key_name: string
  bass_tab: BassTabNote[]
  chords: AnalysisChord[]
}

export interface VelodyAPI {
  openFileDialog: () => Promise<string | null>
  startSeparation: (songPath: string) => Promise<string[]>
  listSongs: () => Promise<SongItem[]>
  analyzeSong: (songDir: string) => Promise<AnalysisData | { error: string }>
  loadAnalysis: (songDir: string) => Promise<AnalysisData | null>
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
