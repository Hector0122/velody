// Cloud library sync engine (desktop side). The cloud is a synced copy of the
// local library, never the playback source: songs are downloaded whole before
// they open, and everything keeps working with the cloud off or unreachable.
// See openspec/changes/cloud-library-sync (design D5–D9).
import { createHash, randomUUID } from 'crypto'
import { createReadStream } from 'fs'
import { access, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'fs/promises'
import { join } from 'path'
import {
  CLOUD_FILE_NAME_RE,
  type CloudActionResult,
  type CloudFile,
  type CloudProgressEvent,
  type CloudSong
} from '../../shared/cloud'
import type { SongItem } from '../../shared/types'
import { SerialTaskQueue } from '../taskQueue'
import { metaUpdatedAt, readMeta, syncedMeta, updateMeta } from '../songMeta'
import type { CloudApi } from './client'

/** In-progress downloads live here (dot-prefixed: the library scan skips them). */
export const DOWNLOAD_DIR_PREFIX = '.velody_dl_'

const TRANSFER_CONCURRENCY = 3

export interface CloudSyncDeps {
  /** Stems library root. */
  root: () => string
  /** Local library scan (no cloud info). */
  scanLocal: () => Promise<SongItem[]>
  /** API client while cloud sync is enabled + configured, else null. */
  api: () => Promise<CloudApi | null>
  /** Same, but fail-fast (short timeout, no retries) — used right before a song opens. */
  quickApi: () => Promise<CloudApi | null>
  /** Remove a deleted song from setlists etc. */
  onSongDeleted: (songName: string) => Promise<void>
  emit: (e: CloudProgressEvent) => void
}

export interface CloudStatus {
  enabled: boolean
  offline: boolean
  error?: string
}

type HashCache = Record<string, { size: number; mtimeMs: number; sha256: string }>

// ── helpers ───────────────────────────────────────────────────────────────

export function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

export function hashFile(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    createReadStream(path)
      .on('data', (chunk) => h.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(h.digest('hex')))
  })
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function runPool<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) await fn(items[next++])
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** Audio files of a song folder that belong in the cloud (stems + saved recordings). */
export async function listSongFiles(dir: string): Promise<string[]> {
  return (await readdir(dir))
    .filter((n) => CLOUD_FILE_NAME_RE.test(n) && !n.startsWith('_tmp'))
    .sort()
}

/**
 * Name/size/SHA-256 of every file to sync. Hashes are cached in `.velody`
 * (`fileHashes`, keyed by size + mtime) so each file is hashed once.
 */
export async function buildManifest(dir: string): Promise<CloudFile[]> {
  const meta = await readMeta(dir)
  const cache: HashCache = (meta?.fileHashes as HashCache) ?? {}
  const nextCache: HashCache = {}
  let changed = false
  const files: CloudFile[] = []
  for (const name of await listSongFiles(dir)) {
    const st = await stat(join(dir, name))
    const hit = cache[name]
    let digest: string
    if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) {
      digest = hit.sha256
    } else {
      digest = await hashFile(join(dir, name))
      changed = true
    }
    nextCache[name] = { size: st.size, mtimeMs: st.mtimeMs, sha256: digest }
    files.push({ name, size: st.size, sha256: digest })
  }
  if (changed || Object.keys(cache).length !== files.length) {
    await updateMeta(dir, { fileHashes: nextCache }, { touch: false })
  }
  return files
}

/**
 * Merges the local scan with the cloud index, matching by cloudId (from
 * `.velody`), or by name for a local song without one (e.g. after a reinstall
 * or a lost `.velody`), so it isn't uploaded a second time.
 * `cloud === null` (offline): only local songs, state from their cloudId.
 */
export function mergeLibrary(
  local: { item: SongItem; cloudId?: string }[],
  cloud: CloudSong[] | null
): SongItem[] {
  if (!cloud) {
    return local.map(({ item, cloudId }) => ({
      ...item,
      sync: cloudId ? 'synced' : 'local',
      ...(cloudId ? { cloudId } : {})
    }))
  }
  const byId = new Map(cloud.map((s) => [s.id, s]))
  const byName = new Map(cloud.map((s) => [s.name, s]))
  const matched = new Set<string>()
  const out: SongItem[] = local.map(({ item, cloudId }) => {
    const id = cloudId ?? byName.get(item.name)?.id
    if (id && byId.has(id) && !matched.has(id)) {
      matched.add(id)
      return { ...item, sync: 'synced', cloudId: id }
    }
    return { ...item, sync: 'local', ...(cloudId ? { cloudId } : {}) }
  })
  const taken = new Set(out.map((s) => s.name))
  for (const s of cloud) {
    // shortcut: a cloud-only song whose name is taken by a different local song
    // is hidden (no rename), add a suffix if this ever happens in practice.
    if (matched.has(s.id) || taken.has(s.name)) continue
    out.push({
      name: s.name,
      stems: [],
      sync: 'cloud',
      cloudId: s.id,
      sizeBytes: s.files.reduce((a, f) => a + f.size, 0)
    })
  }
  out.sort((a, b) => b.name.localeCompare(a.name))
  return out
}

