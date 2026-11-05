// Single-user auth: one long random bearer token, set with
// `wrangler secret put API_TOKEN`. Both sides are hashed first so the byte
// comparison is constant-time regardless of the tokens' lengths.

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
}

export async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([sha256(a), sha256(b)])
  let diff = 0
  for (let i = 0; i < ha.length; i++) diff |= ha[i] ^ hb[i]
  return diff === 0
}

/** True when the request carries the configured token. No token configured → nobody gets in. */
export async function isAuthorized(
  request: Request,
  apiToken: string | undefined
): Promise<boolean> {
  if (!apiToken) return false
  const header = request.headers.get('Authorization') ?? ''
  const match = /^Bearer (.+)$/.exec(header)
  if (!match) return false
  return constantTimeEqual(match[1], apiToken)
}
