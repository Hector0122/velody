import { memo } from 'react'
import TimelineMarkers from './TimelineMarkers'
import { formatTime } from '../utils'

interface Marker {
  time: number
  label: string
}

interface TimelinePanelProps {
  markers: Marker[]
  loopStart: number | null
  loopEnd: number | null
  loopEnabled: boolean
  masterWaveDuration: number
  duration: number
  masterWaveContainerRef: React.RefObject<HTMLDivElement | null>
  onSetLoopStart: (time: number | null) => void
  onSetLoopEnd: (time: number | null) => void
  onToggleLoop: () => void
  onClearMarkers: () => void
  onRemoveMarker: (i: number) => void
}

function TimelinePanel({
  markers,
  loopStart,
  loopEnd,
  loopEnabled,
  masterWaveDuration,
  duration,
  masterWaveContainerRef,
  onSetLoopStart,
  onSetLoopEnd,
  onToggleLoop,
  onClearMarkers,
  onRemoveMarker
}: TimelinePanelProps): React.JSX.Element {
  return (
    <div className="bg-neutral-900/80 rounded-xl border border-neutral-800 p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-neutral-400 uppercase tracking-wide">
            Timeline
          </span>
          <span className="text-[10px] font-mono text-neutral-500">
            <span data-live-time>0:00</span> / {formatTime(masterWaveDuration || duration)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {markers.length > 0 && (
            <>
              <select
                value={
                  loopStart !== null
                    ? markers.findIndex((m) => m.time === loopStart).toString()
                    : ''
                }
                onChange={(e) => {
                  const idx = parseInt(e.target.value)
                  if (!isNaN(idx) && markers[idx]) onSetLoopStart(markers[idx].time)
                  else onSetLoopStart(null)
                }}
                className="bg-neutral-800 text-neutral-300 text-[10px] border border-neutral-700 rounded px-1 py-0.5"
              >
                <option value="">A—</option>
                {markers.map((m, i) => (
                  <option key={i} value={i}>
                    {m.label}
                  </option>
                ))}
              </select>
              <select
                value={
                  loopEnd !== null ? markers.findIndex((m) => m.time === loopEnd).toString() : ''
                }
                onChange={(e) => {
                  const idx = parseInt(e.target.value)
                  if (!isNaN(idx) && markers[idx]) onSetLoopEnd(markers[idx].time)
                  else onSetLoopEnd(null)
                }}
                className="bg-neutral-800 text-neutral-300 text-[10px] border border-neutral-700 rounded px-1 py-0.5"
              >
                <option value="">B—</option>
                {markers.map((m, i) => (
                  <option key={i} value={i}>
                    {m.label}
                  </option>
                ))}
              </select>
              <button
                onClick={onToggleLoop}
                disabled={loopStart === null || loopEnd === null}
                className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-colors ${
                  loopEnabled
                    ? 'bg-green-600 text-white'
                    : 'bg-neutral-800 text-neutral-500 hover:text-white disabled:opacity-30'
                }`}
              >
                Loop
              </button>
            </>
          )}
          <button
            onClick={onClearMarkers}
            className="px-2 py-0.5 rounded text-[10px] font-medium bg-neutral-800 text-neutral-500 hover:text-white transition-colors"
          >
            Clear
          </button>
        </div>
      </div>
      <div className="relative">
        <div
          ref={masterWaveContainerRef}
          className="w-full rounded overflow-hidden cursor-pointer h-16"
        />
        <TimelineMarkers
          markers={markers}
          loopStart={loopStart}
          loopEnd={loopEnd}
          loopEnabled={loopEnabled}
          duration={masterWaveDuration || duration}
          onMarkerClick={(m) => {
            if (loopStart === m.time) onSetLoopStart(null)
            else if (loopEnd === m.time) onSetLoopEnd(null)
            else if (loopStart === null) onSetLoopStart(m.time)
            else if (loopEnd === null) onSetLoopEnd(m.time)
            else {
              onSetLoopStart(m.time)
              onSetLoopEnd(null)
            }
          }}
          onMarkerContextMenu={(i) => {
            const m = markers[i]
            onRemoveMarker(i)
            if (loopStart === m.time) onSetLoopStart(null)
            if (loopEnd === m.time) onSetLoopEnd(null)
          }}
        />
      </div>
      <div className="flex items-center justify-between mt-1">
        <span className="text-[10px] text-neutral-600">
          Double-click to add marker • Click marker to set A/B • Right-click to remove
        </span>
        <span className="text-[10px] text-neutral-600">
          {markers.length} marker{markers.length !== 1 ? 's' : ''}
        </span>
      </div>
    </div>
  )
}

export default memo(TimelinePanel)
