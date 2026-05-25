import Fretboard from './Fretboard'

interface JamZoneProps {
  effectiveKey: string
  selectedScaleIdx: number
  scalesMaxH: number
  fretboardColRef: React.RefObject<HTMLDivElement | null>
  onSelectScale: (idx: number) => void
}

const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

export default function JamZone({
  effectiveKey,
  selectedScaleIdx,
  scalesMaxH,
  fretboardColRef,
  onSelectScale
}: JamZoneProps): React.JSX.Element {
  const parts = effectiveKey.split(' ')
  const tonicIdx = NOTE.indexOf(parts[0])
  const isMajor = parts[1] === 'Major'
  const scales = isMajor
    ? [
        { name: 'Major (Ionian)', pattern: [0, 2, 4, 5, 7, 9, 11] },
        { name: 'Lydian', pattern: [0, 2, 4, 6, 7, 9, 11] },
        { name: 'Mixolydian', pattern: [0, 2, 4, 5, 7, 9, 10] },
        { name: 'Major Pentatonic', pattern: [0, 2, 4, 7, 9] },
        { name: 'Blues', pattern: [0, 3, 5, 6, 7, 10] }
      ]
    : [
        { name: 'Natural Minor', pattern: [0, 2, 3, 5, 7, 8, 10] },
        { name: 'Dorian', pattern: [0, 2, 3, 5, 7, 9, 10] },
        { name: 'Phrygian', pattern: [0, 1, 3, 5, 7, 8, 10] },
        { name: 'Harmonic Minor', pattern: [0, 2, 3, 5, 7, 8, 11] },
        { name: 'Melodic Minor', pattern: [0, 2, 3, 5, 7, 9, 11] },
        { name: 'Minor Pentatonic', pattern: [0, 3, 5, 7, 10] },
        { name: 'Blues', pattern: [0, 3, 5, 6, 7, 10] }
      ]
  const toNote = (s: number): string => NOTE[(tonicIdx + s) % 12]

  return (
    <div className="bg-neutral-900/80 rounded-xl border border-neutral-800 p-4">
      <div className="grid grid-cols-[200px_1fr] gap-6 items-start">
        <div className="flex flex-col overflow-hidden" style={{ maxHeight: scalesMaxH }}>
          <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-2 shrink-0">
            Scales
          </h3>
          <div className="overflow-y-auto flex flex-col gap-1 flex-1 min-h-0">
            {scales.map(({ name, pattern }, si) => (
              <button
                key={name}
                onClick={() => onSelectScale(si)}
                className={`flex flex-col gap-0.5 rounded-lg p-2 transition-colors text-left ${
                  si === selectedScaleIdx
                    ? 'bg-neutral-800 ring-1 ring-orange-500/50'
                    : 'hover:bg-neutral-800/60'
                }`}
              >
                <span
                  className={`text-[11px] uppercase tracking-wide ${
                    si === selectedScaleIdx ? 'text-orange-400' : 'text-neutral-500'
                  }`}
                >
                  {name}
                </span>
                <div className="flex flex-wrap gap-0.5">
                  {pattern.map((s, i) => (
                    <span
                      key={i}
                      className="w-5 h-5 rounded bg-neutral-800 text-neutral-400 text-[9px] font-mono flex items-center justify-center"
                    >
                      {toNote(s)}
                    </span>
                  ))}
                </div>
              </button>
            ))}
          </div>
        </div>
        <div className="min-w-0" ref={fretboardColRef}>
          <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-2">
            {scales[selectedScaleIdx].name} on fretboard
          </h3>
          <div className="bg-neutral-950/50 rounded-lg p-3">
            <Fretboard
              notes={scales[selectedScaleIdx].pattern.map((s) => (tonicIdx + s) % 12)}
              rootNote={tonicIdx}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
