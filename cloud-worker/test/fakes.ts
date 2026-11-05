// Test doubles for the Worker's bindings: a D1 adapter over node:sqlite (so
// the real migration SQL runs) and an in-memory R2 bucket. Only the subset of
// each API that src/app.ts uses is implemented.
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Env } from '../src/env'
import { createApp } from '../src/app'
import type { Presigner } from '../src/presign'

class FakeStatement {
  private args: SQLInputValue[] = []
  constructor(
    private db: DatabaseSync,
    private sql: string
  ) {}
  bind(...args: unknown[]): FakeStatement {
    this.args = args as SQLInputValue[]
    return this
  }
  async first<T>(): Promise<T | null> {
    return (this.db.prepare(this.sql).get(...this.args) as T | undefined) ?? null
  }
  async all<T>(): Promise<{ results: T[] }> {
    return { results: this.db.prepare(this.sql).all(...this.args) as T[] }
  }
  async run(): Promise<{ meta: { changes: number } }> {
    const r = this.db.prepare(this.sql).run(...this.args)
    return { meta: { changes: Number(r.changes) } }
  }
}

export function createFakeD1(): D1Database {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(
    readFileSync(fileURLToPath(new URL('../migrations/0001_init.sql', import.meta.url)), 'utf-8')
  )
  return {
    prepare: (sql: string) => new FakeStatement(db, sql),
    async batch(stmts: FakeStatement[]) {
      db.exec('BEGIN')
      try {
        const out = []
        for (const s of stmts) out.push(await s.run())
        db.exec('COMMIT')
        return out
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
    }
  } as unknown as D1Database
}

export class FakeR2 {
  objects = new Map<string, string>()

  async head(key: string): Promise<{ size: number } | null> {
    const v = this.objects.get(key)
    return v === undefined ? null : { size: Buffer.byteLength(v) }
  }
  async get(key: string): Promise<{ json(): Promise<unknown> } | null> {
    const v = this.objects.get(key)
    return v === undefined ? null : { json: async () => JSON.parse(v) }
  }
  async put(key: string, value: string): Promise<void> {
    this.objects.set(key, value)
  }
  async delete(keys: string | string[]): Promise<void> {
    for (const k of Array.isArray(keys) ? keys : [keys]) this.objects.delete(k)
  }
  async list(opts: {
    prefix: string
    cursor?: string
  }): Promise<{ objects: { key: string }[]; truncated: boolean; cursor?: string }> {
    const all = [...this.objects.keys()].filter((k) => k.startsWith(opts.prefix)).sort()
    // Two-item pages, to exercise cursor handling.
    const start = opts.cursor ? Number(opts.cursor) : 0
    const page = all.slice(start, start + 2)
    const truncated = start + 2 < all.length
    return {
      objects: page.map((key) => ({ key })),
      truncated,
      cursor: truncated ? String(start + 2) : undefined
    }
  }
}

export const TOKEN = 'test-token-0123456789'

export interface Harness {
  env: Env
  r2: FakeR2
  call: (method: string, path: string, body?: unknown, token?: string | null) => Promise<Response>
}

/** Presigner stub: a recognizable fake URL instead of real S3 signing. */
export const fakePresign: Presigner = async (method, key) => `https://r2.test/${method}/${key}`

export function createHarness(): Harness {
  const r2 = new FakeR2()
  const env: Env = {
    BUCKET: r2 as unknown as R2Bucket,
    DB: createFakeD1(),
    R2_BUCKET_NAME: 'velody',
    API_TOKEN: TOKEN
  }
  const app = createApp(fakePresign)
  const call: Harness['call'] = (method, path, body, token = TOKEN) => {
    const headers: Record<string, string> = {}
    if (token !== null) headers.Authorization = `Bearer ${token}`
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    return app.fetch(
      new Request(`https://worker.test${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
      }),
      env
    )
  }
  return { env, r2, call }
}

export const SONG_ID = '11111111-2222-4333-8444-555555555555'
export const hash = (c: string): string => c.repeat(64)

/** Simulates the client PUTting a file to its presigned URL. */
export function putObject(r2: FakeR2, songId: string, name: string, size: number): void {
  r2.objects.set(`songs/${songId}/${name}`, 'x'.repeat(size))
}
