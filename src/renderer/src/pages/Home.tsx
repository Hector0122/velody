import { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react'
import AudioUploader from '../components/AudioUploader'
import UrlImporter from '../components/UrlImporter'
import StemPlayer from '../components/StemPlayer'

interface RecentSong {
  name: string
  stems: string[]
}

interface Toast {
  id: number
  message: string
  type: 'error' | 'success'
}

interface PendingFile {
  name: string
  path: string
}

let toastCounter = 0

function Home(): React.JSX.Element {
  const [currentSong, setCurrentSong] = useState<{
    stems: string[]
    songName: string
  } | null>(null)
  const [jobQueue, setJobQueue] = useState<SeparationJob[]>([])
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([])
  const [recentSongs, setRecentSongs] = useState<RecentSong[]>([])
  const [toasts, setToasts] = useState<Toast[]>([])
  const [error, setError] = useState<string | null>(null)
  const [importMode, setImportMode] = useState<'local' | 'url'>('local')
  const jobQueueRef = useRef<SeparationJob[]>([])

  useLayoutEffect(() => {
    jobQueueRef.current = jobQueue
  })

  const addToast = useCallback((message: string, type: 'error' | 'success' = 'error') => {
    const id = ++toastCounter
    setToasts((prev) => [...prev, { id, message, type }])
    const duration = type === 'error' ? 8000 : 4000
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), duration)
  }, [])

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  // Subscribe to backend events
  useEffect(() => {
    if (!window.api) return

    const unsubProgress = window.api.onSeparationProgress((e) => {
      setJobQueue((prev) => prev.map((j) => (j.id === e.jobId ? { ...j, progress: e.percent } : j)))
    })

    const unsubComplete = window.api.onSeparationComplete((e) => {
      setJobQueue((prev) =>
        prev.map((j) =>
          j.id === e.jobId ? { ...j, status: 'completed', stems: e.stems, progress: 100 } : j
        )
      )
      window.api.listSongs().then(setRecentSongs)
      const name = jobQueueRef.current.find((j) => j.id === e.jobId)?.songName ?? e.jobId
      addToast(`\u2714 Ready: ${name}`, 'success')
    })

    const unsubFailed = window.api.onSeparationFailed((e) => {
      setJobQueue((prev) =>
        prev.map((j) => (j.id === e.jobId ? { ...j, status: 'failed', error: e.error } : j))
      )
      const name = jobQueueRef.current.find((j) => j.id === e.jobId)?.songName ?? e.jobId
      addToast(`Failed: ${name}`, 'error')
    })

    const unsubCancelled = window.api.onSeparationCancelled((e) => {
      setJobQueue((prev) => prev.map((j) => (j.id === e.jobId ? { ...j, status: 'cancelled' } : j)))
    })

    const unsubChanged = window.api.onSeparationJobsChanged((jobs) => {
      setJobQueue(jobs)
    })

    const unsubDlProgress = window.api.onDownloadProgress((e) => {
      setJobQueue((prev) =>
        prev.map((j) =>
          j.id === e.jobId ? { ...j, progress: e.percent, songName: e.title ?? j.songName } : j
        )
      )
    })

    const unsubDlFailed = window.api.onDownloadFailed((e) => {
      setJobQueue((prev) =>
        prev.map((j) => (j.id === e.jobId ? { ...j, status: 'failed', error: e.error } : j))
      )
      addToast(`Download failed: ${e.error}`, 'error')
    })

    return () => {
      unsubProgress()
      unsubComplete()
      unsubFailed()
      unsubCancelled()
      unsubChanged()
      unsubDlProgress()
      unsubDlFailed()
    }
  }, [addToast])

  // Load recent songs and active jobs on mount
  useEffect(() => {
    if (!window.api) return
    window.api.listSongs().then(setRecentSongs)
    window.api.listSeparationJobs().then(setJobQueue)
  }, [])

  const handleOpenFile = async (): Promise<void> => {
    if (!window.api) return
    const path = await window.api.openFileDialog()
    if (!path) return
    const parts = path.split(/[/\\]/)
    setPendingFiles((prev) => [...prev, { name: parts[parts.length - 1], path }])
  }

  const handleFilesAdded = (paths: string[]): void => {
    const newFiles = paths.map((p) => {
      const parts = p.split(/[/\\]/)
      return { name: parts[parts.length - 1], path: p }
    })
    setPendingFiles((prev) => [...prev, ...newFiles])
  }

  const handleRemoveFile = (path: string): void => {
    setPendingFiles((prev) => prev.filter((f) => f.path !== path))
  }

  const handleProcessAll = async (): Promise<void> => {
    if (!window.api || pendingFiles.length === 0) return
    setError(null)

    const files = [...pendingFiles]
    setPendingFiles([])

    for (const file of files) {
      try {
        const result = await window.api.startSeparation(file.path)
        setJobQueue((prev) => {
          if (prev.some((j) => j.id === result.jobId)) return prev
          return [
            ...prev,
            {
              id: result.jobId,
              songPath: file.path,
              songName: result.songName,
              status: 'queued',
              progress: 0
            }
          ]
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to queue'
        setError(msg)
        addToast(msg, 'error')
      }
    }
    addToast(`${files.length} song(s) added to queue`, 'success')
  }

  const handleSelectRecent = (song: RecentSong): void => {
    setError(null)
    setCurrentSong({ stems: song.stems, songName: song.name })
  }

  const handleUrlImport = (url: string, jobId: string, songName: string): void => {
    setJobQueue((prev) => {
      if (prev.some((j) => j.id === jobId)) return prev
      return [...prev, { id: jobId, songPath: url, songName, status: 'queued', progress: 0 }]
    })
  }

  const handleCancelJob = async (jobId: string): Promise<void> => {
    if (!window.api) return
    await window.api.cancelSeparation(jobId)
  }

  const handleDeleteSong = async (song: RecentSong, e: React.MouseEvent): Promise<void> => {
    e.stopPropagation()
    if (!window.api) return

    // Cancel running/queued jobs for this song first
    const normalized = song.name.toLowerCase()
    for (const job of jobQueueRef.current) {
      if (
        job.songName.toLowerCase() === normalized &&
        (job.status === 'queued' || job.status === 'running')
      ) {
        await window.api.cancelSeparation(job.id)
      }
    }

    await window.api.deleteSong(song.name)
    setRecentSongs((prev) => prev.filter((s) => s.name !== song.name))
    setJobQueue((prev) => prev.filter((j) => j.songName.toLowerCase() !== normalized))
    if (currentSong?.songName === song.name) setCurrentSong(null)
  }

  const queuedJobs = jobQueue.filter(
    (j) =>
      j.status === 'queued' ||
      j.status === 'running' ||
      j.status === 'failed' ||
      j.status === 'cancelled'
  )

  return (
    <div className="min-h-screen bg-neutral-950 flex">
      {/* Sidebar */}
      <aside className="w-52 shrink-0 border-r border-neutral-800 flex flex-col">
        <div className="p-4 border-b border-neutral-800">
          <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
            Velody
          </h1>
        </div>

        <button
          onClick={handleOpenFile}
          className="mx-3 mt-3 px-3 py-2 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white transition-colors"
        >
          + New Song
        </button>

        {/* Queue */}
        {queuedJobs.length > 0 && (
          <div className="mt-3 mx-3">
            <h3 className="text-[10px] font-semibold text-neutral-500 uppercase tracking-wide mb-1.5">
              Queue
            </h3>
            <div className="space-y-1">
              {queuedJobs.map((job) => (
                <div
                  key={job.id}
                  className={`rounded-lg border p-2 flex flex-col gap-1 ${
                    job.status === 'failed'
                      ? 'bg-red-950/50 border-red-800/50'
                      : job.status === 'cancelled'
                        ? 'bg-neutral-900/50 border-neutral-800/50'
                        : 'bg-neutral-900 border-neutral-800'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`text-[10px] truncate flex-1 ${
                        job.status === 'failed'
                          ? 'text-red-400'
                          : job.status === 'cancelled'
                            ? 'text-neutral-600'
                            : 'text-neutral-300'
                      }`}
                    >
                      {job.songName}
                    </span>
                    {job.status !== 'failed' && job.status !== 'cancelled' && (
                      <button
                        onClick={() => handleCancelJob(job.id)}
                        className="text-[9px] text-neutral-600 hover:text-red-400 transition-colors shrink-0"
                        title="Cancel"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  {job.status === 'running' && (
                    <div className="w-full bg-neutral-800 rounded-full h-1.5 overflow-hidden">
                      <div
                        className="bg-blue-500 h-full rounded-full transition-all duration-300"
                        style={{ width: `${job.progress}%` }}
                      />
                    </div>
                  )}
                  {job.status === 'queued' && (
                    <span className="text-[9px] text-neutral-600">Waiting...</span>
                  )}
                  {job.status === 'failed' && (
                    <span className="text-[9px] text-red-400/80 truncate" title={job.error}>
                      Failed: {job.error ?? 'Unknown error'}
                    </span>
                  )}
                  {job.status === 'cancelled' && (
                    <span className="text-[9px] text-neutral-600">Cancelled</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-3 mt-3 space-y-1">
          <h3 className="text-[10px] font-semibold text-neutral-500 uppercase tracking-wide mb-1.5">
            Recent Songs
          </h3>
          {recentSongs.map((song) => (
            <div key={song.name} className="relative group">
              <button
                onClick={() => handleSelectRecent(song)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                  currentSong?.songName === song.name
                    ? 'bg-blue-600/20 text-blue-300 border border-blue-600/30'
                    : 'text-neutral-400 hover:text-white hover:bg-neutral-800'
                }`}
              >
                <span className="truncate block">{song.name}</span>
              </button>
              <button
                onClick={(e) => handleDeleteSong(song, e)}
                className="absolute right-1 top-1/2 -translate-y-1/2 w-6 h-6 rounded flex items-center justify-center text-neutral-600 hover:text-red-400 hover:bg-red-900/30 transition-colors opacity-0 group-hover:opacity-100 text-xs"
                title="Delete song"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col p-8 min-w-0">
        {error && (
          <div className="mb-6 p-4 bg-red-900/30 border border-red-600 rounded-xl text-red-400 text-sm">
            {error}
          </div>
        )}

        {currentSong ? (
          <StemPlayer
            key={currentSong.songName}
            stems={currentSong.stems}
            songName={currentSong.songName}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center max-w-md">
              <p className="text-neutral-500 mb-4">Import a song to get started</p>

              <div className="flex gap-1 mb-6 bg-neutral-900 rounded-xl p-1 border border-neutral-800">
                <button
                  onClick={() => setImportMode('local')}
                  className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                    importMode === 'local'
                      ? 'bg-neutral-800 text-white'
                      : 'text-neutral-500 hover:text-neutral-300'
                  }`}
                >
                  Local Files
                </button>
                <button
                  onClick={() => setImportMode('url')}
                  className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                    importMode === 'url'
                      ? 'bg-neutral-800 text-white'
                      : 'text-neutral-500 hover:text-neutral-300'
                  }`}
                >
                  From URL
                </button>
              </div>

              {importMode === 'local' ? (
                <AudioUploader
                  files={pendingFiles}
                  onFilesAdded={handleFilesAdded}
                  onRemoveFile={handleRemoveFile}
                  onProcessAll={handleProcessAll}
                />
              ) : (
                <UrlImporter onImportStarted={handleUrlImport} />
              )}
            </div>
          </div>
        )}
      </main>

      {/* Toast notifications */}
      {toasts.length > 0 && (
        <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`px-4 py-3 pr-8 rounded-xl text-sm font-medium shadow-lg animate-[slideUp_0.3s_ease-out] relative ${
                t.type === 'error'
                  ? 'bg-red-900/90 text-red-300 border border-red-700'
                  : 'bg-green-900/90 text-green-300 border border-green-700'
              }`}
            >
              {t.message}
              {t.type === 'error' && (
                <button
                  onClick={() => dismissToast(t.id)}
                  className="absolute top-1.5 right-1.5 w-5 h-5 rounded flex items-center justify-center text-red-400/60 hover:text-red-300 hover:bg-red-800/40 transition-colors text-xs"
                  title="Dismiss"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default Home
