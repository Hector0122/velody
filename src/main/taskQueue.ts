// Serial task queue: runs one task at a time, deduplicates by key, and lets
// high-priority tasks jump ahead of queued low-priority ones.
//
// Used for BPM detection: only one TempoCNN/TensorFlow process may run at a
// time (several at once OOM low-RAM machines — see CLAUDE.md), the song the
// user just opened must not wait behind background analysis of the whole
// library, and concurrent requests for the *same* song share one run. (The
// previous "singleflight" handed whatever detection was in flight to every
// concurrent caller — even for a different song.)

type Priority = 'high' | 'low'

interface Entry<T> {
  key: string
  priority: Priority
  task: () => Promise<T>
  promise: Promise<T>
  resolve: (v: T) => void
  reject: (e: unknown) => void
}

export class SerialTaskQueue<T> {
  private queue: Entry<T>[] = []
  private running: Entry<T> | null = null

  /** Runs `task` (or joins an identical queued/running one with the same key). */
  run(key: string, task: () => Promise<T>, priority: Priority = 'low'): Promise<T> {
    if (this.running?.key === key) return this.running.promise
    const queued = this.queue.find((e) => e.key === key)
    if (queued) {
      if (priority === 'high' && queued.priority === 'low') {
        // Promote: move it ahead of every low-priority entry.
        this.queue = this.queue.filter((e) => e !== queued)
        queued.priority = 'high'
        this.insert(queued)
      }
      return queued.promise
    }

    let resolve!: (v: T) => void
    let reject!: (e: unknown) => void
    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })
    this.insert({ key, priority, task, promise, resolve, reject })
    this.pump()
    return promise
  }

  /** Number of tasks waiting (not counting the running one). */
  get pending(): number {
    return this.queue.length
  }

  has(key: string): boolean {
    return this.running?.key === key || this.queue.some((e) => e.key === key)
  }

  private insert(entry: Entry<T>): void {
    if (entry.priority === 'high') {
      // After other high-priority entries (FIFO among them), before any low.
      const firstLow = this.queue.findIndex((e) => e.priority === 'low')
      if (firstLow === -1) this.queue.push(entry)
      else this.queue.splice(firstLow, 0, entry)
    } else {
      this.queue.push(entry)
    }
  }

  private pump(): void {
    if (this.running || this.queue.length === 0) return
    const entry = this.queue.shift()!
    this.running = entry
    Promise.resolve()
      .then(entry.task)
      .then(entry.resolve, entry.reject)
      .finally(() => {
        this.running = null
        this.pump()
      })
  }
}
