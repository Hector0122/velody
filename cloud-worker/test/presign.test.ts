import { describe, expect, it } from 'vitest'
import { createPresigner } from '../src/presign'
import type { Env } from '../src/env'

const env = {
  R2_BUCKET_NAME: 'velody',
  R2_ACCOUNT_ID: 'acc123',
  R2_ACCESS_KEY_ID: 'AKIDEXAMPLE',
  R2_SECRET_ACCESS_KEY: 'secret'
} as Env

describe('createPresigner', () => {
  it('signs a query-string URL for the object on the R2 S3 endpoint', async () => {
    const url = new URL(await createPresigner(env)('PUT', 'songs/abc/My Song (live).mp3'))
    expect(url.host).toBe('acc123.r2.cloudflarestorage.com')
    expect(url.pathname).toBe('/velody/songs/abc/My%20Song%20(live).mp3')
    expect(url.searchParams.get('X-Amz-Expires')).toBe('3600')
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/)
    expect(url.searchParams.get('X-Amz-Credential')).toContain('AKIDEXAMPLE')
    expect(url.toString()).not.toContain('secret')
  })

  it('fails clearly when S3 credentials are not configured', async () => {
    const p = createPresigner({ R2_BUCKET_NAME: 'velody' } as Env)
    await expect(p('GET', 'k')).rejects.toThrow(/not configured/)
  })
})
