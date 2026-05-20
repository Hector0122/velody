import { useState, useCallback } from 'react'

function AudioUploader(): React.JSX.Element {
  const [isDragging, setIsDragging] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)

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

  const handleDrop = useCallback((e: React.DragEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    const files = Array.from(e.dataTransfer.files)
    const audioFile = files.find((f) =>
      ['audio/wav', 'audio/mpeg', 'audio/flac', 'audio/mp4', 'audio/ogg', 'audio/x-wav'].includes(
        f.type
      )
    )
    if (audioFile) {
      setFileName(audioFile.name)
    }
  }, [])

  const handleFileSelect = async (): Promise<void> => {
    if (window.api) {
      const path = await window.api.openFileDialog()
      if (path) {
        const parts = path.split(/[/\\]/)
        setFileName(parts[parts.length - 1])
      }
    }
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
      {fileName ? (
        <div className="space-y-2">
          <p className="text-lg font-medium text-white">{fileName}</p>
          <p className="text-sm text-neutral-400">Click to choose a different file</p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="text-4xl text-neutral-400">🎵</div>
          <p className="text-lg font-medium text-neutral-300">Drop your audio file here</p>
          <p className="text-sm text-neutral-500">or click to browse files</p>
          <p className="text-xs text-neutral-600">Supports WAV, MP3, FLAC, M4A, OGG</p>
        </div>
      )}
    </div>
  )
}

export default AudioUploader
