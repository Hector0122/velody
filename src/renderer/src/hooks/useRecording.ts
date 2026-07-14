import { useState, useRef, useCallback } from 'react'
import { formatTime, updateTimeDisplays } from '../utils'

interface UseRecordingParams {
  audioCtxRef: React.MutableRefObject<AudioContext | null>
  seek: (time: number) => void
  stemWaves: React.MutableRefObject<Record<string, unknown>>
  waveUrlsRef: React.MutableRefObject<Record<string, string>>
  bpm: number
  positionRef: React.MutableRefObject<number>
  audioStartRef: React.MutableRefObject<number | null>
  stems: string[]
  stemMeta: Record<string, { color: string; label: string }>
  playClick: (accent: boolean, scheduledTime: number) => void
  setRecordedStems: React.Dispatch<React.SetStateAction<string[]>>
  progressRef: React.MutableRefObject<number>
}

export function useRecording({
  audioCtxRef,
  seek,
  bpm,
  positionRef,
  audioStartRef,
  stems,
  stemMeta,
  playClick,
  setRecordedStems,
  progressRef
}: UseRecordingParams): {
  recording: 'idle' | 'countdown' | 'recording' | 'confirming'
  recordingKey: string | null
  recordingCount: number
  recordingElapsed: number
  monitorVolume: number
  recordingFormat: 'wav' | 'mp3'
  recordingTake: number
  countInBars: number
  setMonitorVolume: (v: number) => void
  setRecordingFormat: (v: 'wav' | 'mp3') => void
  setCountInBars: (v: number) => void
  handleStartRecording: (key: string) => Promise<void>
  handleStopRecording: () => void
  handleDiscardRecording: () => void
  handleSaveRecording: () => Promise<void>
} {
  const [recording, setRecording] = useState<'idle' | 'countdown' | 'recording' | 'confirming'>(
    'idle'
  )
  const [recordingKey, setRecordingKey] = useState<string | null>(null)
  const [recordingCount, setRecordingCount] = useState(3)
  const [recordingElapsed, setRecordingElapsed] = useState(0)
  const [recordingBlob, setRecordingBlob] = useState<Blob | null>(null)
  const [monitorVolume, setMonitorVolume] = useState(0.5)
  const [recordingFormat, setRecordingFormat] = useState<'wav' | 'mp3'>('wav')
  const [recordingTake, setRecordingTake] = useState(1)
  const [countInBars, setCountInBars] = useState(1)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recordingChunksRef = useRef<Blob[]>([])
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const recordingStartTimeRef = useRef(0)
  const recordingOffsetRef = useRef(0)
  const recordingTimeoutIds = useRef<ReturnType<typeof setTimeout>[]>([])
  const recordingElapsedRef = useRef(0)

  const beginCapture = useCallback(
    (stream: MediaStream): void => {
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      mediaRecorderRef.current = mr
      recordingChunksRef.current = []
      recordingOffsetRef.current = positionRef.current

      mr.ondataavailable = (e) => {
        if (e.data.size > 0) recordingChunksRef.current.push(e.data)
      }

      mr.onstop = () => {
        const blob = new Blob(recordingChunksRef.current, { type: 'audio/webm' })
        setRecordingBlob(blob)
        const elapsed = Math.floor((Date.now() - recordingStartTimeRef.current) / 1000)
        recordingElapsedRef.current = elapsed
        setRecordingElapsed(elapsed)
        setRecording('confirming')
      }

      recordingStartTimeRef.current = Date.now()
      mr.start()

      setRecording('recording')
      setRecordingElapsed(0)
      recordingElapsedRef.current = 0

      recordingTimerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - recordingStartTimeRef.current) / 1000)
        recordingElapsedRef.current = elapsed
        const els = document.querySelectorAll<HTMLElement>('[data-rec-elapsed]')
        const str = formatTime(elapsed)
        for (let i = 0; i < els.length; i++) els[i].textContent = str
      }, 250)
    },
    [positionRef]
  )

  const handleStartRecording = useCallback(
    async (key: string): Promise<void> => {
      if (!window.api) return
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        setRecordingKey(key)
        recordingChunksRef.current = []

        const totalBeats = countInBars * 4
        if (totalBeats > 0) {
          let ctx = audioCtxRef.current
          if (!ctx) {
            try {
              ctx = new AudioContext()
              audioCtxRef.current = ctx
            } catch {
              console.error('[useRecording] Failed to create AudioContext')
              stream.getTracks().forEach((t) => t.stop())
              return
            }
          }
          if (ctx.state === 'suspended') {
            ctx.resume()
          }
          const interval = 60 / bpm

          const nearStart = positionRef.current < 5
          const audioStart = audioStartRef.current
          let seekStart = positionRef.current
          if (nearStart && audioStart !== null && audioStart > 0) {
            const countInDur = totalBeats * interval
            seekStart = Math.max(0, audioStart - countInDur)
            seek(seekStart)
            positionRef.current = seekStart
            progressRef.current = seekStart
            updateTimeDisplays(seekStart)
          }

          const now = ctx.currentTime
          const scheduleTime = now + 0.05

          for (let i = 0; i < totalBeats; i++) {
            const scheduledTime = scheduleTime + i * interval
            playClick(i === 0, scheduledTime)
          }

          setRecording('countdown')
          setRecordingCount(totalBeats)

          recordingTimeoutIds.current = []
          for (let i = 0; i < totalBeats; i++) {
            const msDelay = i * interval * 1000 + 50
            const id = setTimeout(() => setRecordingCount(totalBeats - i), msDelay)
            recordingTimeoutIds.current.push(id)
          }

          const totalMs = totalBeats * interval * 1000 + 50
          const beginId = setTimeout(() => beginCapture(stream), totalMs)
          recordingTimeoutIds.current.push(beginId)
        } else {
          setRecording('countdown')
          setRecordingCount(3)
          const cd = setInterval(() => {
            setRecordingCount((prev) => {
              if (prev <= 1) {
                clearInterval(cd)
                beginCapture(stream)
                return 0
              }
              return prev - 1
            })
          }, 1000)
        }
      } catch (err) {
        console.error('[useRecording] Permission denied or no mic:', err)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [audioCtxRef, seek, bpm, countInBars, positionRef, audioStartRef, playClick, beginCapture]
  )

  const handleStopRecording = useCallback((): void => {
    for (const id of recordingTimeoutIds.current) clearTimeout(id)
    recordingTimeoutIds.current = []
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current)
      recordingTimerRef.current = null
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
  }, [])

  const handleDiscardRecording = useCallback((): void => {
    for (const id of recordingTimeoutIds.current) clearTimeout(id)
    recordingTimeoutIds.current = []
    setRecording('idle')
    setRecordingKey(null)
    setRecordingBlob(null)
    setRecordingElapsed(0)
    setRecordingCount(3)
    setRecordingTake(1)
    recordingChunksRef.current = []
  }, [])

  const handleSaveRecording = useCallback(async (): Promise<void> => {
    if (!window.api || !recordingBlob || !recordingKey) return
    const songDir = stems.length > 0 ? stems[0].replace(/[/\\][^/\\]+$/, '') : ''
    if (!songDir) return

    const label = stemMeta[recordingKey]?.label ?? recordingKey
    const take = recordingTake
    const name = `Recording ${label} ${take}`
    const arrayBuf = await recordingBlob.arrayBuffer()

    const result = await window.api.saveRecording(
      songDir,
      Array.from(new Uint8Array(arrayBuf)),
      name,
      recordingFormat,
      recordingOffsetRef.current
    )
    if (result.success && result.path) {
      setRecordedStems((prev) => [...prev, result.path!])
      setRecordingTake((prev) => prev + 1)
    }

    setRecording('idle')
    setRecordingKey(null)
    setRecordingBlob(null)
    setRecordingElapsed(0)
    setRecordingCount(3)
    recordingChunksRef.current = []
  }, [
    recordingBlob,
    recordingKey,
    recordingTake,
    recordingFormat,
    recordingOffsetRef,
    stems,
    stemMeta,
    setRecordedStems
  ])

  return {
    recording,
    recordingKey,
    recordingCount,
    recordingElapsed,
    monitorVolume,
    recordingFormat,
    recordingTake,
    countInBars,
    setMonitorVolume,
    setRecordingFormat,
    setCountInBars,
    handleStartRecording,
    handleStopRecording,
    handleDiscardRecording,
    handleSaveRecording
  }
}
