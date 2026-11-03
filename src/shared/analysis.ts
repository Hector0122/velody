// Shared between the renderer (useSongAnalysis) and main (background library
// analysis) so both read and write the same .velody analysis cache.

// 20: also caches the detected downbeat (`detectedDownbeatShift`).
// 19: detection runs on the drums stem (pickBeatTrackingStem).
// 18: caches started storing the detected beat-time grid.
export const ANALYSIS_CACHE_VERSION = 20

// Stem to run tempo/beat detection on. Drums carry the clearest onsets for
// beat tracking; the fallbacks are the next most rhythmic stems. (Detection
// used to take stems[0], whose identity depended on directory-listing order.)
const BEAT_TRACKING_PREFERENCE = ['drums', 'bass', 'other', 'guitar', 'piano', 'vocals']

const stemName = (path: string): string =>
  path
    .split(/[/\\]/)
    .pop()
    ?.replace(/\.[^.]+$/, '') ?? path

export function pickBeatTrackingStem(stems: string[]): string | undefined {
  for (const name of BEAT_TRACKING_PREFERENCE) {
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
