import { useEffect, useRef, useState } from 'react'

interface MarkerLabelInputProps {
  time: number
  formatTime: (s: number) => string
  onSave: (label: string) => void
  onCancel: () => void
}

export default function MarkerLabelInput({
  time,
  formatTime,
  onSave,
  onCancel
}: MarkerLabelInputProps): React.JSX.Element {
  const [label, setLabel] = useState(() => {
    const sec = Math.floor(time % 60)
    const min = Math.floor(time / 60)
    return `Section ${min}:${sec.toString().padStart(2, '0')}`
  })
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-neutral-900 border border-neutral-700 rounded-md p-5 w-72 shadow-2xl flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-neutral-400 uppercase tracking-wide">
          New Marker
        </h3>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-neutral-500">Position: {formatTime(time)}</span>
          <input
            ref={inputRef}
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Verse, Chorus, Bridge..."
            className="w-full px-3 py-2 rounded-sm text-sm bg-neutral-800 border border-neutral-700 text-white placeholder-neutral-600 focus:outline-none focus:border-orange-500"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && label.trim()) onSave(label.trim())
              if (e.key === 'Escape') onCancel()
            }}
          />
        </div>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2 rounded-sm text-xs font-medium bg-neutral-800 text-neutral-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => label.trim() && onSave(label.trim())}
            disabled={!label.trim()}
            className="flex-1 px-4 py-2 rounded-sm text-xs font-semibold bg-orange-600 hover:bg-orange-500 text-white transition-colors disabled:opacity-50"
          >
            Add Marker
          </button>
        </div>
      </div>
    </div>
  )
}
