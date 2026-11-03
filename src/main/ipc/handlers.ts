import { ipcMain, dialog, shell, app, BrowserWindow } from 'electron'
import { spawn, execFile } from 'child_process'
import { join, dirname } from 'path'
import { tmpdir } from 'os'
import { createWriteStream } from 'fs'
import { writeFile, readFile, rm, readdir, stat, mkdtemp, access, rename } from 'fs/promises'
import { constants } from 'fs'
import crypto from 'crypto'
import { SetupManager } from '../setup'
import { JobManager } from '../jobs/JobManager'
import { getStemsRootDir } from '../paths'
import type { StemBitrate } from '../../shared/types'

interface BpmDetectionResult {
  bpm: number
  firstBeatOffset: number
  beatTimes: number[]
}

let bpmDetectionRunning: Promise<BpmDetectionResult | null> | null = null
// Separate singleflight guard for hint-based redetection (see
// add-tempo-octave-correction) — kept independent from bpmDetectionRunning
// above so a correction redetect for one song can't return the wrong
// song's normal-detection result (or vice versa) if both happen to be
// in flight at once. Also lower-risk to run concurrently with a normal
// detection than two normal detections are with each other: the hint path
// skips TempoCNN/TensorFlow entirely (the actual OOM risk on low-RAM
// machines — see CLAUDE.md), it's just librosa's beat tracker.
let bpmRedetectionRunning: Promise<BpmDetectionResult | null> | null = null

const STEM_NAMES = ['vocals', 'drums', 'bass', 'other', 'piano', 'guitar']

let setupManager: SetupManager | null = null
let jobManager: JobManager | null = null

export function setSetupManager(mgr: SetupManager): void {
  setupManager = mgr
}

export function setJobManager(mgr: JobManager): void {
  jobManager = mgr
}

// Pure FFmpeg trim-arg builders, extracted for direct unit testing (same
// rationale as scanSongsLibrary above) — see openspec/changes/
// add-song-trim-points. `-ss` before an input is a fast input-side seek;
// duration (`-t`) rather than an absolute end-time (`-to`) is used on the
// output side so the clip length is unambiguous regardless of how many
// individually `-ss`'d inputs are combined (export:mix has one per stem).
export function trimInputArgs(trimStart?: number): string[] {
  return trimStart && trimStart > 0 ? ['-ss', String(trimStart)] : []
}

export function trimOutputArgs(trimStart?: number, trimEnd?: number): string[] {
  if (trimEnd == null) return []
  const duration = Math.max(0, trimEnd - (trimStart ?? 0))
  return ['-t', String(duration)]
}

// Raw-PCM equivalent of the renderer's Web-Audio 'woodblock' click
// (clickPresets.ts) — see openspec/changes/add-metronome-click-sounds and
// simplify-metronome-to-woodblock-only. No Web Audio API exists in the main
// process, so the click is synthesized directly as a sample value at
// `beatPos` (seconds since the last beat). The frequency sweep uses a
// simple linear freq(t)*t approximation rather than a true chirp's phase
// integral — an acceptable simplification for a <30ms transient. Kept
// independent from the renderer's ClickPreset type rather than shared — the
// two implementations (Web Audio vs. raw PCM) are unrelated code with no
// common runtime.
type ClickTrackPreset = 'woodblock'

