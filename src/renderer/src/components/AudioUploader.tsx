import { useState, useCallback } from 'react'

interface PendingFile {
  name: string
  path: string
}

interface AudioUploaderProps {
  files: PendingFile[]
  onFilesAdded: (paths: string[]) => void
  onRemoveFile: (path: string) => void
  onProcessAll: () => void
}

const AUDIO_MIME = [
  'audio/wav',
  'audio/mpeg',
  'audio/flac',
  'audio/mp4',
  'audio/ogg',
  'audio/x-wav',
  'audio/mp3',
  'audio/x-m4a'
]

function AudioUploader({
  files,
  onFilesAdded,
  onRemoveFile,
  onProcessAll
}: AudioUploaderProps): React.JSX.Element {
  const [isDragging, setIsDragging] = useState(false)

  const extractPaths = useCallback((fileList: FileList | File[]): string[] => {
    return Array.from(fileList)
      .filter((f) => AUDIO_MIME.includes(f.type) || /\.(wav|mp3|flac|m4a|ogg)$/i.test(f.name))
      .map((f) => (f as { path?: string }).path || f.name)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(false)
      const paths = extractPaths(e.dataTransfer.files)
      if (paths.length > 0) onFilesAdded(paths)
    },
    [onFilesAdded, extractPaths]
  )

  const handleFileSelect = async (): Promise<void> => {
    if (window.api) {
      const path = await window.api.openFileDialog()
      if (path) {
        onFilesAdded([path])
      }
    }
  }

  if (files.length > 0) {
    return (
      <div className="space-y-4">
        <div className="border-2 border-blue-500/50 rounded-xl p-4 bg-blue-500/5 max-h-64 overflow-y-auto">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-neutral-300">
              {files.length} file{files.length !== 1 ? 's' : ''} selected
            </p>
          </div>
          <div className="space-y-1.5">
            {files.map((f) => (
              <div
                key={f.path}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-neutral-800/50 hover:bg-neutral-800 transition-colors group"
              >
                <span className="text-neutral-400 text-sm truncate flex-1">{f.name}</span>
                <button
                  onClick={() => onRemoveFile(f.path)}
                  className="text-neutral-600 hover:text-red-400 transition-colors text-xs flex-shrink-0 w-5 h-5 flex items-center justify-center rounded hover:bg-red-900/20"
                  title="Remove"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
        <div className="flex gap-3">
          <button
            onClick={onProcessAll}
            className="flex-1 py-3 rounded-xl font-medium bg-gradient-to-r from-blue-500 to-purple-600 text-white hover:opacity-90 transition-opacity"
          >
            Process {files.length} file{files.length !== 1 ? 's' : ''}
          </button>
          <button
            onClick={handleFileSelect}
            className="px-6 py-3 rounded-xl font-medium border border-neutral-700 text-neutral-300 hover:text-white hover:border-neutral-500 transition-colors"
          >
            Add more
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleFileSelect}
      className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all duration-200 ${
        isDragging
          ? 'border-blue-400 bg-blue-400/10 scale-[1.02]'
          : 'border-neutral-700 hover:border-neutral-500 bg-neutral-900/50'
      }`}
    >
      <div className="space-y-3">
        <div className="text-4xl text-neutral-400">🎵</div>
        <p className="text-lg font-medium text-neutral-300">Drop audio files here</p>
        <p className="text-sm text-neutral-500">or click to browse</p>
        <p className="text-xs text-neutral-600">
          Supports WAV, MP3, FLAC, M4A, OGG · Multiple files
        </p>
      </div>
    </div>
  )
}

export default AudioUploader
