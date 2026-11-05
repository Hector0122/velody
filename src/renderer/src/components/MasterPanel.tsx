import { memo, useState } from 'react'
import { formatTime, BPM_MIN, BPM_MAX } from '../utils'
import { SPEED_MIN, SPEED_MAX, SPEED_STEP } from '../hooks/pitchShifter'
import type { TempoOctaveDirection } from '../hooks/tempoOctaveCorrection'

interface MasterPanelProps {
  masterPlaying: boolean
  masterVolume: number
  masterPan: number
  duration: number
  bpm: number
  metronomeOn: boolean
  metroVolume: number
  metroPan: number
  monitorVolume: number
  recordingFormat: 'wav' | 'mp3'
  countInBars: number
  playbackCountInBars: number
  onToggleMasterPlay: () => void
  onPlaybackCountInBarsChange: (bars: number) => void
  onRestart: () => void
  onMasterVolumeChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onMasterPanChange: (v: number) => void
  onBpmDecrement: () => void
  onBpmChange: (v: number) => void
  onBpmIncrement: () => void
  onCorrectTempoOctave: (direction: TempoOctaveDirection) => void
  downbeatShift: number
  speed: number
  semitones: number
  onSpeedChange: (speed: number) => void
  onSemitonesChange: (semitones: number) => void
  pitchShifterError: string | null
  onMarkDownbeat: () => void
  onDownbeatShiftChange: (shift: number) => void
  correctingTempoOctave: boolean
  onMetronomeToggle: () => void
  onMetroVolumeChange: (v: number) => void
  onMetroPanChange: (v: number) => void
  onMonitorVolumeChange: (v: number) => void
  onRecordingFormatChange: (fmt: 'wav' | 'mp3') => void
  onCountInBarsChange: (bars: number) => void
  onShowExportModal: () => void
}

