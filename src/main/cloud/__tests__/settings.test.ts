import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { CloudSettingsStore, normalizeCloudUrl, type SecretBox } from '../settings'

// Stand-in for Electron's safeStorage: reversible, but the output never
// contains the plain text.
function fakeBox(available = true): SecretBox {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (s) => Buffer.from([...Buffer.from(s)].map((b) => b ^ 0x5a)),
    decryptString: (b) => Buffer.from([...b].map((x) => x ^ 0x5a)).toString()
  }
}

const TOKEN = 'super-secret-token-value'
const URL_ = 'https://velody-cloud.example.workers.dev'

describe('CloudSettingsStore', () => {
  let dir: string
  let path: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'velody-cloud-settings-'))
    path = join(dir, 'cloud.json')
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('is disabled and inactive when never configured', async () => {
    const store = new CloudSettingsStore(path, fakeBox())
    expect(await store.view()).toEqual({
      url: '',
      enabled: false,
      hasToken: false,
      encryptionAvailable: true
    })
    expect(await store.active()).toBeNull()
  })

  it('never writes the plain token to disk and never exposes it in the view', async () => {
    const store = new CloudSettingsStore(path, fakeBox())
    const view = await store.save({ url: URL_, enabled: true, token: TOKEN })
    expect(JSON.stringify(view)).not.toContain(TOKEN)
    expect(view.hasToken).toBe(true)
    expect(await readFile(path, 'utf-8')).not.toContain(TOKEN)
    expect(await store.active()).toEqual({ url: URL_, token: TOKEN })
  })

  it('keeps the saved token when saving without one', async () => {
    const store = new CloudSettingsStore(path, fakeBox())
    await store.save({ url: URL_, enabled: true, token: TOKEN })
    await store.save({ url: URL_ + '/', enabled: true })
    expect(await store.active()).toEqual({ url: URL_, token: TOKEN })
  })

  it('is inactive while disabled, even when configured', async () => {
    const store = new CloudSettingsStore(path, fakeBox())
    await store.save({ url: URL_, enabled: false, token: TOKEN })
    expect(await store.active()).toBeNull()
    expect(await store.resolve()).toEqual({ url: URL_, token: TOKEN })
  })

  it('refuses to save a token when secure storage is unavailable', async () => {
    const store = new CloudSettingsStore(path, fakeBox(false))
    await expect(store.save({ url: URL_, enabled: true, token: TOKEN })).rejects.toThrow(
      /Secure storage/
    )
  })
})

describe('normalizeCloudUrl', () => {
  it('trims trailing slashes', () => {
    expect(normalizeCloudUrl(' https://a.dev/// ')).toBe('https://a.dev')
  })

  it('allows http only for this machine', () => {
    expect(normalizeCloudUrl('http://localhost:8787')).toBe('http://localhost:8787')
    expect(() => normalizeCloudUrl('http://example.com')).toThrow(/https/)
    expect(() => normalizeCloudUrl('not a url')).toThrow(/Invalid/)
  })
})
