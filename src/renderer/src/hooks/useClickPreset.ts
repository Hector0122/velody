import useLocalStoragePreference from './useLocalStoragePreference'
import { type ClickPreset, DEFAULT_CLICK_PRESET, isClickPreset } from './clickPresets'

export default function useClickPreset(): [ClickPreset, (preset: ClickPreset) => void] {
  return useLocalStoragePreference<ClickPreset>(
    'velody:clickPreset',
    DEFAULT_CLICK_PRESET,
    isClickPreset
  )
}
