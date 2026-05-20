export interface VelodyAPI {
  openFileDialog: () => Promise<string | null>
  startSeparation: (songPath: string) => Promise<string[]>
  onSeparationProgress: (callback: (progress: number) => void) => void
  onSeparationComplete: (callback: (stems: string[]) => void) => void
  onSeparationError: (callback: (error: string) => void) => void
}

declare global {
  interface Window {
    api: VelodyAPI
  }
}
