import { memo } from 'react'

interface StemCardMeta {
  color: string
  label: string
}

interface StemCardProps {
  meta: StemCardMeta
  isRecording: boolean
  isAudible: boolean
  isInactive: boolean
  isActive: boolean
  isSolo: boolean
  progress: number
  duration: number
  exporting: boolean
  isRecordingThis: boolean
  recordingElapsed: number
  canTab: boolean
  canRecord: boolean
  formatTime: (s: number) => string
  onToggle: () => void
  onSolo: () => void
  onExport: () => void
  onOpenTab: () => void
  onStartRecording: () => void
  onStopRecording: () => void
  onDeleteRecording: () => void
  children: React.ReactNode
}

function StemCard({
  meta,
  isRecording,
  isAudible,
  isInactive,
  isActive,
  isSolo,
  progress,
  duration,
  exporting,
  isRecordingThis,
  recordingElapsed,
  canTab,
  canRecord,
  formatTime,
  onToggle,
  onSolo,
  onExport,
  onOpenTab,
  onStartRecording,
  onStopRecording,
  onDeleteRecording,
  children
}: StemCardProps): React.JSX.Element {
  return (
    <div
      className={`rounded-xl border p-4 space-y-3 transition-all ${
        isInactive
          ? 'opacity-50 border-neutral-700 bg-neutral-900/20'
          : 'border-neutral-700 bg-neutral-900/50'
      }`}
      style={{ borderColor: isInactive ? undefined : meta.color + '40' }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl" style={{ color: meta.color }}>
            &#9679;
          </span>
          <span className="font-semibold capitalize" style={{ color: meta.color }}>
            {meta.label}
          </span>
          {isRecording && (
            <div className="flex items-center gap-1">
              <span className="text-[9px] font-bold text-red-500 bg-red-500/10 px-1.5 py-0.5 rounded">
                REC
              </span>
              <button
                onClick={onDeleteRecording}
                className="text-[9px] text-neutral-600 hover:text-red-400 hover:bg-red-500/10 rounded px-1 py-0.5 transition-colors"
                title="Delete recording"
              >
                ✕
              </button>
            </div>
          )}
        </div>
        {isAudible && (
          <span className="flex gap-0.5">
            {[1, 2, 3].map((i) => (
              <span
                key={i}
                className="w-0.5 bg-white rounded-full"
                style={{
                  height: 8 + i * 4,
                  animation: `pulse 0.8s ease-in-out ${i * 0.15}s infinite`
                }}
              />
            ))}
          </span>
        )}
      </div>

      {children}

      <div className="flex items-center justify-between text-[10px] text-neutral-500">
        <span>{formatTime(progress)}</span>
        <span>{duration > 0 ? formatTime(duration) : '0:00'}</span>
      </div>

      <div className="flex items-center justify-between">
        <button
          onClick={onToggle}
          className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
            isActive ? 'bg-green-600/30 hover:bg-green-600/40' : 'bg-white/10 hover:bg-white/20'
          }`}
        >
          {isActive ? (
            <span className="text-green-400 text-sm font-bold">| |</span>
          ) : (
            <span className="text-white text-sm ml-0.5">&#9654;</span>
          )}
        </button>
        <button
          onClick={onSolo}
          className={`px-4 py-1 rounded-lg text-xs font-medium transition-colors ${
            isSolo ? 'bg-yellow-600 text-white' : 'bg-neutral-800 text-neutral-400 hover:text-white'
          }`}
        >
          S
        </button>
        <button
          onClick={onExport}
          disabled={exporting}
          className="px-3 py-1 rounded-lg text-xs font-medium bg-neutral-800 text-neutral-400 hover:text-white hover:bg-neutral-700 transition-colors disabled:opacity-40"
        >
          {exporting ? '...' : 'Export'}
        </button>
        {canTab && (
          <button
            onClick={onOpenTab}
            className="px-3 py-1 rounded-lg text-xs font-medium bg-neutral-800 text-neutral-400 hover:text-white hover:bg-neutral-700 transition-colors"
            title="Search tabs on Ultimate Guitar"
          >
            Tabs
          </button>
        )}
        {canRecord && (
          <button
            onClick={onStartRecording}
            className="px-3 py-1 rounded-lg text-xs font-medium bg-red-900/40 text-red-400 hover:text-red-300 hover:bg-red-800/50 transition-colors"
          >
            REC
          </button>
        )}
      </div>

      {isRecordingThis && (
        <div className="flex items-center justify-between bg-red-900/20 rounded-lg px-3 py-2 -mt-1">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-red-400 text-xs font-mono">{formatTime(recordingElapsed)}</span>
          </div>
          <button
            onClick={onStopRecording}
            className="px-3 py-1 rounded-lg text-xs font-medium bg-red-600 text-white hover:bg-red-500 transition-colors"
          >
            ⏹ Stop
          </button>
        </div>
      )}
    </div>
  )
}

export default memo(StemCard)
