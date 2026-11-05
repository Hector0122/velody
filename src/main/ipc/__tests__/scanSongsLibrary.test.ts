import { describe, it, expect, vi, beforeEach } from 'vitest'
import { join } from 'path'

// Only fs/promises needs mocking: `readdir`/`stat`/`access` are the only
// filesystem calls scanSongsLibrary exercises. 'fs' (constants) and 'electron'
// (imported by handlers.ts at module scope but unused by this code path) are
// left real/unmocked — importing handlers.ts outside Electron's runtime just
// yields `undefined` bindings for the electron exports, which is fine since
// registerIpcHandlers() (the only place that touches them) is never called.
const readdirMock = vi.fn()
const statMock = vi.fn()
const accessMock = vi.fn()
vi.mock('fs/promises', () => ({
  readdir: (...args: unknown[]) => (readdirMock as (...a: unknown[]) => unknown)(...args),
  stat: (...args: unknown[]) => (statMock as (...a: unknown[]) => unknown)(...args),
  access: (...args: unknown[]) => (accessMock as (...a: unknown[]) => unknown)(...args),
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  readFile: vi.fn(),
  rm: vi.fn(),
  mkdtemp: vi.fn()
}))

import { scanSongsLibrary } from '../handlers'

const ROOT = '/output/stems'

function dir(...segments: string[]): string {
  return join(ROOT, ...segments)
}

describe('scanSongsLibrary', () => {
  beforeEach(() => {
    readdirMock.mockReset()
    statMock.mockReset()
    accessMock.mockReset()
    accessMock.mockResolvedValue(undefined) // root exists
  })

  it('includes every valid song directory, scanned concurrently', async () => {
    readdirMock.mockImplementation(async (path: string) => {
      if (path === ROOT) return ['song-a', 'song-b']
      if (path === dir('song-a')) return ['vocals.wav', 'drums.wav']
      if (path === dir('song-b')) return ['bass.wav']
      return []
    })
    statMock.mockResolvedValue({ isDirectory: () => true })

    const result = await scanSongsLibrary(ROOT)

    expect(result).toHaveLength(2)
    expect(result.map((s) => s.name).sort()).toEqual(['song-a', 'song-b'])
    const songA = result.find((s) => s.name === 'song-a')
    expect(songA?.stems).toEqual([dir('song-a', 'vocals.wav'), dir('song-a', 'drums.wav')])
  })

  it('excludes a directory with no recognized stem files', async () => {
    readdirMock.mockImplementation(async (path: string) => {
      if (path === ROOT) return ['song-a', 'not-a-song']
      if (path === dir('song-a')) return ['vocals.wav']
      if (path === dir('not-a-song')) return ['readme.txt', 'cover.png']
      return []
    })
    statMock.mockResolvedValue({ isDirectory: () => true })

    const result = await scanSongsLibrary(ROOT)

    expect(result.map((s) => s.name)).toEqual(['song-a'])
  })

  it('skips hidden entries such as in-progress cloud downloads', async () => {
    readdirMock.mockImplementation(async (path: string) => {
      if (path === ROOT) return ['song-a', '.velody_dl_123']
      if (path === dir('song-a')) return ['vocals.mp3']
      if (path === dir('.velody_dl_123')) return ['vocals.mp3']
      return []
    })
    statMock.mockResolvedValue({ isDirectory: () => true })

    const result = await scanSongsLibrary(ROOT)

    expect(result.map((s) => s.name)).toEqual(['song-a'])
  })

  it('excludes non-directory entries', async () => {
    readdirMock.mockImplementation(async (path: string) => {
      if (path === ROOT) return ['song-a', 'stray-file.txt']
      if (path === dir('song-a')) return ['vocals.wav']
      return []
    })
    statMock.mockImplementation(async (path: string) => ({
      isDirectory: () => path !== dir('stray-file.txt')
    }))

    const result = await scanSongsLibrary(ROOT)

    expect(result.map((s) => s.name)).toEqual(['song-a'])
    // A non-directory entry must not have its contents read.
    expect(readdirMock).not.toHaveBeenCalledWith(dir('stray-file.txt'))
  })

  it('returns results sorted by name descending regardless of scan completion order', async () => {
    // 'song-a' resolves slower than 'song-c' and 'song-b' to prove the final
    // sort doesn't depend on which concurrent scan finishes first.
    readdirMock.mockImplementation(async (path: string) => {
      if (path === ROOT) return ['song-a', 'song-b', 'song-c']
      const delay = path === dir('song-a') ? 20 : 0
      await new Promise((r) => setTimeout(r, delay))
      return ['vocals.wav']
    })
    statMock.mockResolvedValue({ isDirectory: () => true })

    const result = await scanSongsLibrary(ROOT)

    expect(result.map((s) => s.name)).toEqual(['song-c', 'song-b', 'song-a'])
  })

  it('scans all entries concurrently, not sequentially', async () => {
    readdirMock.mockImplementation(async (path: string) => {
      if (path === ROOT) return ['song-a', 'song-b', 'song-c']
      return new Promise(() => {
        /* never resolves — proves every stat/readdir fired without waiting */
      })
    })
    statMock.mockImplementation(
      () =>
        new Promise(() => {
          /* never resolves */
        })
    )

    void scanSongsLibrary(ROOT)

    await vi.waitFor(() => {
      expect(statMock).toHaveBeenCalledTimes(3)
    })
  })

  it('returns an empty list when the stems root does not exist', async () => {
    accessMock.mockRejectedValue(new Error('ENOENT'))

    const result = await scanSongsLibrary(ROOT)

    expect(result).toEqual([])
    expect(readdirMock).not.toHaveBeenCalled()
  })
})
