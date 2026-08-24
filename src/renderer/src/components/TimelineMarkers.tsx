interface MarkerItem {
  time: number
  label: string
}

interface TimelineMarkersProps {
  markers: MarkerItem[]
  loopStart: number | null
  loopEnd: number | null
  loopEnabled: boolean
  trimStart?: number
  trimEnd?: number | null
  duration: number
  onMarkerClick: (marker: MarkerItem, index: number) => void
  onMarkerContextMenu: (index: number) => void
}

export default function TimelineMarkers({
  markers,
  loopStart,
  loopEnd,
  loopEnabled,
  trimStart = 0,
  trimEnd = null,
  duration,
  onMarkerClick,
  onMarkerContextMenu
}: TimelineMarkersProps): React.JSX.Element | null {
  const d = duration || 1

  return (
    <>
      {trimStart > 0 && (
        <div
          className="absolute top-0 bottom-0 left-0 bg-black/50 pointer-events-none"
          style={{ width: `${(trimStart / d) * 100}%`, zIndex: 4 }}
        />
      )}
      {trimEnd !== null && trimEnd < d && (
        <div
          className="absolute top-0 bottom-0 right-0 bg-black/50 pointer-events-none"
          style={{ width: `${((d - trimEnd) / d) * 100}%`, zIndex: 4 }}
        />
      )}
      {markers.map((m, i) => {
        const leftPct = d > 0 ? (m.time / d) * 100 : 0
        const isLoopStart = loopStart === m.time
        const isLoopEnd = loopEnd === m.time
        return (
          <div
            key={i}
            className="absolute top-0 bottom-0 flex flex-col items-center group cursor-pointer"
            style={{ left: `${leftPct}%`, transform: 'translateX(-50%)', zIndex: 10 }}
            onClick={() => onMarkerClick(m, i)}
            onContextMenu={(e) => {
              e.preventDefault()
              onMarkerContextMenu(i)
            }}
          >
            <div
              className={`h-3 w-0.5 rounded-full ${isLoopStart || isLoopEnd ? 'bg-orange-500' : 'bg-blue-500'}`}
            />
            <span
              className={`text-[8px] font-mono-brand mt-0.5 whitespace-nowrap ${isLoopStart || isLoopEnd ? 'text-orange-400' : 'text-blue-400'}`}
            >
              {m.label}
            </span>
          </div>
        )
      })}
      {loopEnabled && loopStart !== null && loopEnd !== null && (
        <div
          className="absolute top-0 bottom-0 bg-green-500/10 pointer-events-none"
          style={{
            left: `${Math.min((loopStart / d) * 100, (loopEnd / d) * 100)}%`,
            width: `${Math.abs(((loopEnd - loopStart) / d) * 100)}%`,
            zIndex: 5
          }}
        />
      )}
    </>
  )
}
