import { useEffect, useRef, useCallback } from 'react'

interface UseCountInReturn {
  // Schedules `bars * 4` metronome clicks (accenting every 4th click — the
  // downbeat of each bar) via `playClick`, starting ~50ms in the future.
  // `onTick(remaining)` fires once immediately (remaining = bars * 4) and
  // once per subsequent click as it plays, counting down to 1; `onComplete`
  // fires once, after the last click. No-op if `bars <= 0` or the
  // AudioContext isn't ready yet.
  start: (
    bars: number,
    bpm: number,
    onTick: (remaining: number) => void,
    onComplete: () => void
  ) => void
  // Clears every pending scheduled tick/completion for the current count-in
  // without calling onComplete — used to cancel mid-countdown (e.g. Stop
  // pressed before the count-in finishes).
  cancel: () => void
}

// Shared click-scheduling engine behind both the recording pre-roll
// (useRecording) and the playback-start count-in (add-song-count-in) — the
// exact same "N bars of metronome clicks, then do something" mechanic,
// extracted so it's implemented once instead of twice. Deliberately has no
// opinion on what "counting" state a caller shows in its UI — onTick/
// onComplete let each caller drive its own state (useRecording's
// recording/recordingCount, or a separate playback-count-in state).
//
// Takes `ensureAudioCtx` (useMetronome's own, e.g. its `ensureAudioCtx`)
// rather than a raw AudioContext ref — playClick internally reads
// useMetronome's *own* private AudioContext (created lazily only once the
// in-song scheduler runs), which is a different AudioContext than the
// stem-playback engine's. Passing a ref to some other context here (as an
// earlier version of this code did, reusing useAudioContextEngine's ref)
// checks/creates the wrong context: playClick's own ctx stays null and it
// silently no-ops, producing no click sound at all — see
// fix-count-in-silent-click.
export default function useCountIn(
  ensureAudioCtx: () => AudioContext | null,
  playClick: (accent: boolean, scheduledTime: number) => void
): UseCountInReturn {
  const timeoutIdsRef = useRef<ReturnType<typeof setTimeout>[]>([])

  const cancel = useCallback((): void => {
    for (const id of timeoutIdsRef.current) clearTimeout(id)
    timeoutIdsRef.current = []
  }, [])

  const start = useCallback(
    (
      bars: number,
      bpm: number,
      onTick: (remaining: number) => void,
      onComplete: () => void
    ): void => {
      if (bars <= 0) return
      const ctx = ensureAudioCtx()
      if (!ctx) return
      cancel()

      const totalBeats = bars * 4
      const interval = 60 / bpm
      const scheduleTime = ctx.currentTime + 0.05

      for (let i = 0; i < totalBeats; i++) {
        playClick(i % 4 === 0, scheduleTime + i * interval)
      }

      onTick(totalBeats)

      const ids: ReturnType<typeof setTimeout>[] = []
      for (let i = 0; i < totalBeats; i++) {
        const msDelay = i * interval * 1000 + 50
        ids.push(setTimeout(() => onTick(totalBeats - i), msDelay))
      }
      const totalMs = totalBeats * interval * 1000 + 50
      ids.push(setTimeout(onComplete, totalMs))
      timeoutIdsRef.current = ids
    },
    [ensureAudioCtx, playClick, cancel]
  )

  useEffect(() => cancel, [cancel])

  return { start, cancel }
}
