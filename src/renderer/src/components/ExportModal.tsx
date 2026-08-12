interface StemMeta {
  key: string
  meta: { color: string; label: string }
}

interface ExportModalProps {
  show: boolean
  stemItems: StemMeta[]
  exportSelection: Record<string, boolean>
  exportFormat: 'wav' | 'mp3'
  exportWithMetronome: boolean
  exporting: boolean
  bpm: number
  onToggleSelection: (key: string) => void
  onSetFormat: (fmt: 'wav' | 'mp3') => void
  onSetMetronome: (v: boolean) => void
  onClose: () => void
  onExport: () => void
}

export default function ExportModal({
  show,
  stemItems,
  exportSelection,
  exportFormat,
  exportWithMetronome,
  exporting,
  bpm,
  onToggleSelection,
  onSetFormat,
  onSetMetronome,
  onClose,
  onExport
}: ExportModalProps): React.JSX.Element | null {
  if (!show) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-neutral-900 border border-neutral-700 rounded-md p-5 w-72 shadow-2xl flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-neutral-400 uppercase tracking-wide">
            Export Mix
          </h3>
          <button
            onClick={onClose}
            className="text-neutral-500 hover:text-white text-lg leading-none"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] text-neutral-500 uppercase tracking-wide">Stems</span>
          {stemItems.map(({ key, meta }) => (
            <label key={key} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={!!exportSelection[key]}
                onChange={() => onToggleSelection(key)}
                className="accent-brand-primary"
              />
              <span className="text-xs text-neutral-300">{meta.label}</span>
            </label>
          ))}
        </div>

        <div className="flex items-center justify-between">
          <span className="text-[10px] text-neutral-500 uppercase tracking-wide">Format</span>
          <div className="flex gap-1">
            <button
              onClick={() => onSetFormat('wav')}
              className={`px-3 py-1 rounded-sm text-xs font-medium transition-colors ${
                exportFormat === 'wav'
                  ? 'bg-brand-primary text-white'
                  : 'bg-neutral-800 text-neutral-400'
              }`}
            >
              WAV
            </button>
            <button
              onClick={() => onSetFormat('mp3')}
              className={`px-3 py-1 rounded-sm text-xs font-medium transition-colors ${
                exportFormat === 'mp3'
                  ? 'bg-brand-primary text-white'
                  : 'bg-neutral-800 text-neutral-400'
              }`}
            >
              MP3
            </button>
          </div>
        </div>

        <label className="flex items-center gap-2 text-xs text-neutral-400 cursor-pointer">
          <input
            type="checkbox"
            checked={exportWithMetronome}
            onChange={(e) => onSetMetronome(e.target.checked)}
            className="accent-brand-primary"
          />
          Include metronome ({bpm} BPM)
        </label>

        <button
          onClick={onExport}
          disabled={exporting || Object.values(exportSelection).filter(Boolean).length === 0}
          className="w-full px-3 py-2 rounded-sm text-xs font-semibold bg-brand-primary hover:bg-brand-primary/80 disabled:bg-neutral-700 disabled:text-neutral-500 text-white transition-colors"
        >
          {exporting ? 'Exporting...' : 'Export'}
        </button>
      </div>
    </div>
  )
}
