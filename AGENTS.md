# Velody — Herramienta de Práctica Musical

## Overview

Velody es una aplicación de escritorio para la separación de stems con IA, diseñada como **herramienta sencilla para que el músico practique**.

El flujo principal:

- Importar una canción
- Separar stems con Demucs
- Tocar sobre los stems aislados
- Usar herramientas visuales (marcadores, loops) para aprender y practicar
- Exportar stems

---

# Main Goals

## MVP Goals

- Import audio files
- Separate stems with Demucs
- Playback isolated tracks
- Mute/Solo stems
- Export separated audio
- Local processing only

---

# Why Desktop First?

Desktop allows:

- Local CPU/GPU usage
- Faster processing
- Lower infrastructure costs
- Better audio workflows
- Easier file access
- Better UX for music tools

Avoids:

- Cloud GPU costs
- Mobile hardware limitations
- Browser processing restrictions

---

# Core Architecture

```txt
React UI
↓
Electron IPC
↓
Electron Main Process
↓
Python Worker
↓
Demucs / FFmpeg
↓
Generated stems
↓
UI Playback
```

---

# Recommended Tech Stack

| Layer            | Technology         |
| ---------------- | ------------------ |
| Desktop App      | Electron           |
| Frontend         | React + TypeScript |
| Styling          | TailwindCSS        |
| Audio Waveforms  | WaveSurfer.js      |
| AI Separation    | Demucs             |
| Audio Processing | FFmpeg             |
| AI Runtime       | Python + PyTorch   |
| Packaging        | Electron Builder   |

---

# Project Structure

```txt
velody/
│
├── src/
│   ├── main/
│   │   ├── index.ts              ← Electron main process
│   │   ├── ipc/
│   │   │   └── handlers.ts       ← IPC: file dialog, spawn Python
│   │   ├── audio-server.ts       ← HTTP streaming server
│   │   ├── jobs/
│   │   │   └── JobManager.ts     ← Separation job queue
│   │   └── setup/
│   │       └── index.ts          ← Auto-setup manager
│   ├── preload/
│   │   ├── index.ts              ← contextBridge APIs
│   │   └── index.d.ts            ← Window.api types
│   └── renderer/
│       ├── index.html
│       └── src/
│           ├── main.tsx
│           ├── App.tsx
│           ├── env.d.ts
│           ├── components/
│           │   ├── AudioUploader.tsx   ← Drag & drop
│           │   ├── StemPlayer.tsx      ← Main orchestrator
│           │   ├── StemGrid.tsx        ← Virtualized stem grid
│           │   ├── StemCard.tsx        ← Individual stem controls
│           │   ├── MasterPanel.tsx     ← Master volume, BPM, metronome
│           │   ├── TimelinePanel.tsx   ← Loop A/B controls
│           │   ├── TimelineMarkers.tsx ← Visual markers
│           │   ├── JamZone.tsx         ← Scale explorer
│           │   ├── Fretboard.tsx       ← Interactive fretboard
│           │   ├── ExportModal.tsx     ← Export dialog
│           │   ├── RecordingConfirmationModal.tsx
│           │   └── SetupScreen.tsx     ← First-run setup
│           ├── pages/
│           │   └── Home.tsx           ← Main layout + queue
│           ├── hooks/
│           │   ├── useMetronome.ts    ← Click track engine
│           │   └── useRecording.ts    ← Recording flow
│
├── python-worker/
│   ├── separate.py              ← Demucs script
│   ├── detect_key.py            ← Key detection (Krumhansl-Schmuckler)
│   ├── requirements.txt
│   └── utils/
│
├── output/
│   └── stems/                   ← Generated stems here
│
├── resources/                   ← App icons
├── build/                       ← Electron builder configs
├── electron.vite.config.ts
├── package.json
├── tsconfig.json / .node / .web
└── eslint.config.mjs
```

---

# Initial Features

## Audio Import

- Drag & drop audio files
- File picker support
- WAV/MP3/FLAC support

---

## Stem Separation

Initial stems:

- Vocals
- Drums
- Bass
- Other
- Piano
- Guitar

Using:

- Demucs (htdemucs_6s)

---

## Audio Playback

Features:

- Play/Pause
- Timeline
- Waveforms
- Mute stem
- Solo stem
- Volume per stem (individual slider)

Using:

- WaveSurfer.js

---

## Export

Allow exporting:

- Individual stems (WAV/MP3)
- Mix export (select which stems, with optional metronome click track)
- WAV/MP3 format toggle
- Export All (opens directory picker, exports all stems)

---

# Key Detection

## How It Works

`python-worker/detect_key.py` detecta la tonalidad usando numpy FFT + Krumhansl-Schmuckler:

