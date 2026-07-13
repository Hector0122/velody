import { spawn, ChildProcess } from 'child_process'
import { join } from 'path'
import { BrowserWindow, app } from 'electron'
import { randomUUID } from 'crypto'
import type { SetupManager } from '../setup'

export interface SeparationJob {
  id: string
  songPath: string
  songName: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  progress: number
  process?: ChildProcess | null
  stems?: string[]
  error?: string
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

function getOutputStemsDir(): string {
  if (app.isPackaged) {
    return join(app.getPath('userData'), 'output', 'stems')
  }
  return join(__dirname, '../../output/stems')
}

export class JobManager {
  private queue: SeparationJob[] = []
  private running = false
  private readonly setupManager: SetupManager | null

  constructor(setupManager: SetupManager | null) {
    this.setupManager = setupManager
  }

  enqueue(songPath: string): SeparationJob {
    const job: SeparationJob = {
      id: randomUUID(),
      songPath,
      songName: songNameFromPath(songPath),
      status: 'queued',
      progress: 0
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
      if (useRealDemucs) {
        await this.runDemucs(job)
      } else {
        await this.runSimulation(job)
      }

      job.status = 'completed'
      job.progress = 100
      this.emit('separation:complete', { jobId: job.id, stems: job.stems })
    } catch (err) {
      if ((job.status as string) === 'cancelled') return
      job.status = 'failed'
      job.error = err instanceof Error ? err.message : 'Unknown error'
      this.emit('separation:failed', { jobId: job.id, error: job.error })
    } finally {
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
      const outputDir = getOutputStemsDir()

      const proc = spawn(
        pythonPath,
        [pythonScript, job.songPath, '--job-id', job.id, '--output-dir', outputDir],
        {
          cwd: scriptDir
        }
      )

      job.process = proc

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
              this.emit('separation:jobs-changed', this.getQueue())
            } else if (parsed.type === 'complete' && Array.isArray(parsed.stems)) {
              job.stems = parsed.stems
            } else if (parsed.type === 'error') {
              reject(new Error(parsed.message))
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
        if (job.status === 'cancelled') return
        if (code === 0 && job.stems) {
          resolve()
        } else {
          reject(new Error(`Python process exited with code ${code}`))
        }
      })

      proc.on('error', (err) => {
        job.process = null
        reject(err)
      })
    })
  }

  private async runSimulation(job: SeparationJob): Promise<void> {
    const stemsDir = join(getOutputStemsDir(), job.songName)
    const { mkdirSync, writeFileSync } = await import('fs')

    mkdirSync(stemsDir, { recursive: true })

    const stemNames = ['vocals', 'drums', 'bass', 'other', 'piano', 'guitar']
    const frequencies: Record<string, number> = {
      vocals: 440,
      drums: 180,
      bass: 110,
      other: 660,
      piano: 523,
      guitar: 330
    }

    const stems: string[] = []

    for (let i = 0; i < stemNames.length; i++) {
      const name = stemNames[i]
      const filePath = join(stemsDir, `${name}.wav`)
      // Simulate work (minimum delay so queue shows progress)
      await new Promise((r) => setTimeout(r, 300))

      const sampleRate = 44100
      const durationSec = 60
      const freq = frequencies[name] || 440
      const numSamples = Math.floor(sampleRate * durationSec)
      const buffer = Buffer.alloc(44 + numSamples * 2)

      buffer.write('RIFF', 0)
      buffer.writeUInt32LE(36 + numSamples * 2, 4)
      buffer.write('WAVE', 8)
      buffer.write('fmt ', 12)
      buffer.writeUInt32LE(16, 16)
      buffer.writeUInt16LE(1, 20)
      buffer.writeUInt16LE(1, 22)
      buffer.writeUInt32LE(sampleRate, 24)
      buffer.writeUInt32LE(sampleRate * 2, 28)
      buffer.writeUInt16LE(2, 32)
      buffer.writeUInt16LE(16, 34)
      buffer.write('data', 36)
      buffer.writeUInt32LE(numSamples * 2, 40)

      for (let s = 0; s < numSamples; s++) {
        const t = s / sampleRate
        const sample = Math.sin(2 * Math.PI * freq * t)
        const intSample = Math.max(-32768, Math.min(32767, Math.floor(sample * 20000)))
        buffer.writeInt16LE(intSample, 44 + s * 2)
      }

      writeFileSync(filePath, buffer)
      stems.push(filePath)

      job.progress = Math.round(((i + 1) / stemNames.length) * 100)
      this.emit('separation:progress', { jobId: job.id, percent: job.progress })
      this.emit('separation:jobs-changed', this.getQueue())
    }

    job.stems = stems
  }

  private sanitizeJob(job: SeparationJob): SeparationJob {
    const { process: _p, ...rest } = job
    void _p
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
