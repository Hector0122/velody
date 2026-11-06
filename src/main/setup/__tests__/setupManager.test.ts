import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'

// SetupManager talks to the system via `child_process.execFile` (version probes,
// `pip show`, ffmpeg/venv checks) and `fs.existsSync` (locating the venv/ffmpeg
// binaries). Mock both so readiness checks are deterministic and we can assert
// on how many/which subprocesses were spawned.
const execFileMock = vi.fn()
const spawnMock = vi.fn()
vi.mock('child_process', () => ({
  execFile: (...args: unknown[]) => (execFileMock as (...a: unknown[]) => void)(...args),
  spawn: (...args: unknown[]) => (spawnMock as (...a: unknown[]) => unknown)(...args)
}))

const existsSyncMock = vi.fn()
vi.mock('fs', () => ({
  existsSync: (...args: unknown[]) => (existsSyncMock as (...a: unknown[]) => boolean)(...args),
  createWriteStream: vi.fn(),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn(),
  renameSync: vi.fn()
}))

import { SetupManager } from '../index'

type ExecFileCallback = (err: Error | null, stdout?: string, stderr?: string) => void

function mockExecFileSuccess(): void {
  execFileMock.mockImplementation((_file: string, args: string[], cb: ExecFileCallback) => {
    if (Array.isArray(args) && args.includes('--version')) {
      cb(null, 'Python 3.11.9\n')
    } else {
      cb(null, '', '')
    }
  })
}

describe('SetupManager readiness caching', () => {
  beforeEach(() => {
    execFileMock.mockReset()
    existsSyncMock.mockReset()
  })

  it('runs full verification and caches the result on a successful check', async () => {
    existsSyncMock.mockReturnValue(true)
    mockExecFileSuccess()
    const manager = new SetupManager(false)

    const result = await manager.isSetupComplete()

    expect(result).toBe(true)
    expect(execFileMock).toHaveBeenCalled()
    // Internal cache field set only on a fully-passing check (see design.md).
    expect((manager as unknown as { cachedReady: boolean | null }).cachedReady).toBe(true)
  })

  it('reuses the cached result without re-spawning verification processes', async () => {
    existsSyncMock.mockReturnValue(true)
    mockExecFileSuccess()
    const manager = new SetupManager(false)

    await manager.isSetupComplete()
    execFileMock.mockClear()

    const second = await manager.isSetupComplete()

    expect(second).toBe(true)
    expect(execFileMock).not.toHaveBeenCalled()
  })

  it('never caches a failed readiness check, so the next call re-verifies', async () => {
    // Simulate a missing venv: `check('venv')` short-circuits to false via
    // `existsSync(VENV_PYTHON)` without needing execFile at all.
    existsSyncMock.mockReturnValue(false)
    mockExecFileSuccess()
    const manager = new SetupManager(false)

    const first = await manager.isSetupComplete()
    expect(first).toBe(false)
    expect((manager as unknown as { cachedReady: boolean | null }).cachedReady).toBeNull()

    execFileMock.mockClear()
    const second = await manager.isSetupComplete()
    expect(second).toBe(false)
    // Re-verified from scratch: the Python version probe fired again.
    expect(execFileMock).toHaveBeenCalled()
  })

  it('resets the cached readiness state when run() starts', async () => {
    const manager = new SetupManager(true) // simMode: run() resolves without spawning anything
    ;(manager as unknown as { cachedReady: boolean | null }).cachedReady = true

    await manager.run()

    expect((manager as unknown as { cachedReady: boolean | null }).cachedReady).toBeNull()
  })
})

describe('SetupManager verification concurrency', () => {
  beforeEach(() => {
    execFileMock.mockReset()
    existsSyncMock.mockReset()
  })

  it('probes all compatible Python versions concurrently, not sequentially', async () => {
    existsSyncMock.mockReturnValue(false)
    // Never resolve, so we can inspect call count before anything settles.
    execFileMock.mockImplementation(() => {})
    const manager = new SetupManager(false)

    // Don't await: Promise.all's `.map()` invokes every candidate's execFile
    // call synchronously before the surrounding async function suspends, so
    // all probes should already have been issued by the time this next line runs.
    void (manager as unknown as { checkPython: () => Promise<boolean> }).checkPython()

    // COMPATIBLE_PYTHON_VERSIONS has 3 entries (3.11, 3.10, 3.9).
    expect(execFileMock).toHaveBeenCalledTimes(3)
  })

  it('checks all Demucs dependency packages concurrently, not sequentially', async () => {
    existsSyncMock.mockReturnValue(true)
    execFileMock.mockImplementation(() => {})
    const manager = new SetupManager(false)

    void (manager as unknown as { checkDemucs: () => Promise<boolean> }).checkDemucs()

    // demucs, torch, torchaudio, librosa, yt-dlp (beat-this is optional)
    expect(execFileMock).toHaveBeenCalledTimes(5)
  })

  it('runs a python path containing spaces as one program, not split at the space', async () => {
    execFileMock.mockImplementation((_f: string, _a: string[], cb: ExecFileCallback) => cb(null))
    const manager = new SetupManager(false)
    const python = 'C:\\Users\\Juan Perez\\venv\\Scripts\\python.exe'
    ;(manager as unknown as { getPythonPath: () => string }).getPythonPath = () => python

    const ok = await (manager as unknown as { checkDemucs: () => Promise<boolean> }).checkDemucs()

    expect(ok).toBe(true)
    expect(execFileMock).toHaveBeenCalledWith(
      python,
      ['-m', 'pip', 'show', 'demucs'],
      expect.any(Function)
    )
  })
})

function mockSpawnSuccess(): void {
  spawnMock.mockImplementation(() => {
    const proc = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter }
    proc.stdout = new EventEmitter()
    proc.stderr = new EventEmitter()
    // Resolve on the next tick so `spawnAsync`'s Promise executor has already
    // registered its 'close' listener.
    setImmediate(() => proc.emit('close', 0))
    return proc
  })
}

describe('SetupManager - GPU-aware torch install (Windows)', () => {
  beforeEach(() => {
    execFileMock.mockReset()
    spawnMock.mockReset()
  })

  it('hasNvidiaGpu reflects whether `nvidia-smi -L` succeeds', async () => {
    execFileMock.mockImplementation((_file, _args, cb) => cb(null, '', ''))
    const manager = new SetupManager(false)

    const present = await (
      manager as unknown as { hasNvidiaGpu: () => Promise<boolean> }
    ).hasNvidiaGpu()
    expect(present).toBe(true)
    expect(execFileMock).toHaveBeenCalledWith('nvidia-smi', ['-L'], expect.any(Function))

    execFileMock.mockImplementation((_file, _args, cb) => cb(new Error('not found')))
    const absent = await (
      manager as unknown as { hasNvidiaGpu: () => Promise<boolean> }
    ).hasNvidiaGpu()
    expect(absent).toBe(false)
  })

  // isWin is resolved from process.platform at module load time, so the
  // Windows-only branch itself can't be exercised on a non-Windows test
  // runner — this confirms the non-Windows path stays unaffected regardless
  // of GPU presence, which is what we can verify in this environment.
  it('does not force the CPU-only wheel on non-Windows platforms regardless of GPU detection', async () => {
    execFileMock.mockImplementation((_file, _args, cb) => cb(null, '', ''))
    mockSpawnSuccess()
    const manager = new SetupManager(false)

    await (manager as unknown as { installDemucs: () => Promise<boolean> }).installDemucs()

    const spawnArgs = spawnMock.mock.calls[0][1] as string[]
    expect(spawnArgs).not.toContain('--extra-index-url')
  })
})
