import { contextBridge, ipcRenderer } from 'electron'

const api = {
  openFileDialog: () => ipcRenderer.invoke('dialog:openFile'),
  startSeparation: (songPath: string) => ipcRenderer.invoke('separation:start', songPath),
  listSongs: () => ipcRenderer.invoke('songs:list'),
  deleteSong: (songName: string) => ipcRenderer.invoke('song:delete', songName),
  readAudioFile: (filePath: string) => ipcRenderer.invoke('audio:readFile', filePath),
  getAudioUrl: (filePath: string) => ipcRenderer.invoke('audio:url', filePath),
  getSetupStatus: () => ipcRenderer.invoke('setup:status'),
  startSetup: () => ipcRenderer.invoke('setup:start'),
  getPythonPath: () => ipcRenderer.invoke('setup:pythonPath'),
  getFfmpegPath: () => ipcRenderer.invoke('setup:ffmpegPath'),
  openDirectoryDialog: () => ipcRenderer.invoke('dialog:openDirectory'),
  saveFileDialog: (defaultName: string, filters?: { name: string; extensions: string[] }[]) =>
    ipcRenderer.invoke('dialog:saveFile', defaultName, filters ?? []),
  exportMix: (filePaths: string[], outputPath: string, options?: { bpm?: number }) =>
    ipcRenderer.invoke('export:mix', filePaths, outputPath, options),
  exportSingle: (filePath: string, outputPath: string) =>
    ipcRenderer.invoke('export:single', filePath, outputPath),
  saveRecording: (songDir: string, data: number[], name: string, format: string) =>
    ipcRenderer.invoke('record:save', songDir, data, name, format),
  transposeStems: (stemPaths: string[], semitones: number) =>
    ipcRenderer.invoke('stems:transpose', stemPaths, semitones),
  onSetupProgress: (callback: (progress: unknown) => void) => {
    ipcRenderer.on('setup:progress', (_event, progress) => callback(progress))
  },
  saveMeta: (songDir: string, meta: Record<string, unknown>) =>
    ipcRenderer.invoke('song:saveMeta', songDir, meta),
  loadMeta: (songDir: string) => ipcRenderer.invoke('song:loadMeta', songDir),
  detectKey: (songDir: string, stemPaths: string[]) =>
    ipcRenderer.invoke('song:detectKey', songDir, stemPaths)
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
