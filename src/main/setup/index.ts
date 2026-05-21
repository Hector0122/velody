import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, createWriteStream } from 'fs'
import { execSync, exec } from 'child_process'
import { get } from 'https'

export interface SetupProgress {
  step: string
  progress: number
  status: 'working' | 'done' | 'error'
  message: string
}

export type ProgressCallback = (progress: SetupProgress) => void

export class SetupManager {
  private venvDir: string
  private ffmpegDir: string
  private progressCallback: ProgressCallback | null = null
  private readonly simMode: boolean

  constructor(simMode = false) {
    const userData = app.getPath('userData')
    this.venvDir = join(userData, 'venv')
    this.ffmpegDir = join(userData, 'ffmpeg')
    this.simMode = simMode
    mkdirSync(userData, { recursive: true })
  }

  setProgressCallback(callback: ProgressCallback): void {
    this.progressCallback = callback
  }

  private emit(step: string, progress: number, status: SetupProgress['status'], message: string): void {
    this.progressCallback?.({ step, progress, status, message })
  }

  async run(): Promise<void> {
    this.emit('python', 0, 'working', 'Checking Python installation...')
    const pythonOk = await this.checkPython()
    if (!pythonOk) {
      this.emit('python', 0, 'error', 'Python 3 is required. Install from https://python.org')
      throw new Error('Python 3 not found')
    }
    this.emit('python', 100, 'done', `Python 3 found`)

    if (this.simMode) {
      this.emit('venv', 100, 'done', 'Simulation mode — skipping venv')
      this.emit('demucs', 100, 'done', 'Simulation mode — skipping Demucs install')
      this.emit('ffmpeg', 100, 'done', 'Simulation mode — skipping FFmpeg')
      this.emit('done', 100, 'done', 'Running in simulation mode — ready!')
      return
    }

    this.emit('venv', 0, 'working', 'Creating virtual environment...')
    await this.createVenv()
    this.emit('venv', 100, 'done', 'Virtual environment ready')

    this.emit('demucs', 0, 'working', 'Installing Demucs + PyTorch (may take a while)...')
    await this.installDemucs()
    this.emit('demucs', 100, 'done', 'Demucs installed')

    this.emit('ffmpeg', 0, 'working', 'Setting up FFmpeg...')
    await this.setupFfmpeg()
    this.emit('ffmpeg', 100, 'done', 'FFmpeg ready')

    this.emit('done', 100, 'done', 'All dependencies installed!')
  }

  getPythonPath(): string {
    if (!existsSync(join(this.venvDir, 'pyvenv.cfg'))) {
      const systemPython = this.checkSystemCommand('python3') ? 'python3' : 'python'
      return systemPython
    }
    const isWin = process.platform === 'win32'
    return join(this.venvDir, isWin ? 'Scripts' : 'bin', isWin ? 'python.exe' : 'python3')
  }

  getFfmpegPath(): string {
    const isWin = process.platform === 'win32'
    const name = isWin ? 'ffmpeg.exe' : 'ffmpeg'
    const bundled = join(__dirname, '../../../resources/ffmpeg', name)
    if (existsSync(bundled)) return bundled

    const downloaded = join(this.ffmpegDir, name)
    if (existsSync(downloaded)) return downloaded

    if (this.checkSystemCommand('ffmpeg')) return 'ffmpeg'

    return ''
  }

  isSetupComplete(): boolean {
    if (this.simMode) return true
    return existsSync(join(this.venvDir, 'pyvenv.cfg'))
  }

  canUseRealDemucs(): boolean {
    if (this.simMode) return false
    return existsSync(join(this.venvDir, 'pyvenv.cfg'))
  }

  private checkSystemCommand(cmd: string): boolean {
    try {
      execSync(`which ${cmd} 2>/dev/null || where ${cmd} 2>nul`, { stdio: 'ignore' })
      return true
    } catch {
      return false
    }
  }

  private async checkPython(): Promise<boolean> {
    try {
      const v = execSync('python3 --version 2>/dev/null || python --version 2>/dev/null').toString().trim()
      this.emit('python', 50, 'working', v)
      return true
    } catch {
      return false
    }
  }

  private async createVenv(): Promise<void> {
    if (existsSync(join(this.venvDir, 'pyvenv.cfg'))) return

    return new Promise((resolve, reject) => {
      const pythonCmd = this.checkSystemCommand('python3') ? 'python3' : 'python'
      exec(`"${pythonCmd}" -m venv "${this.venvDir}"`, (error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  }

  private async installDemucs(): Promise<void> {
    const python = this.getPythonPath()

    return new Promise((resolve, reject) => {
      const proc = exec(
        `"${python}" -m pip install demucs torch torchaudio --progress-bar off`,
        { maxBuffer: 10 * 1024 * 1024 },
        (error) => {
          if (error) reject(error)
          else resolve()
        }
      )
      proc.stderr?.on('data', (data: string) => {
        const line = data.toString().trim()
        if (line.includes('Installing') || line.includes('Collecting')) {
          this.emit('demucs', 30, 'working', line.slice(0, 80))
        }
      })
    })
  }

  private async setupFfmpeg(): Promise<void> {
    if (this.checkSystemCommand('ffmpeg')) return

    mkdirSync(this.ffmpegDir, { recursive: true })

    const urls: Record<string, string> = {
      darwin: 'https://evermeet.cx/ffmpeg/ffmpeg-7.1.zip',
      win32: 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
      linux: 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz'
    }

    const url = urls[process.platform]
    if (!url) {
      this.emit('ffmpeg', 0, 'error', 'Unsupported platform')
      return
    }

    this.emit('ffmpeg', 10, 'working', 'Downloading FFmpeg...')

    return new Promise((resolve, reject) => {
      get(url, (response) => {
        const total = parseInt(response.headers['content-length'] || '0', 10)
        let downloaded = 0

        const file = createWriteStream(join(this.ffmpegDir, 'ffmpeg.zip'))
        response.pipe(file)

        response.on('data', (chunk: Buffer) => {
          downloaded += chunk.length
          if (total) {
            const pct = Math.round((downloaded / total) * 100)
            this.emit('ffmpeg', pct, 'working', `Downloading FFmpeg... ${pct}%`)
          }
        })

        file.on('finish', () => {
          file.close()
          this.emit('ffmpeg', 100, 'done', 'FFmpeg downloaded')
          resolve()
        })

        file.on('error', reject)
      }).on('error', reject)
    })
  }
}
