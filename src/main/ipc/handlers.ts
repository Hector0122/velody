import { ipcMain, dialog, BrowserWindow } from 'electron'
import { spawn, execFile } from 'child_process'
import { createInterface } from 'readline'
import { join, dirname } from 'path'
import { tmpdir } from 'os'
import { writeFile, readFile, rm, readdir, stat, mkdtemp, access, rename } from 'fs/promises'
import { constants } from 'fs'
import crypto from 'crypto'
import { SetupManager } from '../setup'
import { JobManager } from '../jobs/JobManager'
import { getPythonWorkerDir, getStemsRootDir, isInsideDir, openExternalUrl } from '../paths'
import { SerialTaskQueue } from '../taskQueue'
import { readMeta, updateMeta } from '../songMeta'
import {
  ANALYSIS_CACHE_VERSION,
  needsAnalysis,
  pickBeatTrackingStem,
  trackerOf,
  validChords,
  STEM_NAMES
} from '../../shared/analysis'
import type { BpmDetectionResult, SongItem, StemBitrate } from '../../shared/types'

// One BPM detection at a time (each one holds PyTorch models and the song's
// mix in RAM, ~1.4 GB; several at once OOM low-RAM machines — see CLAUDE.md), deduplicated per stem+hint, and the
// song the user opens (high priority) jumps ahead of background analysis.
const detectionQueue = new SerialTaskQueue<BpmDetectionResult | null>()

// .velody access lives in ../songMeta (shared with cloud sync); re-exported
// so existing imports keep working.
export { updateMeta }

// Set once handlers are registered; see requestLibraryAnalysis.
let startLibraryAnalysis: (() => void) | null = null
// Set once Beat This! is known to be installed: songs analyzed without it are redone.
let redoFallbacks = false

/**
 * Analyze (BPM, beat grid, downbeat) every library song that doesn't have a
 * current analysis yet, one at a time in the background, so songs open
 * instantly. Pauses while a separation is running; a song the user opens
 * meanwhile jumps the queue. `beatThisReady` also redoes songs whose grid
 * was made without Beat This! (see trackerOf).
 */
export function requestLibraryAnalysis(beatThisReady = false): void {
  if (beatThisReady) redoFallbacks = true
  startLibraryAnalysis?.()
}

let setupManager: SetupManager | null = null
let jobManager: JobManager | null = null

export function setSetupManager(mgr: SetupManager): void {
  setupManager = mgr
}

export function setJobManager(mgr: JobManager): void {
  jobManager = mgr
}

let libraryLister: (() => Promise<SongItem[]>) | null = null

/** Lets cloud sync decorate `songs:list` (set from index.ts — avoids an import cycle). */
export function setLibraryLister(fn: () => Promise<SongItem[]>): void {
  libraryLister = fn
}

