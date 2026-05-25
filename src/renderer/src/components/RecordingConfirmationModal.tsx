interface RecordingConfirmationModalProps {
  elapsed: number
  stemLabel: string
  formatTime: (seconds: number) => string
  onDiscard: () => void
  onSave: () => void
}

export default function RecordingConfirmationModal({
  elapsed,
  stemLabel,
  formatTime,
  onDiscard,
  onSave
}: RecordingConfirmationModalProps): React.JSX.Element {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-neutral-900 border border-neutral-700 rounded-2xl p-6 w-72 shadow-2xl flex flex-col items-center gap-4">
        <h3 className="text-sm font-semibold text-neutral-400 uppercase tracking-wide">
          Save recording?
        </h3>
        <div className="flex flex-col items-center gap-1">
          <span className="text-2xl font-bold text-white">{formatTime(elapsed)}</span>
          <span className="text-xs text-neutral-500">{stemLabel}</span>
        </div>
        <div className="flex gap-3 w-full">
          <button
            onClick={onDiscard}
            className="flex-1 px-4 py-2 rounded-lg text-xs font-medium bg-neutral-800 text-neutral-400 hover:text-white transition-colors"
          >
            Discard
          </button>
          <button
            onClick={onSave}
            className="flex-1 px-4 py-2 rounded-lg text-xs font-semibold bg-red-600 hover:bg-red-500 text-white transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
