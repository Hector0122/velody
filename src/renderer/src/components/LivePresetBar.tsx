import { useState } from 'react'
import type { LivePreset } from '../hooks/livePresets'

interface LivePresetBarProps {
  presets: LivePreset[]
  activePresetId: string | null
  onApply: (id: string) => void
  onSave: (name: string) => void
  onDelete: (id: string) => void
}

// Compact "ready to play" mix-preset control in the song header — see
// openspec/changes/add-live-presets. Selecting a preset applies it
// immediately (works even mid-playback, since the underlying mute/volume/
// pan/metronome state already transitions smoothly); typing a name and
// saving either creates a new preset or updates one with that exact name.
export default function LivePresetBar({
  presets,
  activePresetId,
  onApply,
  onSave,
  onDelete
}: LivePresetBarProps): React.JSX.Element {
  const [name, setName] = useState('')
  const activePreset = presets.find((p) => p.id === activePresetId) ?? null

  const handleSave = (): void => {
    const trimmed = name.trim()
    if (!trimmed) return
    onSave(trimmed)
    setName('')
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[10px] text-neutral-500 uppercase tracking-wide shrink-0">
        Live Preset
      </span>
      <select
        aria-label="Live preset"
        value={activePresetId ?? ''}
        onChange={(e) => {
          if (e.target.value) onApply(e.target.value)
        }}
        className="min-w-0 px-2 py-1 rounded-md bg-neutral-800 border border-neutral-700 text-neutral-200 text-xs focus:outline-none focus:border-brand-primary transition-colors"
      >
        <option value="">{presets.length === 0 ? 'No presets yet' : 'Select preset...'}</option>
        {presets.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {activePreset && (
        <button
          onClick={() => onDelete(activePreset.id)}
          title={`Delete "${activePreset.name}"`}
          className="text-neutral-600 hover:text-red-500 transition-colors text-xs shrink-0"
        >
          &#10005;
        </button>
      )}
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSave()
        }}
        placeholder="Save current mix as..."
        className="min-w-0 w-40 px-2 py-1 rounded-md bg-neutral-800 border border-neutral-700 text-neutral-200 text-xs placeholder-neutral-500 focus:outline-none focus:border-brand-primary transition-colors"
      />
      <button
        onClick={handleSave}
        title="Save the current mute/volume/pan/metronome/master-volume state as a preset — re-using an existing name updates it in place"
        className="px-2.5 py-1 rounded-md text-xs font-semibold bg-brand-primary hover:bg-brand-primary/80 text-white transition-colors shrink-0"
      >
        Save
      </button>
    </div>
  )
}
