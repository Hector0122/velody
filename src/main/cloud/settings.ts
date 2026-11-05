// Cloud settings: Worker URL + enabled flag + personal token, in
// <userData>/cloud.json. The token is encrypted with the OS credential store
// (Electron safeStorage) and never returned to the renderer — the renderer
// only ever sees CloudSettingsView.
import { readFile, rename, writeFile } from 'fs/promises'
import type { CloudSettingsInput, CloudSettingsView } from '../../shared/cloud'

/** The subset of Electron's safeStorage used here (injectable for tests). */
export interface SecretBox {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(encrypted: Buffer): string
}

interface StoredSettings {
  url: string
  enabled: boolean
  /** base64 of safeStorage.encryptString(token) */
  tokenEnc?: string
}

const EMPTY: StoredSettings = { url: '', enabled: false }

/** https only, except plain http to this machine (for `wrangler dev`). */
export function normalizeCloudUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error('Invalid URL')
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new Error('The cloud URL must use https://')
  }
  return trimmed
}

export class CloudSettingsStore {
  constructor(
    private readonly path: string,
    private readonly box: SecretBox
  ) {}

  private async read(): Promise<StoredSettings> {
    try {
      const raw = JSON.parse(await readFile(this.path, 'utf-8'))
      return {
        url: typeof raw.url === 'string' ? raw.url : '',
        enabled: raw.enabled === true,
        tokenEnc: typeof raw.tokenEnc === 'string' ? raw.tokenEnc : undefined
      }
    } catch {
      return { ...EMPTY }
    }
  }

  private async write(s: StoredSettings): Promise<void> {
    const tmp = `${this.path}.${process.pid}.tmp`
    await writeFile(tmp, JSON.stringify(s), { encoding: 'utf-8', mode: 0o600 })
    await rename(tmp, this.path)
  }

  private toView(s: StoredSettings): CloudSettingsView {
    return {
      url: s.url,
      enabled: s.enabled,
      hasToken: !!s.tokenEnc,
      encryptionAvailable: this.box.isEncryptionAvailable()
    }
  }

  async view(): Promise<CloudSettingsView> {
    return this.toView(await this.read())
  }

  async save(input: CloudSettingsInput): Promise<CloudSettingsView> {
    const current = await this.read()
    const next: StoredSettings = {
      url: normalizeCloudUrl(input.url),
      enabled: !!input.enabled,
      tokenEnc: current.tokenEnc
    }
    const token = input.token?.trim()
    if (token) {
      if (!this.box.isEncryptionAvailable()) {
        throw new Error('Secure storage is not available on this system; the token cannot be saved')
      }
      next.tokenEnc = this.box.encryptString(token).toString('base64')
    }
    await this.write(next)
    return this.toView(next)
  }

  /** URL + token for a test call, using an unsaved token when given. */
  async resolve(override?: { url?: string; token?: string }): Promise<{
    url: string
    token: string
  } | null> {
    const s = await this.read()
    const url = override?.url !== undefined ? normalizeCloudUrl(override.url) : s.url
    const token = override?.token?.trim() || this.decrypt(s.tokenEnc)
    return url && token ? { url, token } : null
  }

  /** URL + token when cloud sync is enabled and fully configured, else null. */
  async active(): Promise<{ url: string; token: string } | null> {
    const s = await this.read()
    if (!s.enabled) return null
    const token = this.decrypt(s.tokenEnc)
    return s.url && token ? { url: s.url, token } : null
  }

  private decrypt(enc: string | undefined): string | null {
    if (!enc || !this.box.isEncryptionAvailable()) return null
    try {
      return this.box.decryptString(Buffer.from(enc, 'base64'))
    } catch {
      return null
    }
  }
}
