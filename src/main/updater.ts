import { app, BrowserWindow, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateStatus } from '../shared/types'

// Auto-update from GitHub Releases (see electron-builder.yml `publish` and
// .github/workflows/release.yml). On launch, the installed app checks the
// latest release; if it's newer it downloads in the background and the
// renderer offers "Restart to update". If the user ignores it, the update is
// installed on the next quit anyway.
//
// Only runs in a packaged build (AppImage / .deb / Windows installer) — in
// `pnpm dev` there's nothing to update; use `git pull`. A .deb update asks for
// the admin password (it installs a system package); AppImage doesn't.
//
// This is the app's only outbound request besides URL import, and it isn't
// part of separation/playback: when offline the check just fails silently.

let status: UpdateStatus = { state: 'idle' }

function setStatus(next: UpdateStatus): void {
  status = next
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('update:status', status)
  }
}

export function initAutoUpdater(): void {
  ipcMain.handle('update:getStatus', () => status)
  ipcMain.handle('update:install', () => {
    if (status.state === 'ready') autoUpdater.quitAndInstall()
  })

  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    setStatus({ state: 'downloading', version: info.version, percent: 0 })
  })
  autoUpdater.on('download-progress', (progress) => {
    if (status.state === 'downloading') {
      setStatus({ ...status, percent: Math.round(progress.percent) })
    }
  })
  autoUpdater.on('update-downloaded', (info) => {
    setStatus({ state: 'ready', version: info.version })
  })
  autoUpdater.on('error', (err) => {
    // Offline, rate-limited, etc. — not worth bothering the user about.
    console.error('[updater]', err?.message ?? err)
    if (status.state === 'downloading') setStatus({ state: 'idle' })
  })

  autoUpdater.checkForUpdates().catch(() => {})
}
