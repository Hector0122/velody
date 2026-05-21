import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerIpcHandlers, setSetupManager } from './ipc/handlers'
import { SetupManager } from './setup'
import { registerAudioProtocol } from './protocol'
import icon from '../../resources/icon.png?asset'

let mainWindow: BrowserWindow | null = null
let setupManager: SetupManager | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  registerAudioProtocol()
  electronApp.setAppUserModelId('com.velody')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  setupManager = new SetupManager(true)
  setSetupManager(setupManager)

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

  ipcMain.handle('audio:readFile', async (_event, filePath: string) => {
    const { readFile } = await import('fs/promises')
    const buffer = await readFile(filePath)
    return buffer
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

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
