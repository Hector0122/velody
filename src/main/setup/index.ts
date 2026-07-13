import { execFile, spawn } from 'child_process'
import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync } from 'fs'
import { mkdir, rm } from 'fs/promises'
import https from 'https'
import { join } from 'path'
import { homedir, tmpdir } from 'os'
import { URL } from 'url'

export interface SetupProgress {
  step: string
  progress: number
  status: 'working' | 'done' | 'error'
  message: string
}

export type ProgressCallback = (progress: SetupProgress) => void

const DATA_DIR = join(homedir(), '.local', 'share', 'velody')
const VENV_DIR = join(DATA_DIR, 'venv')
const isWin = process.platform === 'win32'
const PYTHON = isWin ? 'python' : 'python3'
const VENV_PYTHON = join(VENV_DIR, isWin ? 'Scripts' : 'bin', isWin ? 'python.exe' : PYTHON)
const VENV_PIP = join(VENV_DIR, isWin ? 'Scripts' : 'bin', isWin ? 'pip.exe' : 'pip')

const FFMPEG_DIR = join(DATA_DIR, 'ffmpeg')
const FFMPEG_BIN = join(FFMPEG_DIR, 'bin', isWin ? 'ffmpeg.exe' : 'ffmpeg')

const STEPS = ['python', 'venv', 'demucs', 'ffmpeg'] as const

const HELP: Record<string, string> = isWin
  ? {
      python:
        'Python 3 not found.\nDownload and install Python from:\nhttps://python.org/downloads/\nMake sure to check "Add Python to PATH" during installation.',
      venv: 'Failed to create virtual environment.',
      demucs:
        'Failed to install Demucs.\nTry running manually:\n  python -m pip install demucs torch torchaudio',
      ffmpeg:
        'FFmpeg not found.\nDownload FFmpeg from:\nhttps://ffmpeg.org/download.html\nOr install with winget:\n  winget install ffmpeg'
    }
  : {
      python:
        'Python 3 not found.\nInstall Python 3:\n  sudo apt install python3 python3-pip python3-venv',
      venv: 'Failed to create virtual environment.',
      demucs: `Failed to install Demucs.\nTry running manually:\n  python3 -m venv ${VENV_DIR}\n  ${VENV_DIR}/bin/pip install demucs torch torchaudio`,
      ffmpeg: 'FFmpeg not found.\nInstall FFmpeg:\n  sudo apt install ffmpeg'
    }

