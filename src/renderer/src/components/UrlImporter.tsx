import { useState } from 'react'

interface UrlImporterProps {
  onImportStarted: (url: string, jobId: string, songName: string) => void
}

function isValidUrl(text: string): boolean {
  try {
    const url = new URL(text)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function UrlImporter({ onImportStarted }: UrlImporterProps): React.JSX.Element {
  const [url, setUrl] = useState('')
  const [status, setStatus] = useState<'idle' | 'downloading' | 'error'>('idle')
  const [progress, setProgress] = useState(0)
  const [title, setTitle] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = async (): Promise<void> => {
    if (!window.api || !isValidUrl(url)) return

    setStatus('downloading')
    setProgress(0)
    setTitle('')
    setError('')

    const unsubProgress = window.api.onDownloadProgress((e) => {
      setProgress(e.percent)
      if (e.title) setTitle(e.title)
    })

    try {
      const result = await window.api.importFromUrl(url)
      onImportStarted(url, result.jobId, result.songName)
      setUrl('')
      setStatus('idle')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Download failed'
      setError(msg)
      setStatus('error')
    } finally {
      unsubProgress()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && isValidUrl(url) && status !== 'downloading') {
      handleSubmit()
    }
  }

  return (
    <div className="space-y-4">
      <div className="border-2 border-dashed rounded-xl p-8 text-center border-neutral-700 bg-neutral-900/50">
        <div className="space-y-3">
          <div className="text-4xl text-neutral-400">🔗</div>
          <p className="text-lg font-medium text-neutral-300">Import from URL</p>
          <p className="text-sm text-neutral-500">YouTube, SoundCloud, Bandcamp, and 1000+ sites</p>
        </div>
      </div>

      <div className="flex gap-3">
        <input
          type="text"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value)
            if (status === 'error') setStatus('idle')
          }}
          onKeyDown={handleKeyDown}
          placeholder="Paste YouTube link..."
          disabled={status === 'downloading'}
          className="flex-1 px-4 py-3 rounded-xl bg-neutral-800 border border-neutral-700 text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-blue-500 transition-colors disabled:opacity-50"
        />
        <button
          onClick={handleSubmit}
          disabled={!isValidUrl(url) || status === 'downloading'}
          className="px-6 py-3 rounded-xl font-medium bg-gradient-to-r from-blue-500 to-purple-600 text-white hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {status === 'downloading' ? 'Importing...' : 'Import'}
        </button>
      </div>

      {status === 'downloading' && (
        <div className="space-y-2">
          {title && (
            <p className="text-sm text-neutral-400 truncate">
              <span className="text-neutral-500">Downloading:</span> {title}
            </p>
          )}
          <div className="w-full bg-neutral-800 rounded-full h-2 overflow-hidden">
            <div
              className="bg-blue-500 h-full rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-xs text-neutral-500 text-right">{progress}%</p>
        </div>
      )}

      {status === 'error' && error && (
        <div className="p-3 rounded-lg bg-red-900/30 border border-red-600 text-red-400 text-sm">
          {error}
        </div>
      )}
    </div>
  )
}

export default UrlImporter
