import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
// Importing handlers.ts outside Electron's runtime is safe here — see the
// comment in scanSongsLibrary.test.ts. readSetlists/writeSetlists take the
// target path as a parameter, so these tests use a real temp file instead
// of mocking fs/promises.
import { readSetlists, writeSetlists, pruneSongFromSetlists, type Setlist } from '../handlers'

describe('readSetlists / writeSetlists', () => {
  let dir: string
  let setlistsPath: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'velody-setlists-test-'))
    setlistsPath = join(dir, 'setlists.json')
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('returns [] when the file does not exist', async () => {
    expect(await readSetlists(setlistsPath)).toEqual([])
  })

  it('returns [] for corrupted JSON rather than throwing', async () => {
    const { writeFile } = await import('fs/promises')
    await writeFile(setlistsPath, '{not valid json', 'utf-8')
    expect(await readSetlists(setlistsPath)).toEqual([])
  })

  it('returns [] when the file is valid JSON but missing the setlists array', async () => {
    const { writeFile } = await import('fs/promises')
    await writeFile(setlistsPath, JSON.stringify({ notSetlists: [] }), 'utf-8')
    expect(await readSetlists(setlistsPath)).toEqual([])
  })

  it('round-trips a list of setlists through write then read', async () => {
    const setlists: Setlist[] = [
      { id: 'a', name: 'Show 1', songNames: ['Song A', 'Song B'], updatedAt: 1000 },
      { id: 'b', name: 'Show 2', songNames: [], updatedAt: 2000 }
    ]
    await writeSetlists(setlistsPath, setlists)
    expect(await readSetlists(setlistsPath)).toEqual(setlists)
  })

  it('a second write fully replaces the first (no merge)', async () => {
    await writeSetlists(setlistsPath, [{ id: 'a', name: 'Old', songNames: [], updatedAt: 1 }])
    await writeSetlists(setlistsPath, [{ id: 'b', name: 'New', songNames: [], updatedAt: 2 }])
    const result = await readSetlists(setlistsPath)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('b')
  })

  it('does not leave a stale .tmp file behind after a successful write', async () => {
    await writeSetlists(setlistsPath, [{ id: 'a', name: 'X', songNames: [], updatedAt: 1 }])
    const { readdir } = await import('fs/promises')
    const files = await readdir(dir)
    expect(files).toEqual(['setlists.json'])
  })
})

describe('pruneSongFromSetlists', () => {
  it('removes the deleted song from every setlist that referenced it', () => {
    const setlists: Setlist[] = [
      { id: 'a', name: 'Show 1', songNames: ['Song A', 'Song B'], updatedAt: 1 },
      { id: 'b', name: 'Show 2', songNames: ['Song B', 'Song C'], updatedAt: 2 }
    ]
    const { pruned, changed } = pruneSongFromSetlists(setlists, 'Song B')

    expect(changed).toBe(true)
    expect(pruned.find((sl) => sl.id === 'a')?.songNames).toEqual(['Song A'])
    expect(pruned.find((sl) => sl.id === 'b')?.songNames).toEqual(['Song C'])
  })

  it('reports changed: false and leaves the list untouched when nothing referenced the song', () => {
    const setlists: Setlist[] = [{ id: 'c', name: 'Show 3', songNames: ['Song D'], updatedAt: 3 }]
    const { pruned, changed } = pruneSongFromSetlists(setlists, 'Song B')

    expect(changed).toBe(false)
    expect(pruned).toEqual(setlists)
  })

  it('removes the song from a setlist without emptying its other entries', () => {
    const setlists: Setlist[] = [
      { id: 'a', name: 'Show 1', songNames: ['Song A', 'Song B', 'Song C'], updatedAt: 1 }
    ]
    const { pruned } = pruneSongFromSetlists(setlists, 'Song B')
    expect(pruned[0].songNames).toEqual(['Song A', 'Song C'])
  })
})
