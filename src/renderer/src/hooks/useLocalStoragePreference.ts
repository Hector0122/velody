import { useState, useCallback } from 'react'

// Small shared helper for a lightweight, global (not per-song) preference
// persisted in the renderer's localStorage — first used by the metronome
// click preset (add-metronome-click-sounds), reused by
// add-metronome-and-mix-panning's pan values. Not a fit for per-song
// settings — those go through the .velody sidecar via song:saveMeta/
// loadMeta instead (see useTrim/useSongCountIn). Deliberately not a new
// general settings-file/IPC mechanism: this is the first (and so far only
// couple of) global preference this app has ever needed, and localStorage
// already covers that with zero main-process changes.
export default function useLocalStoragePreference<T>(
  key: string,
  defaultValue: T,
  isValid: (value: unknown) => value is T
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key)
      if (raw === null) return defaultValue
      const parsed = JSON.parse(raw)
      return isValid(parsed) ? parsed : defaultValue
    } catch {
      // localStorage unavailable, or a corrupted/unexpected stored value —
      // degrade to the default rather than throw.
      return defaultValue
    }
  })

  const setPersisted = useCallback(
    (next: T): void => {
      setValue(next)
      try {
        window.localStorage.setItem(key, JSON.stringify(next))
      } catch {
        /* localStorage unavailable (e.g. private mode quota) — in-memory state still works for this session */
      }
    },
    [key]
  )

  return [value, setPersisted]
}
