import { useState, useEffect, useCallback, useRef, useLayoutEffect, useMemo } from 'react'
import AudioUploader from '../components/AudioUploader'
import UrlImporter from '../components/UrlImporter'
import StemPlayer from '../components/StemPlayer'
import SetlistPanel from '../components/SetlistPanel'
import UpdateBanner from '../components/UpdateBanner'
import CloudSettingsModal from '../components/CloudSettingsModal'
import DeleteSongDialog, { type DeleteChoice } from '../components/DeleteSongDialog'
import useLocalStoragePreference from '../hooks/useLocalStoragePreference'
import {
  filterSongsByQuery,
  formatBytes,
  reorderSetlistSongs,
  resolveNextSetlistSong,
  songCloudActions
} from '../utils'
import type { CloudProgressEvent } from '../../../shared/cloud'

interface RecentSong {
  name: string
  stems: string[]
  sync?: 'local' | 'cloud' | 'synced'
  cloudId?: string
  sizeBytes?: number
}

interface Toast {
  id: number
  message: string
  type: 'error' | 'success'
  action?: { label: string; onClick: () => void }
}

interface PendingFile {
  name: string
  path: string
}

let toastCounter = 0

type StemBitrate = 128 | 192 | 320

// Approximate size of the 6 stems of a 4-minute song at each bitrate.
const STEM_BITRATE_OPTIONS: { value: StemBitrate; hint: string }[] = [
  { value: 128, hint: '~23 MB per song — fine for practice' },
  { value: 192, hint: '~35 MB per song — balanced' },
  { value: 320, hint: '~58 MB per song — maximum quality' }
]

