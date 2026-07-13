/// <reference types="vite/client" />

declare global {
  interface Window {
    api: import('../shared/types').VelodyAPI
  }

  type SetupProgress = import('../shared/types').SetupProgress
  type SongItem = import('../shared/types').SongItem
  type ExportResult = import('../shared/types').ExportResult
  type SeparationProgressEvent = import('../shared/types').SeparationProgressEvent
  type SeparationCompleteEvent = import('../shared/types').SeparationCompleteEvent
  type SeparationFailedEvent = import('../shared/types').SeparationFailedEvent
  type SeparationCancelledEvent = import('../shared/types').SeparationCancelledEvent
  type SeparationJob = import('../shared/types').SeparationJob
}

export {}
