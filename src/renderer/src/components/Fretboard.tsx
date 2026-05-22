import { useState } from 'react'

interface FretboardProps {
  notes: number[]
  rootNote: number
}

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

const GUITAR_STRINGS = [
  { name: 'e', open: 4 },
  { name: 'B', open: 11 },
  { name: 'G', open: 7 },
  { name: 'D', open: 2 },
  { name: 'A', open: 9 },
  { name: 'E', open: 4 }
]

const BASS_STRINGS = [
  { name: 'G', open: 7 },
  { name: 'D', open: 2 },
  { name: 'A', open: 9 },
  { name: 'E', open: 4 }
]

const FRET_COUNT = 12
const FRET_WIDTH = 40
const STRING_SPACING = 28
const STRING_LABEL_W = 24
const PADDING_X = 6
const PADDING_Y = 10
const LABEL_H = 18
const DOT_R = 8

function Fretboard({ notes, rootNote }: FretboardProps): React.JSX.Element {
  const [instrument, setInstrument] = useState<'guitar' | 'bass'>('guitar')

  const scaleNotes = new Set(notes)

  const strings = instrument === 'guitar' ? GUITAR_STRINGS : BASS_STRINGS
  const svgW = PADDING_X * 2 + STRING_LABEL_W + (FRET_COUNT + 1) * FRET_WIDTH
  const svgH = PADDING_Y * 2 + strings.length * STRING_SPACING + LABEL_H

  const noteName = (noteIdx: number): string => NOTES[noteIdx]

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setInstrument('guitar')}
          className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
            instrument === 'guitar'
              ? 'bg-neutral-700 text-white'
              : 'bg-neutral-800 text-neutral-500 hover:text-white'
          }`}
        >
          Guitar
        </button>
        <button
          onClick={() => setInstrument('bass')}
          className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
            instrument === 'bass'
              ? 'bg-neutral-700 text-white'
              : 'bg-neutral-800 text-neutral-500 hover:text-white'
          }`}
        >
          Bass
        </button>
        <span className="text-xs text-neutral-500 ml-auto">{notes.length}-note scale</span>
      </div>
      <div className="w-full max-w-[90%] mx-auto">
        <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
          {strings.map((s, si) => {
            const y = PADDING_Y + si * STRING_SPACING + STRING_SPACING / 2
            return (
              <g key={s.name}>
                <text
                  x={PADDING_X}
                  y={y + 4}
                  textAnchor="start"
                  className="fill-neutral-400"
                  style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 700 }}
                >
                  {s.name}
                </text>
                <line
                  x1={PADDING_X + STRING_LABEL_W}
                  y1={y}
                  x2={PADDING_X + STRING_LABEL_W + (FRET_COUNT + 1) * FRET_WIDTH}
                  y2={y}
                  stroke="#404040"
                  strokeWidth={
                    si === 0 ||
                    (instrument === 'guitar' && si === 5) ||
                    (instrument === 'bass' && si === 3)
                      ? 2.5
                      : 1
                  }
                />
              </g>
            )
          })}

          {Array.from({ length: FRET_COUNT + 2 }, (_, fi) => {
            const x = PADDING_X + STRING_LABEL_W + fi * FRET_WIDTH
            return (
              <g key={fi}>
                <line
                  x1={x}
                  y1={PADDING_Y}
                  x2={x}
                  y2={PADDING_Y + strings.length * STRING_SPACING}
                  stroke={fi === 0 ? '#888' : '#333'}
                  strokeWidth={fi === 0 ? 3 : 1}
                />
                {fi <= FRET_COUNT && (
                  <text
                    x={x + FRET_WIDTH / 2}
                    y={PADDING_Y + strings.length * STRING_SPACING + LABEL_H - 4}
                    textAnchor="middle"
                    className="fill-neutral-500"
                    style={{ fontSize: 10, fontFamily: 'monospace' }}
                  >
                    {fi}
                  </text>
                )}
              </g>
            )
          })}

          {strings.map((s, si) => {
            const y = PADDING_Y + si * STRING_SPACING + STRING_SPACING / 2
            const dots: React.JSX.Element[] = []
            for (let f = 0; f <= FRET_COUNT; f++) {
              const note = (s.open + f) % 12
              if (scaleNotes.has(note)) {
                const x = PADDING_X + STRING_LABEL_W + f * FRET_WIDTH + FRET_WIDTH / 2
                const isRoot = note === rootNote
                dots.push(
                  <g key={f}>
                    <circle
                      cx={x}
                      cy={y}
                      r={DOT_R}
                      className={isRoot ? 'fill-orange-500' : 'fill-green-600'}
                    />
                    <text
                      x={x}
                      y={y + 4}
                      textAnchor="middle"
                      className="fill-white"
                      style={{ fontSize: 8, fontFamily: 'monospace', fontWeight: 700 }}
                    >
                      {noteName(note)}
                    </text>
                  </g>
                )
              }
            }
            return dots
          })}
        </svg>
      </div>
    </div>
  )
}

export default Fretboard
