import type {
  SetupProgress,
  SongItem,
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