// ── engine ────────────────────────────────────────────────────────────────

type Result = CloudActionResult & { songName?: string }

export class CloudSync {
  private cloudSongs: CloudSong[] | null = null
  private status: CloudStatus = { enabled: false, offline: false }
  private lastList = new Map<string, SongItem>()
  // One transfer at a time; opening a cloud song (high) jumps ahead of an
  // "upload all" backlog (low).
  private queue = new SerialTaskQueue<Result>()

  constructor(private readonly deps: CloudSyncDeps) {}

  getStatus(): CloudStatus {
    return { ...this.status }
  }

  /** Removes download folders left behind by a crash/quit mid-download. */
  async cleanupStaleDownloads(): Promise<void> {
    const root = this.deps.root()
    let entries: string[] = []
    try {
      entries = await readdir(root)
    } catch {
      return
    }
    await Promise.all(
      entries
        .filter((e) => e.startsWith(DOWNLOAD_DIR_PREFIX))
        .map((e) => rm(join(root, e), { recursive: true, force: true }))
    )
  }

  /** The library list with sync states, or the plain local scan when cloud is off. */
  async listLibrary(): Promise<SongItem[]> {
    const local = await this.deps.scanLocal()
    const api = await this.deps.api()
    if (!api) {
      this.status = { enabled: false, offline: false }
      this.lastList = new Map(local.map((s) => [s.name, s]))
      return local
    }
    let cloud: CloudSong[] | null = null
    try {
      cloud = (await api.listSongs()).songs
      this.cloudSongs = cloud
      this.status = { enabled: true, offline: false }
    } catch (err) {
      this.status = { enabled: true, offline: true, error: errorMessage(err) }
    }
    const root = this.deps.root()
    const withIds = await Promise.all(
      local.map(async (item) => {
        const id = (await readMeta(join(root, item.name)))?.cloudId
        return { item, cloudId: typeof id === 'string' ? id : undefined }
      })
    )
    const merged = mergeLibrary(withIds, cloud)
    // Songs matched by name get their cloudId saved, so every later action
    // (open, remove, re-upload) uses the existing cloud copy.
    const unlinked = new Set(withIds.filter((w) => !w.cloudId).map((w) => w.item.name))
    await Promise.all(
      merged
        .filter((s) => s.sync === 'synced' && unlinked.has(s.name))
        .map((s) => updateMeta(join(root, s.name), { cloudId: s.cloudId }, { touch: false }))
    )
    this.lastList = new Map(merged.map((s) => [s.name, s]))
    return merged
  }

  private async requireApi(): Promise<CloudApi> {
    const api = await this.deps.api()
    if (!api) throw new Error('Cloud sync is not enabled')
    return api
  }

  private async find(songName: string): Promise<SongItem> {
    await this.listLibrary()
    const item = this.lastList.get(songName)
    if (!item) throw new Error(`Song not found: ${songName}`)
    return item
  }

  private run(key: string, priority: 'high' | 'low', task: () => Promise<Result>): Promise<Result> {
    return this.queue.run(key, task, priority).catch((err) => ({
      success: false,
      error: errorMessage(err)
    }))
  }

  // ── upload ──────────────────────────────────────────────────────────────

  upload(songName: string): Promise<Result> {
    return this.run(`upload:${songName}`, 'high', () => this.uploadNow(songName))
  }

  async uploadAll(): Promise<Result & { uploaded: number; failed: string[] }> {
    const songs = [...(await this.listLibrary())].filter((s) => s.sync === 'local').reverse()
    const results = await Promise.all(
      songs.map((s) => this.run(`upload:${s.name}`, 'low', () => this.uploadNow(s.name)))
    )
    const failed = songs.filter((_, i) => !results[i].success).map((s) => s.name)
    return {
      success: failed.length === 0,
      uploaded: songs.length - failed.length,
      failed,
      ...(failed.length ? { error: `${failed.length} song(s) failed to upload` } : {})
    }
  }

