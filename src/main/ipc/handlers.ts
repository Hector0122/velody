import { ipcMain, dialog, shell, app } from 'electron'
import { spawn, execFile } from 'child_process'
import { join, dirname } from 'path'
import { tmpdir } from 'os'
import { createWriteStream } from 'fs'
import { mkdir, writeFile, readFile, rm, readdir, stat, mkdtemp, access } from 'fs/promises'
import { constants } from 'fs'
import { SetupManager } from '../setup'
import { JobManager } from '../jobs/JobManager'

const STEM_NAMES = ['vocals', 'drums', 'bass', 'other', 'piano', 'guitar']

let setupManager: SetupManager | null = null
let jobManager: JobManager | null = null

export function setSetupManager(mgr: SetupManager): void {
  setupManager = mgr
}

export function setJobManager(mgr: JobManager): void {
  jobManager = mgr
}

function getStemsRootDir(): string {
  if (app.isPackaged) {
    return join(app.getPath('userData'), 'output', 'stems')
  }
  return join(__dirname, '../../output/stems')
}

function getPythonWorkerDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'python-worker')
  }
  return join(__dirname, '../../python-worker')
}

function getFfprobePath(): string {
  const ffmpeg = setupManager?.getFfmpegPath()
  if (ffmpeg && ffmpeg !== 'ffmpeg') {
    const dir = dirname(ffmpeg)
    const bin = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'
    return join(dir, bin)
  }
  return 'ffprobe'
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

export interface SongItem {
  name: string
  stems: string[]
}

export function registerIpcHandlers(): void {
  ipcMain.handle('shell:openExternal', (_event, url: string) => shell.openExternal(url))

  ipcMain.handle('songs:list', async (): Promise<SongItem[]> => {
    const root = getStemsRootDir()
    if (!(await fileExists(root))) return []
    const entries = await readdir(root)
    const result: SongItem[] = []
    for (const entry of entries) {
      const dir = join(root, entry)
      const st = await stat(dir)
      if (!st.isDirectory()) continue
      const files = await readdir(dir)
      const stems = files
        .filter((f) => STEM_NAMES.some((s) => f.startsWith(s)))
        .map((f) => join(dir, f))
      if (stems.length > 0) result.push({ name: entry, stems })
    }
    result.sort((a, b) => b.name.localeCompare(a.name))
    return result
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

  ipcMain.handle('song:delete', async (_event, songName: string) => {
    const dir = join(getStemsRootDir(), songName)
    if (!(await fileExists(dir))) return { success: false, error: 'Song not found' }
    await rm(dir, { recursive: true, force: true })
    return { success: true }
  })

  ipcMain.handle(
    'song:saveMeta',
    async (_event, songDir: string, meta: Record<string, unknown>) => {
      const metaPath = join(songDir, '.velody')
      await writeFile(metaPath, JSON.stringify(meta), 'utf-8')
      return { success: true }
    }
  )

  ipcMain.handle('song:loadMeta', async (_event, songDir: string) => {
    const metaPath = join(songDir, '.velody')
    if (!(await fileExists(metaPath))) return null
    try {
      return JSON.parse(await readFile(metaPath, 'utf-8'))
    } catch {
      return null
    }
  })

  ipcMain.handle(
    'song:detectKey',
    async (_event, songDir: string, stemPaths: string[]): Promise<string | null> => {
      const pythonPath = setupManager?.getPythonPath() ?? 'python3'
      const scriptPath = join(getPythonWorkerDir(), 'detect_key.py')
      const ffmpegPath = setupManager?.getFfmpegPath() ?? 'ffmpeg'
      try {
        const out = await new Promise<string>((resolve, reject) => {
          execFile(
            pythonPath,
            [scriptPath, songDir, ...stemPaths, '--ffmpeg-path', ffmpegPath],
            { timeout: 600_000, maxBuffer: 65536 },
            (err, stdout) => (err ? reject(err) : resolve(stdout))
          )
        })
        const lines = out.trim().split('\n')
        const last = lines[lines.length - 1]
        const parsed = last ? JSON.parse(last.trim()) : null
        return parsed && typeof parsed.key === 'string' ? parsed.key : null
      } catch {
        return null
      }
    }
  )

  ipcMain.handle('separation:start', (_event, songPath: string) => {
    if (!jobManager) return { error: 'Job manager not ready' }
    const job = jobManager.enqueue(songPath)
    return { jobId: job.id, songName: job.songName }
  })

  ipcMain.handle('separation:cancel', (_event, jobId: string) => {
    if (!jobManager) return false
    return jobManager.cancel(jobId)
  })

  ipcMain.handle('separation:list', () => {
    if (!jobManager) return []
    return jobManager.getQueue()
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

  // Async click track generation — yields to event loop between chunks
  async function generateClickTrackWavAsync(
    filePath: string,
    bpm: number,
    durationSec: number,
    sampleRate = 44100
  ): Promise<void> {
    const totalSamples = Math.floor(sampleRate * durationSec)
    const beatInterval = 60 / bpm

    // Write WAV header
    const header = Buffer.alloc(44)
    header.write('RIFF', 0)
    header.writeUInt32LE(36 + totalSamples * 2, 4)
    header.write('WAVE', 8)
    header.write('fmt ', 12)
    header.writeUInt32LE(16, 16)
    header.writeUInt16LE(1, 20)
    header.writeUInt16LE(1, 22)
    header.writeUInt32LE(sampleRate, 24)
    header.writeUInt32LE(sampleRate * 2, 28)
    header.writeUInt16LE(2, 32)
    header.writeUInt16LE(16, 34)
    header.write('data', 36)
    header.writeUInt32LE(totalSamples * 2, 40)

    const writeStream = createWriteStream(filePath)
    writeStream.write(header)

    const CHUNK = 44100 // 1 second per chunk
    let offset = 0

    return new Promise<void>((resolve, reject) => {
      const processChunk = (): void => {
        const end = Math.min(offset + CHUNK, totalSamples)
        const len = end - offset
        const buf = Buffer.alloc(len * 2)

        for (let i = 0; i < len; i++) {
          const t = (offset + i) / sampleRate
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
          buf.writeInt16LE(intSample, i * 2)
        }

        writeStream.write(buf)
        offset = end

        if (offset < totalSamples) {
          setImmediate(processChunk)
        } else {
          writeStream.end()
          resolve()
        }
      }

      writeStream.on('error', reject)
      setImmediate(processChunk)
    })
  }

  async function getLongestDuration(filePaths: string[]): Promise<number> {
    let maxDur = 0
    for (const fp of filePaths) {
      try {
        const out = await new Promise<string>((resolve, reject) => {
          execFile(
            getFfprobePath(),
            [
              '-v',
              'error',
              '-show_entries',
              'format=duration',
              '-of',
              'default=noprint_wrappers=1:nokey=1',
              fp
            ],
            { timeout: 5000 },
            (err, stdout) => {
              if (err) reject(err)
              else resolve(stdout)
            }
          )
        })
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
        const dur = await getLongestDuration(filePaths)
        const tmpDir = await mkdtemp(join(tmpdir(), 'velody-click-'))
        const clickPath = join(tmpDir, 'click.wav')
        await generateClickTrackWavAsync(clickPath, options.bpm, Math.ceil(dur))
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
        const timeout = setTimeout(() => proc.kill('SIGTERM'), 600_000)
        let stderr = ''
        proc.stderr.on('data', (data: Buffer) => {
          stderr += data.toString()
        })
        proc.on('close', async (code) => {
          clearTimeout(timeout)
          if (options?.bpm) {
            const td = join(allPaths[allPaths.length - 1], '..')
            try {
              await rm(td, { recursive: true, force: true })
            } catch {
              /* ignore */
            }
          }
          if (code === 0) resolve({ success: true })
          else resolve({ success: false, error: stderr.slice(0, 500) })
        })
        proc.on('error', async (err) => {
          clearTimeout(timeout)
          if (options?.bpm) {
            const td = join(allPaths[allPaths.length - 1], '..')
            try {
              await rm(td, { recursive: true, force: true })
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
    async (
      _event,
      songDir: string,
      data: number[],
      name: string,
      format: string,
      offset: number
    ) => {
      const isMp3 = format === 'mp3'
      const ext = isMp3 ? '.mp3' : '.wav'
      const fileName = `${name}${ext}`
      const destPath = join(songDir, fileName)
      const tempPath = join(songDir, `_tmp_rec.wav`)
      await writeFile(tempPath, Buffer.from(data))

      const ffmpeg = setupManager?.getFfmpegPath() ?? 'ffmpeg'

      let ffmpegArgs: string[]
      if (offset > 0) {
        ffmpegArgs = [
          '-f',
          'lavfi',
          '-i',
          `anullsrc=r=44100:d=${offset}`,
          '-i',
          tempPath,
          '-filter_complex',
          '[0:a][1:a]concat=n=2:v=0:a=1',
          '-y',
          destPath
        ]
      } else {
        ffmpegArgs = ['-i', tempPath, '-y', destPath]
      }

      if (isMp3) {
        ffmpegArgs = [...ffmpegArgs.slice(0, -2), '-c:a', 'libmp3lame', ...ffmpegArgs.slice(-2)]
      }

      return new Promise<{ success: boolean; path?: string; error?: string }>((resolve) => {
        const proc = spawn(ffmpeg, ffmpegArgs)
        const timeout = setTimeout(() => proc.kill('SIGTERM'), 600_000)
        proc.stderr.on('data', () => {})
        proc.on('close', async (code) => {
          clearTimeout(timeout)
          try {
            await rm(tempPath, { force: true })
          } catch {
            /* ignore */
          }
          if (code === 0) resolve({ success: true, path: destPath })
          else resolve({ success: false, error: 'Conversion failed' })
        })
        proc.on('error', async (err) => {
          clearTimeout(timeout)
          try {
            await rm(tempPath, { force: true })
          } catch {
            /* ignore */
          }
          resolve({ success: false, error: err.message })
        })
      })
    }
  )

  ipcMain.handle('export:single', async (_event, filePath: string, outputPath: string) => {
    const ffmpeg = setupManager?.getFfmpegPath() ?? 'ffmpeg'
    return new Promise<{ success: boolean; error?: string }>((resolve) => {
      const proc = spawn(ffmpeg, ['-i', filePath, '-y', outputPath])
      const timeout = setTimeout(() => proc.kill('SIGTERM'), 600_000)
      let stderr = ''
      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString()
      })
      proc.on('close', (code) => {
        clearTimeout(timeout)
        if (code === 0) resolve({ success: true })
        else resolve({ success: false, error: stderr.slice(0, 500) })
      })
      proc.on('error', (err) => {
        clearTimeout(timeout)
        resolve({ success: false, error: err.message })
      })
    })
  })

  ipcMain.handle('file:delete', async (_event, filePath: string) => {
    if (await fileExists(filePath)) {
      await rm(filePath)
      return { success: true }
    }
    return { success: false, error: 'File not found' }
  })

  ipcMain.handle('stems:transpose', async (_event, stemPaths: string[], semitones: number) => {
    const baseDir = join(stemPaths[0], '../../_transposed')
    const suffix = semitones >= 0 ? `+${semitones}` : `${semitones}`
    const absDir = join(baseDir, suffix)
    await mkdir(absDir, { recursive: true })

    const ffmpeg = setupManager?.getFfmpegPath() ?? 'ffmpeg'
    const pitchFactor = Math.pow(2, semitones / 12)
    const newPaths: string[] = []

    for (const stemPath of stemPaths) {
      const name = stemPath.split(/[/\\]/).pop()
      const outPath = join(absDir, name!)
      newPaths.push(outPath)

      if (await fileExists(outPath)) continue // cache hit — skip FFmpeg

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
        const timeout = setTimeout(() => proc.kill('SIGTERM'), 600_000)
        proc.stderr.on('data', () => {})
        proc.on('close', (code) => {
          clearTimeout(timeout)
          code === 0 ? resolve() : reject(new Error(`FFmpeg exit code ${code}`))
        })
        proc.on('error', (err) => {
          clearTimeout(timeout)
          reject(err)
        })
      })
    }

    return newPaths
  })
}
