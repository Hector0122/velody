// Typed client for the cloud Worker API (src/shared/cloud.ts) plus raw
// transfers against presigned R2 URLs. Retries only network failures,
// timeouts and 5xx — never 4xx, which won't change on retry.
import {
  CLOUD_API_PREFIX,
  type ApiError,
  type CommitResponse,
  type DownloadResponse,
  type ListSongsResponse,
  type MetaResponse,
  type PutMetaRequest,
  type UploadBeginRequest,
  type UploadBeginResponse
} from '../../shared/cloud'

export class CloudApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: ApiError
  ) {
    super(message)
    this.name = 'CloudApiError'
  }
}

export type PutMetaResult =
  | { ok: true; updatedAt: number }
  | { ok: false; current: MetaResponse | null }

/** Everything the sync engine needs from the cloud (faked in tests). */
export interface CloudApi {
  health(): Promise<void>
  listSongs(): Promise<ListSongsResponse>
  beginUpload(id: string, req: UploadBeginRequest): Promise<UploadBeginResponse>
  commit(id: string): Promise<CommitResponse>
  download(id: string): Promise<DownloadResponse>
  getMeta(id: string): Promise<MetaResponse | null>
  putMeta(id: string, req: PutMetaRequest): Promise<PutMetaResult>
  deleteSong(id: string): Promise<void>
  putFile(url: string, data: Buffer): Promise<void>
  getFile(url: string): Promise<Buffer>
}

export interface CloudClientOptions {
  baseUrl: string
  token: string
  fetch?: typeof fetch
  timeoutMs?: number
  /** Timeout for a single file transfer (stems are a few MB). */
  transferTimeoutMs?: number
  retries?: number
  retryDelayMs?: number
}

const isRetryableStatus = (s: number): boolean => s >= 500

function describeNetworkError(err: unknown): string {
  if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
    return 'The cloud did not respond in time'
  }
  return `Cannot reach the cloud (${err instanceof Error ? err.message : String(err)})`
}

export class CloudClient implements CloudApi {
  private readonly fetchImpl: typeof fetch
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly transferTimeoutMs: number
  private readonly retries: number
  private readonly retryDelayMs: number

  constructor(private readonly opts: CloudClientOptions) {
    this.fetchImpl = opts.fetch ?? fetch
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '') + CLOUD_API_PREFIX
    this.timeoutMs = opts.timeoutMs ?? 15_000
    this.transferTimeoutMs = opts.transferTimeoutMs ?? 120_000
    this.retries = opts.retries ?? 2
    this.retryDelayMs = opts.retryDelayMs ?? 500
  }

  /** fetch with timeout + retry on network errors and 5xx. */
  private async send(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    let lastError: unknown
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (attempt > 0)
        await new Promise((r) => setTimeout(r, this.retryDelayMs * 2 ** (attempt - 1)))
      try {
        const res = await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
        if (isRetryableStatus(res.status) && attempt < this.retries) {
          lastError = new CloudApiError(`Cloud error ${res.status}`, res.status)
          continue
        }
        return res
      } catch (err) {
        lastError = err
      }
    }
    if (lastError instanceof CloudApiError) throw lastError
    throw new CloudApiError(describeNetworkError(lastError), 0)
  }

  private async api<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.send(
      this.baseUrl + path,
      {
        method,
        headers: {
          Authorization: `Bearer ${this.opts.token}`,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
        },
        body: body !== undefined ? JSON.stringify(body) : undefined
      },
      this.timeoutMs
    )
    let parsed: unknown = null
    try {
      parsed = await res.json()
    } catch {
      /* non-JSON body */
    }
    if (!res.ok) {
      const errBody = (parsed ?? undefined) as ApiError | undefined
      const message =
        res.status === 401 ? 'Invalid cloud token' : (errBody?.error ?? `Cloud error ${res.status}`)
      throw new CloudApiError(message, res.status, errBody)
    }
    return parsed as T
  }

  async health(): Promise<void> {
    await this.api('GET', '/health')
  }

  listSongs(): Promise<ListSongsResponse> {
    return this.api('GET', '/songs')
  }

  beginUpload(id: string, req: UploadBeginRequest): Promise<UploadBeginResponse> {
    return this.api('POST', `/songs/${id}/upload`, req)
  }

  commit(id: string): Promise<CommitResponse> {
    return this.api('POST', `/songs/${id}/commit`)
  }

  download(id: string): Promise<DownloadResponse> {
    return this.api('GET', `/songs/${id}/download`)
  }

  async getMeta(id: string): Promise<MetaResponse | null> {
    try {
      return await this.api<MetaResponse>('GET', `/songs/${id}/meta`)
    } catch (err) {
      if (err instanceof CloudApiError && err.status === 404) return null
      throw err
    }
  }

  async putMeta(id: string, req: PutMetaRequest): Promise<PutMetaResult> {
    try {
      const r = await this.api<{ updatedAt: number }>('PUT', `/songs/${id}/meta`, req)
      return { ok: true, updatedAt: r.updatedAt }
    } catch (err) {
      if (err instanceof CloudApiError && err.status === 409) {
        const b = err.body as Partial<MetaResponse> | undefined
        const current =
          b && typeof b.updatedAt === 'number' && b.meta
            ? { meta: b.meta, updatedAt: b.updatedAt }
            : null
        return { ok: false, current }
      }
      throw err
    }
  }

  async deleteSong(id: string): Promise<void> {
    await this.api('DELETE', `/songs/${id}`)
  }

  async putFile(url: string, data: Buffer): Promise<void> {
    const res = await this.send(
      url,
      {
        method: 'PUT',
        headers: { 'Content-Length': String(data.length) },
        body: new Uint8Array(data)
      },
      this.transferTimeoutMs
    )
    if (!res.ok) throw new CloudApiError(`Upload to storage failed (${res.status})`, res.status)
  }

  async getFile(url: string): Promise<Buffer> {
    const res = await this.send(url, { method: 'GET' }, this.transferTimeoutMs)
    if (!res.ok) throw new CloudApiError(`Download from storage failed (${res.status})`, res.status)
    return Buffer.from(await res.arrayBuffer())
  }
}
