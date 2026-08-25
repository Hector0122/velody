import { useState, useRef, useEffect } from 'react'
import type { LivePreset } from '../hooks/livePresets'

// How long the "×" stays armed as "Confirm?" before reverting on its own —
// long enough to notice and click again, short enough not to linger as a
// trap for a later, unrelated click in roughly the same spot.
const DELETE_CONFIRM_TIMEOUT_MS = 4000

// How long "Update"/"Save New" show a "✓ Saved" flash after a click —
// onSave itself is fire-and-forget (no promise to await), so this is
// purely a feedback timer, not tied to when persistence actually
// completes (which is effectively instant either way).
const SAVED_FLASH_TIMEOUT_MS = 1200

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
// pan/metronome state already transitions smoothly).
//
// Saving under an existing name always updated that preset in place
// (upsertLivePreset, unchanged) — but the only way to trigger that was
// re-typing the exact name into an always-blank text field, which nobody
// found or used: reported as "no los puedo actualizar." The actual gap was
// UI, not data — a dedicated "Update" button, shown only while a preset is
// selected, now just re-saves under that preset's own name with zero
// typing required. The name field + its own Save button remain, now
// explicitly for creating additional/new presets.
export default function LivePresetBar({
  presets,
  activePresetId,
  onApply,
  onSave,
  onDelete
}: LivePresetBarProps): React.JSX.Element {
  const [name, setName] = useState('')
  const activePreset = presets.find((p) => p.id === activePresetId) ?? null

  // A single click on "×" used to delete immediately — reported as an
  // accidental loss ("le di en la x y perdi mi preset"). The first click
  // now only arms a confirm step (the button becomes "Confirm?" for a few
  // seconds); an actual delete needs a second, deliberate click.
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null)
  const confirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Brief "✓ Saved" flash after Update/Save New — a click that silently
  // did nothing visible left the user unsure it registered at all
  // ("quiero que el botón haga algo... para que el usuario se dé cuenta
  // que le dio clic"). 'update' | 'new' distinguishes which button is
  // flashing since both can be visible at once.
  const [justSaved, setJustSaved] = useState<'update' | 'new' | null>(null)
  const savedFlashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current)
      if (savedFlashTimeoutRef.current) clearTimeout(savedFlashTimeoutRef.current)
    }
  }, [])

  const armDeleteConfirm = (id: string): void => {
    setConfirmingDeleteId(id)
    if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current)
    confirmTimeoutRef.current = setTimeout(
      () => setConfirmingDeleteId(null),
      DELETE_CONFIRM_TIMEOUT_MS
    )
  }

  const handleDeleteClick = (id: string): void => {
    if (confirmingDeleteId === id) {
      if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current)
      setConfirmingDeleteId(null)
      onDelete(id)
    } else {
      armDeleteConfirm(id)
    }
  }

  const flashSaved = (which: 'update' | 'new'): void => {
    setJustSaved(which)
    if (savedFlashTimeoutRef.current) clearTimeout(savedFlashTimeoutRef.current)
    savedFlashTimeoutRef.current = setTimeout(() => setJustSaved(null), SAVED_FLASH_TIMEOUT_MS)
  }

  const handleUpdate = (): void => {
    if (!activePreset) return
    onSave(activePreset.name)
    flashSaved('update')
  }

  const handleSaveNew = (): void => {
    const trimmed = name.trim()
    if (!trimmed) return
    onSave(trimmed)
    setName('')
    flashSaved('new')
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
        <>
          <button
            onClick={handleUpdate}
            title={`Update "${activePreset.name}" with the current mix`}
            className={
              justSaved === 'update'
                ? 'px-2.5 py-1 rounded-md text-xs font-semibold bg-green-600 text-white transition-colors shrink-0'
                : 'px-2.5 py-1 rounded-md text-xs font-semibold bg-neutral-800 border border-neutral-700 text-neutral-300 hover:text-white hover:border-brand-primary transition-colors shrink-0'
            }
          >
            {justSaved === 'update' ? '✓ Saved' : 'Update'}
          </button>
          <button
            onClick={() => handleDeleteClick(activePreset.id)}
            title={
              confirmingDeleteId === activePreset.id
                ? `Click again to permanently delete "${activePreset.name}"`
                : `Delete "${activePreset.name}"`
            }
            className={
              confirmingDeleteId === activePreset.id
                ? 'px-2 py-1 rounded-md text-[10px] font-semibold bg-red-600 hover:bg-red-500 text-white transition-colors shrink-0'
                : 'text-neutral-600 hover:text-red-500 transition-colors text-xs shrink-0'
            }
          >
            {confirmingDeleteId === activePreset.id ? 'Confirm?' : <>&#10005;</>}
          </button>
        </>
      )}
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSaveNew()
        }}
        placeholder="Save current mix as new..."
        className="min-w-0 w-40 px-2 py-1 rounded-md bg-neutral-800 border border-neutral-700 text-neutral-200 text-xs placeholder-neutral-500 focus:outline-none focus:border-brand-primary transition-colors"
      />
      <button
        onClick={handleSaveNew}
        title="Save the current mute/volume/pan/metronome/master-volume state as a new preset"
        className={
          justSaved === 'new'
            ? 'px-2.5 py-1 rounded-md text-xs font-semibold bg-green-600 text-white transition-colors shrink-0'
            : 'px-2.5 py-1 rounded-md text-xs font-semibold bg-brand-primary hover:bg-brand-primary/80 text-white transition-colors shrink-0'
        }
      >
        {justSaved === 'new' ? '✓ Saved' : 'Save New'}
      </button>
    </div>
  )
}
