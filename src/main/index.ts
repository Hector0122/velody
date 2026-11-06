import { app, BrowserWindow, ipcMain } from 'electron'
import { dirname, join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import {
  registerIpcHandlers,
  setSetupManager,
  setJobManager,
  requestLibraryAnalysis
} from './ipc/handlers'
import { SetupManager } from './setup'
import { JobManager } from './jobs/JobManager'
import { startAudioServer, stopAudioServer, audioUrl } from './audio-server'
import { initAutoUpdater } from './updater'
import { setupCloud } from './cloud/ipc'
import { openExternalUrl } from './paths'
import { updateMeta } from './songMeta'

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
      sandbox: false,
      // Keep audio scheduling timers (metronome, count-in) running at full
      // rate when the window is minimized or behind another app — Chromium
      // otherwise throttles them to ~1/s and the click drops out.
      backgroundThrottling: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    void openExternalUrl(details.url)
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

  ipcMain.handle('setup:status', async () => {
    return {
      complete: (await setupManager?.isSetupComplete()) ?? true
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

  registerIpcHandlers()
  setupCloud(() => mainWindow)
  initAutoUpdater()
  createWindow()

  // Pre-analyze songs (BPM, beat grid, downbeat) in the background so they
  // open instantly: shortly after launch, and after every new separation.
  setTimeout(requestLibraryAnalysis, 10_000)
  // Beat This! is optional (never blocks setup): install it in the background
  // if missing, then redo songs analyzed without it.
  // shortcut: while offline its model can't download, so those songs are
  // retried (and fall back again) once per launch — fine for a personal library.
  void setupManager
    .isSetupComplete()
    .then((ok) => ok && setupManager?.ensureOptionalPackages())
    .then((ready) => ready && requestLibraryAnalysis(true))
  jobManager.onJobCompleted((stems) => {
    // The stems may replace an older song of the same name: its cached
    // analysis (BPM, beat grid) no longer applies, so have it re-detected.
    const invalidate = stems[0]
      ? updateMeta(dirname(stems[0]), { _version: 0 }, { touch: false })
      : Promise.resolve()
    invalidate.catch((err) => console.error('[jobCompleted]', err)).finally(requestLibraryAnalysis)
  })

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
