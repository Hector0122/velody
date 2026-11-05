// Contract of the personal cloud backend (cloud-worker/, a Cloudflare Worker
// over R2 + D1). Imported by the Worker, the desktop main process and the
// renderer — keep it free of runtime dependencies. See
// openspec/changes/cloud-library-sync/design.md (D3, D4).

export const CLOUD_API_PREFIX = '/v1'

/** Presigned transfer URLs expire after this many seconds. */
export const PRESIGN_EXPIRES_SECONDS = 3600

/** Metadata writes stamped further than this in the future are rejected. */
export const MAX_META_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000

/** A stem/recording file of a song, as stored in the cloud. */
export interface CloudFile {
  /** File name inside the song folder, e.g. "vocals.mp3". */
  name: string
  size: number
  /** Lowercase hex SHA-256 of the file content. */
  sha256: string
}

export interface CloudSong {
  id: string
  name: string
  files: CloudFile[]
  /** `updatedAt` of the stored metadata, or null when none was uploaded yet. */
  metaUpdatedAt: number | null
  updatedAt: number
}

export interface ListSongsResponse {
  songs: CloudSong[]
}

export interface UploadBeginRequest {
  name: string
  files: CloudFile[]
}

export interface PresignedFile {
  name: string
  url: string
}

export interface UploadBeginResponse {
  /** Only the files that still need uploading (unchanged ones are omitted). */
  uploads: PresignedFile[]
  expiresAt: number
}

export interface CommitResponse {
  song: CloudSong
}

export interface DownloadResponse {
  files: (CloudFile & { url: string })[]
  expiresAt: number
}

/** A song's `.velody` metadata as synced (local-only keys stripped). */
export type SongMetaDoc = Record<string, unknown>

export interface MetaResponse {
  meta: SongMetaDoc
  updatedAt: number
}

export interface PutMetaRequest {
  meta: SongMetaDoc
  updatedAt: number
}

export interface ApiError {
  error: string
  /** commit: declared files that are absent from storage or have the wrong size. */
  missing?: string[]
}

export const SONG_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Plain file names only: no path separators, no leading dot, audio extensions. */
export const CLOUD_FILE_NAME_RE = /^(?!\.)[^/\\\0]{1,200}\.(mp3|wav)$/i

export const SHA256_RE = /^[0-9a-f]{64}$/

// ── Desktop-side sync state (not part of the HTTP API) ────────────────────

/** local: only on this laptop · cloud: only in the cloud · synced: both. */
export type SongSyncState = 'local' | 'cloud' | 'synced'

/** Keys of `.velody` that describe this device only and are never uploaded. */
export const LOCAL_ONLY_META_KEYS = ['cloudId', 'fileHashes'] as const

export interface CloudSettingsView {
  url: string
  enabled: boolean
  /** A token is saved (its value never leaves the main process). */
  hasToken: boolean
  /** safeStorage is usable on this machine. */
  encryptionAvailable: boolean
}

export interface CloudSettingsInput {
  url: string
  enabled: boolean
  /** Omitted/empty keeps the saved token. */
  token?: string
}

export type CloudTestResult = { ok: true } | { ok: false; error: string }

export type CloudTransferKind = 'upload' | 'download'

export interface CloudProgressEvent {
  kind: CloudTransferKind
  songName: string
  /** 0–100 for the current song. */
  percent: number
  status: 'queued' | 'running' | 'done' | 'failed'
  error?: string
}

export interface CloudActionResult {
  success: boolean
  error?: string
}
