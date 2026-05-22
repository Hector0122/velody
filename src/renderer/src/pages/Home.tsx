import { useState, useEffect, useCallback } from 'react'
import AudioUploader from '../components/AudioUploader'
import ProcessingScreen from '../components/ProcessingScreen'
import StemPlayer from '../components/StemPlayer'

type ViewState = 'upload' | 'processing' | 'results'

interface RecentSong {
  name: string
  stems: string[]
}

interface Toast {
  id: number
  message: string
  type: 'error' | 'success'
}

let toastCounter = 0

function Home(): React.JSX.Element {
  const [view, setView] = useState<ViewState>('upload')
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [selectedName, setSelectedName] = useState<string>('')
  const [stems, setStems] = useState<string[]>([])
  const [songName, setSongName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [recentSongs, setRecentSongs] = useState<RecentSong[]>([])
  const [toasts, setToasts] = useState<Toast[]>([])

  const addToast = useCallback((message: string, type: 'error' | 'success' = 'error') => {
    const id = ++toastCounter
    setToasts((prev) => [...prev, { id, message, type }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000)
  }, [])

  useEffect(() => {
    if (!window.api) return
    window.api.listSongs().then(setRecentSongs)
  }, [])

  const handleOpenFile = async (): Promise<void> => {
    if (!window.api) return
    const path = await window.api.openFileDialog()
    if (!path) return
    const parts = path.split(/[/\\]/)
    setSelectedPath(path)
    setSelectedName(parts[parts.length - 1])

    setView('processing')
    setSongName(parts[parts.length - 1])
    setError(null)

    try {
      const result = await window.api.startSeparation(path)
      setStems(result)
      setView('results')
      const songs = await window.api.listSongs()
      setRecentSongs(songs)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Separation failed'
      setError(msg)
      addToast(msg, 'error')
      setView('upload')
    }
  }

  const handleSeparate = async (): Promise<void> => {
    if (!selectedPath || !window.api) return

    setView('processing')
    setSongName(selectedName)
    setError(null)

    try {
      const result = await window.api.startSeparation(selectedPath)
      setStems(result)
      setView('results')
      const songs = await window.api.listSongs()
      setRecentSongs(songs)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Separation failed'
      setError(msg)
      addToast(msg, 'error')
      setView('upload')
    }
  }

  const handleReset = (): void => {
    setView('upload')
    setSelectedPath(null)
    setSelectedName('')
    setStems([])
    setSongName('')
    setError(null)
  }

  const handleSelectRecent = (song: RecentSong): void => {
    setSongName(song.name)
    setStems(song.stems)
    setView('results')
  }

  const handleDeleteSong = async (song: RecentSong, e: React.MouseEvent): Promise<void> => {
    e.stopPropagation()
    if (!window.api) return
    await window.api.deleteSong(song.name)
    setRecentSongs((prev) => prev.filter((s) => s.name !== song.name))
    if (song.name === songName) handleReset()
  }

  const handleExportAll = async (): Promise<void> => {
    if (!window.api) return
    const dir = await window.api.openDirectoryDialog()
    if (!dir) return
    const ext = '.wav'
    for (const stemPath of stems) {
      const name =
        stemPath
          .split(/[/\\]/)
          .pop()
          ?.replace(/\.[^.]+$/, '') || 'stem'
      const outPath = `${dir}/${songName} - ${name}${ext}`
      try {
        await window.api.exportSingle(stemPath, outPath)
      } catch {
        addToast(`Failed to export ${name}`, 'error')
        return
      }
    }
    addToast(`All stems exported to ${dir}`, 'success')
  }

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

        <div className="flex-1 overflow-y-auto px-3 mt-3 space-y-1">
          {recentSongs.map((song) => (
            <div key={song.name} className="relative group">
              <button
                onClick={() => handleSelectRecent(song)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                  song.name === songName && view === 'results'
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

        {view === 'processing' ? (
          <ProcessingScreen songName={songName} />
        ) : view === 'results' && stems.length > 0 ? (
          <StemPlayer stems={stems} songName={songName} onExportAll={handleExportAll} />
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center max-w-md">
              <p className="text-neutral-500 mb-4">Import a song to get started</p>
              <AudioUploader
                selectedFile={selectedPath ? { name: selectedName, path: selectedPath } : null}
                onFileSelect={(path) => {
                  const parts = path.split(/[/\\]/)
                  setSelectedPath(path)
                  setSelectedName(parts[parts.length - 1])
                }}
                onRemove={() => {
                  setSelectedPath(null)
                  setSelectedName('')
                }}
                onSeparate={handleSeparate}
              />
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
              className={`px-4 py-3 rounded-xl text-sm font-medium shadow-lg animate-[slideUp_0.3s_ease-out] ${
                t.type === 'error'
                  ? 'bg-red-900/90 text-red-300 border border-red-700'
                  : 'bg-green-900/90 text-green-300 border border-green-700'
              }`}
            >
              {t.message}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default Home