  private async uploadNow(songName: string): Promise<Result> {
    const emit = (status: CloudProgressEvent['status'], percent: number, error?: string): void =>
      this.deps.emit({ kind: 'upload', songName, percent, status, error })
    emit('running', 0)
    try {
      const api = await this.requireApi()
      const item = this.lastList.get(songName) ?? (await this.find(songName))
      if (item.sync === 'cloud') throw new Error('Song is not on this laptop')
      await this.uploadSong(api, songName, item.cloudId, (p) => emit('running', p))
      emit('done', 100)
      return { success: true, songName }
    } catch (err) {
      emit('failed', 0, errorMessage(err))
      return { success: false, songName, error: errorMessage(err) }
    }
  }

  /** begin → PUT changed files → commit → sync metadata. Never touches local files. */
  private async uploadSong(
    api: CloudApi,
    songName: string,
    knownId: string | undefined,
    onProgress: (percent: number) => void
  ): Promise<string> {
    const dir = join(this.deps.root(), songName)
    const meta = await readMeta(dir)
    const id =
      (typeof meta?.cloudId === 'string' ? meta.cloudId : undefined) ?? knownId ?? randomUUID()
    const files = await buildManifest(dir)
    if (files.length === 0) throw new Error('No audio files to upload')

    const begin = await api.beginUpload(id, { name: songName, files })
    // Persist the id right away so an interrupted upload resumes on the same one.
    if (meta?.cloudId !== id) await updateMeta(dir, { cloudId: id }, { touch: false })

    const sizes = new Map(files.map((f) => [f.name, f.size]))
    const total = begin.uploads.reduce((a, u) => a + (sizes.get(u.name) ?? 0), 0)
    let done = 0
    await runPool(begin.uploads, TRANSFER_CONCURRENCY, async (u) => {
      await api.putFile(u.url, await readFile(join(dir, u.name)))
      done += sizes.get(u.name) ?? 0
      onProgress(total ? Math.round((done / total) * 95) : 95)
    })
    await api.commit(id)
    await this.syncMeta(api, id, dir)
    if (this.cloudSongs && !this.cloudSongs.some((s) => s.id === id)) {
      this.cloudSongs.push({
        id,
        name: songName,
        files,
        metaUpdatedAt: null,
        updatedAt: Date.now()
      })
    }
    return id
  }

  // ── metadata ────────────────────────────────────────────────────────────

  /**
   * Last-write-wins on `updatedAt`: pushes local metadata when it's newer,
   * pulls (replacing synced keys) when the cloud's is newer.
   */
  private async syncMeta(
    api: CloudApi,
    id: string,
    dir: string
  ): Promise<'pushed' | 'pulled' | 'same'> {
    let local = await readMeta(dir)
    if (metaUpdatedAt(local) === 0) {
      // Legacy sidecar without a timestamp: stamp it so it can be compared.
      await updateMeta(dir, {})
      local = await readMeta(dir)
    }
    const localAt = metaUpdatedAt(local)
    const remote = await api.getMeta(id)
    const remoteAt = remote?.updatedAt ?? 0
    if (remote && remoteAt > localAt) {
      await updateMeta(
        dir,
        { ...remote.meta, updatedAt: remoteAt },
        { touch: false, replace: true }
      )
      return 'pulled'
    }
    if (localAt > remoteAt) {
      const r = await api.putMeta(id, { meta: syncedMeta(local), updatedAt: localAt })
      if (!r.ok && r.current) {
        await updateMeta(
          dir,
          { ...r.current.meta, updatedAt: r.current.updatedAt },
          { touch: false, replace: true }
        )
        return 'pulled'
      }
      if (!r.ok) throw new Error('Could not save metadata to the cloud')
      return 'pushed'
    }
    return 'same'
  }

  /**
   * Right before a synced song opens: bring its metadata up to date in either
   * direction. Fail-fast and never throws — offline just opens the local copy.
   */
  async syncMetaOnOpen(songName: string): Promise<'pushed' | 'pulled' | 'same' | 'skipped'> {
    try {
      const api = await this.deps.quickApi()
      if (!api || this.status.offline) return 'skipped'
      const dir = join(this.deps.root(), songName)
      const meta = await readMeta(dir)
      const id = typeof meta?.cloudId === 'string' ? meta.cloudId : undefined
      if (!id || this.lastList.get(songName)?.sync !== 'synced') return 'skipped'
      return await this.syncMeta(api, id, dir)
    } catch {
      return 'skipped'
    }
  }

