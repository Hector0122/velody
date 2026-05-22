import { createServer } from 'http'
import { createReadStream, existsSync, statSync } from 'fs'
import { extname } from 'path'

const MIME_MAP: Record<string, string> = {
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg'
}

let server: ReturnType<typeof createServer> | null = null
let activePort = 0

export function startAudioServer(): Promise<number> {
  return new Promise((resolve) => {
    server = createServer(async (req, res) => {
      const filePath = decodeURIComponent(req.url?.slice(1) || '')
      const mime = MIME_MAP[extname(filePath).toLowerCase()] || 'audio/mpeg'

      if (!existsSync(filePath)) {
        res.writeHead(404)
        res.end('Not found')
        return
      }

      const stat = statSync(filePath)
      const fileSize = stat.size
      const rangeHeader = req.headers.range

      if (rangeHeader) {
        const parts = rangeHeader.replace(/bytes=/, '').split('-')
        const start = parseInt(parts[0], 10)
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1
        const chunkSize = end - start + 1

        res.writeHead(206, {
          'Content-Type': mime,
          'Content-Length': chunkSize,
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache'
        })
        createReadStream(filePath, { start, end }).pipe(res)
      } else {
        res.writeHead(200, {
          'Content-Type': mime,
          'Content-Length': fileSize,
          'Accept-Ranges': 'bytes',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache'
        })
        createReadStream(filePath).pipe(res)
      }
    })
    server.listen(0, '127.0.0.1', () => {
      activePort = (server!.address() as { port: number }).port
      resolve(activePort)
    })
  })
}

export function stopAudioServer(): void {
  server?.close()
  server = null
  activePort = 0
}

export function getAudioPort(): number {
  return activePort
}

export function audioUrl(filePath: string): string {
  return `http://127.0.0.1:${activePort}/${encodeURI(filePath)}`
}
