import { beforeEach, describe, expect, it } from 'vitest'
import { createHarness, hash, putObject, SONG_ID, type Harness } from './fakes'
import type {
  CloudSong,
  CommitResponse,
  DownloadResponse,
  ListSongsResponse,
  UploadBeginResponse
} from '../../src/shared/cloud'

let h: Harness

const FILES = [
  { name: 'drums.mp3', size: 10, sha256: hash('a') },
  { name: 'vocals.mp3', size: 20, sha256: hash('b') }
]

async function begin(files = FILES, name = 'My Song'): Promise<UploadBeginResponse> {
  const res = await h.call('POST', `/v1/songs/${SONG_ID}/upload`, { name, files })
  expect(res.status).toBe(200)
  return res.json()
}

async function uploadComplete(files = FILES): Promise<void> {
  await begin(files)
  for (const f of files) putObject(h.r2, SONG_ID, f.name, f.size)
  expect((await h.call('POST', `/v1/songs/${SONG_ID}/commit`)).status).toBe(200)
}

async function listSongs(): Promise<CloudSong[]> {
  return ((await (await h.call('GET', '/v1/songs')).json()) as ListSongsResponse).songs
}

beforeEach(() => {
  h = createHarness()
})

describe('auth', () => {
  it('rejects a missing token with 401', async () => {
    const res = await h.call('GET', '/v1/health', undefined, null)
    expect(res.status).toBe(401)
  })

  it('rejects a wrong token with 401, without leaking data', async () => {
    await uploadComplete()
    const res = await h.call('GET', '/v1/songs', undefined, 'nope')
    expect(res.status).toBe(401)
    expect(await res.text()).not.toContain('My Song')
  })

  it('rejects everything when no API_TOKEN is configured', async () => {
    h.env.API_TOKEN = undefined
    expect((await h.call('GET', '/v1/health')).status).toBe(401)
  })

  it('accepts the configured token', async () => {
    const res = await h.call('GET', '/v1/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
})

describe('upload / commit', () => {
  it('hides a song while changed files are re-uploaded, until the commit', async () => {
    await uploadComplete()
    const changed = [FILES[0], { name: 'vocals.mp3', size: 21, sha256: hash('c') }]
    await begin(changed)
    expect(await listSongs()).toEqual([])
    putObject(h.r2, SONG_ID, 'vocals.mp3', 21)
    expect((await h.call('POST', `/v1/songs/${SONG_ID}/commit`)).status).toBe(200)
    expect((await listSongs()).map((s) => s.id)).toEqual([SONG_ID])
  })

  it('keeps a song listed when a re-upload changes nothing', async () => {
    await uploadComplete()
    await begin()
    expect((await listSongs()).map((s) => s.id)).toEqual([SONG_ID])
  })

  it('returns one presigned URL per file', async () => {
    const r = await begin()
    expect(r.uploads.map((u) => u.name)).toEqual(['drums.mp3', 'vocals.mp3'])
    expect(r.uploads[0].url).toBe(`https://r2.test/PUT/songs/${SONG_ID}/drums.mp3`)
  })

  it('hides songs whose upload was never committed', async () => {
    await begin()
    expect(await listSongs()).toEqual([])
  })

  it('commits when every declared file is stored, and lists the song', async () => {
    await begin()
    for (const f of FILES) putObject(h.r2, SONG_ID, f.name, f.size)
    const res = await h.call('POST', `/v1/songs/${SONG_ID}/commit`)
    expect(res.status).toBe(200)
    const { song } = (await res.json()) as CommitResponse
    expect(song.files).toEqual(FILES)
    const songs = await listSongs()
    expect(songs).toHaveLength(1)
    expect(songs[0]).toMatchObject({
      id: SONG_ID,
      name: 'My Song',
      files: FILES,
      metaUpdatedAt: null
    })
  })

  it('refuses to commit with missing or wrong-size files and names them', async () => {
    await begin()
    putObject(h.r2, SONG_ID, 'drums.mp3', 3) // wrong size; vocals absent
    const res = await h.call('POST', `/v1/songs/${SONG_ID}/commit`)
    expect(res.status).toBe(409)
    expect(((await res.json()) as { missing: string[] }).missing).toEqual([
      'drums.mp3',
      'vocals.mp3'
    ])
    expect(await listSongs()).toEqual([])
  })

  it('re-upload omits files already stored with the same hash', async () => {
    await begin()
    putObject(h.r2, SONG_ID, 'drums.mp3', 10) // interrupted after the first file
    const r = await begin()
    expect(r.uploads.map((u) => u.name)).toEqual(['vocals.mp3'])
  })

  it('re-upload sends a file again when its hash changed', async () => {
    await uploadComplete()
    const changed = [{ ...FILES[0], sha256: hash('c') }, FILES[1]]
    const r = await begin(changed)
    expect(r.uploads.map((u) => u.name)).toEqual(['drums.mp3'])
  })

  it('commit removes objects of files no longer in the song', async () => {
    await uploadComplete()
    await uploadComplete([FILES[1]])
    expect([...h.r2.objects.keys()]).toEqual([`songs/${SONG_ID}/vocals.mp3`])
  })

  it('rejects path-like or hidden file names', async () => {
    for (const name of ['../x.mp3', 'a/b.mp3', '.velody', 'notes.txt']) {
      const res = await h.call('POST', `/v1/songs/${SONG_ID}/upload`, {
        name: 'S',
        files: [{ name, size: 1, sha256: hash('a') }]
      })
      expect(res.status, name).toBe(400)
    }
  })

  it('rejects an id that is not a UUID', async () => {
    expect((await h.call('GET', '/v1/songs/../meta')).status).toBe(404)
    expect((await h.call('POST', '/v1/songs/not-a-uuid/commit')).status).toBe(400)
  })
})

describe('list / download', () => {
  it('lists songs with their files and timestamps', async () => {
    await uploadComplete()
    const [song] = await listSongs()
    expect(song.updatedAt).toBeGreaterThan(0)
    expect(song.files.map((f) => f.name)).toEqual(['drums.mp3', 'vocals.mp3'])
  })

  it('returns presigned GET URLs for a complete song', async () => {
    await uploadComplete()
    const res = await h.call('GET', `/v1/songs/${SONG_ID}/download`)
    const body = (await res.json()) as DownloadResponse
    expect(body.files.map((f) => f.url)).toEqual([
      `https://r2.test/GET/songs/${SONG_ID}/drums.mp3`,
      `https://r2.test/GET/songs/${SONG_ID}/vocals.mp3`
    ])
    expect(body.files[0]).toMatchObject(FILES[0])
  })

  it('404s on an unknown or uncommitted song', async () => {
    expect((await h.call('GET', `/v1/songs/${SONG_ID}/download`)).status).toBe(404)
    await begin()
    expect((await h.call('GET', `/v1/songs/${SONG_ID}/download`)).status).toBe(404)
  })
})

describe('metadata (last-write-wins)', () => {
  const put = (
    updatedAt: number,
    meta: Record<string, unknown> = { bpm: updatedAt }
  ): Promise<Response> => h.call('PUT', `/v1/songs/${SONG_ID}/meta`, { meta, updatedAt })

  beforeEach(async () => {
    await uploadComplete()
  })

  it('rolls the timestamp back when storing the metadata fails', async () => {
    expect((await put(1000)).status).toBe(200)
    const realPut = h.r2.put.bind(h.r2)
    h.r2.put = async () => {
      throw new Error('R2 down')
    }
    expect((await put(2000)).status).toBe(500)
    h.r2.put = realPut
    // Still 1000: the failed write didn't make the old meta look newer.
    expect((await listSongs())[0].metaUpdatedAt).toBe(1000)
    expect((await put(2000)).status).toBe(200)
  })

  it('stores newer metadata and reports its updatedAt in the list', async () => {
    expect((await put(1000)).status).toBe(200)
    const res = await h.call('GET', `/v1/songs/${SONG_ID}/meta`)
    expect(await res.json()).toEqual({ meta: { bpm: 1000 }, updatedAt: 1000 })
    expect((await listSongs())[0].metaUpdatedAt).toBe(1000)
  })

  it('rejects equal and older timestamps with 409 + the current document', async () => {
    await put(2000)
    for (const t of [2000, 1500]) {
      const res = await put(t)
      expect(res.status).toBe(409)
      expect(await res.json()).toMatchObject({ meta: { bpm: 2000 }, updatedAt: 2000 })
    }
  })

  it('rejects timestamps more than a day in the future', async () => {
    const res = await put(Date.now() + 2 * 24 * 3600 * 1000)
    expect(res.status).toBe(400)
  })

  it('404s for metadata of an unknown song', async () => {
    const res = await h.call('PUT', `/v1/songs/99999999-2222-4333-8444-555555555555/meta`, {
      meta: {},
      updatedAt: 1
    })
    expect(res.status).toBe(404)
  })
})

describe('delete', () => {
  it('removes the song, its files and its metadata', async () => {
    await uploadComplete()
    await h.call('PUT', `/v1/songs/${SONG_ID}/meta`, { meta: {}, updatedAt: 5 })
    const res = await h.call('DELETE', `/v1/songs/${SONG_ID}`)
    expect(res.status).toBe(200)
    expect(await listSongs()).toEqual([])
    expect(h.r2.objects.size).toBe(0)
    expect((await h.call('GET', `/v1/songs/${SONG_ID}/download`)).status).toBe(404)
  })

  it('404s on an unknown song and changes nothing', async () => {
    await uploadComplete()
    expect((await h.call('DELETE', '/v1/songs/99999999-2222-4333-8444-555555555555')).status).toBe(
      404
    )
    expect(await listSongs()).toHaveLength(1)
  })
})
