import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type {
  CloudFile,
  CloudProgressEvent,
  CloudSong,
  MetaResponse,
  UploadBeginRequest,
  UploadBeginResponse,
  CommitResponse,
  DownloadResponse
} from '../../../shared/cloud'
import type { SongItem } from '../../../shared/types'
import type { CloudApi, PutMetaResult } from '../client'
import { CloudSync, DOWNLOAD_DIR_PREFIX, buildManifest, mergeLibrary, sha256 } from '../sync'

// ── In-memory stand-in for the Worker + R2 ────────────────────────────────

class FakeCloud implements CloudApi {
  objects = new Map<string, Buffer>() // `${id}/${name}`
  songs = new Map<string, { name: string; files: CloudFile[]; complete: boolean }>()
  meta = new Map<string, MetaResponse>()
  putCount = 0
  failPutsAfter = Infinity
  corruptDownloads = false
  deleteFails = false
  calls: string[] = []

  async health(): Promise<void> {
    this.calls.push('health')
  }
  async listSongs(): Promise<{ songs: CloudSong[] }> {
    return {
      songs: [...this.songs]
        .filter(([, s]) => s.complete)
        .map(([id, s]) => ({
          id,
          name: s.name,
          files: s.files,
          metaUpdatedAt: this.meta.get(id)?.updatedAt ?? null,
          updatedAt: 1
        }))
    }
  }
  async beginUpload(id: string, req: UploadBeginRequest): Promise<UploadBeginResponse> {
    this.calls.push(`begin:${id}`)
    const prev = this.songs.get(id)
    const uploads = req.files
      .filter((f) => {
        const old = prev?.files.find((p) => p.name === f.name)
        return !(old && old.sha256 === f.sha256 && this.objects.has(`${id}/${f.name}`))
      })
      .map((f) => ({ name: f.name, url: `put://${id}/${f.name}` }))
    this.songs.set(id, { name: req.name, files: req.files, complete: prev?.complete ?? false })
    return { uploads, expiresAt: 0 }
  }
  async commit(id: string): Promise<CommitResponse> {
    const s = this.songs.get(id)!
    const missing = s.files.filter((f) => !this.objects.has(`${id}/${f.name}`))
    if (missing.length) throw new Error('missing')
    s.complete = true
    return { song: { id, name: s.name, files: s.files, metaUpdatedAt: null, updatedAt: 1 } }
  }
  async download(id: string): Promise<DownloadResponse> {
    const s = this.songs.get(id)!
    return { files: s.files.map((f) => ({ ...f, url: `get://${id}/${f.name}` })), expiresAt: 0 }
  }
  async getMeta(id: string): Promise<MetaResponse | null> {
    return this.meta.get(id) ?? null
  }
  async putMeta(
    id: string,
    req: { meta: Record<string, unknown>; updatedAt: number }
  ): Promise<PutMetaResult> {
    const cur = this.meta.get(id)
    if (cur && cur.updatedAt >= req.updatedAt) return { ok: false, current: cur } as PutMetaResult
    this.meta.set(id, { meta: req.meta, updatedAt: req.updatedAt })
    return { ok: true, updatedAt: req.updatedAt } as PutMetaResult
  }
  async deleteSong(id: string): Promise<void> {
    if (this.deleteFails) throw new Error('cloud down')
    this.songs.delete(id)
    this.meta.delete(id)
    for (const k of [...this.objects.keys()]) if (k.startsWith(`${id}/`)) this.objects.delete(k)
  }
  async putFile(url: string, data: Buffer): Promise<void> {
    if (this.putCount >= this.failPutsAfter) throw new Error('network down')
    this.putCount++
    this.objects.set(url.slice('put://'.length), data)
  }
  async getFile(url: string): Promise<Buffer> {
    const data = this.objects.get(url.slice('get://'.length))!
    return this.corruptDownloads ? Buffer.concat([data.subarray(1), Buffer.from('X')]) : data
  }
}

// ── Harness ───────────────────────────────────────────────────────────────

let root: string
let cloud: FakeCloud
let enabled: boolean
let events: CloudProgressEvent[]
let deleted: string[]
let sync: CloudSync

async function scanLocal(): Promise<SongItem[]> {
  const out: SongItem[] = []
  for (const e of await readdir(root)) {
    if (e.startsWith('.')) continue
    const files = (await readdir(join(root, e))).filter((f) => f.endsWith('.mp3'))
    if (files.length) out.push({ name: e, stems: files.map((f) => join(root, e, f)) })
  }
  return out.sort((a, b) => b.name.localeCompare(a.name))
}

