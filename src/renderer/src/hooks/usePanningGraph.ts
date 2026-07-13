import { useRef, useCallback, useEffect } from 'react'

interface PanningNodes {
  source: MediaElementAudioSourceNode
  panner: StereoPannerNode
}

interface UsePanningGraphParams {
  audioCtxRef: React.MutableRefObject<AudioContext | null>
  audioEls: React.MutableRefObject<Record<string, HTMLAudioElement>>
  stemPannings: Record<string, number>
}

interface UsePanningGraphReturn {
  ensureAudioContext: () => AudioContext | null
  setupPanningForKey: (key: string) => void
  setupAllPanning: () => void
  panNodesRef: React.MutableRefObject<Record<string, PanningNodes>>
  disconnectPanner: (key: string) => void
  disconnectAllPanners: () => void
}

export function usePanningGraph({
  audioCtxRef,
  audioEls,
  stemPannings
}: UsePanningGraphParams): UsePanningGraphReturn {
  const panNodesRef = useRef<Record<string, PanningNodes>>({})

  const ensureAudioContext = useCallback((): AudioContext | null => {
    if (!audioCtxRef.current) {
      try {
        audioCtxRef.current = new AudioContext()
      } catch (e) {
        console.error('[pan] AudioContext creation failed', e)
        return null
      }
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume()
    }
    return audioCtxRef.current
  }, [audioCtxRef])

  const setupPanningForKey = useCallback(
    (key: string): void => {
      if (panNodesRef.current[key]) return
      const ctx = audioCtxRef.current
      if (!ctx) return
      const el = audioEls.current[key]
      if (!el) return
      try {
        const source = ctx.createMediaElementSource(el)
        const panner = ctx.createStereoPanner()
        panner.pan.value = stemPannings[key] ?? 0
        source.connect(panner)
        panner.connect(ctx.destination)
        panNodesRef.current[key] = { source, panner }
      } catch (err) {
        console.error('[pan] FAILED for', key, err)
      }
    },
    [audioCtxRef, audioEls, stemPannings]
  )

  const setupAllPanning = useCallback((): void => {
    for (const key of Object.keys(stemPannings)) {
      setupPanningForKey(key)
    }
  }, [stemPannings, setupPanningForKey])

  // Sync panner values reactively when sliders move after graph is wired
  useEffect(() => {
    for (const [key, nodes] of Object.entries(panNodesRef.current)) {
      nodes.panner.pan.value = stemPannings[key] ?? 0
    }
  }, [stemPannings])

  const disconnectPanner = useCallback((key: string): void => {
    if (panNodesRef.current[key]) {
      try {
        panNodesRef.current[key].panner.disconnect()
      } catch {
        /* ignore */
      }
      delete panNodesRef.current[key]
    }
  }, [])

  const disconnectAllPanners = useCallback((): void => {
    for (const nodes of Object.values(panNodesRef.current)) {
      try {
        nodes.panner.disconnect()
      } catch {
        /* ignore */
      }
    }
    panNodesRef.current = {}
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnectAllPanners()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    ensureAudioContext,
    setupPanningForKey,
    setupAllPanning,
    panNodesRef,
    disconnectPanner,
    disconnectAllPanners
  }
}
