import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerIpcHandlers, setSetupManager, setJobManager } from './ipc/handlers'
import { SetupManager } from './setup'
import { JobManager } from './jobs/JobManager'
import { startAudioServer, stopAudioServer, audioUrl } from './audio-server'
import { exec } from 'child_process'

let mainWindow: BrowserWindow | null = null
let setupManager: SetupManager | null = null
let jobManager: JobManager | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    exec(`sensible-browser "${details.url}"`, (err) => {
      if (err) shell.openExternal(details.url)
    })
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.velody')

  await startAudioServer()

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  setupManager = new SetupManager(false)
  setSetupManager(setupManager)

  jobManager = new JobManager(setupManager)
  setJobManager(jobManager)

  ipcMain.handle('setup:status', () => {
    return {
      complete: setupManager?.isSetupComplete() ?? true
    }
  })

  ipcMain.handle('setup:start', async () => {
    if (!setupManager || !mainWindow) return { success: false, error: 'Not ready' }
    setupManager.setProgressCallback((progress) => {
      mainWindow?.webContents.send('setup:progress', progress)
    })
    try {
      await setupManager.run()
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Setup failed' }
    }
  })

  ipcMain.handle('audio:url', (_event, filePath: string) => {
    return audioUrl(filePath)
  })

  ipcMain.handle('setup:pythonPath', () => {
    return setupManager?.getPythonPath() ?? 'python3'
  })

  ipcMain.handle('setup:ffmpegPath', () => {
    return setupManager?.getFfmpegPath() ?? 'ffmpeg'
  })

  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  jobManager?.cleanup()
  stopAudioServer()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    stopAudioServer()
    app.quit()
  }
})
