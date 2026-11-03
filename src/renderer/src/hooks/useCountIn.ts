import { useEffect, useRef, useCallback } from 'react'

// Exported so callers that need to independently pre-schedule something
// else to land at the exact same real-world instant the count-in finishes
// (e.g. StemPlayer pre-scheduling the song's actual first sample on the
// *stem engine's own* AudioContext — a different clock than this hook's
// ctx — see fix-count-in-handoff-precision) can compute an identical
// duration without duplicating/risking drift from this magic number.
export const COUNT_IN_LEAD_IN = 0.05

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
  // Plays clicks at exact, caller-computed AudioContext times (the playback
  // count-in laid on the song's beat grid — see planCountIn in downbeat.ts).
  // `onTick(remaining)` fires immediately and as each click plays.
  startAt: (
    clicks: { when: number; accent: boolean }[],
    onTick: (remaining: number) => void
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
  // The rAF poll driving onComplete (see below) — tracked separately from
  // timeoutIdsRef since it's canceled via cancelAnimationFrame, not
  // clearTimeout.
  const rafIdRef = useRef<number | null>(null)

  const cancel = useCallback((): void => {
    for (const id of timeoutIdsRef.current) clearTimeout(id)
    timeoutIdsRef.current = []
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current)
      rafIdRef.current = null
    }
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
      const scheduleTime = ctx.currentTime + COUNT_IN_LEAD_IN

      for (let i = 0; i < totalBeats; i++) {
        playClick(i % 4 === 0, scheduleTime + i * interval)
      }

      onTick(totalBeats)

      // onTick is display-only (drives the on-screen "3... 2... 1..."
      // countdown) — setTimeout's precision is plenty for that, no need to
      // tie it to the audio clock.
      const ids: ReturnType<typeof setTimeout>[] = []
      for (let i = 0; i < totalBeats; i++) {
        const msDelay = i * interval * 1000 + COUNT_IN_LEAD_IN * 1000
        ids.push(setTimeout(() => onTick(totalBeats - i), msDelay))
      }
      timeoutIdsRef.current = ids

      // onComplete is NOT display-only — it's what actually starts song
      // playback (and arms the in-song metronome), so it has to land at the
      // same instant the last count-in click's beat would have landed.
      // A setTimeout here (as this used to be) runs on the JS wall clock,
      // which isn't phase-locked to the AudioContext's own hardware clock
      // that the clicks are scheduled against via ctx.currentTime — the two
      // can drift apart by tens of milliseconds (main-thread congestion, GC
      // pauses, Electron IPC overhead), even over a 1-2 bar count-in. That
      // drift landed exactly on the moment the song starts, producing a
      // subtle "not quite locked to the beat" feel reported after live use
      // — see fix-count-in-onbeat-handoff-jitter. Polling ctx.currentTime
      // via requestAnimationFrame instead ties onComplete to the exact same
      // clock the clicks themselves use, capping the error at ~1 frame
      // (~16ms) instead of unbounded setTimeout jitter.
      const targetTime = scheduleTime + totalBeats * interval
      const poll = (): void => {
        if (ctx.currentTime >= targetTime) {
          rafIdRef.current = null
          onComplete()
          return
        }
        rafIdRef.current = requestAnimationFrame(poll)
      }
      rafIdRef.current = requestAnimationFrame(poll)
    },
    [ensureAudioCtx, playClick, cancel]
  )

  const startAt = useCallback(
    (clicks: { when: number; accent: boolean }[], onTick: (remaining: number) => void): void => {
      if (clicks.length === 0) return
      const ctx = ensureAudioCtx()
      if (!ctx) return
      cancel()
      for (const click of clicks) playClick(click.accent, click.when)
      onTick(clicks.length)
      // Display-only countdown; wall-clock precision is fine here.
      timeoutIdsRef.current = clicks.map((click, i) =>
        setTimeout(
          () => onTick(clicks.length - i),
          Math.max(0, (click.when - ctx.currentTime) * 1000)
        )
      )
    },
    [ensureAudioCtx, playClick, cancel]
  )

  useEffect(() => cancel, [cancel])

  return { start, startAt, cancel }
}
