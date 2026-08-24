import { contextBridge, ipcRenderer } from 'electron'

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

export interface Setlist {
  id: string
  name: string
  songNames: string[]
  updatedAt: number
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

export interface DownloadProgressEvent {
  jobId: string
  percent: number
  title?: string
}

export interface DownloadFailedEvent {
  jobId: string
  error: string
}

const api = {
  openFileDialog: () => ipcRenderer.invoke('dialog:openFile'),
  startSeparation: (songPath: string) =>
    ipcRenderer.invoke('separation:start', songPath) as Promise<{
      jobId: string
      songName: string
    }>,
  cancelSeparation: (jobId: string) =>
    ipcRenderer.invoke('separation:cancel', jobId) as Promise<boolean>,
  listSeparationJobs: () => ipcRenderer.invoke('separation:list') as Promise<SeparationJob[]>,

  onSeparationProgress: (callback: (e: SeparationProgressEvent) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, e: SeparationProgressEvent): void => {
      callback(e)
    }
    ipcRenderer.on('separation:progress', handler)
    return (): void => {
      ipcRenderer.removeListener('separation:progress', handler)
    }
  },
  onSeparationComplete: (callback: (e: SeparationCompleteEvent) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, e: SeparationCompleteEvent): void => {
      callback(e)
    }
    ipcRenderer.on('separation:complete', handler)
    return (): void => {
      ipcRenderer.removeListener('separation:complete', handler)
    }
  },
  onSeparationFailed: (callback: (e: SeparationFailedEvent) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, e: SeparationFailedEvent): void => {
      callback(e)
    }
    ipcRenderer.on('separation:failed', handler)
    return (): void => {
      ipcRenderer.removeListener('separation:failed', handler)
    }
  },
  onSeparationCancelled: (callback: (e: SeparationCancelledEvent) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, e: SeparationCancelledEvent): void => {
      callback(e)
    }
    ipcRenderer.on('separation:cancelled', handler)
    return (): void => {
      ipcRenderer.removeListener('separation:cancelled', handler)
    }
  },
  onSeparationJobsChanged: (callback: (jobs: SeparationJob[]) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, jobs: SeparationJob[]): void => {
      callback(jobs)
    }
    ipcRenderer.on('separation:jobs-changed', handler)
    return (): void => {
      ipcRenderer.removeListener('separation:jobs-changed', handler)
    }
  },

  listSongs: () => ipcRenderer.invoke('songs:list'),
  deleteSong: (songName: string) => ipcRenderer.invoke('song:delete', songName),
  listSetlists: () => ipcRenderer.invoke('setlists:list'),
  saveSetlist: (setlist: Setlist) => ipcRenderer.invoke('setlists:save', setlist),
  deleteSetlist: (id: string) => ipcRenderer.invoke('setlists:delete', id),
  readAudioFile: (filePath: string) => ipcRenderer.invoke('audio:readFile', filePath),
  getAudioUrl: (filePath: string) => ipcRenderer.invoke('audio:url', filePath),
  getSetupStatus: () => ipcRenderer.invoke('setup:status'),
  startSetup: () => ipcRenderer.invoke('setup:start'),
  getPythonPath: () => ipcRenderer.invoke('setup:pythonPath'),
  getFfmpegPath: () => ipcRenderer.invoke('setup:ffmpegPath'),
  openDirectoryDialog: () => ipcRenderer.invoke('dialog:openDirectory'),
  saveFileDialog: (defaultName: string, filters?: { name: string; extensions: string[] }[]) =>
    ipcRenderer.invoke('dialog:saveFile', defaultName, filters ?? []),
  exportMix: (
    filePaths: string[],
    outputPath: string,
    options?: {
      bpm?: number
      trimStart?: number
      trimEnd?: number
      clickPreset?: 'woodblock'
    }
  ) => ipcRenderer.invoke('export:mix', filePaths, outputPath, options),
  exportSingle: (
    filePath: string,
    outputPath: string,
    options?: { trimStart?: number; trimEnd?: number }
  ) => ipcRenderer.invoke('export:single', filePath, outputPath, options),
  saveRecording: (songDir: string, data: number[], name: string, format: string, offset: number) =>
    ipcRenderer.invoke('record:save', songDir, data, name, format, offset),
  transposeStems: (stemPaths: string[], semitones: number) =>
    ipcRenderer.invoke('stems:transpose', stemPaths, semitones),
  onSetupProgress: (callback: (progress: unknown) => void) => {
    ipcRenderer.on('setup:progress', (_event, progress) => callback(progress))
  },
  saveMeta: (songDir: string, meta: Record<string, unknown>) =>
    ipcRenderer.invoke('song:saveMeta', songDir, meta),
  loadMeta: (songDir: string) => ipcRenderer.invoke('song:loadMeta', songDir),
  detectBpm: (stemPath: string) =>
    ipcRenderer.invoke('song:detectBpm', stemPath) as Promise<{
      bpm: number
      firstBeatOffset: number
      beatTimes: number[]
    } | null>,
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  deleteFile: (filePath: string) => ipcRenderer.invoke('file:delete', filePath),
  importFromUrl: (url: string) =>
    ipcRenderer.invoke('url:import', url) as Promise<{
      jobId: string
      songName: string
    }>,
  onDownloadProgress: (callback: (e: DownloadProgressEvent) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, e: DownloadProgressEvent): void => {
      callback(e)
    }
    ipcRenderer.on('url:download-progress', handler)
    return (): void => {
      ipcRenderer.removeListener('url:download-progress', handler)
    }
  },
  onDownloadFailed: (callback: (e: DownloadFailedEvent) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, e: DownloadFailedEvent): void => {
      callback(e)
    }
    ipcRenderer.on('url:download-failed', handler)
    return (): void => {
      ipcRenderer.removeListener('url:download-failed', handler)
    }
  },
  checkYtDlp: () => ipcRenderer.invoke('url:checkYtDlp') as Promise<{ available: boolean }>,
  updateYtDlp: () =>
    ipcRenderer.invoke('url:updateYtDlp') as Promise<{ success: boolean; error?: string }>
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