1. Decodifica el stem de bajo con FFmpeg (solo bajo — más confiable que el mix completo)
2. FFT de 32768 puntos (resolución ~1.35 Hz/bin, separa semitonos incluso a 40 Hz)
3. Chroma vector (12 notas) en rango 40–2000 Hz
4. Krumhansl-Schmuckler: correlaciona el chroma contra 24 perfiles (12 mayores + 12 menores)
5. Si KS tiene poca certeza (gap < 5% entre 1° y 2°) Y el bajo tiene una nota claramente dominante (>10% de margen), overridea con la nota más fuerte del bajo

## Caché

- Resultado guardado en `.velody` (sidecar JSON) con versión
- Al cargar una canción, se muestra la key de caché instantáneamente y Python la corrige si es necesario

---

# Jam Zone

Botón en el panel lateral que despliega las escalas para improvisar sobre la canción:

| Tonalidad | Escalas mostradas                                                                                 |
| --------- | ------------------------------------------------------------------------------------------------- |
| **Mayor** | Major (Ionian), Lydian, Mixolydian, Major Pentatonic, Blues                                       |
| **Menor** | Natural Minor (Aeolian), Dorian, Phrygian, Harmonic Minor, Melodic Minor, Minor Pentatonic, Blues |

Cada escala muestra las notas como chips de colores. Ideal para improvisar o aprender la escala correcta para cada canción.

---

# Python Worker

## Purpose

The Python worker is isolated from the Electron app.

Responsibilities:

- Run Demucs
- Process audio
- Handle FFmpeg operations
- Return processing results

## Status

El flag `useRealDemucs` en `src/main/ipc/handlers.ts` (controlado por `SetupManager.canUseRealDemucs()`) determina si usa Demucs real o simulación.
En simulación, los stems son tonos senoidales. Si el venv con Demucs está configurado, usa Demucs real automáticamente.

### Auto-setup

En el primer arranque, `SetupManager` (src/main/setup/index.ts) detecta las dependencias y si falta algo:

1. Verifica Python 3
2. Crea un venv en `~/.local/share/velody/venv`
3. Instala Demucs + PyTorch automáticamente (`pip install`)
4. Descarga FFmpeg portable si no está en el sistema

---

# Example Workflow

```txt
User imports song
↓
Electron sends file path
↓
Python worker starts
↓
Demucs separates stems
↓
FFmpeg converts output
↓
Electron receives stems
↓
Frontend updates UI
```

---

# Initial Python Dependencies

```bash
pip install demucs
pip install torch
pip install torchaudio
```

---

# FFmpeg

Required for:

- Audio conversion
- Exporting
- Compression
- File normalization

Install:

https://ffmpeg.org

---

# Electron Responsibilities

## Main Process

Responsible for:

- File system access
- Launching Python scripts
- Managing IPC
- Handling local paths

---

## Renderer Process

Responsible for:

- UI
- Playback
- Waveforms
- User interactions

---

# IPC Communication Example

```txt
Frontend
↓
window.electron.startSeparation(songPath)
↓
Electron Main
↓
spawn python process
↓
Receive progress
↓
Update UI
```

---

# Future Features

## Phase 2 — Navegación

Features para navegar y practicar secciones específicas de la canción:

- **Timeline interactivo**: waveform clickeable con zoom, seek y arrastre, reemplazando el seek básico actual ◐ (seek listo, falta zoom/arrastre)
- **Marcadores secciones**: markers editables sobre el timeline (verso, coro, puente, etc.) ✅
- **Loops secciones**: loop A/B y loop de sección usando los marcadores, para repetir pasajes difíciles ✅

## Phase 2 — Grabación simple

Herramientas mínimas para que el músico se grabe practicando:

- **Count-in para grabación**: elegir un intro de 1, 2 o 4 compases con clics de metrónomo antes de grabar ✅
- **Loop para multi-take**: loop A/B para grabar múltiples capas sobre la misma sección
- **Waveform visualization de recordings**: mostrar forma de onda de la grabación al terminar ✅

## Phase 2 — Herramientas de práctica

- **Tempo tap**: tocar el tempo manualmente con un botón si la detección automática falla
- **Manual key override**: permitir al usuario cambiar la tonalidad detectada si el algoritmo falla ✅
- **Key-aware Jam Zone**: que las escalas cambien en tiempo real si el usuario sobreescribe la key ✅
- **Jam Zone visual / Diapasón interactivo**: fretboard SVG con notas de escala, toggle guitarra/bajo ✅
- **🔗 Tab Finder**: botón por stem que busca tabs en Ultimate Guitar ✅

## Phase 2 — Mezcla

Control de mezcla por stem para ajustar la escucha:

