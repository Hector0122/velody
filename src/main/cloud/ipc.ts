// Wires cloud sync into Electron: settings store (safeStorage), API clients,
// the sync engine, `songs:list` decoration and the `cloud:*` IPC channels.
// The token never crosses to the renderer.
import { app, ipcMain, safeStorage, type BrowserWindow } from 'electron'
import { join } from 'path'
import type {
  CloudActionResult,
  CloudSettingsInput,
  CloudSettingsView,
  CloudTestResult
} from '../../shared/cloud'
import { getStemsRootDir } from '../paths'
import { pruneDeletedSong, scanSongsLibrary, setLibraryLister } from '../ipc/handlers'
import { CloudClient } from './client'
import { CloudSettingsStore } from './settings'
import { CloudSync, type CloudStatus } from './sync'

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** Song names come from the renderer: plain folder names only. */
function validSongName(name: unknown): name is string {
  return (
    typeof name === 'string' &&
    name.length > 0 &&
    name !== '.' &&
    name !== '..' &&
    !/[/\\\0]/.test(name)
  )
}

export function setupCloud(getWindow: () => BrowserWindow | null): CloudSync {
  const store = new CloudSettingsStore(join(app.getPath('userData'), 'cloud.json'), safeStorage)

  const clientFor = async (quick: boolean): Promise<CloudClient | null> => {
    const cfg = await store.active()
    if (!cfg) return null
    return new CloudClient({
      baseUrl: cfg.url,
      token: cfg.token,
      ...(quick ? { timeoutMs: 2000, retries: 0 } : {})
    })
  }

  const sync = new CloudSync({
    root: getStemsRootDir,
    scanLocal: () => scanSongsLibrary(getStemsRootDir()),
    api: () => clientFor(false),
    quickApi: () => clientFor(true),
    onSongDeleted: pruneDeletedSong,
    emit: (e) => getWindow()?.webContents.send('cloud:progress', e)
  })

  setLibraryLister(() => sync.listLibrary())
  void sync.cleanupStaleDownloads()

  const badName = (): CloudActionResult => ({ success: false, error: 'Invalid song name' })

  ipcMain.handle('cloud:getSettings', (): Promise<CloudSettingsView> => store.view())

  ipcMain.handle(
    'cloud:saveSettings',
    async (
      _e,
      input: CloudSettingsInput
    ): Promise<{ success: boolean; error?: string; settings?: CloudSettingsView }> => {
      try {
        return { success: true, settings: await store.save(input) }
      } catch (err) {
        return { success: false, error: errorMessage(err) }
      }
    }
  )

  // Tests the given (possibly unsaved) URL/token, falling back to saved ones.
  ipcMain.handle(
    'cloud:test',
    async (_e, input?: { url?: string; token?: string }): Promise<CloudTestResult> => {
      try {
        const cfg = await store.resolve(input)
        if (!cfg) return { ok: false, error: 'Enter the Worker URL and token first' }
        await new CloudClient({ baseUrl: cfg.url, token: cfg.token, retries: 0 }).health()
        return { ok: true }
      } catch (err) {
        return { ok: false, error: errorMessage(err) }
      }
    }
  )

  ipcMain.handle('cloud:status', (): CloudStatus => sync.getStatus())

  ipcMain.handle('cloud:upload', (_e, name: unknown) =>
    validSongName(name) ? sync.upload(name) : badName()
  )
  ipcMain.handle('cloud:uploadAll', () => sync.uploadAll())
  ipcMain.handle('cloud:download', (_e, name: unknown) =>
    validSongName(name) ? sync.download(name) : badName()
  )
  ipcMain.handle('cloud:removeLocal', (_e, name: unknown) =>
    validSongName(name) ? sync.removeLocal(name) : badName()
  )
  ipcMain.handle('cloud:deleteEverywhere', (_e, name: unknown) =>
    validSongName(name) ? sync.deleteEverywhere(name) : badName()
  )
  ipcMain.handle('cloud:syncMetaOnOpen', (_e, name: unknown) =>
    validSongName(name) ? sync.syncMetaOnOpen(name) : 'skipped'
  )

  return sync
}
