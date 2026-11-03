import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { updateMeta } from '../handlers'

describe('updateMeta (.velody sidecar writes)', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'velody-meta-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('keeps every key when many writers update the same song at once', async () => {
    // e.g. analysis results + count-in + speed + downbeat saved concurrently.
    await Promise.all(
      Array.from({ length: 25 }, (_, i) => updateMeta(dir, { [`key${i}`]: i }))
    )
    const meta = JSON.parse(await readFile(join(dir, '.velody'), 'utf-8'))
    for (let i = 0; i < 25; i++) expect(meta[`key${i}`]).toBe(i)
  })

  it('merges into existing metadata and lets later writes win per key', async () => {
    await writeFile(join(dir, '.velody'), JSON.stringify({ bpm: 120, trimStart: 1 }), 'utf-8')
    await updateMeta(dir, { bpm: 128 })
    await updateMeta(dir, { downbeatShift: 2 })
    const meta = JSON.parse(await readFile(join(dir, '.velody'), 'utf-8'))
    expect(meta).toEqual({ bpm: 128, trimStart: 1, downbeatShift: 2 })
  })

  it('leaves no temp files behind', async () => {
    await Promise.all([updateMeta(dir, { a: 1 }), updateMeta(dir, { b: 2 })])
    expect(await readdir(dir)).toEqual(['.velody'])
  })
})