/** Removes a deleted song from every setlist that referenced it. */
export async function pruneDeletedSong(songName: string): Promise<void> {
  const setlistsPath = getSetlistsPath()
  const { pruned, changed } = pruneSongFromSetlists(await readSetlists(setlistsPath), songName)
  if (changed) await writeSetlists(setlistsPath, pruned)
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

// `beatPos` is the offset from the click's time; anything outside [0, 30 ms)
// is silence. Tone + noise-burst gain balance matches the renderer's
// woodblock (clickPresets.ts) so an exported click sounds like the live one.
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

export type { SongItem }

// Extracted from the IPC handler so it's directly unit-testable without
// mocking Electron's ipcMain — the handler below is a thin wrapper over this.
const STEM_BITRATES: readonly StemBitrate[] = [128, 192, 320]

// Renderer input — only pass through a bitrate separate.py actually accepts.
function validBitrate(v: unknown): StemBitrate | undefined {
  return STEM_BITRATES.includes(v as StemBitrate) ? (v as StemBitrate) : undefined
}

export async function scanSongsLibrary(root: string): Promise<SongItem[]> {
  if (!(await fileExists(root))) return []
  // Dot-prefixed entries are never songs (e.g. `.velody_dl_*`, a cloud
  // download in progress, renamed into place only once complete).
  const entries = (await readdir(root)).filter((e) => !e.startsWith('.'))
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
  ipcMain.handle('shell:openExternal', (_event, url: string) => openExternalUrl(url))

  ipcMain.handle('songs:list', async (): Promise<SongItem[]> => {
    // With cloud sync on, the list also carries cloud-only songs and each
    // song's sync state (src/main/cloud/sync.ts).
    return libraryLister ? libraryLister() : scanSongsLibrary(getStemsRootDir())
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
    // Renderer input: never delete outside the library (or the library itself).
    if (!isInsideDir(dir, getStemsRootDir()) || !(await fileExists(dir))) {
      return { success: false, error: 'Song not found' }
    }
    await rm(dir, { recursive: true, force: true })

    // Prune the deleted song from every setlist that referenced it, so
    // deleting a song is atomic from the user's perspective — no dangling
    // reference left for the setlists UI to render awkwardly.
    await pruneDeletedSong(songName)

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
      await updateMeta(songDir, meta)
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
  // beat positions at that tempo) instead of detecting the tempo. See
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
        execFile(pythonPath, args, { timeout: 600_000, maxBuffer: 1024 * 1024 }, (err, stdout) =>
          err ? reject(err) : resolve(stdout)
        )
      })
      const lines = out.trim().split('\n')
      const last = lines[lines.length - 1]
      const parsed = last ? JSON.parse(last.trim()) : null
      // bpm <= 0 is a failed detection — never hand it on (it would be cached
      // and break the metronome's 60/bpm math).
      if (
        parsed &&
        typeof parsed.bpm === 'number' &&
        parsed.bpm > 0 &&
        typeof parsed.firstBeatOffset === 'number'
      ) {
        // beatTimes is new; default to [] so an older script build (or any
        // unexpected shape) degrades to "no grid" rather than breaking.
        const beatTimes = Array.isArray(parsed.beatTimes) ? parsed.beatTimes : []
        const result: BpmDetectionResult = {
          bpm: parsed.bpm,
          firstBeatOffset: parsed.firstBeatOffset,
          beatTimes
        }
        if (parsed.tracker === 'beat_this') result.tracker = 'beat_this'
        const chords = validChords(parsed.chords)
        if (chords) result.chords = chords
        if (Number.isInteger(parsed.downbeatShift)) {
          result.downbeatShift = parsed.downbeatShift
          result.downbeatConfidence =
            typeof parsed.downbeatConfidence === 'number' ? parsed.downbeatConfidence : undefined
        }
        return result
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
      return detectionQueue.run(
        `${stemPath}|${bpmHint ?? ''}`,
        () => runDetectBpm(stemPath, bpmHint),
        'high'
      )
    }
  )

  let analysisRunning = false
  let analysisRequested = false
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

  async function analyzeLibrary(): Promise<void> {
    analysisRunning = true
    try {
      while (analysisRequested) {
        analysisRequested = false
        const root = getStemsRootDir()
        for (const song of await scanSongsLibrary(root)) {
          const songDir = join(root, song.name)
          const stem = pickBeatTrackingStem(song.stems)
          if (!stem || !needsAnalysis(await readMeta(songDir), redoFallbacks)) continue
          // Don't compete with Demucs for the GPU/CPU/RAM.
          while (jobManager?.isBusy()) await sleep(5000)
          // Re-check: the user may have opened (and analyzed) it meanwhile.
          if (!needsAnalysis(await readMeta(songDir), redoFallbacks)) continue
          const result = await detectionQueue
            .run(`${stem}|`, () => runDetectBpm(stem), 'low')
            .catch(() => null)
          // Like the renderer, only successful detections are cached.
          if (!result) continue
          await updateMeta(songDir, {
            bpm: result.bpm,
            firstBeatOffset: result.firstBeatOffset,
            beatTimes: result.beatTimes,
            detectedDownbeatShift: result.downbeatShift,
            tracker: trackerOf(result),
            chords: result.chords,
            _version: ANALYSIS_CACHE_VERSION
          })
        }
      }
    } catch (err) {
      console.error('[libraryAnalysis]', err)
    } finally {
      analysisRunning = false
    }
  }

  startLibraryAnalysis = (): void => {
    analysisRequested = true
    if (!analysisRunning) void analyzeLibrary()
  }

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

  // The metronome as a mono 16-bit WAV: silence with a click at each of the
  // renderer's click times (metronomeClicks — the same grid as the live one).
  async function writeClickTrackWav(
    filePath: string,
    clicks: { time: number; accent: boolean }[],
    durationSec: number,
    sampleRate = 44100
  ): Promise<void> {
    const totalSamples = Math.floor(sampleRate * durationSec)
    const clickSamples = Math.ceil(sampleRate * 0.03) // clickSampleValue's 30 ms decay
    const wav = Buffer.alloc(44 + totalSamples * 2)
    wav.write('RIFF', 0)
    wav.writeUInt32LE(36 + totalSamples * 2, 4)
    wav.write('WAVE', 8)
    wav.write('fmt ', 12)
    wav.writeUInt32LE(16, 16)
    wav.writeUInt16LE(1, 20)
    wav.writeUInt16LE(1, 22)
    wav.writeUInt32LE(sampleRate, 24)
    wav.writeUInt32LE(sampleRate * 2, 28)
    wav.writeUInt16LE(2, 32)
    wav.writeUInt16LE(16, 34)
    wav.write('data', 36)
    wav.writeUInt32LE(totalSamples * 2, 40)
    for (const { time, accent } of clicks) {
      const first = Math.ceil(time * sampleRate)
      for (let i = Math.max(0, first); i < Math.min(totalSamples, first + clickSamples); i++) {
        const sample = clickSampleValue(i / sampleRate - time, accent)
        wav.writeInt16LE(Math.max(-32768, Math.min(32767, Math.floor(sample * 32767))), 44 + i * 2)
      }
    }
    await writeFile(filePath, wav)
  }

  async function getLongestDuration(filePaths: string[]): Promise<number> {
    const durations = await Promise.all(
      filePaths.map(
        (fp) =>
          new Promise<number>((resolve) => {
            execFile(
              getFfprobePath(),
              ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', fp],
              { timeout: 5000 },
              (err, stdout) => {
                if (err) console.error('[song:getDuration]', err)
                resolve(err ? 0 : parseFloat(stdout.trim()) || 0)
              }
            )
          })
      )
    )
    return Math.max(0, ...durations) || 60
  }

  // Runs FFmpeg (10 min limit); the error is the end of its stderr, where
  // FFmpeg puts the actual failure (the start is just its version banner).
  function runFfmpeg(args: string[]): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      const proc = spawn(setupManager?.getFfmpegPath() ?? 'ffmpeg', args)
      const timeout = setTimeout(() => proc.kill('SIGTERM'), 600_000)
      let stderr = ''
      proc.stderr.on('data', (data: Buffer) => {
        stderr = (stderr + data.toString()).slice(-2000)
      })
      proc.on('close', (code) => {
        clearTimeout(timeout)
        resolve(code === 0 ? { success: true } : { success: false, error: stderr.slice(-500) })
      })
      proc.on('error', (err) => {
        clearTimeout(timeout)
        resolve({ success: false, error: err.message })
      })
    })
  }

  ipcMain.handle(
    'export:mix',
    async (
      _event,
      filePaths: string[],
      outputPath: string,
      options?: {
        clicks?: { time: number; accent: boolean }[]
        trimStart?: number
        trimEnd?: number
      }
    ) => {
      if (filePaths.length === 0) return { success: false, error: 'No files to mix' }
      const allPaths = [...filePaths]
      let tmpDir: string | null = null
      try {
        // Renderer input: keep only well-formed click times.
        const clicks = Array.isArray(options?.clicks)
          ? options.clicks.filter((c) => Number.isFinite(c?.time) && c.time >= 0)
          : []
        if (clicks.length > 0) {
          const dur = await getLongestDuration(filePaths)
          tmpDir = await mkdtemp(join(tmpdir(), 'velody-click-'))
          const clickPath = join(tmpDir, 'click.wav')
          await writeClickTrackWav(clickPath, clicks, Math.ceil(dur))
          allPaths.push(clickPath)
        }

        // Every input gets the same -ss so all stems (and the synthesized
        // click track, if present) stay time-aligned once seeked.
        const args: string[] = []
        for (const fp of allPaths) args.push(...trimInputArgs(options?.trimStart), '-i', fp)
        const inputs = allPaths.map((_, i) => `[${i}:a]`).join('')
        args.push(
          '-filter_complex',
          `${inputs}amix=inputs=${allPaths.length}:duration=longest`,
          ...trimOutputArgs(options?.trimStart, options?.trimEnd),
          '-y',
          outputPath
        )
        return await runFfmpeg(args)
      } finally {
        if (tmpDir) await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
      }
    }
  )

  ipcMain.handle(
    'record:save',
    async (
      _event,
      songDir: string,
      data: Uint8Array,
      name: string,
      format: string,
      offset: number
    ) => {
      const isMp3 = format === 'mp3'
      const destPath = join(songDir, `${name}${isMp3 ? '.mp3' : '.wav'}`)
      // Renderer input: recordings only ever go into a song folder.
      if (!isInsideDir(destPath, getStemsRootDir())) {
        return { success: false, error: 'Invalid destination' }
      }
      const tempPath = join(songDir, `_tmp_rec_${crypto.randomUUID()}.wav`)
      // The take starts `offset` seconds into the song: prepend that much silence.
      const input =
        offset > 0
          ? ['-f', 'lavfi', '-i', `anullsrc=r=44100:d=${offset}`, '-i', tempPath]
          : ['-i', tempPath]
      const filter = offset > 0 ? ['-filter_complex', '[0:a][1:a]concat=n=2:v=0:a=1'] : []
      const codec = isMp3 ? ['-c:a', 'libmp3lame'] : []
      try {
        await writeFile(tempPath, data)
        const result = await runFfmpeg([...input, ...filter, ...codec, '-y', destPath])
        return result.success ? { success: true, path: destPath } : result
      } finally {
        await rm(tempPath, { force: true }).catch(() => {})
      }
    }
  )

  ipcMain.handle(
    'export:single',
    async (
      _event,
      filePath: string,
      outputPath: string,
      options?: { trimStart?: number; trimEnd?: number }
    ) =>
      runFfmpeg([
        ...trimInputArgs(options?.trimStart),
        '-i',
        filePath,
        ...trimOutputArgs(options?.trimStart, options?.trimEnd),
        '-y',
        outputPath
      ])
  )

  ipcMain.handle('file:delete', async (_event, filePath: string) => {
    if (isInsideDir(filePath, getStemsRootDir()) && (await fileExists(filePath))) {
      await rm(filePath)
      return { success: true }
    }
    return { success: false, error: 'File not found' }
  })

  async function updateYtDlpPackage(): Promise<{ success: boolean; error?: string }> {
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
  }

  ipcMain.handle('url:updateYtDlp', () => updateYtDlpPackage())

  ipcMain.handle('url:import', async (_event, url: string, bitrate?: number) => {
    const pythonPath = setupManager?.getPythonPath() ?? 'python3'
    const scriptPath = join(getPythonWorkerDir(), 'download.py')
    const ffmpegPath = setupManager?.getFfmpegPath() ?? 'ffmpeg'

    const jobId = `dl-${Date.now()}`
    const notifyFailed = (msg: string): void => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send('url:download-failed', { jobId, error: msg })
        }
      }
    }

    // `final`: whether a failure of this attempt is reported to the UI (the
    // first attempt stays quiet if it may still be retried).
    const attempt = (final: boolean): Promise<{ path: string; title: string }> =>
      new Promise<{ path: string; title: string }>((resolve, reject) => {
        const proc = spawn(pythonPath, [scriptPath, url, '--ffmpeg-path', ffmpegPath], {
          cwd: getPythonWorkerDir()
        })

        let title = 'Untitled'
        let stderr = ''
        let settled = false

        const broadcastFailed = (msg: string): void => {
          if (final || !msg.includes('[UPDATE_YTDLP]')) notifyFailed(msg)
        }

        const timeout = setTimeout(() => {
          if (!settled) {
            settled = true
            proc.kill('SIGTERM')
            broadcastFailed('Download timed out')
            reject(new Error('Download timed out'))
          }
        }, 600_000)

        // Line by line: a JSON message can arrive split across two stdout chunks.
        createInterface({ input: proc.stdout }).on('line', (line) => {
          if (!line.trim()) return
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
        })

        proc.stderr.on('data', (data: Buffer) => {
          stderr += data.toString()
        })

        proc.on('close', (code) => {
          if (!settled) {
            settled = true
            clearTimeout(timeout)
            // Exiting without a complete/error message is a failure too (even
            // with code 0) — otherwise the import would wait forever.
            const msg = `Download process failed (code ${code}): ${stderr.slice(0, 300)}`
            broadcastFailed(msg)
            reject(new Error(msg))
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

    // YouTube changes break old yt-dlp versions. When download.py says so,
    // update yt-dlp in the venv and retry once before giving up.
    let downloadResult: { path: string; title: string }
    try {
      downloadResult = await attempt(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (!message.includes('[UPDATE_YTDLP]')) throw err
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send('url:download-progress', {
            jobId,
            percent: 0,
            title: 'Updating yt-dlp…'
          })
        }
      }
      const updated = await updateYtDlpPackage()
      if (!updated.success) {
        notifyFailed(message)
        throw err
      }
      downloadResult = await attempt(true)
    }

    if (!jobManager) return { error: 'Job manager not ready' }
    // download.py writes into its own velody_dl_* temp dir; let the job delete it when done.
    const job = jobManager.enqueue(downloadResult.path, {
      tempDir: dirname(downloadResult.path),
      bitrate: validBitrate(bitrate)
    })
    return { jobId: job.id, songName: downloadResult.title || job.songName }
  })
}
