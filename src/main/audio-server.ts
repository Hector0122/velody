import { createServer } from 'http'
import { createReadStream, existsSync, statSync } from 'fs'
import { extname, resolve, join, sep } from 'path'

const MIME_MAP: Record<string, string> = {
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg'
}

let server: ReturnType<typeof createServer> | null = null
let activePort = 0
let stemsRootDir = ''

function isPathSafe(filePath: string): boolean {
  if (!stemsRootDir) return false
  const resolved = resolve(filePath)
  const root = resolve(stemsRootDir)
  return resolved.startsWith(root + sep) || resolved === root
}

export function startAudioServer(): Promise<number> {
  return new Promise((resolvePort) => {
    stemsRootDir = resolve(join(__dirname, '../../output/stems'))

    server = createServer((req, res) => {
      // Handle CORS preflight
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Range',
          'Access-Control-Max-Age': '86400'
        })
        res.end()
        return
      }

      const rawPath = decodeURIComponent(req.url?.slice(1) || '')
      const filePath = resolve(stemsRootDir, rawPath)

      if (!isPathSafe(filePath) || !existsSync(filePath)) {
        res.writeHead(404)
        res.end('Not found')
        return
      }

      const mime = MIME_MAP[extname(filePath).toLowerCase()] || 'audio/mpeg'
      const stat = statSync(filePath)
      const fileSize = stat.size
      const rangeHeader = req.headers.range

      const headers: Record<string, string | number> = {
        'Content-Type': mime,
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache'
      }

      if (rangeHeader) {
        const parts = rangeHeader.replace(/bytes=/, '').split('-')
        const start = parseInt(parts[0], 10)
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1
        const chunkSize = end - start + 1

        res.writeHead(206, {
          ...headers,
          'Content-Length': chunkSize,
          'Content-Range': `bytes ${start}-${end}/${fileSize}`
        })
        createReadStream(filePath, { start, end }).pipe(res)
      } else {
        res.writeHead(200, {
          ...headers,
          'Content-Length': fileSize
        })
        createReadStream(filePath).pipe(res)
      }
    })

    server.listen(0, '127.0.0.1', () => {
      activePort = (server!.address() as { port: number }).port
      resolvePort(activePort)
    })
  })
}

export function stopAudioServer(): void {
  server?.close()
  server = null
  activePort = 0
  stemsRootDir = ''
}

export function getAudioPort(): number {
  return activePort
}

export function audioUrl(filePath: string): string {
  return `http://127.0.0.1:${activePort}/${encodeURI(filePath)}`
}