async function makeSong(name: string, files: Record<string, string>, meta?: object): Promise<void> {
  await mkdir(join(root, name), { recursive: true })
  for (const [f, content] of Object.entries(files)) await writeFile(join(root, name, f), content)
  if (meta) await writeFile(join(root, name, '.velody'), JSON.stringify(meta))
}

const meta = async (name: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(join(root, name, '.velody'), 'utf-8'))

const stateOf = async (name: string): Promise<string | undefined> =>
  (await sync.listLibrary()).find((s) => s.name === name)?.sync

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'velody-sync-'))
  cloud = new FakeCloud()
  enabled = true
  events = []
  deleted = []
  sync = new CloudSync({
    root: () => root,
    scanLocal,
    api: async () => (enabled ? cloud : null),
    quickApi: async () => (enabled ? cloud : null),
    onSongDeleted: async (n) => void deleted.push(n),
    emit: (e) => events.push(e)
  })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

// ── Tests ─────────────────────────────────────────────────────────────────

describe('mergeLibrary', () => {
  const song = (name: string): SongItem => ({ name, stems: [`/r/${name}/drums.mp3`] })
  const remote = (id: string, name: string): CloudSong => ({
    id,
    name,
    files: [{ name: 'drums.mp3', size: 7, sha256: 'x' }],
    metaUpdatedAt: null,
    updatedAt: 1
  })

  it('labels local-only, cloud-only and synced songs without duplicates', () => {
    const out = mergeLibrary(
      [{ item: song('A') }, { item: song('C'), cloudId: 'c' }],
      [remote('b', 'B'), remote('c', 'C')]
    )
    expect(out.map((s) => [s.name, s.sync])).toEqual([
      ['C', 'synced'],
      ['B', 'cloud'],
      ['A', 'local']
    ])
    expect(out.find((s) => s.name === 'B')).toMatchObject({ stems: [], sizeBytes: 7 })
  })

  it('matches by name a local song without a cloudId (reinstall / lost .velody)', () => {
    const out = mergeLibrary([{ item: song('A') }], [remote('a', 'A')])
    expect(out).toEqual([{ ...song('A'), sync: 'synced', cloudId: 'a' }])
  })

  it('never matches by name a song already linked to another cloud id', () => {
    const out = mergeLibrary([{ item: song('A'), cloudId: 'gone' }], [remote('a', 'A')])
    expect(out.map((s) => [s.name, s.sync])).toEqual([['A', 'local']])
  })

  it('offline: local songs only, state from their cloudId', () => {
    const out = mergeLibrary([{ item: song('A') }, { item: song('B'), cloudId: 'b' }], null)
    expect(out.map((s) => s.sync)).toEqual(['local', 'synced'])
  })
})

describe('buildManifest', () => {
  it('hashes files once and reuses the cached hash while size+mtime are unchanged', async () => {
    await makeSong('S', { 'drums.mp3': 'drums', '_tmp_rec_x.wav': 'tmp', 'notes.txt': 'n' })
    const dir = join(root, 'S')
    const first = await buildManifest(dir)
    expect(first).toEqual([{ name: 'drums.mp3', size: 5, sha256: sha256(Buffer.from('drums')) }])

    // Same size + mtime as cached but different bytes: the cache wins
    // (proves the file isn't re-hashed).
    await writeFile(join(dir, 'drums.mp3'), 'DRUMS')
    const { mtimeMs } = await stat(join(dir, 'drums.mp3'))
    const m = await meta('S')
    m.fileHashes = { 'drums.mp3': { ...first[0], mtimeMs } }
    await writeFile(join(dir, '.velody'), JSON.stringify(m))
    expect((await buildManifest(dir))[0].sha256).toBe(first[0].sha256)

    // A real change (new mtime) is re-hashed.
    await utimes(join(dir, 'drums.mp3'), new Date(), new Date(Date.now() + 5000))
    expect((await buildManifest(dir))[0].sha256).toBe(sha256(Buffer.from('DRUMS')))
  })

  it('does not bump updatedAt when caching hashes', async () => {
    await makeSong('S', { 'drums.mp3': 'd' }, { bpm: 1, updatedAt: 7 })
    await buildManifest(join(root, 'S'))
    expect((await meta('S')).updatedAt).toBe(7)
  })
})

