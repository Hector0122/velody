import { useState, useCallback } from 'react'

interface SelectedFile {
  name: string
  path: string
}

interface AudioUploaderProps {
  selectedFile: SelectedFile | null
  onFileSelect: (path: string) => void
  onRemove: () => void
  onSeparate: () => void
}

function AudioUploader({
  selectedFile,
  onFileSelect,
  onRemove,
  onSeparate
}: AudioUploaderProps): React.JSX.Element {
  const [isDragging, setIsDragging] = useState(false)

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
      const files = Array.from(e.dataTransfer.files)
      const audioFile = files.find((f) =>
        ['audio/wav', 'audio/mpeg', 'audio/flac', 'audio/mp4', 'audio/ogg', 'audio/x-wav'].includes(
          f.type
        )
      )
      if (audioFile) {
        const filePath = (audioFile as { path?: string }).path || audioFile.name
        onFileSelect(filePath)
      }
    },
    [onFileSelect]
  )

  const handleFileSelect = async (): Promise<void> => {
    if (window.api) {
      const path = await window.api.openFileDialog()
      if (path) {
        onFileSelect(path)
      }
    }
  }

  if (selectedFile) {
    return (
      <div className="space-y-4">
        <div className="border-2 border-blue-500/50 rounded-xl p-6 bg-blue-500/5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-3xl">🎵</span>
              <div>
                <p className="text-lg font-medium text-white">{selectedFile.name}</p>
                <p className="text-sm text-neutral-400">Ready to separate</p>
              </div>
            </div>
            <button
              onClick={onRemove}
              className="p-2 text-neutral-500 hover:text-red-400 transition-colors"
              title="Remove file"
            >
              ✕
            </button>
          </div>
        </div>
        <div className="flex gap-3">
          <button
            onClick={onSeparate}
            className="flex-1 py-3 rounded-xl font-medium bg-gradient-to-r from-blue-500 to-purple-600 text-white hover:opacity-90 transition-opacity"
          >
            Separate stems
          </button>
          <button
            onClick={handleFileSelect}
            className="px-6 py-3 rounded-xl font-medium border border-neutral-700 text-neutral-300 hover:text-white hover:border-neutral-500 transition-colors"
          >
            Change
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
        <p className="text-lg font-medium text-neutral-300">Drop your audio file here</p>
        <p className="text-sm text-neutral-500">or click to browse files</p>
        <p className="text-xs text-neutral-600">Supports WAV, MP3, FLAC, M4A, OGG</p>
      </div>
    </div>
  )
}

export default AudioUploader