// `beatPos` is a *signed* offset from the nearest beat (see the caller:
// `t - Math.round(t / beatInterval) * beatInterval`), so it's negative for
// roughly the second half of every beat interval (samples closer to the
// *next* beat than the previous one). Requires `beatPos >= 0` in addition
// to the upper bound — omitting the lower bound (a bug present in the
// original pre-add-metronome-click-sounds math, fixed here rather than
// preserved) would otherwise trigger the click branch across that entire
// negative half with an unbounded, clipping `(1 - phase)` envelope for very
// negative `beatPos`. Tone + noise-burst gain balance matches the
// renderer's woodblock (see clickPresets.ts's `woodblock`/`playNoiseBurst`
// — a boosted-gain-only tone still read as too soft/dull to cut through a
// live mix, so a brief noise transient was added and the budget rebalanced
// between the two rather than just raising raw gain further) so an
// exported mix's baked-in click matches what's heard live.
export function clickSampleValue(beatPos: number, accent: boolean): number {
  const decay = 0.03
  let sample = 0
  if (beatPos >= 0 && beatPos < decay) {
    const [start, end] = accent ? [900, 500] : [650, 400]
    const freq = start + (end - start) * (beatPos / decay)
    sample = Math.sin(2 * Math.PI * freq * beatPos) * (1 - beatPos / decay) * (accent ? 0.7 : 0.55)
  }
  const noiseDur = 0.005
  if (beatPos >= 0 && beatPos < noiseDur) {
    sample += (Math.random() * 2 - 1) * (1 - beatPos / noiseDur) * (accent ? 0.3 : 0.2)
  }
  return sample
}

// Named setlists — ordered references to library songs by name (never a
// copy of song data; the library scan via scanSongsLibrary remains the
// single source of truth for what a song's stems actually are). See
// openspec/changes/add-song-setlists.
export interface Setlist {
  id: string
  name: string
  songNames: string[]
  updatedAt: number
}

function getSetlistsPath(): string {
  return join(dirname(getStemsRootDir()), 'setlists.json')
}

// setlistsPath is a parameter (not read from getSetlistsPath() internally)
// so these are directly unit-testable against a temp file, matching
// scanSongsLibrary's own testability rationale above.
export async function readSetlists(setlistsPath: string): Promise<Setlist[]> {
  try {
    const raw = await readFile(setlistsPath, 'utf-8')
    const parsed = JSON.parse(raw)
    if (!parsed || !Array.isArray(parsed.setlists)) return []
    return parsed.setlists
  } catch {
    // Missing file or corrupted JSON — treat as "no setlists yet" rather
    // than throwing.
    return []
  }
}

// Atomic write: serialize to a temp file in the same directory, then
// rename over the target. A crash mid-write can only ever leave the stale
// temp file behind, never a half-written setlists.json.
export async function writeSetlists(setlistsPath: string, setlists: Setlist[]): Promise<void> {
  const tmpPath = `${setlistsPath}.tmp-${crypto.randomUUID()}`
  await writeFile(tmpPath, JSON.stringify({ setlists }), 'utf-8')
  await rename(tmpPath, setlistsPath)
}

