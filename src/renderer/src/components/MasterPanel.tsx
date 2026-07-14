import { memo } from 'react'
import { formatTime, BPM_MIN, BPM_MAX } from '../utils'

interface MasterPanelProps {
  masterPlaying: boolean
  masterVolume: number
  duration: number
  bpm: number
  metronomeOn: boolean
  metroVolume: number
  monitorVolume: number
  recordingFormat: 'wav' | 'mp3'
  countInBars: number
  onToggleMasterPlay: () => void
  onRestart: () => void
  onMasterVolumeChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onBpmDecrement: () => void
  onBpmChange: (v: number) => void
  onBpmIncrement: () => void
  onMetronomeToggle: () => void
  onMetroVolumeChange: (v: number) => void
  onMonitorVolumeChange: (v: number) => void
  onRecordingFormatChange: (fmt: 'wav' | 'mp3') => void
  onCountInBarsChange: (bars: number) => void
  onShowExportModal: () => void
}

function MasterPanel({
  masterPlaying,
  masterVolume,
  duration,
  bpm,
  metronomeOn,
  metroVolume,
  monitorVolume,
  recordingFormat,
  countInBars,
  onToggleMasterPlay,
  onRestart,
  onMasterVolumeChange,
  onBpmDecrement,
  onBpmChange,
  onBpmIncrement,
  onMetronomeToggle,
  onMetroVolumeChange,
  onMonitorVolumeChange,
  onRecordingFormatChange,
  onCountInBarsChange,
  onShowExportModal
}: MasterPanelProps): React.JSX.Element {
  return (
    <div className="w-44 shrink-0 bg-neutral-900/80 rounded-xl border border-neutral-800 p-4 flex flex-col items-center gap-5 self-start order-1">
      <h3 className="text-sm font-semibold text-neutral-400 uppercase tracking-wide">Master</h3>
      <div className="flex items-center gap-2">
        <button
          onClick={onToggleMasterPlay}
          className="w-12 h-12 rounded-full flex items-center justify-center bg-blue-600/20 hover:bg-blue-600/30 transition-colors"
        >
          {masterPlaying ? (
            <span className="text-blue-400 text-base font-bold">| |</span>
          ) : (
            <span className="text-blue-400 text-base ml-0.5">&#9654;</span>
          )}
        </button>
        <button
          onClick={onRestart}
          className="w-10 h-10 rounded-full flex items-center justify-center bg-neutral-800 hover:bg-neutral-700 transition-colors text-neutral-400 hover:text-white"
          title="Restart"
        >
          &#9664;&#9664;
        </button>
      </div>
      <span className="text-[10px] font-mono text-neutral-500 -mt-2">
        <span data-live-time>0:00</span> / {formatTime(duration)}
      </span>
      <div className="flex flex-col items-center gap-2 w-full">
        <span className="text-xs text-neutral-500">Volume</span>
        <input
          type="range"
          aria-label="Master volume"
          min="0"
          max="1"
          step="0.01"
          value={masterVolume}
          onChange={onMasterVolumeChange}
          className="accent-blue-500 cursor-pointer h-[120px] w-6 [writing-mode:vertical-lr] [direction:rtl]"
        />
        <span className="text-xs text-neutral-500">{Math.round(masterVolume * 100)}%</span>
      </div>

      <div className="border-t border-neutral-800 pt-4 w-full flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-neutral-400 uppercase tracking-wide text-center">
          Record
        </h3>
        <div className="flex flex-col gap-2 w-full">
          <span className="text-[10px] text-neutral-500 text-center">Monitor volume</span>
          <input
            type="range"
            aria-label="Monitor volume"
            min="0"
            max="1"
            step="0.01"
            value={monitorVolume}
            onChange={(e) => onMonitorVolumeChange(parseFloat(e.target.value))}
            className="accent-red-500 cursor-pointer w-full"
          />
        </div>
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => onRecordingFormatChange('wav')}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
              recordingFormat === 'wav'
                ? 'bg-red-600 text-white'
                : 'bg-neutral-800 text-neutral-400'
            }`}
          >
            WAV
          </button>
          <button
            onClick={() => onRecordingFormatChange('mp3')}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
              recordingFormat === 'mp3'
                ? 'bg-red-600 text-white'
                : 'bg-neutral-800 text-neutral-400'
            }`}
          >
            MP3
          </button>
        </div>
        <div className="flex items-center justify-center gap-1.5">
          <span className="text-[10px] text-neutral-500">Count-in</span>
          {[0, 1, 2, 4].map((bars) => (
            <button
              key={bars}
              onClick={() => onCountInBarsChange(bars)}
              className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                countInBars === bars ? 'bg-red-600 text-white' : 'bg-neutral-800 text-neutral-400'
              }`}
            >
              {bars === 0 ? 'OFF' : `${bars}`}
            </button>
          ))}
        </div>
      </div>

      <div className="border-t border-neutral-800 pt-3 w-full">
        <button
          onClick={onShowExportModal}
          className="w-full px-2 py-1.5 rounded text-[10px] font-semibold bg-blue-600 hover:bg-blue-500 text-white transition-colors"
        >
          Export Mix...
        </button>
      </div>

      <div className="border-t border-neutral-800 pt-4 w-full flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-neutral-400 uppercase tracking-wide text-center">
          Metronome
        </h3>
        <div className="flex items-center justify-center gap-1.5">
          <span className="text-xs text-neutral-500">BPM</span>
          <button
            onClick={onBpmDecrement}
            className="w-6 h-6 rounded bg-neutral-800 text-neutral-400 hover:text-white text-xs flex items-center justify-center"
          >
            −
          </button>
          <input
            type="number"
            aria-label="BPM"
            min={BPM_MIN}
            max={BPM_MAX}
            value={bpm}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10)
              if (!isNaN(v) && v >= BPM_MIN && v <= BPM_MAX) onBpmChange(v)
            }}
            className="w-12 h-6 text-center text-xs font-mono text-white bg-neutral-800 border border-neutral-700 rounded focus:outline-none focus:border-orange-500 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <button
            onClick={onBpmIncrement}
            className="w-6 h-6 rounded bg-neutral-800 text-neutral-400 hover:text-white text-xs flex items-center justify-center"
          >
            +
          </button>
        </div>
        <div className="flex items-center justify-between px-1">
          <button
            onClick={onMetronomeToggle}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              metronomeOn
                ? 'bg-orange-600 text-white'
                : 'bg-neutral-800 text-neutral-400 hover:text-white'
            }`}
          >
            {metronomeOn ? 'ON' : 'OFF'}
          </button>
          <div className="flex flex-col items-center gap-1.5">
            <span className="text-xs text-neutral-500">Vol</span>
            <input
              type="range"
              aria-label="Metronome volume"
              min="0"
              max="1"
              step="0.01"
              value={metroVolume}
              onChange={(e) => onMetroVolumeChange(parseFloat(e.target.value))}
              className="accent-orange-500 cursor-pointer h-[60px] w-5 [writing-mode:vertical-lr] [direction:rtl]"
            />
            <span className="text-xs text-neutral-500">{Math.round(metroVolume * 100)}%</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default memo(MasterPanel)
