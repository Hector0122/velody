// Shared between the renderer (useSongAnalysis) and main (background library
// analysis) so both read and write the same .velody analysis cache.

// 21: Beat This! on the stem mix (follows tempo changes, e.g. drumless intros).
// 20: also caches the detected downbeat (`detectedDownbeatShift`).
// 19: detection runs on the drums stem (pickBeatTrackingStem).
// 18: caches started storing the detected beat-time grid.
export const ANALYSIS_CACHE_VERSION = 21

// Every stem Demucs produces, in beat-tracking preference order: drums carry
// the clearest onsets; the fallbacks are the next most rhythmic stems.
// (Detection used to take stems[0], whose identity depended on listing order.)
export const STEM_NAMES = ['drums', 'bass', 'other', 'guitar', 'piano', 'vocals']

const stemName = (path: string): string =>
  path
    .split(/[/\\]/)
    .pop()
    ?.replace(/\.[^.]+$/, '') ?? path

export function pickBeatTrackingStem(stems: string[]): string | undefined {
  for (const name of STEM_NAMES) {
    const match = stems.find((s) => stemName(s) === name)
    if (match) return match
  }
  return stems[0]
}

/** True when a .velody object already holds a current, successful analysis. */
export function hasCurrentAnalysis(meta: unknown): boolean {
  const m = meta as { bpm?: unknown; _version?: unknown } | null
  return !!m && typeof m.bpm === 'number' && m.bpm > 0 && m._version === ANALYSIS_CACHE_VERSION
}

/**
 * What a fresh (no bpm hint) detection is saved as in `.velody`'s `tracker`:
 * 'fallback' marks a grid made without Beat This! (not installed yet, model
 * not downloaded offline), redone once it's available. A tempo-octave
 * correction saves 'corrected' so it's never redone over the user's choice.
 */
export function trackerOf(result: { tracker?: string }): 'beat_this' | 'fallback' {
  return result.tracker === 'beat_this' ? 'beat_this' : 'fallback'
}

/** Whether background analysis should (re)analyze this song. */
export function needsAnalysis(meta: unknown, redoFallbacks: boolean): boolean {
  if (!hasCurrentAnalysis(meta)) return true
  return redoFallbacks && (meta as { tracker?: unknown }).tracker === 'fallback'
}
