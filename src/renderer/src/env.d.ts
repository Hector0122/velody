/// <reference types="vite/client" />

interface VelodyAPI {
  openFileDialog: () => Promise<string | null>
  startSeparation: (songPath: string) => Promise<string[]>
  onSeparationProgress: (callback: (progress: number) => void) => void
  onSeparationComplete: (callback: (stems: string[]) => void) => void
  onSeparationError: (callback: (error: string) => void) => void
}

interface Window {
  api: VelodyAPI
}
