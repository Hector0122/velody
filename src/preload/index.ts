import { contextBridge, ipcRenderer } from 'electron'

const api = {
  openFileDialog: () => ipcRenderer.invoke('dialog:openFile'),
  startSeparation: (songPath: string) => ipcRenderer.invoke('separation:start', songPath),
  onSeparationProgress: (callback: (progress: number) => void) => {
    ipcRenderer.on('separation:progress', (_event, progress: number) => callback(progress))
  },
  onSeparationComplete: (callback: (stems: string[]) => void) => {
    ipcRenderer.on('separation:complete', (_event, stems: string[]) => callback(stems))
  },
  onSeparationError: (callback: (error: string) => void) => {
    ipcRenderer.on('separation:error', (_event, error: string) => callback(error))
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  ;(window as unknown as Record<string, unknown>).api = api
}