describe('listLibrary', () => {
  it('returns the plain local scan when cloud is disabled', async () => {
    enabled = false
    await makeSong('A', { 'drums.mp3': 'd' })
    expect(await sync.listLibrary()).toEqual([{ name: 'A', stems: [join(root, 'A', 'drums.mp3')] }])
    expect(sync.getStatus()).toEqual({ enabled: false, offline: false })
  })

  it('after a reinstall: links local songs to their cloud copy instead of re-uploading', async () => {
    await makeSong('A', { 'drums.mp3': 'drums' }, { bpm: 120 })
    await sync.upload('A')
    const id = (await meta('A')).cloudId as string
    // Simulate a lost .velody (reinstall, restored backup without sidecars).
    await rm(join(root, 'A', '.velody'))

    expect(await stateOf('A')).toBe('synced')
    expect((await meta('A')).cloudId).toBe(id)
    const r = await sync.uploadAll()
    expect(r.uploaded).toBe(0)
    expect(cloud.songs.size).toBe(1)
  })

  it('falls back to local songs and flags offline when the cloud is unreachable', async () => {
    await makeSong('A', { 'drums.mp3': 'd' })
    vi.spyOn(cloud, 'listSongs').mockRejectedValue(new Error('no network'))
    const list = await sync.listLibrary()
    expect(list.map((s) => [s.name, s.sync])).toEqual([['A', 'local']])
    expect(sync.getStatus()).toMatchObject({ enabled: true, offline: true })
  })
})

describe('upload', () => {
  it('uploads files + metadata, makes the song synced, and keeps local files', async () => {
    await makeSong('A', { 'drums.mp3': 'drums', 'vocals.mp3': 'vox' }, { bpm: 120 })
    const r = await sync.upload('A')
    expect(r).toEqual({ success: true, songName: 'A' })
    const m = await meta('A')
    const id = m.cloudId as string
    expect(cloud.objects.get(`${id}/drums.mp3`)?.toString()).toBe('drums')
    expect(cloud.meta.get(id)?.meta).toEqual({ bpm: 120 })
    expect(cloud.meta.get(id)?.meta).not.toHaveProperty('fileHashes')
    expect(await stateOf('A')).toBe('synced')
    expect(await readdir(join(root, 'A'))).toContain('drums.mp3')
    expect(events.at(-1)).toMatchObject({ kind: 'upload', songName: 'A', status: 'done' })
  })

  it('an interrupted upload leaves the song local-only and resumes without re-sending', async () => {
    await makeSong('A', { 'bass.mp3': 'b', 'drums.mp3': 'd', 'vocals.mp3': 'v' })
    cloud.failPutsAfter = 1
    const r = await sync.upload('A')
    expect(r.success).toBe(false)
    expect(await stateOf('A')).toBe('local')

    cloud.failPutsAfter = Infinity
    const before = cloud.putCount
    expect((await sync.upload('A')).success).toBe(true)
    expect(cloud.putCount - before).toBeLessThan(3)
    expect(new Set(cloud.calls.filter((c) => c.startsWith('begin:')))).toHaveProperty('size', 1) // same cloud id both times
  })

  it('upload all: every local-only song, one failure does not stop the others', async () => {
    await makeSong('A', { 'drums.mp3': 'a' })
    await makeSong('B', { 'drums.mp3': 'b' })
    await makeSong('C', { 'notes.txt': 'no audio' }) // not a song for the scan
    await makeSong('D', { 'drums.mp3': 'd' })
    const orig = cloud.beginUpload.bind(cloud)
    vi.spyOn(cloud, 'beginUpload').mockImplementation((id, req) =>
      req.name === 'B' ? Promise.reject(new Error('boom')) : orig(id, req)
    )
    const r = await sync.uploadAll()
    expect(r).toMatchObject({ success: false, uploaded: 2, failed: ['B'] })
    expect(await stateOf('A')).toBe('synced')
    expect(await stateOf('D')).toBe('synced')
  })
})

describe('download', () => {
  async function cloudOnlySong(name = 'A'): Promise<string> {
    await makeSong(name, { 'drums.mp3': 'drums', 'vocals.mp3': 'vox' }, { trimStart: 3 })
    await sync.upload(name)
    const id = (await meta(name)).cloudId as string
    await rm(join(root, name), { recursive: true })
    return id
  }

  it('downloads a cloud-only song with its metadata and makes it synced', async () => {
    const id = await cloudOnlySong()
    expect(await stateOf('A')).toBe('cloud')
    expect(await sync.download('A')).toEqual({ success: true, songName: 'A' })
    expect(await readFile(join(root, 'A', 'drums.mp3'), 'utf-8')).toBe('drums')
    expect(await meta('A')).toMatchObject({ trimStart: 3, cloudId: id })
    expect(await stateOf('A')).toBe('synced')
    expect((await readdir(root)).filter((e) => e.startsWith(DOWNLOAD_DIR_PREFIX))).toEqual([])
  })

  it('a corrupted file fails the download and leaves no song folder behind', async () => {
    await cloudOnlySong()
    await sync.listLibrary()
    cloud.corruptDownloads = true
    const r = await sync.download('A')
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/corrupted/)
    expect(await readdir(root)).toEqual([])
    expect(await stateOf('A')).toBe('cloud')
  })

  it('removes stale download folders at startup', async () => {
    await mkdir(join(root, `${DOWNLOAD_DIR_PREFIX}abc`))
    await sync.cleanupStaleDownloads()
    expect(await readdir(root)).toEqual([])
  })
})

