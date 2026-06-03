import { execSync } from 'child_process'
import { join } from 'path'
import { homedir } from 'os'
import { existsSync } from 'fs'

export interface SetupProgress {
  step: string
  progress: number
  status: 'working' | 'done' | 'error'
  message: string
}

export type ProgressCallback = (progress: SetupProgress) => void

const VENV_DIR = join(homedir(), '.local', 'share', 'velody', 'venv')
const isWin = process.platform === 'win32'
const PYTHON = isWin ? 'python' : 'python3'
const VENV_PYTHON = join(VENV_DIR, isWin ? 'Scripts' : 'bin', isWin ? 'python.exe' : PYTHON)

const HELP: Record<string, string> = isWin
  ? {
      python:
        'Python 3 not found.\nDownload and install Python from:\nhttps://python.org/downloads/\nMake sure to check "Add Python to PATH" during installation.',
      demucs: `Python found but Demucs is not installed.\nOpen a terminal and run:\n  ${PYTHON} -m pip install demucs torch torchaudio`,
      ffmpeg:
        'FFmpeg not found.\nDownload FFmpeg from:\nhttps://ffmpeg.org/download.html\nOr install with winget:\n  winget install ffmpeg'
    }
  : {
      python:
        'Python 3 not found.\nInstall Python 3:\n  sudo apt install python3 python3-pip python3-venv',
      demucs: `Create venv and install Demucs:\n  python3 -m venv ${VENV_DIR}\n  ${VENV_DIR}/bin/pip install demucs torch torchaudio`,
      ffmpeg: 'FFmpeg not found.\nInstall FFmpeg:\n  sudo apt install ffmpeg'
    }

export class SetupManager {
  private progressCallback: ProgressCallback | null = null
  private readonly simMode: boolean

  constructor(simMode = false) {
    this.simMode = simMode
  }

  setProgressCallback(callback: ProgressCallback): void {
    this.progressCallback = callback
  }

  private emit(
    step: string,
    progress: number,
    status: SetupProgress['status'],
    message: string
  ): void {
    this.progressCallback?.({ step, progress, status, message })
  }

  async run(): Promise<void> {
    if (this.simMode) {
      this.emit('python', 100, 'done', 'Simulation mode — skipping checks')
      this.emit('demucs', 100, 'done', 'Simulation mode — skipping checks')
      this.emit('ffmpeg', 100, 'done', 'Simulation mode — skipping checks')
      this.emit('done', 100, 'done', 'Running in simulation mode — ready!')
      return
    }

    const steps = ['python', 'demucs', 'ffmpeg'] as const

    for (const step of steps) {
      this.emit(step, 0, 'working', `Checking ${step}...`)
      const ok = this.check(step)
      if (ok) {
        this.emit(step, 100, 'done', `${step} found`)
      } else {
        this.emit(step, 0, 'error', HELP[step])
        throw new Error(`${step} not found.\n${HELP[step]}`)
      }
    }

    this.emit('done', 100, 'done', 'All dependencies ready!')
  }

  getPythonPath(): string {
    if (existsSync(VENV_PYTHON)) return VENV_PYTHON
    return PYTHON
  }

  getFfmpegPath(): string {
    try {
      execSync('ffmpeg -version 2>/dev/null', { stdio: 'ignore' })
      return 'ffmpeg'
    } catch {
      return ''
    }
  }

  isSetupComplete(): boolean {
    if (this.simMode) return true
    return ['python', 'demucs', 'ffmpeg'].every((s) => this.check(s))
  }

  canUseRealDemucs(): boolean {
    if (this.simMode) return false
    return this.isSetupComplete()
  }

  private check(step: string): boolean {
    const cmds: Record<string, string> = {
      python: `${PYTHON} --version`,
      demucs: `${this.getPythonPath()} -m pip show demucs`,
      ffmpeg: 'ffmpeg -version'
    }
    const cmd = cmds[step]
    if (!cmd) return false
    try {
      execSync(cmd, { stdio: 'ignore' })
      return true
    } catch {
      return false
    }
  }
}
