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
│   │   ├── songMeta.ts           ← .velody read/write (updateMeta)
│   │   ├── cloud/                ← Optional cloud sync (settings, client, sync engine, IPC)
│   │   └── setup/
│   │       └── index.ts          ← Auto-setup manager
│   ├── shared/
│   │   └── cloud.ts              ← Cloud Worker API contract
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
│   ├── separate.py              ← Demucs script (drops empty stems)
│   ├── stem_activity.py         ← Empty-stem detection
│   ├── prune_empty_stems.py     ← Apply it to an existing library
│   ├── detect_bpm.py            ← TempoCNN + librosa beat grid
│   ├── downbeat.py              ← Which beat is the "1"
│   ├── download.py              ← YouTube import (yt-dlp)
│   ├── requirements.txt
│   └── utils/
│
├── cloud-worker/                ← Cloudflare Worker (R2 + D1) for cloud sync, own package
│
├── scripts/
│   ├── batch-import.mjs         ← Bulk download + separate
│   └── verify-asar.mjs          ← Release check: app.asar has every runtime dep
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

Demucs `htdemucs_6s` produce hasta 6 stems: Vocals, Drums, Bass, Other, Piano, Guitar.

- **Calidad por canción**: MP3 a 128 / 192 / 320 kbps, elegido en "Stem quality" al importar (~23 / 35 / 58 MB por canción de 4 min). `separate.py --bitrate`.
- **Stems vacíos fuera**: `python-worker/stem_activity.py` descarta stems sin una parte real (ej. `piano.mp3` en una canción sin piano): audible < 2 s, o < 8 s con p95 < −50 dB. Nunca descarta todos. `prune_empty_stems.py <root> [--apply]` aplica la misma regla a una biblioteca existente. Una canción puede tener menos de 6 stems.
- **Biblioteca**: `<userData>/output/stems` (Linux: `~/.config/velody/output/stems`), igual en `pnpm dev` y en la app instalada (`src/main/paths.ts`). Nada se escribe dentro del repo.
- **Temporales**: la carpeta temporal de Demucs y la descarga de YouTube se borran siempre, aunque la separación falle o se cancele; al cancelar también se termina el proceso hijo de Demucs.
- **Importación masiva**: `node scripts/batch-import.mjs links.txt [--bitrate 128]` descarga y separa una lista de links (reanudable).

---

## Audio Playback

- Play/Pause, timeline y waveforms (WaveSurfer.js), mute/solo/volumen/pan por stem
- **Arranca donde empieza la música**: al cargar, el cursor salta al primer sonido (`findMusicStart`); Restart vuelve ahí si no hay trim
- **Practice**: velocidad 50–150 % sin cambiar el tono y transposición ±12 semitonos, en tiempo real (`playbackRate` en los stems + un nodo Signalsmith Stretch en el bus master; ver `pitchShifter.ts`). Se guardan por canción.
- **Live mode** (interruptor en la barra lateral): muestra Setlists y Live Presets, pensados para tocar con banda; apagado por defecto.

---

## Export

Allow exporting:

- Individual stems (WAV/MP3)
- Mix export (select which stems, with optional metronome click track)
- WAV/MP3 format toggle
- Export All (opens directory picker, exports all stems)

---

# BPM Detection

## How It Works

`python-worker/detect_bpm.py`, siempre sobre el stem de **batería** (`pickBeatTrackingStem`; antes era `stems[0]`, que dependía del orden del sistema de archivos):

1. TempoCNN (TensorFlow): tempo base
2. librosa `beat.beat_track()`: rejilla completa de beats (`beatTimes`) y `firstBeatOffset`
3. **Downbeat** (`downbeat.py`): estima qué beat es el "1" con golpes del bajo + bombo + cambios de acorde del bajo → `downbeatShift`
4. Si librosa no encuentra beats, se usa el tempo de TempoCNN sin rejilla (nunca devuelve BPM 0)

## Metrónomo y count-in

- El click se programa en el **mismo AudioContext** que los stems, con la posición leída del reloj de audio (exacto a la muestra), respeta la velocidad de práctica y compensa la latencia del nodo de tono.
- **"This is the 1"** / ◀ ▶ corrige el acento a mano; la corrección manual siempre gana sobre la detectada.
- **Count-in sobre la rejilla** (`planCountIn`): termina un beat antes del siguiente beat real de la canción y siempre empieza en un "1".

## Concurrencia y análisis en segundo plano

- `detectionQueue` (`src/main/taskQueue.ts`): **un solo proceso de Python a la vez** (varios TensorFlow simultáneos causaban OOM en Windows con poca RAM), deduplicado por canción, y la canción que abres pasa antes que el trabajo de fondo.
- `requestLibraryAnalysis()`: 10 s después de abrir la app y tras cada separación, analiza las canciones sin caché vigente, una por una, en pausa mientras Demucs trabaja. Así las canciones abren al instante.

## Caché