- **Volumen por track**: slider individual de volumen para cada stem (ya existe volumen básico, mejorar precisión y UX)
- **Per-track panning**: control de paneo izquierda/derecha por stem

---

## Phase 3

- Practice mode como contenedor de todas las herramientas anteriores
- (por definir)

---

# Optional Future Cloud Features

Cloud should NOT process stems initially.

Cloud may later handle:

- User accounts
- Sync projects
- Backup stems
- Share sessions
- Collaboration

---

# Why This Architecture?

## Advantages

- Almost zero infrastructure costs
- Uses user's hardware
- Easier AI integration
- Easier multimedia processing
- Better desktop UX
- Faster MVP development

---

# Suggested Development Roadmap

## Week 1

- Electron setup
- React integration
- Drag & drop UI

---

## Week 2

- Python worker integration
- Demucs execution
- Local output generation

---

## Week 3

- Audio playback
- Waveforms
- Stem controls

---

## Week 4

- Exporting
- UI polish
- Error handling
- Progress tracking

---

# Long-Term Vision

Velody es una herramienta de práctica musical:

- Separar canciones para aislar instrumentos
- Tocar encima con tu propio instrumento
- Ver escalas, notas en el diapasón, tabs
- Practicar secciones específicas con loop
- Aprender canciones escuchando stems individuales

El MVP se enfoca en:

- estabilidad
- buena UX
- procesamiento local
- cero features de producción

Evitar overengineering.

---

# Recording Over Stems

## Feature: Record Over

El usuario puede grabar su propio instrumento sobre cualquier stem original.

### Flujo

1. Click **REC** en un stem (e.g., Guitar)
2. El stem original se mutea automáticamente
3. Cuenta regresiva: 3... 2... 1...
4. `getUserMedia({ audio: true })` captura la entrada del mic/instrumento
5. `MediaRecorder` graba en `audio/webm` mientras los otros stems suenan
6. Al hacer **Stop**: modal de confirmación con duración y stem name
7. **Save** → backend convierte webm → WAV/MP3 con FFmpeg → se guarda en `output/stems/<song>/Recording <Label> <N>.wav`
8. Aparece como un stem nuevo en la grilla ("Recording Guitar 1", "Recording Guitar 2"...)
9. **Discard** → se descarta el blob, el stem original vuelve a la normalidad

### Backend IPC

- `record:save(songDir, data, name, format)` → escribe temp webm, FFmpeg lo convierte a WAV/MP3, devuelve path

### Frontend State

- `recording`: `'idle' | 'countdown' | 'recording' | 'confirming'`
- `recordingKey`: qué stem se está grabando
- `recordedStems: string[]` — paths de stems grabados, se agregan a la grilla
- `monitorVolume`: slider para volumen de monitoreo (solo UI, el monitoreo real es por el direct monitoring de la interfaz)
- `recordingFormat`: `'wav' | 'mp3'`

### Pendientes / Fase 2

- **Loop para multi-take**: que la canción loopee la sección A/B durante la grabación para grabar múltiples capas.

---

# Available Services (for future use)

These services exist and can be used when the app needs cloud features:

| Service                | Account                         | Potential Use                            | Phase    |
| ---------------------- | ------------------------------- | ---------------------------------------- | -------- |
| **Supabase**           | Existing user/DBs               | Auth, user DB, project storage           | Phase 3+ |
| **Cloudflare R2**      | Existing, more buckets possible | Backup/sync stems, share sessions        | Phase 3+ |
| **Firebase (Workers)** | Existing project                | Push notifications, messaging            | Phase 3+ |
| **Mailgun**            | Experienced user                | Transactional emails (welcome, recovery) | Phase 3+ |
| **Railway**            | Used for other projects         | Backend API deployment if needed         | Phase 3+ |
| **GitHub**             | Active account                  | Repository hosting, CI/CD                | Now      |

---

# Core Philosophy

Build a powerful local-first music tool before investing in cloud infrastructure.

Focus on:

- UX
- speed
- reliability
- workflow

NOT on:

- microservices
- Kubernetes
- expensive GPU infrastructure
- premature scaling

---

# Performance Tracking

## Completed

