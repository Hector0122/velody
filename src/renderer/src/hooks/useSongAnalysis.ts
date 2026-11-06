import { useEffect, useRef, useState } from 'react'
import { songDirFromStemPath, pickBeatTrackingStem } from '../utils'
import { ANALYSIS_CACHE_VERSION, trackerOf, validChords } from '../../../shared/analysis'
import type { ChordChange } from '../../../shared/types'
import { smoothBeatGrid } from './downbeat'

// Version lives in src/shared/analysis.ts (main's background analysis writes
// the same cache).
const CACHE_VERSION = ANALYSIS_CACHE_VERSION
export { CACHE_VERSION }

// originalBpmRef/beatTimesRef, like firstBeatOffsetRef, are refs owned by
// StemPlayer and threaded into both this hook (which writes them) and
// useMetronome (which reads them) — avoids a circular dependency between the
// two hooks (useMetronome needs the detected grid; useSongAnalysis needs
// useMetronome's setBpm). Returns the song's detected chords ([] until known).
export default function useSongAnalysis(
  urls: Record<string, string>,
  stems: string[],
  setBpm: (bpm: number) => void,
  firstBeatOffsetRef: React.MutableRefObject<number>,
  originalBpmRef: React.MutableRefObject<number>,
  beatTimesRef: React.MutableRefObject<number[]>,
  // Receives the auto-detected bar phase (see useDownbeatShift).
  onDetectedDownbeat?: (shift: number) => void
): ChordChange[] {
  const detectedRef = useRef(false)
  const [chords, setChords] = useState<ChordChange[]>([])

  useEffect(() => {
    if (detectedRef.current) return
    const allUrls = Object.values(urls)
    if (allUrls.length === 0 || stems.length === 0) return

    detectedRef.current = true
    ;(async (): Promise<void> => {
      if (!window.api) return

      const songDir = songDirFromStemPath(stems[0])
      const cached = (await window.api.loadMeta(songDir)) as {
        bpm?: number
        firstBeatOffset?: number
        beatTimes?: number[]
        detectedDownbeatShift?: number
        chords?: unknown
        _version?: number
      } | null
      if (
        cached &&
        cached.bpm &&
        typeof cached.firstBeatOffset === 'number' &&
        cached._version === CACHE_VERSION
      ) {
        originalBpmRef.current = cached.bpm
        firstBeatOffsetRef.current = cached.firstBeatOffset
        beatTimesRef.current = Array.isArray(cached.beatTimes)
          ? smoothBeatGrid(cached.beatTimes)
          : []
        setBpm(cached.bpm)
        if (typeof cached.detectedDownbeatShift === 'number') {
          onDetectedDownbeat?.(cached.detectedDownbeatShift)
        }
        setChords(validChords(cached.chords) ?? [])
        return
      }

      try {
        const result = await window.api.detectBpm(pickBeatTrackingStem(stems) ?? stems[0])
        if (result) {
          // Defensive: guard against a stale/mismatched main process (e.g. a
          // dev session not yet restarted after this field was added) still
          // returning a result without beatTimes — fall back to [] rather
          // than crash the scheduler on `beatTimes.length`.
          const beatTimes = Array.isArray(result.beatTimes) ? result.beatTimes : []
          originalBpmRef.current = result.bpm
          firstBeatOffsetRef.current = result.firstBeatOffset
          beatTimesRef.current = smoothBeatGrid(beatTimes)
          setBpm(result.bpm)
          if (typeof result.downbeatShift === 'number') onDetectedDownbeat?.(result.downbeatShift)
          setChords(result.chords ?? [])
          window.api.saveMeta(songDir, {
            bpm: result.bpm,
            firstBeatOffset: result.firstBeatOffset,
            beatTimes,
            detectedDownbeatShift: result.downbeatShift,
            tracker: trackerOf(result),
            chords: result.chords,
            _version: CACHE_VERSION
          })
        }
      } catch {
        /* detection failed — do NOT cache fallback */
      }
    })()
  }, [urls, stems, setBpm, firstBeatOffsetRef, originalBpmRef, beatTimesRef, onDetectedDownbeat])

  return chords
}