- `.velody` (JSON junto a los stems), versión en `src/shared/analysis.ts` (`ANALYSIS_CACHE_VERSION`, hoy 20)
- Solo se guardan detecciones **exitosas**; si falla, la próxima vez reintenta
- Todas las escrituras pasan por `updateMeta()` (`src/main/songMeta.ts`): serializadas por canción y atómicas (temp + rename); cada escritura pone `updatedAt` (la sincronización con la nube usa "gana el más reciente")
- Claves solo de este equipo, nunca se suben: `cloudId` (id estable de la canción en la nube) y `fileHashes` (caché de SHA-256 por archivo)

> Las funciones de **tonalidad (Key Detection)** y **Jam Zone / diapasón** se retiraron de la app; ya no existen en el código.

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

# Build & Release

## Commands

| Command | Descripción |
| --- | --- |
| `pnpm dev` | Desarrollo con hot-reload |
| `pnpm build` | Typecheck + vite build (sin empaquetar) |
| `pnpm build:linux` | AppImage + `.deb` en `dist/` |
| `node scripts/verify-asar.mjs` | Verifica que `app.asar` traiga todas las dependencias de runtime |

## Flujo para release (Linux)

```bash
pnpm version patch        # o minor: sube package.json, hace commit y tag vX.Y.Z
git push origin main --follow-tags
```

`.github/workflows/release.yml` corre los tests, empaqueta AppImage + `.deb`, ejecuta `verify-asar.mjs` (la 1.1.0 salió sin `ms` y no abría; ahora el release falla si falta una dependencia) y publica el GitHub Release.

## Auto-update

`src/main/updater.ts` (electron-updater) revisa los Releases de GitHub al abrir la app instalada, descarga la versión nueva en segundo plano y muestra **"Restart to update"**. El `.deb` pide la contraseña de administrador al instalar; el AppImage no. En `pnpm dev` no aplica.

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

## Próxima sesión — Separación extra (opcional, por stem)

Idea: botones opcionales sobre un stem ya separado que solo corren cuando el usuario los pide en esa canción, así no se gasta tiempo ni espacio donde no hace falta. Cada modelo se descarga una sola vez (cientos de MB), cada división tarda ~30 s–1 min con GPU y cada stem extra pesa ~4 MB a 128 kbps.

1. **Dividir batería** — bombo, tarola, toms, hi-hat y platillos. Viable y con buena calidad: modelos abiertos tipo *DrumSep* (MDX23C) aplicados al stem de batería, en local.
2. **Voz principal vs. coros** — modelos "karaoke" que separan la voz líder de los coros. Funcionan bien cuando los coros son claramente otra voz.
3. **Dividir guitarras (L/R)** — no existe un modelo abierto confiable para separar dos guitarras (rítmica/lead). Pero en mucho rock las guitarras dobladas van paneadas izquierda/derecha: dividir el stem de guitarra por canal las separa casi limpio, al instante y sin IA. No sirve si ambas van al centro.

Pendientes de decidir: dónde va el botón en la UI, cómo se nombran/agrupan los sub-stems en el mezclador, y si se pueden revertir (borrar sub-stems y volver al stem original).

## Otras ideas propuestas (sin priorizar)

- Atajos de teclado (espacio, ←/→ por compás, L loop, M metrónomo, R restart, [ ] velocidad)
- Loop que se ajusta a compases + entrenador de velocidad (70 % → +5 % por vuelta)
- Count-in de **grabación** alineado a la rejilla (el de reproducción ya lo está)
- Detección de acordes y de secciones (intro/verso/coro)

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
- ~~Manual key override / Jam Zone / diapasón~~ — retirados de la app (ya no existen)
- **Velocidad sin cambiar tono + transposición** en tiempo real ✅
- **Detección automática del "1"** + botón "This is the 1" ✅
- **Count-in sobre la rejilla de la canción** ✅
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

# Cloud Sync (opcional)

Implementado en `openspec/changes/cloud-library-sync`. La nube **no procesa** stems: es una copia sincronizada de la biblioteca, apagada por defecto.

- Backend: `cloud-worker/` — Cloudflare Worker + R2 (bucket `velody`) + D1 (índice). Un solo usuario, un token personal. Setup en `cloud-worker/README.md`.
- Las llaves de R2 solo existen como secretos del Worker; la app recibe URLs firmadas de 1 h. El token se guarda cifrado (`safeStorage`) en `<userData>/cloud.json`. Nada de esto va en el repo ni en el `.deb`.
- Cada canción: **local**, **solo nube** (0 MB locales, se descarga al abrirla) o **sincronizada**. Acciones: subir, subir todo, descargar, quitar de esta laptop, borrar en todos lados (con confirmación).
- Sin conexión o con la nube apagada, la app funciona igual que antes.
- La app móvil (`MOBILE_APP.md`) consumirá la misma API.

Fuera de alcance por ahora: cuentas multiusuario, compartir, colaboración, streaming.

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
| **Cloudflare R2 + D1 + Workers** | Existing                | Cloud library sync (`cloud-worker/`)     | **In use** |
| **Firebase (Workers)** | Existing project                | Push notifications, messaging            | Phase 3+ |
| **Mailgun**            | Experienced user                | Transactional emails (welcome, recovery) | Phase 3+ |
| **Railway**            | Used for other projects         | Not needed (cloud sync runs on Cloudflare) | —      |
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
