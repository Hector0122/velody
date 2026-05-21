import { useState } from 'react'
import AudioUploader from '../components/AudioUploader'
import ProcessingScreen from '../components/ProcessingScreen'
import StemPlayer from '../components/StemPlayer'

type ViewState = 'upload' | 'processing' | 'results'

function Home(): React.JSX.Element {
  const [view, setView] = useState<ViewState>('upload')
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [selectedName, setSelectedName] = useState<string>('')
  const [stems, setStems] = useState<string[]>([])
  const [originalPath, setOriginalPath] = useState('')
  const [songName, setSongName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const handleFileSelect = (path: string): void => {
    const parts = path.split(/[/\\]/)
    setSelectedPath(path)
    setSelectedName(parts[parts.length - 1])
  }

  const handleRemove = (): void => {
    setSelectedPath(null)
    setSelectedName('')
  }

  const handleSeparate = async (): Promise<void> => {
    if (!selectedPath || !window.api) return

    setView('processing')
    setSongName(selectedName)
    setOriginalPath(selectedPath)
    setError(null)

    try {
      const result = await window.api.startSeparation(selectedPath)
      setStems(result)
      setView('results')
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
    setOriginalPath('')
    setSongName('')
    setError(null)
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
            originalPath={originalPath}
            songName={songName}
            onReset={handleReset}
          />
        ) : (
          <AudioUploader
            selectedFile={selectedPath ? { name: selectedName, path: selectedPath } : null}
            onFileSelect={handleFileSelect}
            onRemove={handleRemove}
            onSeparate={handleSeparate}
          />
        )}
      </main>
    </div>
  )
}

export default Home
