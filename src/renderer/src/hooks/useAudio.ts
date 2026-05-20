import { useState, useCallback } from 'react'

interface AudioState {
  isLoaded: boolean
  isProcessing: boolean
  error: string | null
  trackPath: string | null
  stems: string[]
}

export function useAudio(): AudioState & {
  loadTrack: (path: string) => void
  startSeparation: () => Promise<void>
} {
  const [state, setState] = useState<AudioState>({
    isLoaded: false,
    isProcessing: false,
    error: null,
    trackPath: null,
    stems: []
  })

  const loadTrack = useCallback((path: string) => {
    setState((prev) => ({ ...prev, trackPath: path, isLoaded: true, error: null }))
  }, [])

  const startSeparation = useCallback(async () => {
    if (!state.trackPath || !window.api) return

    setState((prev) => ({ ...prev, isProcessing: true, error: null }))

    try {
      const stems = await window.api.startSeparation(state.trackPath)
      setState((prev) => ({ ...prev, isProcessing: false, stems }))
    } catch (err) {
      setState((prev) => ({
        ...prev,
        isProcessing: false,
        error: err instanceof Error ? err.message : 'Separation failed'
      }))
    }
  }, [state.trackPath])

  return {
    ...state,
    loadTrack,
    startSeparation
  }
}
