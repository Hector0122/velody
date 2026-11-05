// Per-song `.velody` sidecar access. All writes go through updateMeta():
// serialized per song and written via temp-file + rename, so concurrent
// writers (UI hooks, background analysis, cloud sync) can't drop each
// other's keys or expose a half-written file.
import { join } from 'path'
import { readFile, rename, writeFile } from 'fs/promises'
import { LOCAL_ONLY_META_KEYS } from '../shared/cloud'

export interface UpdateMetaOptions {
  /**
   * Stamp `updatedAt = Date.now()` (default). Cloud sync compares it
   * last-write-wins, so device-only bookkeeping (cloudId, fileHashes) and
   * applying a pulled cloud version pass false.
   */
  touch?: boolean
  /**
   * Replace every synced key with `patch` instead of merging; device-only
   * keys (LOCAL_ONLY_META_KEYS) are kept. Used when the cloud version wins.
   */
  replace?: boolean
}

const metaWrites = new Map<string, Promise<void>>()

export function updateMeta(
  songDir: string,
  patch: Record<string, unknown>,
  opts: UpdateMetaOptions = {}
): Promise<void> {
  const metaPath = join(songDir, '.velody')
  const previous = metaWrites.get(songDir) ?? Promise.resolve()
  const next = previous.then(async () => {
    let existing: Record<string, unknown> = {}
    try {
      existing = JSON.parse(await readFile(metaPath, 'utf-8'))
    } catch {
      /* file doesn't exist or invalid JSON */
    }
    const base = opts.replace ? pickLocalOnly(existing) : existing
    const stamp = opts.touch === false ? {} : { updatedAt: Date.now() }
    // Write-then-rename so a concurrent reader never sees a half-written file.
    const tmpPath = `${metaPath}.${process.pid}.tmp`
    await writeFile(tmpPath, JSON.stringify({ ...base, ...patch, ...stamp }), 'utf-8')
    await rename(tmpPath, metaPath)
  })
  const settled = next.catch(() => {})
  metaWrites.set(songDir, settled)
  void settled.then(() => {
    if (metaWrites.get(songDir) === settled) metaWrites.delete(songDir)
  })
  return next
}

export async function readMeta(songDir: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed = JSON.parse(await readFile(join(songDir, '.velody'), 'utf-8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function pickLocalOnly(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of LOCAL_ONLY_META_KEYS) if (k in meta) out[k] = meta[k]
  return out
}

/** The synced part of a song's metadata (device-only keys and updatedAt removed). */
export function syncedMeta(meta: Record<string, unknown> | null): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(meta ?? {}) }
  for (const k of LOCAL_ONLY_META_KEYS) delete out[k]
  delete out.updatedAt
  return out
}

export function metaUpdatedAt(meta: Record<string, unknown> | null): number {
  const v = meta?.updatedAt
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}
