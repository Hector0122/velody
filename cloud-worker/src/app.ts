import {
  CLOUD_API_PREFIX,
  CLOUD_FILE_NAME_RE,
  MAX_META_CLOCK_SKEW_MS,
  PRESIGN_EXPIRES_SECONDS,
  SHA256_RE,
  SONG_ID_RE,
  type ApiError,
  type CloudFile,
  type CloudSong,
  type CommitResponse,
  type DownloadResponse,
  type ListSongsResponse,
  type MetaResponse,
  type PutMetaRequest,
  type UploadBeginRequest,
  type UploadBeginResponse
} from '../../src/shared/cloud'
import { isAuthorized } from './auth'
import type { Env } from './env'
import type { Presigner } from './presign'

const META_FILE = 'meta.json'

interface SongRow {
  id: string
  name: string
  status: 'pending' | 'complete'
  meta_updated_at: number | null
  updated_at: number
}

interface FileRow {
  song_id: string
  name: string
  size: number
  sha256: string
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError
  ) {
    super(body.error)
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

const fail = (status: number, error: string, extra: Partial<ApiError> = {}): never => {
  throw new HttpError(status, { error, ...extra })
}

const songPrefix = (id: string): string => `songs/${id}/`
const fileKey = (id: string, name: string): string => `${songPrefix(id)}${name}`

async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T
  } catch {
    return fail(400, 'Body must be JSON')
  }
}

function validateUpload(body: UploadBeginRequest): void {
  if (!body || typeof body.name !== 'string' || !body.name.trim() || body.name.length > 300) {
    fail(400, 'Invalid song name')
  }
  if (!Array.isArray(body.files) || body.files.length === 0 || body.files.length > 50) {
    fail(400, 'files must be a non-empty array')
  }
  const seen = new Set<string>()
  for (const f of body.files) {
    if (
      !f ||
      typeof f.name !== 'string' ||
      !CLOUD_FILE_NAME_RE.test(f.name) ||
      !Number.isSafeInteger(f.size) ||
      f.size <= 0 ||
      typeof f.sha256 !== 'string' ||
      !SHA256_RE.test(f.sha256)
    ) {
      fail(400, `Invalid file entry: ${JSON.stringify(f?.name ?? f)}`)
    }
    if (seen.has(f.name)) fail(400, `Duplicate file: ${f.name}`)
    seen.add(f.name)
  }
}

export interface App {
  fetch(request: Request, env: Env): Promise<Response>
}

