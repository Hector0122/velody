import { protocol } from 'electron'
import { readFile } from 'fs/promises'
import { extname } from 'path'

const MIME_MAP: Record<string, string> = {
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.aac': 'audio/aac',
  '.wma': 'audio/x-ms-wma'
}

export function registerAudioProtocol(): void {
  protocol.handle('velody', async (request) => {
    const filePath = decodeURIComponent(request.url.replace('velody://', ''))
    try {
      const data = await readFile(filePath)
      const mime = MIME_MAP[extname(filePath).toLowerCase()] || 'audio/mpeg'
      return new Response(data, {
        status: 200,
        headers: { 'Content-Type': mime }
      })
    } catch {
      return new Response('File not found', { status: 404 })
    }
  })
}

export function toAudioUrl(filePath: string): string {
  return `velody://${filePath}`
}