const isStemBitrate = (v: unknown): v is StemBitrate => v === 128 || v === 192 || v === 320
const isBoolean = (v: unknown): v is boolean => typeof v === 'boolean'
const SIDEBAR_MIN = 208
const SIDEBAR_MAX = 520
const isSidebarWidth = (v: unknown): v is number =>
  typeof v === 'number' && v >= SIDEBAR_MIN && v <= SIDEBAR_MAX

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
  // MP3 bitrate for newly separated stems; remembered, changeable per import.
  const [stemBitrate, setStemBitrate] = useLocalStoragePreference<StemBitrate>(
    'velody:stemBitrate',
    128,
    isStemBitrate
  )
  const [showNewSongMenu, setShowNewSongMenu] = useState(false)
  const [songSearch, setSongSearch] = useState('')
  const [sidebarView, setSidebarView] = useState<'library' | 'setlists'>('library')
  // Live-band features (Setlists, Live Presets) are hidden unless this is on.
  const [liveMode, setLiveMode] = useLocalStoragePreference<boolean>(
    'velody:liveMode',
    false,
    isBoolean
  )
  // Sidebar width, dragged from its right edge; long song names need room.
  const [sidebarWidth, setSidebarWidth] = useLocalStoragePreference<number>(
    'velody:sidebarWidth',
    SIDEBAR_MIN,
    isSidebarWidth
  )
  const startSidebarResize = (e: React.MouseEvent): void => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = sidebarWidth
    const onMove = (ev: MouseEvent): void =>
      setSidebarWidth(
        Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, startWidth + ev.clientX - startX))
      )
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }
  const [setlists, setSetlists] = useState<Setlist[]>([])
  const [activeSetlistId, setActiveSetlistId] = useState<string | null>(null)
  // Setlist actions in the library only apply while live mode is on.
  const libraryActiveSetlistId = liveMode ? activeSetlistId : null
  // Which setlist + index the currently open song was opened from, so
  // "Next song" (StemPlayer) knows what to advance to. Cleared whenever a
  // song is opened from anywhere other than the active setlist's song list.
  const [songSetlistContext, setSongSetlistContext] = useState<{
    setlistId: string
    index: number
  } | null>(null)
  const newSongMenuRef = useRef<HTMLDivElement>(null)
  const jobQueueRef = useRef<SeparationJob[]>([])
  // Cloud sync (cloud-library-sync): per-song transfer progress, offline
  // state, the song being downloaded to open, and dialogs.
  const [transfers, setTransfers] = useState<Record<string, CloudProgressEvent>>({})
  const [cloudStatus, setCloudStatus] = useState<{ enabled: boolean; offline: boolean }>({
    enabled: false,
    offline: false
  })
  const [openingSong, setOpeningSong] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<RecentSong | null>(null)
  const [showCloudSettings, setShowCloudSettings] = useState(false)

  const refreshSongs = useCallback(async (): Promise<RecentSong[]> => {
    if (!window.api) return []
    const songs = await window.api.listSongs()
    setRecentSongs(songs)
    window.api.getCloudStatus?.().then(setCloudStatus)
    return songs
  }, [])

  useLayoutEffect(() => {
    jobQueueRef.current = jobQueue
  })

  const addToast = useCallback(
    (message: string, type: 'error' | 'success' = 'error', action?: Toast['action']) => {
      const id = ++toastCounter
      setToasts((prev) => [...prev, { id, message, type, action }])
      const duration = type === 'error' ? 8000 : 4000
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), duration)
    },
    []
  )

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
      refreshSongs()
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
      if (e.error.includes('[UPDATE_YTDLP]')) {
        addToast('YouTube blocked the download. yt-dlp needs to be updated.', 'error', {
          label: 'Update yt-dlp',
          onClick: async () => {
            addToast('Updating yt-dlp...', 'success')
            const result = await window.api.updateYtDlp()
            if (result.success) {
              addToast('yt-dlp updated successfully. Try downloading again.', 'success')
            } else {
              addToast(`Update failed: ${result.error ?? 'unknown error'}`, 'error')
            }
          }
        })
      } else {
        addToast(`Download failed: ${e.error}`, 'error')
      }
    })

    const unsubCloud = window.api.onCloudProgress?.((e) => {
      setTransfers((prev) => {
        const next = { ...prev }
        if (e.status === 'done' || e.status === 'failed') delete next[e.songName]
        else next[e.songName] = e
        return next
      })
      if (e.status === 'failed' && e.kind === 'upload') {
        addToast(`Upload failed: ${e.songName} — ${e.error ?? 'unknown error'}`, 'error')
      }
      if (e.status === 'done' && e.kind === 'upload') {
        setRecentSongs((prev) =>
          prev.map((s) => (s.name === e.songName ? { ...s, sync: 'synced' } : s))
        )
      }
    })

    return () => {
      unsubCloud?.()
      unsubProgress()
      unsubComplete()
      unsubFailed()
      unsubCancelled()
      unsubChanged()
      unsubDlProgress()
      unsubDlFailed()
    }
  }, [addToast, refreshSongs])

  // Load recent songs and active jobs on mount
  useEffect(() => {
    if (!window.api) return
    // Status is computed while the library is listed, so ask for it after.
    window.api.listSongs().then((songs) => {
      setRecentSongs(songs)
      window.api.getCloudStatus?.().then(setCloudStatus)
    })
    window.api.listSeparationJobs().then(setJobQueue)
    window.api.listSetlists().then(setSetlists)
  }, [])

  // Close new song menu on outside click
  useEffect(() => {
    if (!showNewSongMenu) return
    const handleClick = (e: MouseEvent): void => {
      if (newSongMenuRef.current && !newSongMenuRef.current.contains(e.target as Node)) {
        setShowNewSongMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showNewSongMenu])

  const handleOpenFile = useCallback(async (): Promise<void> => {
    if (!window.api) return
    const path = await window.api.openFileDialog()
    if (!path) return
    const parts = path.split(/[/\\]/)
    setPendingFiles((prev) => [...prev, { name: parts[parts.length - 1], path }])
  }, [])

  const handleNewSongLocal = useCallback((): void => {
    setShowNewSongMenu(false)
    setCurrentSong(null)
    setImportMode('local')
    handleOpenFile()
  }, [handleOpenFile])

  const handleNewSongUrl = useCallback((): void => {
    setShowNewSongMenu(false)
    setCurrentSong(null)
    setImportMode('url')
  }, [])

  const handleFilesAdded = useCallback((paths: string[]): void => {
    const newFiles = paths.map((p) => {
      const parts = p.split(/[/\\]/)
      return { name: parts[parts.length - 1], path: p }
    })
    setPendingFiles((prev) => [...prev, ...newFiles])
  }, [])

  const handleRemoveFile = useCallback((path: string): void => {
    setPendingFiles((prev) => prev.filter((f) => f.path !== path))
  }, [])

  const handleProcessAll = async (): Promise<void> => {
    if (!window.api || pendingFiles.length === 0) return
    setError(null)

    const files = [...pendingFiles]
    setPendingFiles([])

    for (const file of files) {
      try {
        const result = await window.api.startSeparation(file.path, stemBitrate)
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

  // A cloud-only song is downloaded before it opens (the engine needs whole
  // files); a synced one gets its metadata brought up to date (fail-fast).
  const ensureLocal = useCallback(
    async (song: RecentSong): Promise<RecentSong | null> => {
      if (song.sync === 'cloud') {
        setOpeningSong(song.name)
        try {
          const r = await window.api.cloudDownload(song.name)
          if (!r.success) {
            addToast(`Download failed: ${r.error ?? 'unknown error'}`, 'error')
            return null
          }
          const songs = await refreshSongs()
          return songs.find((s) => s.name === (r.songName ?? song.name)) ?? null
        } finally {
          setOpeningSong(null)
        }
      }
      if (song.sync === 'synced') await window.api.cloudSyncMetaOnOpen(song.name)
      return song
    },
    [addToast, refreshSongs]
  )

  const handleSelectRecent = useCallback(
    async (song: RecentSong): Promise<void> => {
      setError(null)
      const local = await ensureLocal(song)
      if (!local) return
      setCurrentSong({ stems: local.stems, songName: local.name })
      setSongSetlistContext(null)
    },
    [ensureLocal]
  )

  const handleUrlImport = useCallback((url: string, jobId: string, songName: string): void => {
    setJobQueue((prev) => {
      if (prev.some((j) => j.id === jobId)) return prev
      return [...prev, { id: jobId, songPath: url, songName, status: 'queued', progress: 0 }]
    })
  }, [])

  const handleCancelJob = useCallback(async (jobId: string): Promise<void> => {
    if (!window.api) return
    await window.api.cancelSeparation(jobId)
  }, [])

  const handleDeleteSong = async (song: RecentSong, e: React.MouseEvent): Promise<void> => {
    e.stopPropagation()
    if (!window.api) return
    // Cloud sync off: unchanged behavior. On: confirm, and for songs in the
    // cloud choose between removing the local copy and deleting everywhere.
    if (song.sync === undefined) await deleteLocalSong(song)
    else setDeleteTarget(song)
  }

  const handleConfirmDelete = async (choice: DeleteChoice): Promise<void> => {
    const song = deleteTarget
    setDeleteTarget(null)
    if (!song) return
    if (choice === 'local') {
      await deleteLocalSong(song)
      return
    }
    const r =
      choice === 'removeLocal'
        ? await window.api.cloudRemoveLocal(song.name)
        : await window.api.cloudDeleteEverywhere(song.name)
    if (!r.success) {
      addToast(r.error ?? 'Could not delete the song', 'error')
      return
    }
    addToast(
      choice === 'removeLocal' ? `Removed from this laptop: ${song.name}` : `Deleted: ${song.name}`,
      'success'
    )
    if (currentSong?.songName === song.name) setCurrentSong(null)
    refreshSongs()
    if (choice === 'everywhere') window.api.listSetlists().then(setSetlists)
  }

  const handleUploadSong = (song: RecentSong, e: React.MouseEvent): void => {
    e.stopPropagation()
    window.api.cloudUpload(song.name).then((r) => {
      if (r.success) addToast(`Uploaded: ${song.name}`, 'success')
      refreshSongs()
    })
  }

  const handleDownloadSong = (song: RecentSong, e: React.MouseEvent): void => {
    e.stopPropagation()
    window.api.cloudDownload(song.name).then((r) => {
      if (r.success) addToast(`Downloaded: ${song.name}`, 'success')
      else addToast(`Download failed: ${r.error ?? 'unknown error'}`, 'error')
      refreshSongs()
    })
  }

  const deleteLocalSong = async (song: RecentSong): Promise<void> => {
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
    // The backend already pruned this song from every setlist's songNames
    // (song:delete) — re-fetch to pick up that change locally rather than
    // re-implementing the same pruning logic client-side.
    window.api.listSetlists().then(setSetlists)
  }

  const handleCreateSetlist = useCallback(async (name: string): Promise<void> => {
    if (!window.api) return
    const saved = await window.api.saveSetlist({
      id: crypto.randomUUID(),
      name,
      songNames: [],
      updatedAt: Date.now()
    })
    setSetlists((prev) => [...prev, saved])
    setActiveSetlistId(saved.id)
  }, [])

  const handleDeleteSetlist = useCallback(
    async (id: string): Promise<void> => {
      if (!window.api) return
      await window.api.deleteSetlist(id)
      setSetlists((prev) => prev.filter((sl) => sl.id !== id))
      if (activeSetlistId === id) setActiveSetlistId(null)
      if (songSetlistContext?.setlistId === id) setSongSetlistContext(null)
    },
    [activeSetlistId, songSetlistContext]
  )

  const handleSelectSetlistSong = useCallback(
    async (song: RecentSong, setlistId: string, index: number): Promise<void> => {
      setError(null)
      const local = await ensureLocal(song)
      if (!local) return
      setCurrentSong({ stems: local.stems, songName: local.name })
      setSongSetlistContext({ setlistId, index })
    },
    [ensureLocal]
  )

  const persistSetlist = useCallback(async (updated: Setlist): Promise<void> => {
    if (!window.api) return
    const saved = await window.api.saveSetlist(updated)
    setSetlists((prev) => prev.map((sl) => (sl.id === saved.id ? saved : sl)))
  }, [])

  const handleRemoveSongFromSetlist = useCallback(
    (setlistId: string, songName: string): void => {
      const sl = setlists.find((s) => s.id === setlistId)
      if (!sl) return
      persistSetlist({ ...sl, songNames: sl.songNames.filter((n) => n !== songName) })
    },
    [setlists, persistSetlist]
  )

  const handleMoveSongInSetlist = useCallback(
    (setlistId: string, index: number, direction: -1 | 1): void => {
      const sl = setlists.find((s) => s.id === setlistId)
      if (!sl) return
      const songNames = reorderSetlistSongs(sl.songNames, index, direction)
      if (songNames === sl.songNames) return // out of bounds — no-op
      persistSetlist({ ...sl, songNames })
    },
    [setlists, persistSetlist]
  )

  const handleAddSongToActiveSetlist = useCallback(
    (song: RecentSong): void => {
      if (!activeSetlistId) return
      const sl = setlists.find((s) => s.id === activeSetlistId)
      if (!sl) return
      if (sl.songNames.includes(song.name)) {
        addToast(`Already in "${sl.name}"`, 'error')
        return
      }
      persistSetlist({ ...sl, songNames: [...sl.songNames, song.name] })
      addToast(`Added to "${sl.name}"`, 'success')
    },
    [activeSetlistId, setlists, persistSetlist, addToast]
  )

  const nextSetlistSong = useMemo(
    () => resolveNextSetlistSong(setlists, songSetlistContext, recentSongs),
    [setlists, songSetlistContext, recentSongs]
  )

  const handleNextSongInSetlist = useCallback((): void => {
    if (!songSetlistContext) return
    if (nextSetlistSong.skipped.length > 0) {
      const list = nextSetlistSong.skipped.map((n) => `"${n}"`).join(', ')
      addToast(`Skipped ${list} — no longer in the library`, 'error')
    }
    if (nextSetlistSong.type !== 'found') return
    handleSelectSetlistSong(
      nextSetlistSong.song,
      songSetlistContext.setlistId,
      nextSetlistSong.index
    )
  }, [songSetlistContext, nextSetlistSong, addToast, handleSelectSetlistSong])

  const hasNextSongInSetlist = nextSetlistSong.type === 'found'

  const queuedJobs = useMemo(
    () =>
      jobQueue.filter(
        (j) =>
          j.status === 'queued' ||
          j.status === 'running' ||
          j.status === 'failed' ||
          j.status === 'cancelled'
      ),
    [jobQueue]
  )

  const filteredSongs = useMemo(
    () => filterSongsByQuery(recentSongs, songSearch),
    [recentSongs, songSearch]
  )

  return (
    <div className="h-screen bg-neutral-950 flex overflow-hidden">
      {/* Sidebar */}
      <aside
        className="relative shrink-0 border-r border-neutral-800 flex flex-col"
        style={{ width: sidebarWidth }}
      >
        <div
          onMouseDown={startSidebarResize}
          className="absolute top-0 -right-1 w-2 h-full cursor-col-resize z-10 hover:bg-brand-primary/30"
          title="Drag to resize"
          role="separator"
          aria-orientation="vertical"
        />
        <div className="p-4 border-b border-neutral-800">
          <h1 className="text-xl font-display font-normal bg-gradient-to-r from-brand-primary to-brand-accent bg-clip-text text-transparent">
            Velody
          </h1>
        </div>

        <div className="mx-3 mt-3 relative" ref={newSongMenuRef}>
          <button
            onClick={() => setShowNewSongMenu((prev) => !prev)}
            className="w-full px-3 py-2 rounded-lg text-sm font-semibold bg-brand-primary hover:bg-brand-primary/80 text-white transition-colors"
          >
            + New Song
          </button>
          {showNewSongMenu && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-neutral-800 border border-neutral-700 rounded-lg shadow-lg z-50 overflow-hidden">
              <button
                onClick={handleNewSongLocal}
                className="w-full px-3 py-2 text-left text-sm text-neutral-300 hover:bg-neutral-700 hover:text-white transition-colors"
              >
                Local File
              </button>
              <button
                onClick={handleNewSongUrl}
                className="w-full px-3 py-2 text-left text-sm text-neutral-300 hover:bg-neutral-700 hover:text-white transition-colors border-t border-neutral-700"
              >
                From URL
              </button>
            </div>
          )}
        </div>

        {liveMode && (
          <div className="mx-3 mt-3 flex gap-1 bg-neutral-900 rounded-lg p-1 border border-neutral-800 shrink-0">
            <button
              onClick={() => setSidebarView('library')}
              className={`flex-1 py-1 rounded text-xs font-medium transition-colors ${
                sidebarView === 'library'
                  ? 'bg-neutral-800 text-white'
                  : 'text-neutral-500 hover:text-neutral-300'
              }`}
            >
              Library
            </button>
            <button
              onClick={() => setSidebarView('setlists')}
              className={`flex-1 py-1 rounded text-xs font-medium transition-colors ${
                sidebarView === 'setlists'
                  ? 'bg-neutral-800 text-white'
                  : 'text-neutral-500 hover:text-neutral-300'
              }`}
            >
              Setlists
            </button>
          </div>
        )}

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
                        className="bg-brand-primary h-full rounded-full transition-all duration-300"
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

        {!liveMode || sidebarView === 'library' ? (
          <>
            <div className="mt-3 mx-3 shrink-0">
              <h3 className="text-[10px] font-semibold text-neutral-500 uppercase tracking-wide mb-1.5">
                Recent Songs
                {cloudStatus.enabled && cloudStatus.offline && (
                  <span
                    className="ml-1.5 normal-case tracking-normal text-amber-500/80"
                    title="The cloud can't be reached — local songs still work"
                  >
                    · cloud offline
                  </span>
                )}
              </h3>
              <div className="relative">
                <input
                  type="text"
                  value={songSearch}
                  onChange={(e) => setSongSearch(e.target.value)}
                  placeholder="Search songs..."
                  className="w-full px-2.5 py-1.5 pr-7 rounded-md bg-neutral-800 border border-neutral-700 text-neutral-200 text-xs placeholder-neutral-500 focus:outline-none focus:border-brand-primary transition-colors"
                />
                {songSearch && (
                  <button
                    onClick={() => setSongSearch('')}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 w-4 h-4 rounded flex items-center justify-center text-neutral-500 hover:text-white transition-colors text-xs"
                    title="Clear search"
                  >
                    ✕
                  </button>
                )}
              </div>
              {libraryActiveSetlistId && (
                <p className="text-[10px] text-brand-primary mt-1.5 truncate">
                  Adding to &ldquo;{setlists.find((sl) => sl.id === activeSetlistId)?.name}&rdquo;
                </p>
              )}
            </div>

            <div className="flex-1 overflow-y-auto px-3 mt-2 space-y-1">
              {filteredSongs.length === 0 ? (
                <p className="text-xs text-neutral-600 px-1 py-2">
                  {songSearch ? 'No songs found' : 'No songs yet'}
                </p>
              ) : (
                filteredSongs.map((song) => {
                  const transfer = transfers[song.name]
                  const actions = songCloudActions(song)
                  return (
                    <div key={song.name} className="relative group">
                      <button
                        onClick={() => handleSelectRecent(song)}
                        className={`w-full text-left pl-3 py-2 rounded-lg text-sm transition-colors ${
                          libraryActiveSetlistId
                            ? 'pr-3 group-hover:pr-20'
                            : 'pr-3 group-hover:pr-14'
                        } ${
                          currentSong?.songName === song.name
                            ? 'bg-brand-primary/20 text-brand-primary border border-brand-primary/30'
                            : song.sync === 'cloud'
                              ? 'text-neutral-500 hover:text-white hover:bg-neutral-800'
                              : 'text-neutral-400 hover:text-white hover:bg-neutral-800'
                        }`}
                        title={
                          song.sync === 'cloud'
                            ? `${song.name}\nIn the cloud${song.sizeBytes ? ` (${formatBytes(song.sizeBytes)})` : ''} — downloads when opened`
                            : song.sync === 'synced'
                              ? `${song.name}\nOn this laptop and in the cloud`
                              : song.sync === 'local'
                                ? `${song.name}\nOnly on this laptop`
                                : song.name
                        }
                      >
                        <span className="flex items-center gap-1.5 min-w-0">
                          {song.sync && (
                            <span
                              className={`shrink-0 text-[10px] ${
                                song.sync === 'synced'
                                  ? 'text-green-500/70'
                                  : song.sync === 'cloud'
                                    ? 'text-sky-400/80'
                                    : 'text-neutral-600'
                              }`}
                              aria-label={song.sync}
                            >
                              {song.sync === 'synced' ? '✓' : song.sync === 'cloud' ? '☁' : '•'}
                            </span>
                          )}
                          <span className="truncate">{song.name}</span>
                          {transfer && (
                            <span className="shrink-0 ml-auto text-[10px] text-brand-primary">
                              {transfer.kind === 'upload' ? '↑' : '↓'}
                              {transfer.percent}%
                            </span>
                          )}
                        </span>
                      </button>
                      <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                        {libraryActiveSetlistId && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleAddSongToActiveSetlist(song)
                            }}
                            className="w-6 h-6 rounded flex items-center justify-center text-neutral-600 hover:text-brand-primary hover:bg-brand-primary/10 transition-colors text-xs"
                            title="Add to active setlist"
                          >
                            +
                          </button>
                        )}
                        {actions.includes('upload') && !transfer && (
                          <button
                            onClick={(e) => handleUploadSong(song, e)}
                            className="w-6 h-6 rounded flex items-center justify-center text-neutral-600 hover:text-sky-400 hover:bg-sky-900/30 transition-colors text-xs"
                            title="Upload to the cloud"
                          >
                            ↑
                          </button>
                        )}
                        {actions.includes('download') && !transfer && (
                          <button
                            onClick={(e) => handleDownloadSong(song, e)}
                            className="w-6 h-6 rounded flex items-center justify-center text-neutral-600 hover:text-sky-400 hover:bg-sky-900/30 transition-colors text-xs"
                            title="Download to this laptop"
                          >
                            ↓
                          </button>
                        )}
                        <button
                          onClick={(e) => handleDeleteSong(song, e)}
                          className="w-6 h-6 rounded flex items-center justify-center text-neutral-600 hover:text-red-400 hover:bg-red-900/30 transition-colors text-xs"
                          title="Delete song"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </>
        ) : (
          <SetlistPanel
            setlists={setlists}
            activeSetlistId={activeSetlistId}
            songs={recentSongs}
            currentSongName={currentSong?.songName ?? null}
            onSelectSetlist={setActiveSetlistId}
            onCreateSetlist={handleCreateSetlist}
            onDeleteSetlist={handleDeleteSetlist}
            onSelectSong={handleSelectSetlistSong}
            onRemoveSongFromSetlist={handleRemoveSongFromSetlist}
            onMoveSong={handleMoveSongInSetlist}
          />
        )}
        <UpdateBanner />
        <button
          onClick={() => setShowCloudSettings(true)}
          className="mt-auto mx-3 pt-3 border-t border-neutral-800 flex items-center justify-between gap-2 text-xs text-neutral-500 hover:text-neutral-300 transition-colors shrink-0"
          title="Back up your library to your own cloud"
        >
          <span>Cloud sync</span>
          <span
            className={
              cloudStatus.enabled
                ? cloudStatus.offline
                  ? 'text-amber-500/80'
                  : 'text-green-500/80'
                : 'text-neutral-600'
            }
          >
            {cloudStatus.enabled ? (cloudStatus.offline ? 'offline' : 'on') : 'off'}
          </span>
        </button>
        <label className="mt-2 mx-3 mb-3 pt-3 border-t border-neutral-800 flex items-center justify-between gap-2 text-xs text-neutral-500 cursor-pointer select-none shrink-0">
          <span title="Setlists and Live Presets, for playing with a band">Live mode</span>
          <input
            type="checkbox"
            checked={liveMode}
            onChange={(e) => setLiveMode(e.target.checked)}
            className="accent-brand-primary"
          />
        </label>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col p-8 min-w-0 overflow-y-auto">
        {error && (
          <div className="mb-6 p-4 bg-red-900/30 border border-red-600 rounded-xl text-red-400 text-sm">
            {error}
          </div>
        )}

        {openingSong ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center w-72">
              <p className="text-neutral-300 text-sm mb-1 truncate">{openingSong}</p>
              <p className="text-neutral-500 text-xs mb-3">Downloading from the cloud…</p>
              <div className="w-full bg-neutral-800 rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-brand-primary h-full rounded-full transition-all duration-300"
                  style={{ width: `${transfers[openingSong]?.percent ?? 0}%` }}
                />
              </div>
            </div>
          </div>
        ) : currentSong ? (
          <StemPlayer
            key={currentSong.songName}
            stems={currentSong.stems}
            songName={currentSong.songName}
            onToast={addToast}
            onNextSong={liveMode && songSetlistContext ? handleNextSongInSetlist : undefined}
            liveMode={liveMode}
            hasNextSong={hasNextSongInSetlist}
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

              <div className="flex items-center justify-between gap-3 mb-4 text-sm">
                <span className="text-neutral-500">Stem quality</span>
                <div className="flex gap-1 bg-neutral-900 rounded-lg p-1 border border-neutral-800">
                  {STEM_BITRATE_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setStemBitrate(opt.value)}
                      title={opt.hint}
                      className={`py-1 px-2.5 rounded-md text-xs font-medium transition-colors ${
                        stemBitrate === opt.value
                          ? 'bg-neutral-800 text-white'
                          : 'text-neutral-500 hover:text-neutral-300'
                      }`}
                    >
                      {opt.value} kbps
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-xs text-neutral-600 -mt-2 mb-4 text-right">
                {STEM_BITRATE_OPTIONS.find((o) => o.value === stemBitrate)?.hint}
              </p>

              {importMode === 'local' ? (
                <AudioUploader
                  files={pendingFiles}
                  onFilesAdded={handleFilesAdded}
                  onRemoveFile={handleRemoveFile}
                  onProcessAll={handleProcessAll}
                />
              ) : (
                <UrlImporter onImportStarted={handleUrlImport} bitrate={stemBitrate} />
              )}
            </div>
          </div>
        )}
      </main>

      {deleteTarget && (
        <DeleteSongDialog
          songName={deleteTarget.name}
          sync={deleteTarget.sync}
          onConfirm={handleConfirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {showCloudSettings && (
        <CloudSettingsModal
          onClose={() => setShowCloudSettings(false)}
          onChanged={refreshSongs}
          onToast={addToast}
          localOnlyCount={recentSongs.filter((s) => s.sync === 'local').length}
        />
      )}

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
              {t.action && (
                <button
                  onClick={() => {
                    t.action!.onClick()
                    dismissToast(t.id)
                  }}
                  className="ml-3 px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-xs font-semibold transition-colors"
                >
                  {t.action.label}
                </button>
              )}
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