export function createApp(presign: Presigner): App {
  async function getSong(env: Env, id: string): Promise<SongRow | null> {
    return env.DB.prepare(
      'SELECT id, name, status, meta_updated_at, updated_at FROM songs WHERE id = ?'
    )
      .bind(id)
      .first<SongRow>()
  }

  async function getFiles(env: Env, id: string): Promise<CloudFile[]> {
    const { results } = await env.DB.prepare(
      'SELECT name, size, sha256 FROM song_files WHERE song_id = ? ORDER BY name'
    )
      .bind(id)
      .all<FileRow>()
    return results.map((r) => ({ name: r.name, size: r.size, sha256: r.sha256 }))
  }

  function toSong(row: SongRow, files: CloudFile[]): CloudSong {
    return {
      id: row.id,
      name: row.name,
      files,
      metaUpdatedAt: row.meta_updated_at,
      updatedAt: row.updated_at
    }
  }

  async function listSongs(env: Env): Promise<ListSongsResponse> {
    const [songs, files] = await Promise.all([
      env.DB.prepare(
        "SELECT id, name, status, meta_updated_at, updated_at FROM songs WHERE status = 'complete' ORDER BY name"
      ).all<SongRow>(),
      env.DB.prepare(
        "SELECT f.song_id, f.name, f.size, f.sha256 FROM song_files f JOIN songs s ON s.id = f.song_id WHERE s.status = 'complete' ORDER BY f.name"
      ).all<FileRow>()
    ])
    const bySong = new Map<string, CloudFile[]>()
    for (const f of files.results) {
      const list = bySong.get(f.song_id) ?? []
      list.push({ name: f.name, size: f.size, sha256: f.sha256 })
      bySong.set(f.song_id, list)
    }
    return { songs: songs.results.map((s) => toSong(s, bySong.get(s.id) ?? [])) }
  }

  async function beginUpload(env: Env, id: string, request: Request): Promise<UploadBeginResponse> {
    const body = await readJson<UploadBeginRequest>(request)
    validateUpload(body)
    const now = Date.now()
    const existing = new Map((await getFiles(env, id)).map((f) => [f.name, f]))

    // A file is skipped when the same content was declared before and the
    // object really is in R2 with that size (S3 PUTs are all-or-nothing, so
    // an interrupted upload leaves no object behind).
    const uploads = []
    for (const f of body.files) {
      const prev = existing.get(f.name)
      if (prev && prev.sha256 === f.sha256 && prev.size === f.size) {
        const head = await env.BUCKET.head(fileKey(id, f.name))
        if (head && head.size === f.size) continue
      }
      uploads.push({ name: f.name, url: await presign('PUT', fileKey(id, f.name)) })
    }

    // Re-uploading changed files hides the song (pending) until its commit:
    // otherwise another device could download the new file list while the
    // objects are still the old ones and fail every hash check.
    const filesChanged = uploads.length > 0 || existing.size !== body.files.length
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO songs (id, name, status, created_at, updated_at) VALUES (?, ?, 'pending', ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at,
           status = CASE WHEN ? THEN 'pending' ELSE songs.status END`
      ).bind(id, body.name.trim(), now, now, filesChanged ? 1 : 0),
      env.DB.prepare('DELETE FROM song_files WHERE song_id = ?').bind(id),
      ...body.files.map((f) =>
        env.DB.prepare(
          'INSERT INTO song_files (song_id, name, size, sha256) VALUES (?, ?, ?, ?)'
        ).bind(id, f.name, f.size, f.sha256)
      )
    ])
    return { uploads, expiresAt: now + PRESIGN_EXPIRES_SECONDS * 1000 }
  }

  async function commitUpload(env: Env, id: string): Promise<CommitResponse> {
    const song = (await getSong(env, id)) ?? fail(404, 'Song not found')
    const files = await getFiles(env, id)
    const missing: string[] = []
    for (const f of files) {
      const head = await env.BUCKET.head(fileKey(id, f.name))
      if (!head || head.size !== f.size) missing.push(f.name)
    }
    if (missing.length > 0) fail(409, 'Some files are missing in storage', { missing })

    // Drop objects of files that are no longer part of the song.
    const keep = new Set([...files.map((f) => fileKey(id, f.name)), fileKey(id, META_FILE)])
    const stale = (await listKeys(env, songPrefix(id))).filter((k) => !keep.has(k))
    if (stale.length > 0) await env.BUCKET.delete(stale)

    const now = Date.now()
    await env.DB.prepare("UPDATE songs SET status = 'complete', updated_at = ? WHERE id = ?")
      .bind(now, id)
      .run()
    return { song: toSong({ ...song, status: 'complete', updated_at: now }, files) }
  }

  async function download(env: Env, id: string): Promise<DownloadResponse> {
    const song = await getSong(env, id)
    if (!song || song.status !== 'complete') fail(404, 'Song not found')
    const files = await getFiles(env, id)
    return {
      files: await Promise.all(
        files.map(async (f) => ({ ...f, url: await presign('GET', fileKey(id, f.name)) }))
      ),
      expiresAt: Date.now() + PRESIGN_EXPIRES_SECONDS * 1000
    }
  }

  async function getMeta(env: Env, id: string): Promise<MetaResponse> {
    if (!(await getSong(env, id))) fail(404, 'Song not found')
    const obj = await env.BUCKET.get(fileKey(id, META_FILE))
    if (!obj) return fail(404, 'No metadata')
    return (await obj.json()) as MetaResponse
  }

  async function putMeta(env: Env, id: string, request: Request): Promise<Response> {
    const body = await readJson<PutMetaRequest>(request)
    if (
      !body ||
      typeof body.meta !== 'object' ||
      body.meta === null ||
      Array.isArray(body.meta) ||
      !Number.isSafeInteger(body.updatedAt) ||
      body.updatedAt <= 0
    ) {
      fail(400, 'Body must be { meta: object, updatedAt: number }')
    }
    if (body.updatedAt > Date.now() + MAX_META_CLOCK_SKEW_MS) {
      fail(400, 'updatedAt is too far in the future')
    }
    const song = (await getSong(env, id)) ?? fail(404, 'Song not found')

    // Last-write-wins, decided atomically by the conditional UPDATE.
    const res = await env.DB.prepare(
      'UPDATE songs SET meta_updated_at = ? WHERE id = ? AND (meta_updated_at IS NULL OR meta_updated_at < ?)'
    )
      .bind(body.updatedAt, id, body.updatedAt)
      .run()
    if (!res.meta.changes) {
      const current = await env.BUCKET.get(fileKey(id, META_FILE))
      const stored = current ? ((await current.json()) as MetaResponse) : null
      return json({ error: 'A newer version is stored', ...stored }, 409)
    }
    const doc: MetaResponse = { meta: body.meta, updatedAt: body.updatedAt }
    try {
      await env.BUCKET.put(fileKey(id, META_FILE), JSON.stringify(doc), {
        httpMetadata: { contentType: 'application/json' }
      })
    } catch (err) {
      // Undo the timestamp: left advanced over the old stored meta, clients
      // would take that old meta as the newer version and overwrite theirs.
      await env.DB.prepare(
        'UPDATE songs SET meta_updated_at = ? WHERE id = ? AND meta_updated_at = ?'
      )
        .bind(song.meta_updated_at, id, body.updatedAt)
        .run()
      throw err
    }
    return json({ updatedAt: body.updatedAt })
  }

  async function listKeys(env: Env, prefix: string): Promise<string[]> {
    const keys: string[] = []
    let cursor: string | undefined
    do {
      const page = await env.BUCKET.list({ prefix, cursor })
      keys.push(...page.objects.map((o) => o.key))
      cursor = page.truncated ? page.cursor : undefined
    } while (cursor)
    return keys
  }

  async function deleteSong(env: Env, id: string): Promise<{ deleted: true }> {
    if (!(await getSong(env, id))) fail(404, 'Song not found')
    const keys = await listKeys(env, songPrefix(id))
    for (let i = 0; i < keys.length; i += 1000) await env.BUCKET.delete(keys.slice(i, i + 1000))
    await env.DB.batch([
      env.DB.prepare('DELETE FROM song_files WHERE song_id = ?').bind(id),
      env.DB.prepare('DELETE FROM songs WHERE id = ?').bind(id)
    ])
    return { deleted: true }
  }

  async function route(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (!url.pathname.startsWith(CLOUD_API_PREFIX + '/')) fail(404, 'Not found')
    const path = url.pathname.slice(CLOUD_API_PREFIX.length)
    const method = request.method

    if (path === '/health' && method === 'GET') return json({ ok: true })
    if (path === '/songs' && method === 'GET') return json(await listSongs(env))

    const m = /^\/songs\/([^/]+)(\/(upload|commit|download|meta))?$/.exec(path)
    if (!m) return fail(404, 'Not found')
    const id = m[1]
    if (!SONG_ID_RE.test(id)) fail(400, 'Invalid song id')
    const action = m[3]

    if (!action && method === 'DELETE') return json(await deleteSong(env, id))
    if (action === 'upload' && method === 'POST') return json(await beginUpload(env, id, request))
    if (action === 'commit' && method === 'POST') return json(await commitUpload(env, id))
    if (action === 'download' && method === 'GET') return json(await download(env, id))
    if (action === 'meta' && method === 'GET') return json(await getMeta(env, id))
    if (action === 'meta' && method === 'PUT') return putMeta(env, id, request)
    return fail(405, 'Method not allowed')
  }

  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      // Auth before routing: an unauthenticated caller learns nothing, not
      // even which paths exist.
      if (!(await isAuthorized(request, env.API_TOKEN))) {
        return json({ error: 'Unauthorized' }, 401)
      }
      try {
        return await route(request, env)
      } catch (err) {
        if (err instanceof HttpError) return json(err.body, err.status)
        console.error(err)
        return json({ error: err instanceof Error ? err.message : 'Internal error' }, 500)
      }
    }
  }
}
