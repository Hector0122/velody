import { ipcMain, dialog, shell } from 'electron'
import { spawn, execSync, execFileSync } from 'child_process'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  mkdirSync,
  writeFileSync,
  existsSync,
  readdirSync,
  statSync,
  rmSync,
  mkdtempSync,
  readFileSync
} from 'fs'
import { SetupManager } from '../setup'

const STEM_NAMES = ['vocals', 'drums', 'bass', 'other', 'piano', 'guitar']

let setupManager: SetupManager | null = null

export function setSetupManager(mgr: SetupManager): void {
  setupManager = mgr
}

function getStemsRootDir(): string {
  return join(__dirname, '../../output/stems')
}

function getOutputDir(songPath: string): string {
  const songName =
    join(songPath)
      .split(/[/\\]/)
      .pop()
      ?.replace(/\.[^.]+$/, '') || 'untitled'
  return join(getStemsRootDir(), songName)
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

function saveOrigin(outDir: string, songPath: string): void {
  writeFileSync(join(outDir, '.origin'), songPath, 'utf-8')
}

function simulateSeparation(songPath: string): string[] {
  const outDir = getOutputDir(songPath)
  mkdirSync(outDir, { recursive: true })

  saveOrigin(outDir, songPath)

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

export interface SongItem {
  name: string
  stems: string[]
}

export function registerIpcHandlers(): void {
  ipcMain.handle('shell:openExternal', (_event, url: string) => shell.openExternal(url))

  ipcMain.handle('songs:list', (): SongItem[] => {
    const root = getStemsRootDir()
    if (!existsSync(root)) return []
    return readdirSync(root)
      .filter((entry) => statSync(join(root, entry)).isDirectory())
      .map((name) => {
        const dir = join(root, name)
        const stems = readdirSync(dir)
          .filter((f) => STEM_NAMES.some((s) => f.startsWith(s)))
          .map((f) => join(dir, f))
        return { name, stems }
      })
      .filter((s) => s.stems.length > 0)
      .sort((a, b) => b.name.localeCompare(a.name))
  })

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

  ipcMain.handle('song:delete', (_event, songName: string) => {
    const dir = join(getStemsRootDir(), songName)
    if (!existsSync(dir)) return { success: false, error: 'Song not found' }
    rmSync(dir, { recursive: true, force: true })
    return { success: true }
  })

  ipcMain.handle('song:saveMeta', (_event, songDir: string, meta: Record<string, unknown>) => {
    const metaPath = join(songDir, '.velody')
    writeFileSync(metaPath, JSON.stringify(meta), 'utf-8')
    return { success: true }
  })

  ipcMain.handle('song:loadMeta', (_event, songDir: string) => {
    const metaPath = join(songDir, '.velody')
    if (!existsSync(metaPath)) return null
    try {
      return JSON.parse(readFileSync(metaPath, 'utf-8'))
    } catch {
      return null
    }
  })

  ipcMain.handle(
    'song:detectKey',
    async (_event, songDir: string, stemPaths: string[]): Promise<string | null> => {
      const pythonPath = setupManager?.getPythonPath() ?? 'python3'
      const scriptPath = join(__dirname, '../../python-worker/detect_key.py')
      try {
        const out = execFileSync(pythonPath, [scriptPath, songDir, ...stemPaths], {
          cwd: join(__dirname, '../../python-worker'),
          encoding: 'utf-8'
        })
        const result = JSON.parse(out.trim())
        if (result.key) return result.key
        console.error('detect_key error:', result.error)
        return null
      } catch (err) {
        console.error('detect_key failed:', err)
        return null
      }
    }
  )

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
              const outDir = getOutputDir(songPath)
              saveOrigin(outDir, songPath)
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

  ipcMain.handle('dialog:openDirectory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle(
    'dialog:saveFile',
    async (_event, defaultName: string, filters: { name: string; extensions: string[] }[]) => {
      const result = await dialog.showSaveDialog({
        defaultPath: defaultName,
        filters:
          filters.length > 0
            ? filters
            : [{ name: 'Audio Files', extensions: ['wav', 'mp3', 'flac'] }]
      })
      if (result.canceled || !result.filePath) return null
      return result.filePath
    }
  )

  function generateClickTrackWav(
    filePath: string,
    bpm: number,
    durationSec: number,
    sampleRate = 44100
  ): void {
    const totalSamples = Math.floor(sampleRate * durationSec)
    const buf = Buffer.alloc(44 + totalSamples * 2)

    buf.write('RIFF', 0)
    buf.writeUInt32LE(36 + totalSamples * 2, 4)
    buf.write('WAVE', 8)
    buf.write('fmt ', 12)
    buf.writeUInt32LE(16, 16)
    buf.writeUInt16LE(1, 20)
    buf.writeUInt16LE(1, 22)
    buf.writeUInt32LE(sampleRate, 24)
    buf.writeUInt32LE(sampleRate * 2, 28)
    buf.writeUInt16LE(2, 32)
    buf.writeUInt16LE(16, 34)
    buf.write('data', 36)
    buf.writeUInt32LE(totalSamples * 2, 40)

    const beatInterval = 60 / bpm
    for (let i = 0; i < totalSamples; i++) {
      const t = i / sampleRate
      const beatNum = Math.round(t / beatInterval)
      const beatPos = t - beatNum * beatInterval
      const clickDur = beatNum % 4 === 0 ? 0.002 : 0.001
      const clickFreq = beatNum % 4 === 0 ? 1600 : 900
      let sample = 0
      if (beatPos < clickDur) {
        const phase = beatPos / clickDur
        sample = Math.sin(2 * Math.PI * clickFreq * beatPos) * (1 - phase)
        sample *= beatNum % 4 === 0 ? 0.5 : 0.3
      }
      const intSample = Math.max(-32768, Math.min(32767, Math.floor(sample * 32767)))
      buf.writeInt16LE(intSample, 44 + i * 2)
    }
    writeFileSync(filePath, buf)
  }

  function getLongestDuration(filePaths: string[]): number {
    let maxDur = 0
    for (const fp of filePaths) {
      try {
        const out = execSync(
          `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${fp}"`,
          { encoding: 'utf-8', timeout: 5000 }
        )
        const d = parseFloat(out.trim())
        if (d > maxDur) maxDur = d
      } catch {
        /* skip */
      }
    }
    return maxDur || 60
  }

  ipcMain.handle(
    'export:mix',
    async (_event, filePaths: string[], outputPath: string, options?: { bpm?: number }) => {
      const ffmpeg = setupManager?.getFfmpegPath() ?? 'ffmpeg'
      const allPaths = [...filePaths]

      if (options?.bpm) {
        const dur = getLongestDuration(filePaths)
        const tmpDir = mkdtempSync(join(tmpdir(), 'velody-click-'))
        const clickPath = join(tmpDir, 'click.wav')
        generateClickTrackWav(clickPath, options.bpm, Math.ceil(dur))
        allPaths.push(clickPath)
      }

      const count = allPaths.length
      if (count === 0) return { success: false, error: 'No files to mix' }

      const args: string[] = []
      for (const fp of allPaths) args.push('-i', fp)

      const inputs = allPaths.map((_, i) => `[${i}:a]`).join('')
      args.push(
        '-filter_complex',
        `${inputs}amix=inputs=${count}:duration=longest`,
        '-y',
        outputPath
      )

      return new Promise<{ success: boolean; error?: string }>((resolve) => {
        const proc = spawn(ffmpeg, args)
        let stderr = ''
        proc.stderr.on('data', (data: Buffer) => {
          stderr += data.toString()
        })
        proc.on('close', (code) => {
          if (options?.bpm) {
            const tmpDir = join(allPaths[allPaths.length - 1], '..')
            rmSync(tmpDir, { recursive: true, force: true })
          }
          if (code === 0) resolve({ success: true })
          else resolve({ success: false, error: stderr.slice(0, 500) })
        })
        proc.on('error', (err) => {
          if (options?.bpm) {
            const tmpDir = join(allPaths[allPaths.length - 1], '..')
            try {
              rmSync(tmpDir, { recursive: true, force: true })
            } catch {
              /* ignore */
            }
          }
          resolve({ success: false, error: err.message })
        })
      })
    }
  )

  ipcMain.handle(
    'record:save',
    async (_event, songDir: string, data: number[], name: string, format: string) => {
      const isMp3 = format === 'mp3'
      const ext = isMp3 ? '.mp3' : '.wav'
      const fileName = `${name}${ext}`
      const destPath = join(songDir, fileName)
      const tempPath = join(songDir, `_tmp_rec.wav`)
      writeFileSync(tempPath, Buffer.from(data))

      const ffmpeg = setupManager?.getFfmpegPath() ?? 'ffmpeg'
      const convArgs = isMp3
        ? ['-i', tempPath, '-c:a', 'libmp3lame', '-y', destPath]
        : ['-i', tempPath, '-y', destPath]

      return new Promise<{ success: boolean; path?: string; error?: string }>((resolve) => {
        const proc = spawn(ffmpeg, convArgs)
        proc.stderr.on('data', () => {})
        proc.on('close', (code) => {
          rmSync(tempPath, { force: true })
          if (code === 0) resolve({ success: true, path: destPath })
          else resolve({ success: false, error: 'Conversion failed' })
        })
        proc.on('error', (err) => {
          rmSync(tempPath, { force: true })
          resolve({ success: false, error: err.message })
        })
      })
    }
  )

  ipcMain.handle('export:single', async (_event, filePath: string, outputPath: string) => {
    const ffmpeg = setupManager?.getFfmpegPath() ?? 'ffmpeg'
    return new Promise<{ success: boolean; error?: string }>((resolve) => {
      const proc = spawn(ffmpeg, ['-i', filePath, '-y', outputPath])
      let stderr = ''
      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString()
      })
      proc.on('close', (code) => {
        if (code === 0) resolve({ success: true })
        else resolve({ success: false, error: stderr.slice(0, 500) })
      })
      proc.on('error', (err) => resolve({ success: false, error: err.message }))
    })
  })

  ipcMain.handle('stems:transpose', async (_event, stemPaths: string[], semitones: number) => {
    const outDir = join(stemPaths[0], '../../_transposed')
    const absDir = join(outDir)
    if (existsSync(absDir)) rmSync(absDir, { recursive: true, force: true })
    mkdirSync(absDir, { recursive: true })

    const ffmpeg = setupManager?.getFfmpegPath() ?? 'ffmpeg'
    const pitchFactor = Math.pow(2, semitones / 12)
    const newPaths: string[] = []

    for (const stemPath of stemPaths) {
      const name = stemPath.split(/[/\\]/).pop()
      const outPath = join(absDir, name!)
      newPaths.push(outPath)

      await new Promise<void>((resolve, reject) => {
        const proc = spawn(ffmpeg, [
          '-i',
          stemPath,
          '-af',
          `asetrate=44100*${pitchFactor},atempo=${1 / pitchFactor}`,
          '-ar',
          '44100',
          '-y',
          outPath
        ])
        proc.stderr.on('data', () => {})
        proc.on('close', (code) =>
          code === 0 ? resolve() : reject(new Error(`FFmpeg exit code ${code}`))
        )
        proc.on('error', reject)
      })
    }

    return newPaths
  })
}