function MasterPanel({
  masterPlaying,
  masterVolume,
  masterPan,
  duration,
  bpm,
  metronomeOn,
  metroVolume,
  metroPan,
  monitorVolume,
  recordingFormat,
  countInBars,
  playbackCountInBars,
  onToggleMasterPlay,
  onPlaybackCountInBarsChange,
  onRestart,
  onMasterVolumeChange,
  onMasterPanChange,
  onBpmDecrement,
  onBpmChange,
  onBpmIncrement,
  onCorrectTempoOctave,
  downbeatShift,
  speed,
  semitones,
  onSpeedChange,
  onSemitonesChange,
  pitchShifterError,
  onMarkDownbeat,
  onDownbeatShiftChange,
  correctingTempoOctave,
  onMetronomeToggle,
  onMetroVolumeChange,
  onMetroPanChange,
  onMonitorVolumeChange,
  onRecordingFormatChange,
  onCountInBarsChange,
  onShowExportModal
}: MasterPanelProps): React.JSX.Element {
  // Collapsed by default — Record is settings for an action that actually
  // lives on each stem card (the record button), not something needed at a
  // glance; keeping it closed until wanted saves permanent sidebar height.
  // Local-only, not persisted — same rationale as any other disclosure
  // widget, no need to remember this across sessions.
  const [recordOpen, setRecordOpen] = useState(false)
  return (
    <div className="w-44 shrink-0 bg-neutral-900/80 rounded-md border border-neutral-800 p-4 flex flex-col items-center gap-5 self-start order-1">
      <h3 className="text-sm font-semibold text-neutral-400 uppercase tracking-wide">Master</h3>
      <div className="flex items-center gap-2">
        <button
          onClick={onToggleMasterPlay}
          className="w-12 h-12 rounded-full flex items-center justify-center bg-brand-primary/20 hover:bg-brand-primary/30 transition-colors"
        >
          {masterPlaying ? (
            <span className="text-brand-primary text-base font-bold">| |</span>
          ) : (
            <span className="text-brand-primary text-base ml-0.5">&#9654;</span>
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
      <span className="text-[10px] font-mono-brand text-neutral-500 -mt-2">
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
          className="accent-brand-primary cursor-pointer h-[120px] w-6 [writing-mode:vertical-lr] [direction:rtl]"
        />
        <span className="text-xs text-neutral-500">{Math.round(masterVolume * 100)}%</span>
      </div>
      <div className="flex flex-col items-center gap-1 w-full">
        <span className="text-[10px] text-neutral-500">Mix Pan</span>
        <input
          type="range"
          aria-label="Mix pan"
          min="-1"
          max="1"
          step="0.05"
          value={masterPan}
          onChange={(e) => onMasterPanChange(parseFloat(e.target.value))}
          className="accent-brand-primary cursor-pointer w-full"
        />
        <span className="text-[10px] text-neutral-600">
          {masterPan === 0
            ? 'C'
            : masterPan < 0
              ? `${Math.round(-masterPan * 100)}% L`
              : `${Math.round(masterPan * 100)}% R`}
        </span>
      </div>

      <div className="border-t border-neutral-800 pt-4 w-full flex flex-col gap-3">
        <button
          onClick={() => setRecordOpen((prev) => !prev)}
          className="flex items-center justify-center gap-1.5 w-full text-sm font-semibold text-neutral-400 hover:text-white uppercase tracking-wide transition-colors"
          aria-expanded={recordOpen}
        >
          <span
            className={`text-[10px] transition-transform ${recordOpen ? 'rotate-90' : ''}`}
            aria-hidden="true"
          >
            &#9654;
          </span>
          Record
        </button>
        {recordOpen && (
          <>
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
                className={`px-3 py-1 rounded-sm text-xs font-medium transition-colors ${
                  recordingFormat === 'wav'
                    ? 'bg-red-600 text-white'
                    : 'bg-neutral-800 text-neutral-400'
                }`}
              >
                WAV
              </button>
              <button
                onClick={() => onRecordingFormatChange('mp3')}
                className={`px-3 py-1 rounded-sm text-xs font-medium transition-colors ${
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
                    countInBars === bars
                      ? 'bg-red-600 text-white'
                      : 'bg-neutral-800 text-neutral-400'
                  }`}
                >
                  {bars === 0 ? 'OFF' : `${bars}`}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="border-t border-neutral-800 pt-3 w-full">
        <button
          onClick={onShowExportModal}
          className="w-full px-2 py-1.5 rounded text-[10px] font-semibold bg-brand-primary hover:bg-brand-primary/80 text-white transition-colors"
        >
          Export Mix...
        </button>
      </div>

      <div className="border-t border-neutral-800 pt-4 w-full flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-neutral-400 uppercase tracking-wide text-center">
          Practice
        </h3>
        <div className="flex flex-col gap-1 w-full px-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-neutral-500">Speed</span>
            <button
              onClick={() => onSpeedChange(1)}
              disabled={speed === 1}
              title="Reset to normal speed"
              className="font-mono-brand text-white disabled:text-neutral-400 hover:text-orange-400 disabled:hover:text-neutral-400"
            >
              {Math.round(speed * 100)}%
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => onSpeedChange(speed - SPEED_STEP)}
              aria-label="Slower"
              className="w-6 h-6 shrink-0 rounded bg-neutral-800 text-neutral-400 hover:text-white text-xs flex items-center justify-center"
            >
              −
            </button>
            <input
              type="range"
              aria-label="Playback speed"
              min={SPEED_MIN}
              max={SPEED_MAX}
              step={SPEED_STEP}
              value={speed}
              onChange={(e) => onSpeedChange(parseFloat(e.target.value))}
              className="accent-orange-500 cursor-pointer w-full"
            />
            <button
              onClick={() => onSpeedChange(speed + SPEED_STEP)}
              aria-label="Faster"
              className="w-6 h-6 shrink-0 rounded bg-neutral-800 text-neutral-400 hover:text-white text-xs flex items-center justify-center"
            >
              +
            </button>
          </div>
        </div>
        <div className="flex items-center justify-between w-full px-1 text-xs">
          <span className="text-neutral-500">Pitch</span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => onSemitonesChange(semitones - 1)}
              aria-label="Transpose down a semitone"
              className="w-6 h-6 rounded bg-neutral-800 text-neutral-400 hover:text-white text-xs flex items-center justify-center"
            >
              ♭
            </button>
            <button
              onClick={() => onSemitonesChange(0)}
              disabled={semitones === 0}
              title="Reset to original key"
              className="w-10 text-center font-mono-brand text-white disabled:text-neutral-400 hover:text-orange-400 disabled:hover:text-neutral-400"
            >
              {semitones > 0 ? `+${semitones}` : semitones}
            </button>
            <button
              onClick={() => onSemitonesChange(semitones + 1)}
              aria-label="Transpose up a semitone"
              className="w-6 h-6 rounded bg-neutral-800 text-neutral-400 hover:text-white text-xs flex items-center justify-center"
            >
              ♯
            </button>
          </div>
        </div>
        {pitchShifterError && (
          <p className="text-[10px] text-red-400 text-center">{pitchShifterError}</p>
        )}
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
            className="w-12 h-6 text-center text-xs font-mono-brand text-white bg-neutral-800 border border-neutral-700 rounded focus:outline-none focus:border-orange-500 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <button
            onClick={onBpmIncrement}
            className="w-6 h-6 rounded bg-neutral-800 text-neutral-400 hover:text-white text-xs flex items-center justify-center"
          >
            +
          </button>
        </div>
        <div className="flex items-center justify-center gap-1.5">
          <span
            className="text-[10px] text-neutral-500"
            title="Detected tempo sounds wrong (off by exactly half or double)? Correct it while keeping the metronome locked to the real beat grid."
          >
            {correctingTempoOctave ? 'Correcting…' : 'Tempo wrong?'}
          </span>
          <button
            onClick={() => onCorrectTempoOctave('halve')}
            disabled={correctingTempoOctave}
            title="Halve tempo (detector doubled the real tempo)"
            className="px-2 py-0.5 rounded text-[10px] font-medium bg-neutral-800 text-neutral-400 hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ½
          </button>
          <button
            onClick={() => onCorrectTempoOctave('double')}
            disabled={correctingTempoOctave}
            title="Double tempo (detector halved the real tempo)"
            className="px-2 py-0.5 rounded text-[10px] font-medium bg-neutral-800 text-neutral-400 hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ×2
          </button>
        </div>
        <div className="flex items-center justify-center gap-1.5">
          <button
            onClick={() => onDownbeatShiftChange(downbeatShift - 1)}
            title="Move the accent one beat earlier"
            aria-label="Move accent earlier"
            className="w-6 h-6 rounded bg-neutral-800 text-neutral-400 hover:text-white text-[10px] flex items-center justify-center"
          >
            ◀
          </button>
          <button
            onClick={onMarkDownbeat}
            title="Press on the first beat of a bar while the song plays: that beat becomes the accented '1'. Saved for this song."
            className="px-2.5 h-6 rounded bg-neutral-800 text-neutral-300 hover:text-white text-[10px] font-medium transition-colors"
          >
            This is the 1
          </button>
          <button
            onClick={() => onDownbeatShiftChange(downbeatShift + 1)}
            title="Move the accent one beat later"
            aria-label="Move accent later"
            className="w-6 h-6 rounded bg-neutral-800 text-neutral-400 hover:text-white text-[10px] flex items-center justify-center"
          >
            ▶
          </button>
        </div>
        <div className="flex items-center justify-between px-1">
          <button
            onClick={onMetronomeToggle}
            className={`px-4 py-1.5 rounded-sm text-xs font-semibold transition-colors ${
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
              max="2"
              step="0.01"
              value={metroVolume}
              onChange={(e) => onMetroVolumeChange(parseFloat(e.target.value))}
              className="accent-orange-500 cursor-pointer h-[60px] w-5 [writing-mode:vertical-lr] [direction:rtl]"
            />
            <span className="text-xs text-neutral-500">{Math.round(metroVolume * 100)}%</span>
          </div>
        </div>
        <div className="flex flex-col items-center gap-1 w-full">
          <span className="text-[10px] text-neutral-500">Click Pan</span>
          <input
            type="range"
            aria-label="Metronome pan"
            min="-1"
            max="1"
            step="0.05"
            value={metroPan}
            onChange={(e) => onMetroPanChange(parseFloat(e.target.value))}
            className="accent-orange-500 cursor-pointer w-full"
          />
          <span className="text-[10px] text-neutral-600">
            {metroPan === 0
              ? 'C'
              : metroPan < 0
                ? `${Math.round(-metroPan * 100)}% L`
                : `${Math.round(metroPan * 100)}% R`}
          </span>
        </div>
        <p className="text-[9px] text-neutral-600 text-center leading-tight px-1">
          Click on L, mix on R — plug a separate speaker/monitor into each of your interface&apos;s
          L/R jacks.
        </p>
        <div className="flex items-center justify-center gap-1.5">
          <span className="text-[10px] text-neutral-500" title="Click before playback starts">
            Count-in on Play
          </span>
          {[0, 1, 2].map((bars) => (
            <button
              key={bars}
              onClick={() => onPlaybackCountInBarsChange(bars)}
              className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                playbackCountInBars === bars
                  ? 'bg-brand-primary text-white'
                  : 'bg-neutral-800 text-neutral-400'
              }`}
            >
              {bars === 0 ? 'OFF' : `${bars}`}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export default memo(MasterPanel)
