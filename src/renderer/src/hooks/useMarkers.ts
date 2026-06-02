import { useState, useCallback } from 'react'

interface Marker {
  time: number
  label: string
}

interface UseMarkersReturn {
  markers: Marker[]
  loopStart: number | null
  loopEnd: number | null
  loopEnabled: boolean
  pendingMarkerTime: number
  showMarkerInput: boolean
  setShowMarkerInput: (v: boolean) => void
  setMarkers: React.Dispatch<React.SetStateAction<Marker[]>>
  setPendingMarkerTime: React.Dispatch<React.SetStateAction<number>>
  handleSetLoopStart: (time: number | null) => void
  handleSetLoopEnd: (time: number | null) => void
  handleToggleLoop: () => void
  handleClearMarkers: () => void
  handleRemoveMarker: (i: number) => void
}

export default function useMarkers(): UseMarkersReturn {
  const [markers, setMarkers] = useState<Marker[]>([])
  const [loopStart, setLoopStart] = useState<number | null>(null)
  const [loopEnd, setLoopEnd] = useState<number | null>(null)
  const [loopEnabled, setLoopEnabled] = useState(false)
  const [pendingMarkerTime, setPendingMarkerTime] = useState(0)
  const [showMarkerInput, setShowMarkerInput] = useState(false)

  const handleSetLoopStart = useCallback((time: number | null): void => {
    setLoopStart(time)
  }, [])
  const handleSetLoopEnd = useCallback((time: number | null): void => {
    setLoopEnd(time)
  }, [])
  const handleToggleLoop = useCallback((): void => {
    setLoopEnabled((prev) => !prev)
  }, [])
  const handleClearMarkers = useCallback((): void => {
    setMarkers([])
  }, [])
  const handleRemoveMarker = useCallback((i: number): void => {
    setMarkers((prev) => prev.filter((_, idx) => idx !== i))
  }, [])

  return {
    markers,
    loopStart,
    loopEnd,
    loopEnabled,
    pendingMarkerTime,
    showMarkerInput,
    setShowMarkerInput,
    setMarkers,
    setPendingMarkerTime,
    handleSetLoopStart,
    handleSetLoopEnd,
    handleToggleLoop,
    handleClearMarkers,
    handleRemoveMarker
  }
}
