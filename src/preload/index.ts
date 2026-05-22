import { contextBridge, ipcRenderer } from 'electron'

const api = {
  openFileDialog: () => ipcRenderer.invoke('dialog:openFile'),
  startSeparation: (songPath: string) => ipcRenderer.invoke('separation:start', songPath),
  listSongs: () => ipcRenderer.invoke('songs:list'),
  analyzeSong: (songDir: string) => ipcRenderer.invoke('song:analyze', songDir),
  loadAnalysis: (songDir: string) => ipcRenderer.invoke('analysis:load', songDir),
  deleteSong: (songName: string) => ipcRenderer.invoke('song:delete', songName),
  readAudioFile: (filePath: string) => ipcRenderer.invoke('audio:readFile', filePath),
  getAudioUrl: (filePath: string) => ipcRenderer.invoke('audio:url', filePath),
  getSetupStatus: () => ipcRenderer.invoke('setup:status'),
  startSetup: () => ipcRenderer.invoke('setup:start'),
  getPythonPath: () => ipcRenderer.invoke('setup:pythonPath'),
  getFfmpegPath: () => ipcRenderer.invoke('setup:ffmpegPath'),
  onSetupProgress: (callback: (progress: unknown) => void) => {
    ipcRenderer.on('setup:progress', (_event, progress) => callback(progress))
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
