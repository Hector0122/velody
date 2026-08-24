import type {
  SetupProgress,
  SongItem,
  Setlist,
  ExportResult,
  SeparationProgressEvent,
  SeparationCompleteEvent,
  SeparationFailedEvent,
  SeparationCancelledEvent,
  SeparationJob,
  VelodyAPI
} from '../shared/types'

export type {
  SetupProgress,
  SongItem,
  Setlist,
  ExportResult,
  SeparationProgressEvent,
  SeparationCompleteEvent,
  SeparationFailedEvent,
  SeparationCancelledEvent,
  SeparationJob,
  VelodyAPI
}

declare global {
  interface Window {
    api: VelodyAPI
  }
}