| #   | Optimización                                                                                                 | Impacto                          | Estado  |
| --- | ------------------------------------------------------------------------------------------------------------ | -------------------------------- | ------- |
| R1  | BPM detection → TempoCNN via Python IPC                                                                     | BPM preciso, align con beat       | ✅ Done |
| R2  | `setProgress` throttle 60fps → 20fps                                                                         | -66% re-renders                  | ✅ Done |
| R3  | WaveSurfer sync directo a Canvas                                                                             | 0 renders extra                  | ✅ Done |
| R4  | Refs en `useLayoutEffect`                                                                                    | Sin ESLint warnings              | ✅ Done |
| R5  | Inline styles → Tailwind                                                                                     | CSS más eficiente                | ✅ Done |
| R6  | Strict TypeScript (`tsconfig strict: true`)                                                                  | Type safety total                | ✅ Done |
| R7  | Extracción componentes `ExportModal`, `JamZone`, `RecordingConfirmationModal`, `TimelineMarkers`, `StemCard` | Código más mantenible            | ✅ Done |
| R8  | Extracción hooks `useMetronome`, `useRecording`                                                              | Separación de concerns           | ✅ Done |
| R9  | Eliminación `ProcessingScreen`, `useAudio`, `audio/player.ts`, `shared/types/`                               | Dead code removal                | ✅ Done |
| R10 | Eliminación `electron-updater`, `@electron-toolkit/preload`                                                  | -2 dependencias                  | ✅ Done |
| R11 | Audio-server: `isPathSafe`, CORS `'*'`, OPTIONS preflight                                                    | Seguridad + estabilidad          | ✅ Done |
| R12 | Async `execFile` reemplaza `execSync`/`execFileSync`                                                         | Non-blocking I/O                 | ✅ Done |
| R13 | Timeouts 10min en spawns FFmpeg                                                                              | Evita procesos colgados          | ✅ Done |
| R14 | `AudioContext.close()` on unmount + cleanup timeouts                                                         | Sin memory leaks                 | ✅ Done |
| R15 | Fixed stale closures WaveSurfer + recording sync                                                             | Bugs corregidos                  | ✅ Done |
| R16 | Extracción `MarkerLabelInput` a su propio archivo                                                            | -66 líneas de StemPlayer         | ✅ Done |
| R17 | Extracción BPM + key detection → `useSongAnalysis` hook                                                      | Separación de concerns           | ✅ Done |
| R18 | `stemNameFromPath` unificada en `utils.ts`                                                                   | Sin duplicación (era 2 archivos) | ✅ Done |
| R19 | `formatTime` unificada en `utils.ts`                                                                         | Sin duplicación (era 3 archivos) | ✅ Done |
| R20 | Magic numbers → constantes en `utils.ts`                                                                     | Código más legible               | ✅ Done |
| P2  | Lazy WaveSurfer (crear waveform solo al activar stem)                                                        | -50% WaveSurfer, -40% RAM        | ✅ Done |
| P8  | Volumen por track (slider individual por stem)                                                               | Mezcla más cómoda                | ✅ Done |
| P9  | Per-track panning (control stereo L/R por stem via Web Audio API)                                            | Mezcla más profesional           | ✅ Done |
| R21 | AudioContext engine: AudioBufferSourceNode + GainNode + StereoPannerNode per stem (replaces `<audio>` elements) | Zero desync, instant mute/unmute | ✅ Done |
| R22 | Metronome uses own AudioContext (no shared AudioContext dependency)                                           | Metronome independent of engine  | ✅ Done |
| R23 | useWaveSurfers uses seekRef (breaks circular dependency with engine)                                          | Clean hook architecture          | ✅ Done |
| R24 | useRecording uses seek function (no audioEls dependency)                                                      | Recording independent of audio   | ✅ Done |
| R25 | Metronome drift correction: lastScheduledBeatRef reset on seek/restart/loop                                   | Metronome stays in sync          | ✅ Done |
| R26 | Metronome beat offset alignment (firstBeatOffsetRef from TempoCNN)                                            | Click aligns with first beat     | ✅ Done |

## Pending

| #   | Optimización / Feature | Esfuerzo estimado | Impacto esperado | Estado |
| --- | ---------------------- | ----------------- | ---------------- | ------ |

## Future improvements (sin priorizar)

- **StemPlayer god component**: ~1,080 lns (bajó de ~1,125), aún se puede seguir extrayendo

## Notas técnicas

- **P3 Virtualización StemGrid**: ✅ Ya implementado con `react-window`
- **Lazy WaveSurfer**: ✅ Implementado — `ensureWaveSurfer()` crea waveforms on-demand al dar play
- **Per-stem panning**: ✅ Implementado via `StereoPannerNode` en AudioContext engine
- **Per-stem volume**: ✅ Implementado via `GainNode` en AudioContext engine con rampa `setTargetAtTime`
- **Audio engine**: `useAudioContextEngine` — AudioContext + AudioBufferSourceNode per stem, preloaded buffers, RAF loop for position
- **Metronome**: Own AudioContext, reads `positionRef` directly, uses `firstBeatOffsetRef` from TempoCNN for beat alignment
- **Muting = GainNode 0**: Source keeps playing silently, stays in perfect sync. No recreate/reconnect needed.
