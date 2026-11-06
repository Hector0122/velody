import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'
import { PassThrough } from 'stream'

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('../../paths', () => ({
  getStemsRootDir: () => '/stems',
  getPythonWorkerDir: () => '/worker'
}))
const rmMock = vi.fn(() => Promise.resolve())
vi.mock('fs/promises', () => ({
  rm: (...a: unknown[]) => (rmMock as (...x: unknown[]) => unknown)(...a)
}))

type FakeProc = EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: () => void }
let proc: FakeProc
vi.mock('child_process', () => ({ spawn: () => proc }))

import { JobManager } from '../JobManager'
import type { SetupManager } from '../../setup'

const setup = {
  canUseRealDemucs: async () => true,
  getPythonPath: () => 'python3'
} as unknown as SetupManager

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('JobManager', () => {
  beforeEach(() => {
    rmMock.mockClear()
    proc = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn()
    })
  })

  it('reads a result line that arrives split across two stdout chunks', async () => {
    const manager = new JobManager(setup)
    const done = new Promise<string[]>((r) => manager.onJobCompleted(r))
    manager.enqueue('/music/song.mp3')
    await tick()
    proc.stdout.write('{"type": "complete", "stems": ["/stems/song/dru')
    proc.stdout.write('ms.mp3"]}\n')
    await tick()
    proc.emit('close', 0)
    expect(await done).toEqual(['/stems/song/drums.mp3'])
  })

  it('deletes the downloaded temp dir when a running job is cancelled', async () => {
    const manager = new JobManager(setup)
    const job = manager.enqueue('/tmp/velody_dl_x/song.mp3', { tempDir: '/tmp/velody_dl_x' })
    await tick()
    expect(manager.cancel(job.id)).toBe(true)
    expect(rmMock).toHaveBeenCalledWith('/tmp/velody_dl_x', { recursive: true, force: true })
  })
})