  // ── download ────────────────────────────────────────────────────────────

  download(songName: string): Promise<Result> {
    return this.run(`download:${songName}`, 'high', () => this.downloadNow(songName))
  }

  /**
   * Downloads into a hidden temp folder, verifies every file's size and hash,
   * then renames it into the library in one step — a failure never leaves a
   * partial song behind.
   */
  private async downloadNow(songName: string): Promise<Result> {
    const emit = (status: CloudProgressEvent['status'], percent: number, error?: string): void =>
      this.deps.emit({ kind: 'download', songName, percent, status, error })
    emit('running', 0)
    const root = this.deps.root()
    let tmp: string | null = null
    try {
      const api = await this.requireApi()
      const item = this.lastList.get(songName) ?? (await this.find(songName))
      if (item.sync !== 'cloud' || !item.cloudId) throw new Error('Song is already on this laptop')
      const id = item.cloudId

      const { files } = await api.download(id)
      tmp = join(root, `${DOWNLOAD_DIR_PREFIX}${id}`)
      await rm(tmp, { recursive: true, force: true })
      await mkdir(tmp, { recursive: true })

      const total = files.reduce((a, f) => a + f.size, 0)
      let done = 0
      const hashes: HashCache = {}
      await runPool(files, TRANSFER_CONCURRENCY, async (f) => {
        if (!CLOUD_FILE_NAME_RE.test(f.name)) throw new Error(`Unexpected file name: ${f.name}`)
        const data = await api.getFile(f.url)
        if (data.length !== f.size || sha256(data) !== f.sha256) {
          throw new Error(`Downloaded file is corrupted: ${f.name}`)
        }
        const dest = join(tmp!, f.name)
        await writeFile(dest, data)
        const st = await stat(dest)
        hashes[f.name] = { size: f.size, mtimeMs: st.mtimeMs, sha256: f.sha256 }
        done += f.size
        emit('running', total ? Math.round((done / total) * 95) : 95)
      })

      const remote = await api.getMeta(id)
      const meta = {
        ...(remote ? { ...remote.meta, updatedAt: remote.updatedAt } : {}),
        cloudId: id,
        fileHashes: hashes
      }
      await writeFile(join(tmp, '.velody'), JSON.stringify(meta), 'utf-8')

      const dest = join(root, songName)
      if (await exists(dest)) throw new Error(`A folder named "${songName}" already exists`)
      await rename(tmp, dest)
      tmp = null
      emit('done', 100)
      return { success: true, songName }
    } catch (err) {
      emit('failed', 0, errorMessage(err))
      return { success: false, songName, error: errorMessage(err) }
    } finally {
      if (tmp) await rm(tmp, { recursive: true, force: true }).catch(() => {})
    }
  }

  // ── removal ─────────────────────────────────────────────────────────────

  /**
   * Frees disk space: re-syncs the song first (files + metadata), so nothing
   * exists only on this laptop, then deletes the local folder. Setlists keep
   * the song — it's still in the library, just cloud-only.
   */
  removeLocal(songName: string): Promise<Result> {
    return this.run(`remove:${songName}`, 'high', async () => {
      const api = await this.requireApi()
      const item = await this.find(songName)
      if (item.sync !== 'synced') throw new Error('Only songs already in the cloud can be removed')
      try {
        await this.uploadSong(api, songName, item.cloudId, () => {})
      } catch (err) {
        throw new Error(`Could not sync before removing, nothing was deleted: ${errorMessage(err)}`)
      }
      await rm(join(this.deps.root(), songName), { recursive: true, force: true })
      return { success: true, songName }
    })
  }

  /** Deletes from the cloud first; the local copy only goes once that succeeded. */
  deleteEverywhere(songName: string): Promise<Result> {
    return this.run(`delete:${songName}`, 'high', async () => {
      const api = await this.requireApi()
      const item = await this.find(songName)
      if (item.cloudId && item.sync !== 'local') {
        try {
          await api.deleteSong(item.cloudId)
        } catch (err) {
          throw new Error(`Could not delete from the cloud: ${errorMessage(err)}`)
        }
        this.cloudSongs = this.cloudSongs?.filter((s) => s.id !== item.cloudId) ?? null
      }
      if (item.sync !== 'cloud') {
        await rm(join(this.deps.root(), songName), { recursive: true, force: true })
      }
      await this.deps.onSongDeleted(songName)
      return { success: true, songName }
    })
  }
}
