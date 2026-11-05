import { AwsClient } from 'aws4fetch'
import { PRESIGN_EXPIRES_SECONDS } from '../../src/shared/cloud'
import type { Env } from './env'

export type Presigner = (method: 'GET' | 'PUT', key: string) => Promise<string>

/** R2 object key → URL path, each segment percent-encoded (keys contain spaces etc.). */
function encodeKey(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/')
}

/**
 * Builds query-signed S3 URLs against R2's S3 endpoint, so clients transfer
 * bytes directly with R2 and the R2 credentials stay Worker secrets.
 */
export function createPresigner(env: Env): Presigner {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME } = env
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    return async () => {
      throw new Error('R2 S3 credentials are not configured on the Worker')
    }
  }
  const client = new AwsClient({
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
    service: 's3',
    region: 'auto'
  })
  return async (method, key) => {
    const url = new URL(
      `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET_NAME}/${encodeKey(key)}`
    )
    url.searchParams.set('X-Amz-Expires', String(PRESIGN_EXPIRES_SECONDS))
    const signed = await client.sign(new Request(url, { method }), { aws: { signQuery: true } })
    return signed.url
  }
}