// Pure pruning logic for song:delete's setlist cleanup, extracted for
// direct unit testing (same rationale as scanSongsLibrary above) — a
// deleted song's name is removed from every setlist's songNames; setlists
// that never referenced it come back unchanged (same object reference),
// which the caller uses to skip writing back when nothing changed.
export function pruneSongFromSetlists(
  setlists: Setlist[],
  songName: string
): { pruned: Setlist[]; changed: boolean } {
  let changed = false
  const pruned = setlists.map((sl) => {
    if (!sl.songNames.includes(songName)) return sl
    changed = true
    return { ...sl, songNames: sl.songNames.filter((n) => n !== songName) }
  })
  return { pruned, changed }
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

// Extracted from the IPC handler so it's directly unit-testable without
// mocking Electron's ipcMain — the handler below is a thin wrapper over this.
const STEM_BITRATES: readonly StemBitrate[] = [128, 192, 320]

// Renderer input — only pass through a bitrate separate.py actually accepts.
function validBitrate(v: unknown): StemBitrate | undefined {
  return STEM_BITRATES.includes(v as StemBitrate) ? (v as StemBitrate) : undefined
}

export async function scanSongsLibrary(root: string): Promise<SongItem[]> {
  if (!(await fileExists(root))) return []
  const entries = await readdir(root)
  // Each entry's stat+readdir is independent of every other entry's, so scan
  // them concurrently instead of one at a time — total time is then bounded
  // by the slowest single directory rather than the sum of all of them.
  const scanned = await Promise.all(
    entries.map(async (entry): Promise<SongItem | null> => {
      const dir = join(root, entry)
      const st = await stat(dir)
      if (!st.isDirectory()) return null
      const files = await readdir(dir)
      const stems = files
        .filter((f) => STEM_NAMES.some((s) => f.startsWith(s)))
        .map((f) => join(dir, f))
      if (stems.length === 0) return null
      return { name: entry, stems }
    })
  )
  const result = scanned.filter((item): item is SongItem => item !== null)
  result.sort((a, b) => b.name.localeCompare(a.name))
  return result
}

export function registerIpcHandlers(): void {
  ipcMain.handle('shell:openExternal', (_event, url: string) => shell.openExternal(url))

  ipcMain.handle('songs:list', async (): Promise<SongItem[]> => {
    return scanSongsLibrary(getStemsRootDir())
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

    // Prune the deleted song from every setlist that referenced it, so
    // deleting a song is atomic from the user's perspective — no dangling
    // reference left for the setlists UI to render awkwardly.
    const setlistsPath = getSetlistsPath()
    const { pruned, changed } = pruneSongFromSetlists(await readSetlists(setlistsPath), songName)
    if (changed) await writeSetlists(setlistsPath, pruned)

    return { success: true }
  })

  ipcMain.handle('setlists:list', async (): Promise<Setlist[]> => {
    return readSetlists(getSetlistsPath())
  })

  ipcMain.handle('setlists:save', async (_event, setlist: Setlist): Promise<Setlist> => {
    const setlistsPath = getSetlistsPath()
    const setlists = await readSetlists(setlistsPath)
    const toSave: Setlist = { ...setlist, updatedAt: Date.now() }
    const idx = setlists.findIndex((sl) => sl.id === toSave.id)
    const next =
      idx === -1 ? [...setlists, toSave] : setlists.map((sl, i) => (i === idx ? toSave : sl))
    await writeSetlists(setlistsPath, next)
    return toSave
  })

  ipcMain.handle('setlists:delete', async (_event, id: string): Promise<{ success: boolean }> => {
    const setlistsPath = getSetlistsPath()
    const setlists = await readSetlists(setlistsPath)
    await writeSetlists(
      setlistsPath,
      setlists.filter((sl) => sl.id !== id)
    )
    return { success: true }
  })

  ipcMain.handle(
    'song:saveMeta',
    async (_event, songDir: string, meta: Record<string, unknown>) => {
      const metaPath = join(songDir, '.velody')
      let existing: Record<string, unknown> = {}
      try {
        const raw = await readFile(metaPath, 'utf-8')
        existing = JSON.parse(raw)
      } catch {
        /* file doesn't exist or invalid JSON */
      }
      await writeFile(metaPath, JSON.stringify({ ...existing, ...meta }), 'utf-8')
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

  // `bpmHint`, when given, is threaded through as --bpm-hint — used by
  // add-tempo-octave-correction to re-run librosa's beat tracker with a
  // known-correct tempo as an explicit prior (finding real onset-aligned
  // beat positions at that tempo) instead of TempoCNN's own estimate. See
  // detect_bpm.py.
  async function runDetectBpm(
    stemPath: string,
    bpmHint?: number
  ): Promise<BpmDetectionResult | null> {
    const pythonPath = setupManager?.getPythonPath() ?? 'python3'
    const scriptPath = join(getPythonWorkerDir(), 'detect_bpm.py')
    const ffmpegPath = setupManager?.getFfmpegPath() ?? 'ffmpeg'
    const args = [scriptPath, stemPath, '--ffmpeg-path', ffmpegPath]
    if (typeof bpmHint === 'number') args.push('--bpm-hint', String(bpmHint))
    try {
      const out = await new Promise<string>((resolve, reject) => {
        execFile(pythonPath, args, { timeout: 600_000, maxBuffer: 65536 }, (err, stdout) =>
          err ? reject(err) : resolve(stdout)
        )
      })
      const lines = out.trim().split('\n')
      const last = lines[lines.length - 1]
      const parsed = last ? JSON.parse(last.trim()) : null
      if (parsed && typeof parsed.bpm === 'number' && typeof parsed.firstBeatOffset === 'number') {
        // beatTimes is new; default to [] so an older script build (or any
        // unexpected shape) degrades to "no grid" rather than breaking.
        const beatTimes = Array.isArray(parsed.beatTimes) ? parsed.beatTimes : []
        return { bpm: parsed.bpm, firstBeatOffset: parsed.firstBeatOffset, beatTimes }
      }
      return null
    } catch (err) {
      console.error('[detectBpm]', err)
      return null
    }
  }

  ipcMain.handle(
    'song:detectBpm',
    async (_event, stemPath: string, bpmHint?: number): Promise<BpmDetectionResult | null> => {
      if (typeof bpmHint === 'number') {
        if (bpmRedetectionRunning) return bpmRedetectionRunning
        bpmRedetectionRunning = runDetectBpm(stemPath, bpmHint).finally(() => {
          bpmRedetectionRunning = null
        })
        return bpmRedetectionRunning
      }

      if (bpmDetectionRunning) return bpmDetectionRunning
      bpmDetectionRunning = runDetectBpm(stemPath).finally(() => {
        bpmDetectionRunning = null
      })
      return bpmDetectionRunning
    }
  )

  ipcMain.handle('separation:start', (_event, songPath: string, bitrate?: number) => {
    if (!jobManager) return { error: 'Job manager not ready' }
    const job = jobManager.enqueue(songPath, { bitrate: validBitrate(bitrate) })
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
          const sample = clickSampleValue(beatPos, beatNum % 4 === 0)
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
      } catch (err) {
        console.error('[song:getDuration]', err)
      }
    }
    return maxDur || 60
  }

  ipcMain.handle(
    'export:mix',
    async (
      _event,
      filePaths: string[],
      outputPath: string,
      options?: {
        bpm?: number
        trimStart?: number
        trimEnd?: number
        clickPreset?: ClickTrackPreset
      }
    ) => {
      const ffmpeg = setupManager?.getFfmpegPath() ?? 'ffmpeg'
      const allPaths = [...filePaths]

      if (options?.bpm) {
        const dur = await getLongestDuration(filePaths)
        const tmpDir = await mkdtemp(join(tmpdir(), 'velody-click-'))
        const clickPath = join(tmpDir, 'click.wav')
        // options.clickPreset accepted for forward-compat (there's only one
        // click sound today — see simplify-metronome-to-woodblock-only) but
        // not threaded through: generateClickTrackWavAsync/clickSampleValue
        // have only the one behavior.
        await generateClickTrackWavAsync(clickPath, options.bpm, Math.ceil(dur))
        allPaths.push(clickPath)
      }

      const count = allPaths.length
      if (count === 0) return { success: false, error: 'No files to mix' }

      // Every input gets the same -ss so all stems (and the synthesized
      // click track, if present) stay time-aligned once seeked.
      const args: string[] = []
      for (const fp of allPaths) args.push(...trimInputArgs(options?.trimStart), '-i', fp)

      const inputs = allPaths.map((_, i) => `[${i}:a]`).join('')
      args.push(
        '-filter_complex',
        `${inputs}amix=inputs=${count}:duration=longest`,
        ...trimOutputArgs(options?.trimStart, options?.trimEnd),
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
              console.warn('[export:mix] temp dir cleanup failed')
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
              console.warn('[export:mix] temp dir cleanup failed')
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
      const tempPath = join(songDir, `_tmp_rec_${crypto.randomUUID()}.wav`)
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
            console.warn('[record:save] temp file cleanup failed')
          }
          if (code === 0) resolve({ success: true, path: destPath })
          else resolve({ success: false, error: 'Conversion failed' })
        })
        proc.on('error', async (err) => {
          clearTimeout(timeout)
          try {
            await rm(tempPath, { force: true })
          } catch {
            console.warn('[record:save] temp file cleanup failed')
          }
          resolve({ success: false, error: err.message })
        })
      })
    }
  )

  ipcMain.handle(
    'export:single',
    async (
      _event,
      filePath: string,
      outputPath: string,
      options?: { trimStart?: number; trimEnd?: number }
    ) => {
      const ffmpeg = setupManager?.getFfmpegPath() ?? 'ffmpeg'
      const args = [
        ...trimInputArgs(options?.trimStart),
        '-i',
        filePath,
        ...trimOutputArgs(options?.trimStart, options?.trimEnd),
        '-y',
        outputPath
      ]
      return new Promise<{ success: boolean; error?: string }>((resolve) => {
        const proc = spawn(ffmpeg, args)
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
    }
  )

  ipcMain.handle('file:delete', async (_event, filePath: string) => {
    if (await fileExists(filePath)) {
      await rm(filePath)
      return { success: true }
    }
    return { success: false, error: 'File not found' }
  })

  ipcMain.handle('url:updateYtDlp', async () => {
    const pythonPath = setupManager?.getPythonPath() ?? 'python3'
    try {
      const { ok, stderr } = await new Promise<{ ok: boolean; stderr: string }>((resolve) => {
        execFile(
          pythonPath,
          ['-m', 'pip', 'install', '-U', 'yt-dlp'],
          { timeout: 120_000 },
          (err, _stdout, stderr) => resolve({ ok: !err, stderr: err?.message ?? stderr })
        )
      })
      return { success: ok, error: ok ? undefined : stderr.slice(0, 500) }
    } catch (e) {
      return { success: false, error: String(e).slice(0, 500) }
    }
  })

  ipcMain.handle('url:import', async (_event, url: string, bitrate?: number) => {
    const pythonPath = setupManager?.getPythonPath() ?? 'python3'
    const scriptPath = join(getPythonWorkerDir(), 'download.py')
    const ffmpegPath = setupManager?.getFfmpegPath() ?? 'ffmpeg'

    const downloadResult = await new Promise<{ path: string; title: string }>((resolve, reject) => {
      const proc = spawn(pythonPath, [scriptPath, url, '--ffmpeg-path', ffmpegPath], {
        cwd: getPythonWorkerDir()
      })

      const jobId = `dl-${Date.now()}`
      let title = 'Untitled'
      let stderr = ''
      let settled = false

      const broadcastFailed = (msg: string): void => {
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) {
            win.webContents.send('url:download-failed', { jobId, error: msg })
          }
        }
      }

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true
          proc.kill('SIGTERM')
          broadcastFailed('Download timed out')
          reject(new Error('Download timed out'))
        }
      }, 600_000)

      proc.stdout.on('data', (data: Buffer) => {
        const lines = data.toString().trim().split('\n')
        for (const line of lines) {
          if (!line) continue
          try {
            const parsed = JSON.parse(line)
            if (parsed.type === 'metadata') {
              title = parsed.title || title
            } else if (parsed.type === 'progress') {
              for (const win of BrowserWindow.getAllWindows()) {
                if (!win.isDestroyed()) {
                  win.webContents.send('url:download-progress', {
                    jobId,
                    percent: parsed.percent,
                    title
                  })
                }
              }
            } else if (parsed.type === 'complete' && !settled) {
              settled = true
              clearTimeout(timeout)
              resolve({ path: parsed.path, title: parsed.title || title })
            } else if (parsed.type === 'error' && !settled) {
              settled = true
              clearTimeout(timeout)
              broadcastFailed(parsed.message)
              reject(new Error(parsed.message))
            }
          } catch {
            // non-JSON output, ignore
          }
        }
      })

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString()
      })

      proc.on('close', (code) => {
        if (!settled) {
          settled = true
          clearTimeout(timeout)
          if (code !== 0) {
            const msg = `Download process failed (code ${code}): ${stderr.slice(0, 300)}`
            broadcastFailed(msg)
            reject(new Error(msg))
          }
        }
      })

      proc.on('error', (err) => {
        if (!settled) {
          settled = true
          clearTimeout(timeout)
          broadcastFailed(err.message)
          reject(err)
        }
      })
    })

    if (!jobManager) return { error: 'Job manager not ready' }
    // download.py writes into its own velody_dl_* temp dir; let the job delete it when done.
    const job = jobManager.enqueue(downloadResult.path, {
      tempDir: dirname(downloadResult.path),
      bitrate: validBitrate(bitrate)
    })
    return { jobId: job.id, songName: downloadResult.title || job.songName }
  })
}
