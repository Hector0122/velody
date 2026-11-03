import { spawn, ChildProcess } from 'child_process'
import { join } from 'path'
import { rm } from 'fs/promises'
import { BrowserWindow, app } from 'electron'
import { randomUUID } from 'crypto'
import type { SetupManager } from '../setup'
import { getStemsRootDir } from '../paths'

export interface SeparationJob {
  id: string
  songPath: string
  songName: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  progress: number
  process?: ChildProcess | null
  stems?: string[]
  error?: string
  /** Temp dir holding a downloaded source file; deleted once the job ends. */
  tempDir?: string
  /** MP3 bitrate (kbps) for the stems; separate.py's default when unset. */
  bitrate?: number
}

function songNameFromPath(path: string): string {
  return (
    path
      .split(/[/\\]/)
      .pop()
      ?.replace(/\.[^.]+$/, '') || 'untitled'
  )
}

function getPythonWorkerDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'python-worker')
  }
  return join(__dirname, '../../python-worker')
}

export class JobManager {
  private queue: SeparationJob[] = []
  private running = false
  private readonly setupManager: SetupManager | null

  constructor(setupManager: SetupManager | null) {
    this.setupManager = setupManager
  }

  enqueue(songPath: string, opts: { tempDir?: string; bitrate?: number } = {}): SeparationJob {
    const job: SeparationJob = {
      id: randomUUID(),
      songPath,
      songName: songNameFromPath(songPath),
      status: 'queued',
      progress: 0,
      tempDir: opts.tempDir,
      bitrate: opts.bitrate
    }
    this.queue.push(job)
    this.emit('separation:jobs-changed', this.getQueue())
    this.tryDequeue()
    return job
  }

  cancel(jobId: string): boolean {
    const job = this.queue.find((j) => j.id === jobId)
    if (!job) return false

    if (job.status === 'queued') {
      this.queue = this.queue.filter((j) => j.id !== jobId)
      this.cleanupTempDir(job)
      this.emit('separation:jobs-changed', this.getQueue())
      this.emit('separation:cancelled', { jobId })
      return true
    }

    if (job.status === 'running' && job.process) {
      job.process.kill('SIGTERM')
      job.status = 'cancelled'
      job.process = null
      this.running = false
      this.emit('separation:jobs-changed', this.getQueue())
      this.emit('separation:cancelled', { jobId })
      this.tryDequeue()
      return true
    }

    return false
  }

  getQueue(): SeparationJob[] {
    return this.queue.map((j) => this.sanitizeJob(j))
  }

  private tryDequeue(): void {
    if (this.running) return

    const next = this.queue.find((j) => j.status === 'queued')
    if (!next) return

    this.running = true
    this.runJob(next)
  }

  private async runJob(job: SeparationJob): Promise<void> {
    job.status = 'running'
    job.progress = 0
    this.emit('separation:jobs-changed', this.getQueue())

    const useRealDemucs = (await this.setupManager?.canUseRealDemucs()) ?? false

    try {
      if (!useRealDemucs) {
        // Used to silently fall back to writing fake sine-wave "stems" here,
        // which looked like a successful separation. Fail loudly instead.
        throw new Error(
          'Demucs is not installed. Finish the setup (Python venv + Demucs) and try again.'
        )
      }
      await this.runDemucs(job)

      job.status = 'completed'
      job.progress = 100
      this.emit('separation:complete', { jobId: job.id, stems: job.stems })
    } catch (err) {
      if ((job.status as string) === 'cancelled') return
      job.status = 'failed'
      job.error = err instanceof Error ? err.message : 'Unknown error'
      this.emit('separation:failed', { jobId: job.id, error: job.error })
    } finally {
      this.cleanupTempDir(job)
      this.running = false
      this.emit('separation:jobs-changed', this.getQueue())
      this.tryDequeue()
    }
  }

  private runDemucs(job: SeparationJob): Promise<void> {
    return new Promise((resolve, reject) => {
      const pythonPath = this.setupManager?.getPythonPath() ?? 'python3'
      const scriptDir = getPythonWorkerDir()
      const pythonScript = join(scriptDir, 'separate.py')
      const outputDir = getStemsRootDir()
      let settled = false

      const proc = spawn(
        pythonPath,
        [
          pythonScript,
          job.songPath,
          '--job-id',
          job.id,
          '--output-dir',
          outputDir,
          ...(job.bitrate ? ['--bitrate', String(job.bitrate)] : [])
        ],
        {
          cwd: scriptDir
        }
      )

      job.process = proc

      const DEMUCS_TIMEOUT_MS = 600_000
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true
          proc.kill('SIGTERM')
          reject(new Error('Separation timed out (10 min limit)'))
        }
      }, DEMUCS_TIMEOUT_MS)

      let lastEmittedBucket = -1

      proc.stdout.on('data', (data: Buffer) => {
        const lines = data.toString().trim().split('\n')
        for (const line of lines) {
          if (!line) continue
          try {
            const parsed = JSON.parse(line) as {
              type: string
              percent?: number
              stems?: string[]
              message?: string
            }
            if (parsed.type === 'progress' && typeof parsed.percent === 'number') {
              job.progress = parsed.percent
              this.emit('separation:progress', { jobId: job.id, percent: parsed.percent })
              const bucket = Math.floor(parsed.percent / 10)
              if (bucket !== lastEmittedBucket) {
                lastEmittedBucket = bucket
                this.emit('separation:jobs-changed', this.getQueue())
              }
            } else if (parsed.type === 'complete' && Array.isArray(parsed.stems)) {
              job.stems = parsed.stems
            } else if (parsed.type === 'error') {
              if (!settled) {
                settled = true
                clearTimeout(timeout)
                reject(new Error(parsed.message))
              }
            }
          } catch {
            // non-JSON output, ignore (Demucs logging)
          }
        }
      })

      proc.stderr.on('data', (data: Buffer) => {
        console.error(`[Demucs ${job.songName}]: ${data.toString().trim()}`)
      })

      proc.on('close', (code) => {
        job.process = null
        if (settled) return
        settled = true
        clearTimeout(timeout)
        if (job.status === 'cancelled') return
        if (code === 0 && job.stems) {
          resolve()
        } else {
          reject(new Error(`Python process exited with code ${code}`))
        }
      })

      proc.on('error', (err) => {
        job.process = null
        if (settled) return
        settled = true
        clearTimeout(timeout)
        reject(err)
      })
    })
  }

  private cleanupTempDir(job: SeparationJob): void {
    if (!job.tempDir) return
    const dir = job.tempDir
    job.tempDir = undefined
    rm(dir, { recursive: true, force: true }).catch(() => {})
  }

  private sanitizeJob(job: SeparationJob): SeparationJob {
    const { process: _p, tempDir: _t, ...rest } = job
    void _p
    void _t
    return rest
  }

  private emit(channel: string, payload: unknown): void {
    const windows = BrowserWindow.getAllWindows()
    const sanitized = Array.isArray(payload)
      ? payload.map((item) =>
          typeof item === 'object' && item !== null && 'process' in item
            ? this.sanitizeJob(item as SeparationJob)
            : item
        )
      : payload
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, sanitized)
      }
    }
  }

  cleanup(): void {
    for (const job of this.queue) {
      if (job.process && job.status === 'running') {
        job.process.kill('SIGTERM')
        job.process = null
      }
    }
    this.queue = []
    this.running = false
  }
}
