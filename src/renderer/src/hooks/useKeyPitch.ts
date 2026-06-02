import { useLayoutEffect, useRef, useState, useCallback } from 'react'
import { PITCH_SHIFT_MIN, PITCH_SHIFT_MAX, stemNameFromPath } from '../utils'
import { CACHE_VERSION } from './useSongAnalysis'

interface UseKeyPitchReturn {
  manualKey: string | null
  effectiveKey: string | null
  pitchShift: number
  shiftedPaths: Record<string, string>
  transposing: boolean
  showKeyPicker: boolean
  showJamZone: boolean
  selectedScaleIdx: number
  scalesMaxH: number
  fretboardColRef: React.RefObject<HTMLDivElement | null>
  setShowJamZone: (v: boolean) => void
  setSelectedScaleIdx: (idx: number) => void
  handleKeySelect: (key: string) => void
  handleKeyReset: () => void
  handlePitchShift: (delta: number) => void
  handleToggleKeyPicker: () => void
}

export default function useKeyPitch(
  stems: string[],
  allStems: string[],
  detectedKey: string | null
): UseKeyPitchReturn {
  const [manualKey, setManualKey] = useState<string | null>(null)
  const effectiveKey = manualKey ?? detectedKey
  const [pitchShift, setPitchShift] = useState(0)
  const [shiftedPaths, setShiftedPaths] = useState<Record<string, string>>({})
  const [transposing, setTransposing] = useState(false)
  const [showKeyPicker, setShowKeyPicker] = useState(false)
  const [showJamZone, setShowJamZone] = useState(false)
  const [selectedScaleIdx, setSelectedScaleIdx] = useState(0)

  const fretboardColRef = useRef<HTMLDivElement | null>(null)
  const [scalesMaxH, setScalesMaxH] = useState<number>(400)

  useLayoutEffect(() => {
    const el = fretboardColRef.current
    if (!showJamZone || !el) return
    const update = (): void => {
      setScalesMaxH(el.offsetHeight)
    }
    update()
    const obs = new ResizeObserver(update)
    obs.observe(el)
    return () => obs.disconnect()
  }, [showJamZone])

  const handleKeySelect = useCallback(
    (key: string): void => {
      setManualKey(key)
      setShowKeyPicker(false)
      const songDir = stems.length > 0 ? stems[0].replace(/[/\\][^/\\]+$/, '') : ''
      if (window.api && songDir) {
        window.api.saveMeta(songDir, { key, _version: CACHE_VERSION } as Record<string, unknown>)
      }
    },
    [stems]
  )

  const handleKeyReset = useCallback((): void => {
    setManualKey(null)
    setShowKeyPicker(false)
  }, [])

  const handlePitchShift = useCallback(
    async (delta: number): Promise<void> => {
      if (!window.api) return
      const newShift = pitchShift + delta
      if (newShift < PITCH_SHIFT_MIN || newShift > PITCH_SHIFT_MAX) return
      if (newShift === 0) {
        setPitchShift(0)
        setShiftedPaths({})
        return
      }
      setTransposing(true)
      try {
        const paths = await window.api.transposeStems(allStems, newShift)
        const map: Record<string, string> = {}
        for (const p of paths) map[stemNameFromPath(p)] = p
        setShiftedPaths(map)
        setPitchShift(newShift)
      } catch {
        /* transpose failed */
      }
      setTransposing(false)
    },
    [pitchShift, allStems]
  )

  const handleToggleKeyPicker = useCallback((): void => {
    setShowKeyPicker((prev) => !prev)
  }, [])

  return {
    manualKey,
    effectiveKey,
    pitchShift,
    shiftedPaths,
    transposing,
    showKeyPicker,
    showJamZone,
    selectedScaleIdx,
    scalesMaxH,
    fretboardColRef,
    setShowJamZone,
    setSelectedScaleIdx,
    handleKeySelect,
    handleKeyReset,
    handlePitchShift,
    handleToggleKeyPicker
  }
}
