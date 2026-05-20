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

Using:

- Demucs

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

- Individual stems
- ZIP package
- WAV format

---

# Python Worker

## Purpose

The Python worker is isolated from the Electron app.

Responsibilities:

- Run Demucs
- Process audio
- Handle FFmpeg operations
- Return processing results

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

- BPM detection
- Pitch shifting
- Loop sections
- Karaoke mode
- Practice mode

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