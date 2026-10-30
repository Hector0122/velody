#!/usr/bin/env node
/**
 * Velody batch importer.
 *
 * Reads a text file of YouTube / YouTube Music URLs and, for each pending row,
 * downloads it and separates it into stems using the same python-worker scripts
 * the app itself uses (`download.py` -> `separate.py`), writing into the same
 * `output/stems/<song>/` layout the app already scans -- so processed songs just
 * show up in the library next time the app is opened.
 *
 * Supports two input shapes:
 *   - Tab-separated spreadsheet rows: `#\tTitle\tArtist\tURL[\tstatus]`
 *     (this is the shape produced by pasting a spreadsheet into a .txt file).
 *   - Plain one-URL-per-line files.
 * Header rows and blank rows are skipped automatically.
 *
 * Resumable: after each row, the script writes an outcome (`OK` or
 * `ERROR: <message>`) back into that row's status column and rewrites the file
 * immediately, so interrupting (Ctrl+C, crash, closed terminal) loses at most the
 * song in progress. Re-running the script:
 *   - skips any row whose status column is already non-empty and not `ERROR...`
 *     (this also respects any status the user wrote by hand, e.g. "Listo"),
 *   - retries any row still marked `ERROR...`,
 *   - and additionally skips a row outright if its computed output folder already
 *     contains stem files on disk, regardless of what the status column says.
 *
 * This script deliberately does NOT run BPM/key detection -- that stays a lazy,
 * on-demand step the app performs the first time a song is opened.
 *
 * Usage:
 *   node scripts/batch-import.mjs [links-file] [--output-dir <dir>]
 *
 * Defaults:
 *   links-file    links.txt (in the current working directory)
 *   --output-dir  <repo>/output/stems
 */

import { spawn } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  renameSync
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')
const PYTHON_WORKER_DIR = join(REPO_ROOT, 'python-worker')

// ---------------------------------------------------------------------------
// Path resolution -- ported from src/main/setup/index.ts (SetupManager).
// Kept in sync manually; see design.md "Decisions" for why this isn't imported.
// ---------------------------------------------------------------------------

const isWin = process.platform === 'win32'
const DATA_DIR = join(homedir(), '.local', 'share', 'velody')
const VENV_PYTHON = join(
  DATA_DIR,
  'venv',
  isWin ? 'Scripts' : 'bin',
  isWin ? 'python.exe' : 'python3'
)
const FFMPEG_BIN = join(DATA_DIR, 'ffmpeg', 'bin', isWin ? 'ffmpeg.exe' : 'ffmpeg')

function getPythonPath() {
  if (existsSync(VENV_PYTHON)) return VENV_PYTHON
  return isWin ? 'python' : 'python3'
}

function getFfmpegPath() {
  if (existsSync(FFMPEG_BIN)) return FFMPEG_BIN
  return 'ffmpeg'
}

const DEFAULT_STEMS_OUTPUT_DIR = join(REPO_ROOT, 'output', 'stems')
const DEFAULT_VIDEO_OUTPUT_DIR = join(REPO_ROOT, 'output', 'videos')
const STEM_NAMES = ['vocals', 'drums', 'bass', 'other', 'piano', 'guitar']
const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.webm']
const DOWNLOAD_TIMEOUT_MS = 600_000 // matches url:import's timeout in src/main/ipc/handlers.ts
const SEPARATE_TIMEOUT_MS = 600_000 // matches JobManager.runDemucs's timeout
const INTER_SONG_DELAY_MS = 5_000 // brief pause between downloads to avoid YouTube rate limiting

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

// ---------------------------------------------------------------------------
// Links file parsing
// ---------------------------------------------------------------------------

const URL_PATTERN = /https?:\/\/(?:www\.|music\.)?(?:youtube\.com\/watch\?v=[\w-]+|youtu\.be\/[\w-]+)\S*/i

/**
 * Parse the links file into raw lines (for later rewriting) plus structured rows.
 * Handles both the spreadsheet-pasted tab-separated shape and plain URL lines.
 */