function downloadHttps(
  url: string,
  dest: string,
  onProgress?: (pct: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    https
      .get(
        {
          hostname: parsed.hostname,
          port: 443,
          path: parsed.pathname + parsed.search,
          headers: { 'User-Agent': 'Velody/1.0' }
        },
        (res) => {
          if (res.statusCode === 301 || res.statusCode === 302) {
            const redirect = res.headers.location
            if (redirect) {
              downloadHttps(redirect, dest, onProgress).then(resolve).catch(reject)
              return
            }
          }
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}`))
            return
          }
          const total = parseInt(res.headers['content-length'] || '0', 10)
          let received = 0
          const file = createWriteStream(dest)
          res.on('data', (chunk: Buffer) => {
            received += chunk.length
            if (total && onProgress) {
              onProgress(Math.round((received / total) * 100))
            }
          })
          res.pipe(file)
          file.on('finish', () => {
            file.close()
            resolve()
          })
          file.on('error', reject)
        }
      )
      .on('error', reject)
  })
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
      for (const step of STEPS) {
        this.emit(step, 100, 'done', 'Simulation mode — skipping checks')
      }
      this.emit('done', 100, 'done', 'Running in simulation mode — ready!')
      return
    }

    for (const step of STEPS) {
      this.emit(step, 0, 'working', `Checking ${step}...`)

      if (step === 'python') {
        if (!(await this.checkPython())) {
          this.emit(step, 0, 'error', HELP[step])
          throw new Error(`python not found.\n${HELP[step]}`)
        }
        this.emit(step, 100, 'done', 'Python found')
        continue
      }

      if (await this.check(step)) {
        this.emit(step, 100, 'done', `${step} ready`)
        continue
      }

      this.emit(step, 10, 'working', `Installing ${step}...`)
      const ok = await this.install(step)
      if (!ok) {
        this.emit(step, 0, 'error', HELP[step])
        throw new Error(`${step} install failed.\n${HELP[step]}`)
      }
      this.emit(step, 100, 'done', `${step} installed`)
    }

    this.emit('done', 100, 'done', 'All dependencies ready!')
  }

  getPythonPath(): string {
    if (existsSync(VENV_PYTHON)) return VENV_PYTHON
    return PYTHON
  }

  getFfmpegPath(): string {
    if (existsSync(FFMPEG_BIN)) return FFMPEG_BIN
    return 'ffmpeg'
  }

  async isSetupComplete(): Promise<boolean> {
    if (this.simMode) return true
    for (const s of STEPS) {
      if (s === 'python') {
        if (!(await this.checkPython())) return false
      } else {
        if (!(await this.check(s))) return false
      }
    }
    return true
  }

  async canUseRealDemucs(): Promise<boolean> {
    if (this.simMode) return false
    return this.isSetupComplete()
  }

  private async checkPython(): Promise<boolean> {
    return this.tryCmd(`${PYTHON} --version`)
  }

  private async check(step: string): Promise<boolean> {
    switch (step) {
      case 'venv':
        return existsSync(VENV_PYTHON)
      case 'demucs':
        return this.checkDemucs()
      case 'ffmpeg': {
        const ffmpeg = this.getFfmpegPath()
        return ffmpeg !== '' && (await this.tryCmd(`${ffmpeg} -version`))
      }
      default:
        return false
    }
  }

  private async checkDemucs(): Promise<boolean> {
    const python = this.getPythonPath()
    for (const pkg of ['demucs', 'torch', 'torchaudio']) {
      if (!(await this.tryCmd(`${python} -m pip show ${pkg}`))) return false
    }
    return true
  }

  private tryCmd(cmd: string): Promise<boolean> {
    return new Promise((resolve) => {
      const parts = cmd.trim().split(/\s+/)
      const file = parts[0].replace(/^["']|["']$/g, '')
      const args = parts.slice(1)
      execFile(file, args, (err) => {
        resolve(!err)
      })
    })
  }

  private async install(step: string): Promise<boolean> {
    switch (step) {
      case 'venv':
        return this.createVenv()
      case 'demucs':
        return this.installDemucs()
      case 'ffmpeg':
        return this.downloadFfmpeg()
      default:
        return false
    }
  }

  private createVenv(): Promise<boolean> {
    return this.spawnAsync(PYTHON, ['-m', 'venv', VENV_DIR], 'venv', 120_000)
  }

  private installDemucs(): Promise<boolean> {
    const pip = existsSync(VENV_PIP) ? VENV_PIP : this.getPythonPath()
    const args = existsSync(VENV_PIP)
      ? ['install', 'demucs', 'torch', 'torchaudio']
      : ['-m', 'pip', 'install', 'demucs', 'torch', 'torchaudio']
    return this.spawnAsync(pip, args, 'demucs', 900_000)
  }

  private async downloadFfmpeg(): Promise<boolean> {
    if (!isWin) return false

    try {
      await mkdir(DATA_DIR, { recursive: true })

      const url = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'
      const zipPath = join(tmpdir(), 'velody-ffmpeg.zip')

      this.emit('ffmpeg', 5, 'working', 'Downloading FFmpeg...')

      await downloadHttps(url, zipPath, (pct) => {
        const scaled = 5 + Math.round(pct * 0.4)
        this.emit('ffmpeg', scaled, 'working', `Downloading FFmpeg... ${pct}%`)
      })

      this.emit('ffmpeg', 50, 'working', 'Extracting FFmpeg...')

      if (existsSync(FFMPEG_DIR)) {
        await rm(FFMPEG_DIR, { recursive: true, force: true })
      }

      const extracted = await this.spawnAsync(
        'powershell',
        ['-Command', `Expand-Archive -Path '${zipPath}' -DestinationPath '${FFMPEG_DIR}' -Force`],
        'ffmpeg',
        120_000
      )

      await rm(zipPath, { force: true }).catch(() => {})

      if (!extracted) return false

      const entries = readdirSync(FFMPEG_DIR)
      const subDir = entries.find((e) => e.startsWith('ffmpeg-'))
      if (subDir) {
        const srcBin = join(FFMPEG_DIR, subDir, 'bin')
        if (existsSync(srcBin)) {
          const dstBin = join(FFMPEG_DIR, 'bin')
          mkdirSync(dstBin, { recursive: true })
          for (const file of readdirSync(srcBin)) {
            renameSync(join(srcBin, file), join(dstBin, file))
          }
          await rm(join(FFMPEG_DIR, subDir), { recursive: true, force: true })
        }
      }

      return existsSync(FFMPEG_BIN)
    } catch {
      return false
    }
  }

  private spawnAsync(
    command: string,
    args: string[],
    step: string,
    timeout: number
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn(command, args, {
        shell: isWin,
        stdio: ['ignore', 'pipe', 'pipe']
      })

      const timer = setTimeout(() => {
        proc.kill()
        resolve(false)
      }, timeout)

      let buffer = ''
      let lastProgress = 0

      const handleData = (data: Buffer): void => {
        buffer += data.toString()
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const match = line.match(/(\d+)%/)
          if (match) {
            const pct = parseInt(match[1])
            if (pct > lastProgress) {
              lastProgress = pct
              this.emit(step, Math.min(pct, 99), 'working', `Installing... ${pct}%`)
            }
          }
        }
      }

      proc.stdout?.on('data', handleData)
      proc.stderr?.on('data', handleData)

      proc.on('close', (code) => {
        clearTimeout(timer)
        resolve(code === 0)
      })

      proc.on('error', () => {
        clearTimeout(timer)
        resolve(false)
      })
    })
  }
}