describe('metadata on open', () => {
  async function syncedSong(localMeta: object): Promise<string> {
    await makeSong('A', { 'drums.mp3': 'd' }, localMeta)
    await sync.upload('A')
    await sync.listLibrary()
    return (await meta('A')).cloudId as string
  }

  it('pulls a newer cloud version, replacing synced keys and keeping device keys', async () => {
    const id = await syncedSong({ bpm: 100, trimEnd: 30, updatedAt: 1000 })
    cloud.meta.set(id, { meta: { bpm: 140 }, updatedAt: 5000 })
    expect(await sync.syncMetaOnOpen('A')).toBe('pulled')
    const m = await meta('A')
    expect(m).toMatchObject({ bpm: 140, updatedAt: 5000, cloudId: id })
    expect(m).not.toHaveProperty('trimEnd')
  })

  it('pushes local edits made while offline', async () => {
    const id = await syncedSong({ bpm: 100, updatedAt: 1000 })
    await writeFile(
      join(root, 'A', '.velody'),
      JSON.stringify({ ...(await meta('A')), bpm: 99, updatedAt: 9000 })
    )
    expect(await sync.syncMetaOnOpen('A')).toBe('pushed')
    expect(cloud.meta.get(id)).toEqual({ meta: { bpm: 99 }, updatedAt: 9000 })
  })

  it('opens the local copy when the cloud fails (never throws)', async () => {
    await syncedSong({ bpm: 1, updatedAt: 1 })
    vi.spyOn(cloud, 'getMeta').mockRejectedValue(new Error('timeout'))
    expect(await sync.syncMetaOnOpen('A')).toBe('skipped')
  })

  it('skips songs that are not synced', async () => {
    await makeSong('L', { 'drums.mp3': 'd' })
    await sync.listLibrary()
    expect(await sync.syncMetaOnOpen('L')).toBe('skipped')
  })
})

describe('remove local copy / delete everywhere', () => {
  it('remove local: frees the folder, keeps the cloud copy and setlists', async () => {
    await makeSong('A', { 'drums.mp3': 'd' })
    await sync.upload('A')
    expect((await sync.removeLocal('A')).success).toBe(true)
    expect(await readdir(root)).toEqual([])
    expect(await stateOf('A')).toBe('cloud')
    expect(deleted).toEqual([])
  })

  it('remove local first uploads anything only on the laptop (e.g. a new recording)', async () => {
    await makeSong('A', { 'drums.mp3': 'd' })
    await sync.upload('A')
    const id = (await meta('A')).cloudId as string
    await writeFile(join(root, 'A', 'drums_take1.mp3'), 'take')
    await sync.removeLocal('A')
    expect(cloud.objects.get(`${id}/drums_take1.mp3`)?.toString()).toBe('take')
  })

  it('remove local aborts and deletes nothing when the sync fails', async () => {
    await makeSong('A', { 'drums.mp3': 'd' })
    await sync.upload('A')
    vi.spyOn(cloud, 'commit').mockRejectedValue(new Error('down'))
    const r = await sync.removeLocal('A')
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/nothing was deleted/)
    expect(await readdir(join(root, 'A'))).toContain('drums.mp3')
  })

  it('remove local is refused for local-only songs', async () => {
    await makeSong('A', { 'drums.mp3': 'd' })
    expect((await sync.removeLocal('A')).success).toBe(false)
    expect(await readdir(root)).toEqual(['A'])
  })

  it('delete everywhere removes cloud + local and prunes setlists', async () => {
    await makeSong('A', { 'drums.mp3': 'd' })
    await sync.upload('A')
    expect((await sync.deleteEverywhere('A')).success).toBe(true)
    expect(cloud.songs.size).toBe(0)
    expect(await readdir(root)).toEqual([])
    expect(deleted).toEqual(['A'])
  })

  it('delete everywhere keeps the local copy when the cloud delete fails', async () => {
    await makeSong('A', { 'drums.mp3': 'd' })
    await sync.upload('A')
    cloud.deleteFails = true
    const r = await sync.deleteEverywhere('A')
    expect(r.success).toBe(false)
    expect(await readdir(join(root, 'A'))).toContain('drums.mp3')
    expect(deleted).toEqual([])
  })
})
