import { createServer } from 'http'
import { readFile } from 'fs/promises'
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
      try {
        const data = await readFile(filePath)
        res.writeHead(200, {
          'Content-Type': mime,
          'Content-Length': data.length,
          'Access-Control-Allow-Origin': '*',
          'Accept-Ranges': 'bytes'
        })
        res.end(data)
      } catch {
        res.writeHead(404)
        res.end('Not found')
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
