import { describe, it, expect } from 'vitest'
import { SerialTaskQueue } from '../taskQueue'

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('SerialTaskQueue', () => {
  it('runs one task at a time, in order', async () => {
    const q = new SerialTaskQueue<string>()
    const order: string[] = []
    const a = deferred<string>()
    const pA = q.run('a', async () => {
      order.push('start a')
      return a.promise
    })
    const pB = q.run('b', async () => {
      order.push('start b')
      return 'b'
    })
    await tick()
    expect(order).toEqual(['start a']) // b waits for a
    a.resolve('a')
    expect(await pA).toBe('a')
    expect(await pB).toBe('b')
    expect(order).toEqual(['start a', 'start b'])
  })

  it('gives each key its own result (no cross-song answers)', async () => {
    const q = new SerialTaskQueue<string>()
    const [x, y] = await Promise.all([
      q.run('song-x', async () => 'bpm of x'),
      q.run('song-y', async () => 'bpm of y')
    ])
    expect(x).toBe('bpm of x')
    expect(y).toBe('bpm of y')
  })

  it('deduplicates the same key while queued or running', async () => {
    const q = new SerialTaskQueue<number>()
    let runs = 0
    const gate = deferred<void>()
    const task = async (): Promise<number> => {
      runs++
      await gate.promise
      return 42
    }
    const p1 = q.run('same', task)
    const p2 = q.run('same', task)
    gate.resolve()
    expect(await Promise.all([p1, p2])).toEqual([42, 42])
    expect(runs).toBe(1)
  })

  it('lets a high-priority task jump ahead of queued background work', async () => {
    const q = new SerialTaskQueue<string>()
    const order: string[] = []
    const gate = deferred<void>()
    const job = (name: string) => async (): Promise<string> => {
      order.push(name)
      if (name === 'bg1') await gate.promise
      return name
    }
    q.run('bg1', job('bg1'), 'low')
    q.run('bg2', job('bg2'), 'low')
    q.run('bg3', job('bg3'), 'low')
    const opened = q.run('opened-song', job('opened-song'), 'high')
    // A background entry requested again with high priority is promoted too.
    const promoted = q.run('bg3', job('bg3'), 'high')
    gate.resolve()
    await Promise.all([opened, promoted])
    expect(order.slice(0, 3)).toEqual(['bg1', 'opened-song', 'bg3'])
  })

  it('keeps going after a task fails', async () => {
    const q = new SerialTaskQueue<string>()
    const failed = q.run('bad', async () => {
      throw new Error('boom')
    })
    const ok = q.run('good', async () => 'fine')
    await expect(failed).rejects.toThrow('boom')
    expect(await ok).toBe('fine')
  })
})
