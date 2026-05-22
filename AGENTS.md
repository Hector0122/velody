# Velody — Audio Stem Separation App

## Overview

Velody is a desktop application focused on AI-powered audio stem separation for musicians, producers, and learners.

The first MVP goal is simple:

- Import a song
- Separate stems using AI
- Play isolated tracks
- Export stems

The app will run locally on the user's machine to avoid expensive cloud GPU infrastructure.

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

| Layer | Technology |
|---|---|
| Desktop App | Electron |
| Frontend | React + TypeScript |
| Styling | TailwindCSS |
| Audio Waveforms | WaveSurfer.js |
| AI Separation | Demucs |
| Audio Processing | FFmpeg |
| AI Runtime | Python + PyTorch |
| Packaging | Electron Builder |

---

# Project Structure

```txt
velody/
│
├── src/
│   ├── main/
│   │   ├── index.ts          ← Electron main process
│   │   └── ipc/
│   │       └── handlers.ts   ← IPC: file dialog, spawn Python
│   ├── preload/
│   │   ├── index.ts          ← contextBridge APIs
│   │   └── index.d.ts        ← Window.api types
│   └── renderer/
│       ├── index.html
│       └── src/
│           ├── main.tsx
│           ├── App.tsx
│           ├── env.d.ts
│           ├── components/
│           │   └── AudioUploader.tsx  ← Drag & drop
│           ├── pages/
│           │   └── Home.tsx           ← Main layout
│           ├── hooks/
│           │   └── useAudio.ts        ← Audio state
│           └── audio/
│               └── player.ts          ← WaveSurfer wrapper
│
├── shared/
│   └── types/
│       └── index.ts           ← Stem, Track, SeparationResult
│
├── python-worker/
│   ├── separate.py            ← Demucs script
│   ├── detect_key.py          ← Key detection (numpy FFT + Krumhansl-Schmuckler)
│   ├── requirements.txt
│   └── utils/
│
├── output/
│   └── stems/                 ← Generated stems here
│
├── resources/                 ← App icons
├── build/                     ← Electron builder configs
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
- Volume per stem

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

| Tonalidad | Escalas mostradas |
|---|---|
| **Mayor** | Major (Ionian), Lydian, Mixolydian, Major Pentatonic, Blues |
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

## Phase 2

- Monitoreo interno con baja latencia (AudioContext + AudioWorklet)
- Loop / count-in para grabación
- Input selection (elegir dispositivo de entrada)
- Efectos en vivo (compresor, reverb, EQ) sobre monitor de entrada
- Quantize / corrección rítmica
- Undo / reemplazar takes
- Waveform visualization de recordings
- Pitch shifting
- Loop sections
- Karaoke mode
- Practice mode

## Phase 2 (próximo)

- **Manual key override**: permitir al usuario cambiar la tonalidad detectada si el algoritmo falla
- **Key-aware Jam Zone**: que las escalas cambien en tiempo real si el usuario sobreescribe la key
- **Detección de acordes**: analizar los stems para mostrar los acordes que suenan en cada compás
- **Tempo tap**: permitir al usuario tocar el tempo manualmente si la detección automática falla

---

## Phase 3

- AI chord detection
- Lyrics sync
- MIDI extraction
- Smart EQ isolation

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

Velody can evolve into:

- AI music practice platform
- Stem remixing tool
- Karaoke platform
- Music learning assistant
- Producer workflow tool

The initial MVP focuses ONLY on:
- stability
- stem quality
- good UX
- local processing

Avoid overengineering early.

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
- **Monitoreo interno con baja latencia**: migrar playback de `<audio>` elements a `AudioContext` + `AudioWorklet` para mezclar el input del mic con los stems en tiempo real. Esto permite que el usuario se escuche sin depender del monitor directo de la interfaz.
- **Loop / count-in**: que el usuario pueda elegir un intro de 1 compás antes de grabar, o que la canción loopee para grabar múltiples capas.
- **Input selection**: elegir qué dispositivo de entrada usar (mic 1, interfaz, etc.) via `deviceId` en `getUserMedia`.
- **Efectos en vivo**: compresor, reverb, EQ sobre el monitor de entrada.
- **Quantize / corrección rítmica**: ajustar la grabación al tempo detectado.
- **Undo / reemplazar take**: poder borrar un take grabado o reemplazar el stem original por el recording.
- **Visualización de forma de onda** del recording al terminar.

---

# Available Services (for future use)

These services exist and can be used when the app needs cloud features:

| Service | Account | Potential Use | Phase |
|---|---|---|---|
| **Supabase** | Existing user/DBs | Auth, user DB, project storage | Phase 3+ |
| **Cloudflare R2** | Existing, more buckets possible | Backup/sync stems, share sessions | Phase 3+ |
| **Firebase (Workers)** | Existing project | Push notifications, messaging | Phase 3+ |
| **Mailgun** | Experienced user | Transactional emails (welcome, recovery) | Phase 3+ |
| **Railway** | Used for other projects | Backend API deployment if needed | Phase 3+ |
| **GitHub** | Active account | Repository hosting, CI/CD | Now |

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