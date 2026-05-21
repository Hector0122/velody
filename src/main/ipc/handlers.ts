import { ipcMain, dialog } from 'electron'
import { spawn } from 'child_process'
import { join } from 'path'
import { mkdirSync, writeFileSync, existsSync } from 'fs'
import { SetupManager } from '../setup'

const STEM_NAMES = ['vocals', 'drums', 'bass', 'other']

let setupManager: SetupManager | null = null

export function setSetupManager(mgr: SetupManager): void {
  setupManager = mgr
}

function getOutputDir(songPath: string): string {
  const songName =
    join(songPath)
      .split(/[/\\]/)
      .pop()
      ?.replace(/\.[^.]+$/, '') || 'untitled'
  return join(__dirname, '../../output/stems', songName)
}

function generateWav(
  filePath: string,
  frequency: number,
  durationSec: number,
  sampleRate = 44100
): void {
  const numSamples = Math.floor(sampleRate * durationSec)
  const buffer = Buffer.alloc(44 + numSamples * 2)

  // RIFF header
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + numSamples * 2, 4)
  buffer.write('WAVE', 8)

  // fmt subchunk
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16) // subchunk size
  buffer.writeUInt16LE(1, 20) // PCM format
  buffer.writeUInt16LE(1, 22) // mono
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28) // byte rate
  buffer.writeUInt16LE(2, 32) // block align
  buffer.writeUInt16LE(16, 34) // bits per sample

  // data subchunk
  buffer.write('data', 36)
  buffer.writeUInt32LE(numSamples * 2, 40)

  // Write samples
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate
    let sample = Math.sin(2 * Math.PI * frequency * t)

    // Add harmonics for richer sound
    sample += 0.3 * Math.sin(2 * Math.PI * frequency * 2 * t)
    sample += 0.1 * Math.sin(2 * Math.PI * frequency * 3 * t)

    // Normalize
    sample *= 0.5

    const intSample = Math.max(-32768, Math.min(32767, Math.floor(sample * 32767)))
    buffer.writeInt16LE(intSample, 44 + i * 2)
  }

  writeFileSync(filePath, buffer)
}

const STEM_CONFIG: Record<string, { freq: number; duration: number }> = {
  vocals: { freq: 440, duration: 60 },
  drums: { freq: 180, duration: 60 },
  bass: { freq: 110, duration: 60 },
  other: { freq: 660, duration: 60 }
}

function findExistingStem(outDir: string, name: string): string | null {
  for (const ext of ['.mp3', '.wav', '.flac', '.m4a']) {
    const p = join(outDir, `${name}${ext}`)
    if (existsSync(p)) return p
  }
  return null
}

function simulateSeparation(songPath: string): string[] {
  const outDir = getOutputDir(songPath)
  mkdirSync(outDir, { recursive: true })

  return STEM_NAMES.map((name) => {
    // Reuse real stems if they already exist (from a previous demucs run)
    const existing = findExistingStem(outDir, name)
    if (existing) return existing

    // Fallback: generate a fake sine-wave stem
    const config = STEM_CONFIG[name] || { freq: 440, duration: 15 }
    const wavPath = join(outDir, `${name}.wav`)
    generateWav(wavPath, config.freq, config.duration)
    return wavPath
  })
}

export function registerIpcHandlers(): void {
  ipcMain.handle('dialog:openFile', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Audio Files', extensions: ['wav', 'mp3', 'flac', 'm4a', 'ogg'] }]
    })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    return result.filePaths[0]
  })

  ipcMain.handle('separation:start', async (_event, songPath: string) => {
    const useRealDemucs = setupManager?.canUseRealDemucs() ?? false

    if (useRealDemucs) {
      const pythonPath = setupManager?.getPythonPath() ?? 'python3'
      const pythonScript = join(__dirname, '../../python-worker/separate.py')
      const pythonProcess = spawn(pythonPath, [pythonScript, songPath], {
        cwd: join(__dirname, '../../python-worker')
      })

      return new Promise<string[]>((resolve, reject) => {
        let output = ''

        pythonProcess.stdout.on('data', (data: Buffer) => {
          output += data.toString().trim()
        })

        pythonProcess.stderr.on('data', (data: Buffer) => {
          console.error(`Python error: ${data}`)
        })

        pythonProcess.on('close', (code) => {
          if (code === 0) {
            try {
              const stems = JSON.parse(output) as string[]
              resolve(stems)
            } catch {
              reject(new Error('Failed to parse Python output'))
            }
          } else {
            reject(new Error(`Python process exited with code ${code}`))
          }
        })

        pythonProcess.on('error', (err) => {
          reject(err)
        })
      })
    }

    return simulateSeparation(songPath)
  })
}
