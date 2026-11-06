import { memo } from 'react'
import StemCard from './StemCard'

interface StemMeta {
  color: string
  label: string
}

interface StemGridItem {
  key: string
  meta: StemMeta
  isRecording: boolean
}

interface StemCallbacks {
  onToggle: () => void
  onSolo: () => void
  onExport: () => void
  onOpenTab: () => void
  onStartRecording: () => void
  onVolumeChange: (v: number) => void
  onPanningChange: (v: number) => void
  onDeleteRecording: () => void
}

export interface StemGridCellProps {
  items: StemGridItem[]
  masterPlaying: boolean
  active: Record<string, boolean>
  solo: Record<string, boolean>
  duration: number
  exporting: boolean
  recording: string
  recordingKey: string | null
  formatTime: (s: number) => string
  stemVolumes: Record<string, number>
  stemPannings: Record<string, number>
  stemCallbacks: Record<string, StemCallbacks>
  onStopRecording: () => void
}

const ROW_HEIGHT = 200

function StemGridCell({
  itemIndex,
  ...cellProps
}: { itemIndex: number } & StemGridCellProps): React.JSX.Element | null {
  const {
    items,
    masterPlaying,
    active,
    solo,
    duration,
    exporting,
    recording,
    recordingKey,
    formatTime,
    stemVolumes,
    stemPannings,
    stemCallbacks,
    onStopRecording
  } = cellProps

  if (itemIndex >= items.length) return null
  const { key, meta, isRecording } = items[itemIndex]
  const cb = stemCallbacks[key]
  const isAudible = masterPlaying && active[key]
  const isInactive = !active[key] && !masterPlaying
  const canTab = ['guitar', 'bass', 'piano'].includes(key)
  const canRecord = recording === 'idle' && !isRecording
  const isRecordingThis = recordingKey === key && recording === 'recording'

  return (
    <div style={{ height: ROW_HEIGHT, padding: '0 8px 16px 8px' }}>
      <StemCard
        meta={meta}
        isRecording={isRecording}
        isAudible={isAudible}
        isInactive={isInactive}
        isActive={!!active[key]}
        isSolo={!!solo[key]}
        duration={duration}
        exporting={exporting}
        isRecordingThis={isRecordingThis}
        canTab={canTab}
        canRecord={canRecord}
        formatTime={formatTime}
        stemVolume={stemVolumes[key] ?? 1}
        stemPanning={stemPannings[key] ?? 0}
        onToggle={cb?.onToggle ?? (() => {})}
        onSolo={cb?.onSolo ?? (() => {})}
        onExport={cb?.onExport ?? (() => {})}
        onOpenTab={cb?.onOpenTab ?? (() => {})}
        onStartRecording={cb?.onStartRecording ?? (() => {})}
        onStopRecording={onStopRecording}
        onVolumeChange={cb?.onVolumeChange ?? (() => {})}
        onPanningChange={cb?.onPanningChange ?? (() => {})}
        onDeleteRecording={cb?.onDeleteRecording ?? (() => {})}
      >
        <div className="relative h-8">
          <div data-stem-container={key} className="h-8 rounded overflow-hidden cursor-pointer" />
          <div
            data-stem-cursor
            className="absolute top-0 bottom-0 w-[2px] bg-white/70 pointer-events-none z-10"
            style={{ left: '0%', willChange: 'left' }}
          />
        </div>
      </StemCard>
    </div>
  )
}

// A plain 2-column grid: a song has at most 6 stems plus a few recordings, all
// on screen at once (react-window's virtualization never skipped anything).
function StemGrid(props: StemGridCellProps): React.JSX.Element {
  if (props.items.length === 0) return <div className="min-h-[200px]" />

  return (
    <div className="grid w-full grid-cols-2">
      {props.items.map((item, i) => (
        <StemGridCell key={item.key} itemIndex={i} {...props} />
      ))}
    </div>
  )
}

export default memo(StemGrid)
