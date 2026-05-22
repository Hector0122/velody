import { useState, useEffect } from 'react'
import AudioUploader from '../components/AudioUploader'
import ProcessingScreen from '../components/ProcessingScreen'
import StemPlayer from '../components/StemPlayer'

type ViewState = 'upload' | 'processing' | 'results'

interface RecentSong {
  name: string
  stems: string[]
}

function Home(): React.JSX.Element {
  const [view, setView] = useState<ViewState>('upload')
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [selectedName, setSelectedName] = useState<string>('')
  const [stems, setStems] = useState<string[]>([])
  const [songName, setSongName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [recentSongs, setRecentSongs] = useState<RecentSong[]>([])
  const [analysisData, setAnalysisData] = useState<AnalysisData | null>(null)

  useEffect(() => {
    if (!window.api) return
    window.api.listSongs().then(setRecentSongs)
  }, [])

  const handleFileSelect = (path: string): void => {
    const parts = path.split(/[/\\]/)
    setSelectedPath(path)
    setSelectedName(parts[parts.length - 1])
  }

  const handleRemove = (): void => {
    setSelectedPath(null)
    setSelectedName('')
  }

  const songDirFromStems = (stemPaths: string[]): string => {
    if (stemPaths.length === 0) return ''
    return stemPaths[0].replace(/[/\\][^/\\]+$/, '')
  }

  const loadAndTriggerAnalysis = (songDir: string): void => {
    if (!songDir || !window.api) return
    window.api.loadAnalysis(songDir).then((data) => {
      if (data) setAnalysisData(data)
    }).catch(() => { /* ignore */ })
    window.api.analyzeSong(songDir).then((data) => {
      if (data && !('error' in data)) setAnalysisData(data as AnalysisData)
    }).catch(() => { /* ignore */ })
  }

  const handleSeparate = async (): Promise<void> => {
    if (!selectedPath || !window.api) return

    setView('processing')
    setSongName(selectedName)
    setError(null)
    setAnalysisData(null)

    try {
      const result = await window.api.startSeparation(selectedPath)
      setStems(result)
      setView('results')
      loadAndTriggerAnalysis(songDirFromStems(result))
      const songs = await window.api.listSongs()
      setRecentSongs(songs)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Separation failed')
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
    setAnalysisData(null)
  }

  const handleSelectRecent = (song: RecentSong): void => {
    setAnalysisData(null)
    setSongName(song.name)
    setStems(song.stems)
    setView('results')
    loadAndTriggerAnalysis(songDirFromStems(song.stems))
  }

  const handleDeleteSong = async (song: RecentSong, e: React.MouseEvent): Promise<void> => {
    e.stopPropagation()
    if (!window.api) return
    await window.api.deleteSong(song.name)
    setRecentSongs((prev) => prev.filter((s) => s.name !== song.name))
  }

  return (
    <div className="min-h-screen bg-neutral-950 flex flex-col items-center p-8">
      <header className="mb-12 text-center">
        <h1 className="text-5xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
          Velody
        </h1>
        <p className="mt-2 text-neutral-400 text-lg">AI-powered audio stem separation</p>
      </header>

      <main className="w-full max-w-3xl">
        {error && (
          <div className="mb-6 p-4 bg-red-900/30 border border-red-600 rounded-xl text-red-400 text-sm">
            {error}
          </div>
        )}

        {view === 'processing' ? (
          <ProcessingScreen songName={songName} />
        ) : view === 'results' ? (
          <StemPlayer
            stems={stems}
            songName={songName}
            onReset={handleReset}
            analysisData={analysisData}
          />
        ) : (
          <>
            <AudioUploader
              selectedFile={selectedPath ? { name: selectedName, path: selectedPath } : null}
              onFileSelect={handleFileSelect}
              onRemove={handleRemove}
              onSeparate={handleSeparate}
            />

            {recentSongs.length > 0 && (
              <section className="mt-10">
                <h2 className="text-lg font-semibold text-neutral-300 mb-4">
                  Recent songs
                </h2>
                <div className="grid grid-cols-2 gap-3">
                  {recentSongs.map((song) => {
                    const stemLabels = song.stems.length
                    return (
                      <div key={song.name} className="relative group">
                        <button
                          onClick={() => handleSelectRecent(song)}
                          className="w-full text-left p-4 rounded-xl border border-neutral-700 bg-neutral-900/30 hover:bg-neutral-800/50 hover:border-neutral-500 transition-all"
                        >
                          <div className="flex items-center gap-3 pr-8">
                            <span className="text-2xl">🎵</span>
                            <div className="min-w-0">
                              <p className="text-white font-medium truncate">{song.name}</p>
                              <p className="text-xs text-neutral-500">{stemLabels} stems</p>
                            </div>
                          </div>
                        </button>
                        <button
                          onClick={(e) => handleDeleteSong(song, e)}
                          className="absolute top-3 right-3 w-7 h-7 rounded-lg flex items-center justify-center text-neutral-600 hover:text-red-400 hover:bg-red-900/30 transition-colors opacity-0 group-hover:opacity-100"
                          title="Delete song"
                        >
                          ✕
                        </button>
                      </div>
                    )
                  })}
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  )
}

export default Home