function parseLinksFile(text) {
  const lines = text.split(/\r\n|\r|\n/)
  const rows = []

  lines.forEach((raw, lineIndex) => {
    if (!raw.trim()) return // blank row

    const cells = raw.split('\t')
    if (cells.length > 1) {
      // Tab-separated row. Find whichever cell holds the URL rather than assuming
      // a fixed column, so this also round-trips rows this script has already
      // rewritten (e.g. a plain URL line that became "url\tERROR: ...").
      const urlColIndex = cells.findIndex((c) => URL_PATTERN.test(c))
      if (urlColIndex === -1) return // header row, or a row with no recognizable URL

      const url = cells[urlColIndex].match(URL_PATTERN)[0]
      // Only infer Title/Artist when there are enough preceding columns to match
      // the known spreadsheet shape (# \t Title \t Artist \t URL); otherwise leave
      // them unset rather than guessing.
      const title = urlColIndex >= 2 ? cells[urlColIndex - 2].trim() || undefined : undefined
      const artist = urlColIndex >= 1 ? cells[urlColIndex - 1].trim() || undefined : undefined
      const statusColIndex = urlColIndex + 1

      rows.push({
        lineIndex,
        url,
        title,
        artist,
        statusColIndex,
        status: (cells[statusColIndex] || '').trim()
      })
    } else {
      // Plain one-URL-per-line row.
      const trimmed = raw.trim()
      if (!URL_PATTERN.test(trimmed)) return
      rows.push({
        lineIndex,
        url: trimmed.match(URL_PATTERN)[0],
        title: undefined,
        artist: undefined,
        statusColIndex: null,
        status: ''
      })
    }
  })

  return { lines, rows }
}

/** A row is pending unless its status is set to something other than an ERROR. */
function isPending(row) {
  if (!row.status) return true
  return row.status.toUpperCase().startsWith('ERROR')
}

/** Write `status` back into the row's line in `lines` (in place, not yet persisted). */
function writeStatus(lines, row, status) {
  if (row.statusColIndex !== null) {
    const cells = lines[row.lineIndex].split('\t')
    while (cells.length <= row.statusColIndex) cells.push('')
    cells[row.statusColIndex] = status
    lines[row.lineIndex] = cells.join('\t')
  } else {
    lines[row.lineIndex] = `${lines[row.lineIndex].trim()}\t${status}`
  }
}

function persist(filePath, lines) {
  writeFileSync(filePath, lines.join('\n'), 'utf-8')
}

// ---------------------------------------------------------------------------
// Output naming
// ---------------------------------------------------------------------------

