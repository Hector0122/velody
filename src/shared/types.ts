import type {
  CloudActionResult,
  CloudProgressEvent,
  CloudSettingsInput,
  CloudSettingsView,
  CloudTestResult,
  SongSyncState
} from './cloud'

export interface SetupProgress {
  step: string
  progress: number
  status: 'working' | 'done' | 'error'
  message: string
}

export interface SongItem {
  name: string
  /** Absolute stem paths; empty for a song that is only in the cloud. */
  stems: string[]
  /** Set only while cloud sync is enabled (see cloud-library-sync). */
  sync?: SongSyncState
  cloudId?: string
  /** Total size of the song's files in the cloud (cloud-only songs). */
  sizeBytes?: number
}

// Named, ordered references to library songs by name — never a copy of
// song data. See openspec/changes/add-song-setlists.
export interface Setlist {
  id: string
  name: string
  songNames: string[]
  updatedAt: number
}

export interface ExportResult {
  success: boolean
  error?: string
}

export interface SeparationProgressEvent {
  jobId: string
  percent: number
}

export interface SeparationCompleteEvent {
  jobId: string
  stems: string[]
}

export interface SeparationFailedEvent {
  jobId: string
  error: string
}

export interface SeparationCancelledEvent {
  jobId: string
}

export interface DownloadProgressEvent {
  jobId: string
  percent: number
  title?: string
}

export interface DownloadFailedEvent {
  jobId: string
  error: string
}

/** MP3 bitrate (kbps) Demucs encodes stems with — chosen per song at import time. */
export type StemBitrate = 128 | 192 | 320

export interface SeparationJob {
  id: string
  songPath: string
  songName: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  progress: number
  stems?: string[]
  error?: string
}

/** Auto-update state (packaged builds only — see src/main/updater.ts). */
export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'ready'; version: string }

/** A chord starting at `time` (seconds) and lasting until the next one; 'N' = no chord. */
export interface ChordChange {
  time: number
  chord: string
}

export interface BpmDetectionResult {
  bpm: number
  firstBeatOffset: number
  beatTimes: number[]
  // Estimated bar phase: beat-grid index i is a downbeat when
  // (i - downbeatShift) % 4 === 0. Absent when it couldn't be estimated.
  downbeatShift?: number
  downbeatConfidence?: number
  // 'beat_this' when the Beat This! tracker produced the grid; absent when
  // detection fell back to librosa (or ran with a bpm hint).
  tracker?: 'beat_this'
  // Chord at each change on the beat grid (python-worker/chords.py); absent
  // when chord detection failed or didn't run (bpm-hint re-detection).
  chords?: ChordChange[]
}

export interface VelodyAPI {
  openFileDialog: () => Promise<string | null>
  startSeparation: (
    songPath: string,
    bitrate?: StemBitrate
  ) => Promise<{ jobId: string; songName: string }>
  cancelSeparation: (jobId: string) => Promise<boolean>
  listSeparationJobs: () => Promise<SeparationJob[]>

  onSeparationProgress: (callback: (e: SeparationProgressEvent) => void) => () => void
  onSeparationComplete: (callback: (e: SeparationCompleteEvent) => void) => () => void
  onSeparationFailed: (callback: (e: SeparationFailedEvent) => void) => () => void
  onSeparationCancelled: (callback: (e: SeparationCancelledEvent) => void) => () => void
  onSeparationJobsChanged: (callback: (jobs: SeparationJob[]) => void) => () => void

  listSongs: () => Promise<SongItem[]>
  deleteSong: (songName: string) => Promise<{ success: boolean; error?: string }>
  listSetlists: () => Promise<Setlist[]>
  saveSetlist: (setlist: Setlist) => Promise<Setlist>
  deleteSetlist: (id: string) => Promise<{ success: boolean }>
  getAudioUrl: (filePath: string) => Promise<string>
  getSetupStatus: () => Promise<{ complete: boolean }>
  startSetup: () => Promise<{ success: boolean; error?: string }>
  saveFileDialog: (
    defaultName: string,
    filters?: { name: string; extensions: string[] }[]
  ) => Promise<string | null>
  exportMix: (
    filePaths: string[],
    outputPath: string,
    options?: {
      clicks?: { time: number; accent: boolean }[]
      trimStart?: number
      trimEnd?: number
    }
  ) => Promise<ExportResult>
  exportSingle: (
    filePath: string,
    outputPath: string,
    options?: { trimStart?: number; trimEnd?: number }
  ) => Promise<ExportResult>
  saveRecording: (
    songDir: string,
    data: Uint8Array,
    name: string,
    format: string,
    offset: number
  ) => Promise<ExportResult & { path?: string }>
  onSetupProgress: (callback: (progress: SetupProgress) => void) => void
  saveMeta: (songDir: string, meta: Record<string, unknown>) => Promise<{ success: boolean }>
  loadMeta: (songDir: string) => Promise<Record<string, unknown> | null>
  detectBpm: (
    stemPath: string,
    // Re-runs beat tracking at a caller-supplied tempo instead of
    // detecting it — used to correct a tempo-octave detection
    // error while keeping the beat grid onset-aligned to the real audio.
    // See add-tempo-octave-correction.
    bpmHint?: number
  ) => Promise<BpmDetectionResult | null>
  openExternal: (url: string) => Promise<void>
  deleteFile: (filePath: string) => Promise<{ success: boolean; error?: string }>
  importFromUrl: (
    url: string,
    bitrate?: StemBitrate
  ) => Promise<{ jobId: string; songName: string }>
  onDownloadProgress: (callback: (e: DownloadProgressEvent) => void) => () => void
  onDownloadFailed: (callback: (e: DownloadFailedEvent) => void) => () => void
  updateYtDlp: () => Promise<{ success: boolean; error?: string }>
  getUpdateStatus: () => Promise<UpdateStatus>
  onUpdateStatus: (callback: (s: UpdateStatus) => void) => () => void
  installUpdate: () => Promise<void>

  // Cloud library sync (openspec/changes/cloud-library-sync)
  getCloudSettings: () => Promise<CloudSettingsView>
  saveCloudSettings: (
    input: CloudSettingsInput
  ) => Promise<{ success: boolean; error?: string; settings?: CloudSettingsView }>
  testCloud: (input?: { url?: string; token?: string }) => Promise<CloudTestResult>
  getCloudStatus: () => Promise<{ enabled: boolean; offline: boolean; error?: string }>
  cloudUpload: (songName: string) => Promise<CloudActionResult>
  cloudUploadAll: () => Promise<CloudActionResult & { uploaded: number; failed: string[] }>
  cloudDownload: (songName: string) => Promise<CloudActionResult & { songName?: string }>
  cloudRemoveLocal: (songName: string) => Promise<CloudActionResult>
  cloudDeleteEverywhere: (songName: string) => Promise<CloudActionResult>
  cloudSyncMetaOnOpen: (songName: string) => Promise<'pushed' | 'pulled' | 'same' | 'skipped'>
  onCloudProgress: (callback: (e: CloudProgressEvent) => void) => () => void
}
