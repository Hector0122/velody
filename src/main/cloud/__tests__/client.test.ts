import { describe, it, expect, vi } from 'vitest'
import { CloudApiError, CloudClient } from '../client'

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function client(fetchMock: ReturnType<typeof vi.fn>): CloudClient {
  return new CloudClient({
    baseUrl: 'https://w.dev/',
    token: 'tok',
    fetch: fetchMock as unknown as typeof fetch,
    retries: 2,
    retryDelayMs: 1
  })
}

describe('CloudClient', () => {
  it('sends the bearer token to the versioned path', async () => {
    const f = vi.fn().mockResolvedValue(json({ songs: [] }))
    await client(f).listSongs()
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('https://w.dev/v1/songs')
    expect(init.headers.Authorization).toBe('Bearer tok')
  })

  it('retries network errors and 5xx, then succeeds', async () => {
    const f = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(json({ error: 'boom' }, 503))
      .mockResolvedValueOnce(json({ ok: true }))
    await client(f).health()
    expect(f).toHaveBeenCalledTimes(3)
  })

  it('gives up after the retry budget with a readable error', async () => {
    const f = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    await expect(client(f).health()).rejects.toThrow(/Cannot reach the cloud/)
    expect(f).toHaveBeenCalledTimes(3)
  })

  it('does not retry a 401 and reports an invalid token', async () => {
    const f = vi.fn().mockResolvedValue(json({ error: 'Unauthorized' }, 401))
    const err = await client(f)
      .health()
      .catch((e) => e)
    expect(err).toBeInstanceOf(CloudApiError)
    expect(err.status).toBe(401)
    expect(err.message).toBe('Invalid cloud token')
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('surfaces the API error body (e.g. missing files on commit)', async () => {
    const f = vi
      .fn()
      .mockResolvedValue(json({ error: 'Some files are missing', missing: ['a.mp3'] }, 409))
    const err = await client(f)
      .commit('id')
      .catch((e) => e)
    expect(err.body.missing).toEqual(['a.mp3'])
  })

  it('maps a missing metadata document to null', async () => {
    const f = vi.fn().mockResolvedValue(json({ error: 'No metadata' }, 404))
    expect(await client(f).getMeta('id')).toBeNull()
  })

  it('maps a stale metadata write to { ok: false, current }', async () => {
    const f = vi
      .fn()
      .mockResolvedValue(json({ error: 'newer', meta: { bpm: 1 }, updatedAt: 9 }, 409))
    expect(await client(f).putMeta('id', { meta: {}, updatedAt: 1 })).toEqual({
      ok: false,
      current: { meta: { bpm: 1 }, updatedAt: 9 }
    })
  })

  it('PUTs file bytes with a Content-Length and no auth header', async () => {
    const f = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    await client(f).putFile('https://r2/presigned', Buffer.from('abc'))
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('https://r2/presigned')
    expect(init.headers['Content-Length']).toBe('3')
    expect(init.headers.Authorization).toBeUndefined()
  })
})