function sanitizeFolderName(name) {
  return name
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractVideoId(url) {
  const match = url.match(/[?&]v=([\w-]{6,})/) || url.match(/youtu\.be\/([\w-]{6,})/)
  return match ? match[1] : null
}

/** Compute the sanitized output folder name for a row, using the downloaded title as a fallback. */
function outputFolderNameFor(row, downloadedTitle) {
  const base =
    row.title && row.artist
      ? `${row.artist} - ${row.title}`
      : downloadedTitle || row.title || row.artist || ''
  const sanitized = sanitizeFolderName(base)
  if (sanitized) return sanitized
  return `untitled-${extractVideoId(row.url) || Date.now()}`
}

function hasStemsAlready(outputDir, folderName) {
  const dir = join(outputDir, folderName)
  if (!existsSync(dir)) return false
  try {
    const files = readdirSync(dir)
    return files.some((f) => STEM_NAMES.some((stem) => f.startsWith(stem)))
  } catch {
    return false
  }
}

/** Video mode writes one flat file per song (no stems subfolder), e.g. "Artist - Title.mp4". */
function hasVideoAlready(outputDir, folderName) {
  if (!existsSync(outputDir)) return false
  try {
    const files = readdirSync(outputDir)
    return files.some((f) => VIDEO_EXTENSIONS.some((ext) => f === `${folderName}${ext}`))
  } catch {
    return false
  }
}

function alreadyOnDisk(outputDir, folderName, mode) {
  return mode === 'video' ? hasVideoAlready(outputDir, folderName) : hasStemsAlready(outputDir, folderName)
}

// ---------------------------------------------------------------------------
// Download + separate pipeline
// ---------------------------------------------------------------------------

/** Spawn a python-worker script and resolve/reject based on its JSON-lines protocol. */
function runPythonJsonLines(pythonPath, scriptPath, args, { cwd, timeoutMs }) {
  return new Promise((resolveResult, reject) => {
    const proc = spawn(pythonPath, [scriptPath, ...args], { cwd })
    let settled = false
    let stderr = ''
    let buffer = ''

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true
        proc.kill('SIGTERM')
        reject(new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s`))
      }
    }, timeoutMs)

    proc.stdout.on('data', (data) => {
      buffer += data.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        let parsed
        try {
          parsed = JSON.parse(trimmed)
        } catch {
          continue // non-JSON output (e.g. Demucs/yt-dlp logging), ignore
        }
        if (parsed.type === 'complete' && !settled) {
          settled = true
          clearTimeout(timeout)
          resolveResult(parsed)
        } else if (parsed.type === 'error' && !settled) {
          settled = true
          clearTimeout(timeout)
          reject(new Error(parsed.message || 'Unknown error'))
        }
        // 'progress'/'metadata' events are intentionally not surfaced here --
        // per-row progress isn't needed for an unattended batch run.
      }
    })

    proc.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    proc.on('close', (code) => {
      if (!settled) {
        settled = true
        clearTimeout(timeout)
        if (code === 0) {
          reject(new Error('Process exited successfully but sent no "complete" event'))
        } else {
          reject(
            new Error(
              `Process exited with code ${code}${stderr ? `: ${stderr.slice(0, 300)}` : ''}`
            )
          )
        }
      }
    })

    proc.on('error', (err) => {
      if (!settled) {
        settled = true
        clearTimeout(timeout)
        reject(err)
      }
    })
  })
}

async function downloadSong(url, pythonPath, ffmpegPath, mode) {
  const result = await runPythonJsonLines(
    pythonPath,
    join(PYTHON_WORKER_DIR, 'download.py'),
    [url, '--ffmpeg-path', ffmpegPath, '--mode', mode],
    { cwd: PYTHON_WORKER_DIR, timeoutMs: DOWNLOAD_TIMEOUT_MS }
  )
  return { path: result.path, title: result.title }
}

async function separateSong(audioPath, pythonPath, outputDir) {
  const result = await runPythonJsonLines(
    pythonPath,
    join(PYTHON_WORKER_DIR, 'separate.py'),
    [audioPath, '--output-dir', outputDir],
    { cwd: PYTHON_WORKER_DIR, timeoutMs: SEPARATE_TIMEOUT_MS }
  )
  return { stems: result.stems }
}

/** Download (+ separate, in audio mode) a single row. Throws on failure; caller decides how to record it. */
async function processRow(row, { pythonPath, ffmpegPath, outputDir, mode }) {
  // Pre-flight disk check when the folder name is already knowable (Title+Artist
  // present) -- skips the download entirely for songs already on disk.
  if (row.title && row.artist) {
    const folderName = outputFolderNameFor(row)
    if (alreadyOnDisk(outputDir, folderName, mode)) {
      return { note: 'already on disk' }
    }
  }

  const { path: downloadedPath, title: downloadedTitle } = await downloadSong(
    row.url,
    pythonPath,
    ffmpegPath,
    mode
  )

  const folderName = outputFolderNameFor(row, downloadedTitle)

  // Second check, now that we know the folder name even for plain-URL rows.
  if (alreadyOnDisk(outputDir, folderName, mode)) {
    return { note: 'already on disk' }
  }

  const ext = extname(downloadedPath) || (mode === 'video' ? '.mp4' : '.mp3')

  if (mode === 'video') {
    // Video mode has no separation step -- just land the file in outputDir directly.
    renameSync(downloadedPath, join(outputDir, `${folderName}${ext}`))
    return {}
  }

  // Rename the downloaded temp file to the sanitized name so separate.py's own
  // (unsanitized) Path.stem derivation produces a filesystem-safe folder name --
  // this avoids needing to touch separate.py itself.
  const renamedPath = join(dirname(downloadedPath), `${folderName}${ext}`)
  renameSync(downloadedPath, renamedPath)

  await separateSong(renamedPath, pythonPath, outputDir)

  return {}
}

// ---------------------------------------------------------------------------
// Batch driver
// ---------------------------------------------------------------------------

const HELP_TEXT = `Velody batch importer

Usage:
  node scripts/batch-import.mjs [links-file] [--output-dir <dir>] [--video]

Arguments:
  links-file      Path to the links file (default: links.txt)
  --output-dir    Output root (default: <repo>/output/stems, or
                   <repo>/output/videos with --video)
  --video         Download full video (.mp4) instead of audio -- skips
                   stem separation entirely

Re-run the same command to resume an interrupted batch or retry failed rows.
`

function parseArgs(argv) {
  const args = { linksFile: 'links.txt', outputDir: null, video: false, help: false }
  const rest = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--output-dir' && argv[i + 1]) {
      args.outputDir = resolve(argv[++i])
    } else if (argv[i] === '--video') {
      args.video = true
    } else if (argv[i] === '--help' || argv[i] === '-h') {
      args.help = true
    } else {
      rest.push(argv[i])
    }
  }
  if (rest[0]) args.linksFile = rest[0]
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(HELP_TEXT)
    return
  }

  const linksPath = resolve(args.linksFile)
  if (!existsSync(linksPath)) {
    console.error(`Links file not found: ${linksPath}`)
    process.exitCode = 1
    return
  }

  const pythonPath = getPythonPath()
  const ffmpegPath = getFfmpegPath()
  const mode = args.video ? 'video' : 'audio'
  const outputDir = args.outputDir ?? (args.video ? DEFAULT_VIDEO_OUTPUT_DIR : DEFAULT_STEMS_OUTPUT_DIR)
  mkdirSync(outputDir, { recursive: true })

  const text = readFileSync(linksPath, 'utf-8')
  const { lines, rows } = parseLinksFile(text)
  const pending = rows.filter(isPending)
  const alreadyDone = rows.length - pending.length

  console.log('Velody batch import')
  console.log(`  Links file : ${linksPath}`)
  console.log(`  Mode       : ${mode}`)
  console.log(`  Output dir : ${outputDir}`)
  console.log(`  Python     : ${pythonPath}`)
  console.log(`  FFmpeg     : ${ffmpegPath}`)
  console.log(
    `  Rows found : ${rows.length} (${alreadyDone} already done, ${pending.length} pending)`
  )
  console.log('')

  let okCount = 0
  let errorCount = 0

  for (let i = 0; i < pending.length; i++) {
    const row = pending[i]
    const label = row.title && row.artist ? `${row.artist} - ${row.title}` : row.url
    process.stdout.write(`[${i + 1}/${pending.length}] ${label}: `)

    let skippedNetwork = false
    try {
      // Intentionally sequential (not Promise.all) -- see design.md Non-Goals.
      const result = await processRow(row, { pythonPath, ffmpegPath, outputDir, mode })
      okCount++
      skippedNetwork = Boolean(result.note)
      console.log(`OK${result.note ? ` (${result.note})` : ''}`)
      writeStatus(lines, row, 'OK')
    } catch (err) {
      errorCount++
      const message = (err instanceof Error ? err.message : String(err)).slice(0, 300)
      console.log(`ERROR: ${message}`)
      writeStatus(lines, row, `ERROR: ${message}`)
    }

    // Persist after every row so an interruption loses at most this one song.
    persist(linksPath, lines)

    // Small pause between real download attempts (not after an already-on-disk
    // skip, which made no network request) -- reduces the chance of tripping
    // YouTube's rate limiting across a run of 100+ back-to-back downloads.
    if (!skippedNetwork && i < pending.length - 1) {
      await sleep(INTER_SONG_DELAY_MS)
    }
  }

  console.log('')
  console.log(`Done. ${okCount} succeeded, ${errorCount} failed, ${alreadyDone} already done.`)
  if (errorCount > 0) {
    console.log('Re-run this script to retry the failed rows.')
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
