import { execFile, spawn } from 'child_process'
import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync } from 'fs'
import { mkdir, rm, readdir } from 'fs/promises'
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

const PY_PKGS = ['demucs', 'torch', 'torchaudio', 'tempocnn', 'librosa', 'yt-dlp', 'beat-this']
const STEPS = ['python', 'venv', 'demucs', 'ffmpeg'] as const

const STANDALONE_DIR = join(DATA_DIR, 'python')
const STANDALONE_PYTHON = join(STANDALONE_DIR, isWin ? 'python.exe' : 'bin/python3')

const COMPATIBLE_PYTHON_VERSIONS = ['3.11', '3.10', '3.9']

const HELP: Record<string, string> = isWin
  ? {
      python:
        'Compatible Python (3.9-3.11) not found.\nDownload and install Python from:\nhttps://python.org/downloads/\nMake sure to check "Add Python to PATH" during installation.',
      venv: 'Failed to create virtual environment.',
      demucs:
        'Failed to install dependencies.\nTry running manually:\n  python -m pip install demucs torch torchaudio tempocnn librosa yt-dlp beat-this',
      ffmpeg:
        'FFmpeg not found.\nDownload FFmpeg from:\nhttps://ffmpeg.org/download.html\nOr install with winget:\n  winget install ffmpeg'
    }
  : {
      python:
        'Compatible Python (3.9-3.11) not found.\nInstall Python 3.11:\n  brew install python@3.11\nor download from:\n  https://www.python.org/downloads/',
      venv: 'Failed to create virtual environment.',
      demucs: `Failed to install dependencies.\nTry running manually:\n  python3 -m venv ${VENV_DIR}\n  ${VENV_DIR}/bin/pip install demucs torch torchaudio tempocnn librosa yt-dlp beat-this`,
      ffmpeg: 'FFmpeg not found.\nInstall FFmpeg:\n  brew install ffmpeg'
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
  private compatiblePythonPath: string | null = null
  // Only ever set to `true` (never cache a negative/partial result) once a full
  // readiness check has passed, so a fixable failure is always re-checked on the
  // next query. Reset to `null` at the start of `run()` so a fresh setup pass
  // re-verifies from scratch.
  private cachedReady: boolean | null = null

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
    this.cachedReady = null
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
      const result = await this.install(step)
      if (!result) {
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
    if (this.cachedReady) return true
    for (const s of STEPS) {
      if (s === 'python') {
        if (!(await this.checkPython())) return false
      } else {
        if (!(await this.check(s))) return false
      }
    }
    this.cachedReady = true
    return true
  }

  async canUseRealDemucs(): Promise<boolean> {
    if (this.simMode) return false
    return this.isSetupComplete()
  }

  private async parsePythonVersion(name: string): Promise<string | null> {
    return new Promise((resolve) => {
      execFile(name, ['--version'], (err, stdout) => {
        if (err) {
          resolve(null)
          return
        }
        const match = stdout.trim().match(/^Python\s+(\d+)\.(\d+)/)
        if (match) {
          resolve(`${match[1]}.${match[2]}`)
        } else {
          resolve(null)
        }
      })
    })
  }

  private async checkPython(): Promise<boolean> {
    // Try compatible Python versions on PATH concurrently, then pick the first
    // match in COMPATIBLE_PYTHON_VERSIONS precedence order (same precedence as
    // the previous sequential loop, just not gated on each probe's latency).
    const names = COMPATIBLE_PYTHON_VERSIONS.map((ver) => (isWin ? 'python' : `python${ver}`))
    const versions = await Promise.all(names.map((name) => this.parsePythonVersion(name)))
    for (let i = 0; i < names.length; i++) {
      const actualVersion = versions[i]
      if (actualVersion && COMPATIBLE_PYTHON_VERSIONS.includes(actualVersion)) {
        this.compatiblePythonPath = names[i]
        return true
      }
    }
    // Check standalone download
    if (existsSync(STANDALONE_PYTHON)) {
      this.compatiblePythonPath = STANDALONE_PYTHON
      return true
    }
    // Download standalone Python
    return this.downloadStandalonePython()
  }

  private async check(step: string): Promise<boolean> {
    switch (step) {
      case 'venv':
        if (!existsSync(VENV_PYTHON)) return false
        return this.isVenvCompatible()
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

  private async missingPkgs(): Promise<string[]> {
    const python = this.getPythonPath()
    const results = await Promise.all(
      PY_PKGS.map((pkg) => this.tryCmd(`${python} -m pip show ${pkg}`))
    )
    return PY_PKGS.filter((_, i) => !results[i])
  }

  private async checkDemucs(): Promise<boolean> {
    return (await this.missingPkgs()).length === 0
  }

  private isVenvCompatible(): Promise<boolean> {
    return new Promise((resolve) => {
      execFile(
        VENV_PYTHON,
        [
          '-c',
          'import sys; exit(0 if 3 <= sys.version_info[0] and (3,9) <= sys.version_info[:2] <= (3,11) else 1)'
        ],
        (err) => resolve(!err)
      )
    })
  }

  private async downloadStandalonePython(): Promise<boolean> {
    try {
      const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64'
      const platform = isWin
        ? 'pc-windows-msvc'
        : process.platform === 'darwin'
          ? 'apple-darwin'
          : 'unknown-linux-gnu'
      const url = `https://github.com/astral-sh/python-build-standalone/releases/download/20260623/cpython-3.11.15%2B20260623-${arch}-${platform}-install_only.tar.gz`
      const tarPath = join(DATA_DIR, 'python3.11.tar.gz')

      this.emit('python', 5, 'working', 'Downloading Python 3.11...')
      await downloadHttps(url, tarPath, (pct) => {
        const scaled = 5 + Math.round(pct * 0.35)
        this.emit('python', scaled, 'working', `Downloading Python 3.11... ${pct}%`)
      })

      this.emit('python', 45, 'working', 'Extracting Python 3.11...')
      if (existsSync(STANDALONE_DIR)) {
        await rm(STANDALONE_DIR, { recursive: true, force: true })
      }
      await mkdir(DATA_DIR, { recursive: true })
      const { ok } = await this.spawnAsync(
        'tar',
        ['-xzf', tarPath, '-C', DATA_DIR],
        'python',
        120_000
      )
      if (ok) {
        const entries = await readdir(DATA_DIR)
        const extracted = entries.find((e) => e.startsWith('cpython-'))
        if (extracted) {
          renameSync(join(DATA_DIR, extracted), STANDALONE_DIR)
        }
      }
      await rm(tarPath, { force: true }).catch(() => {})
      if (existsSync(STANDALONE_PYTHON)) {
        this.compatiblePythonPath = STANDALONE_PYTHON
        return true
      }
      return false
    } catch {
      return false
    }
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

  private async createVenv(): Promise<boolean> {
    if (existsSync(VENV_DIR)) {
      await rm(VENV_DIR, { recursive: true, force: true })
    }
    const python = this.compatiblePythonPath ?? PYTHON
    const { ok } = await this.spawnAsync(python, ['-m', 'venv', VENV_DIR], 'venv', 120_000)
    return ok
  }

  // `nvidia-smi -L` succeeds iff NVIDIA drivers (and thus a usable GPU) are
  // present — it ships with any NVIDIA driver install, no extra dependency.
  private hasNvidiaGpu(): Promise<boolean> {
    return this.tryCmd('nvidia-smi -L')
  }

  private async installDemucs(): Promise<boolean> {
    const pip = existsSync(VENV_PIP) ? VENV_PIP : this.getPythonPath()
    // Only what's missing: an existing install that lacks a newly added package
    // (beat-this) shouldn't re-download/upgrade torch & co.
    const missing = await this.missingPkgs()
    const pkgs = missing.length > 0 ? missing : PY_PKGS
    const args = existsSync(VENV_PIP)
      ? ['install', '--upgrade', ...pkgs]
      : ['-m', 'pip', 'install', '--upgrade', ...pkgs]
    // On Windows, only force the CPU-only PyTorch wheel when there's no NVIDIA
    // GPU to use — otherwise this would silently disable Demucs' own CUDA
    // auto-detection ("device default is cuda if available else cpu") for
    // every GPU owner, forcing everyone onto the much slower CPU path.
    if (isWin && !(await this.hasNvidiaGpu())) {
      args.push('--extra-index-url', 'https://download.pytorch.org/whl/cpu')
    }
    const { ok, stderr } = await this.spawnAsync(pip, args, 'demucs', 900_000)
    if (!ok) {
      this.emit('demucs', 0, 'error', `pip install failed:\n${stderr}`)
    }
    return ok
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

      const { ok: extracted } = await this.spawnAsync(
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
  ): Promise<{ ok: boolean; stderr: string }> {
    return new Promise((resolve) => {
      const proc = spawn(command, args, {
        shell: isWin,
        stdio: ['ignore', 'pipe', 'pipe']
      })

      const timer = setTimeout(() => {
        proc.kill()
        resolve({ ok: false, stderr: 'Process timed out' })
      }, timeout)

      let buffer = ''
      let lastProgress = 0
      const stderrLines: string[] = []
      const MAX_STDERR_LINES = 10

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
      proc.stderr?.on('data', (data: Buffer) => {
        handleData(data)
        const lines = data
          .toString()
          .split('\n')
          .filter((l: string) => l.trim())
        for (const line of lines) {
          stderrLines.push(line)
          if (stderrLines.length > MAX_STDERR_LINES) {
            stderrLines.shift()
          }
        }
      })

      proc.on('close', (code) => {
        clearTimeout(timer)
        resolve({ ok: code === 0, stderr: stderrLines.join('\n') })
      })

      proc.on('error', () => {
        clearTimeout(timer)
        resolve({ ok: false, stderr: stderrLines.join('\n') })
      })
    })
  }
}
