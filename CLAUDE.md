# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

There are two roots at the level above this file: `.venv/` (unrelated Python env at the repo root) and `velody/`, which is the actual Electron application and the root for all commands below. Run commands from `velody/`.

## Commands

All commands run from `velody/` via `pnpm`:

```bash
pnpm dev                # electron-vite dev, hot reload
pnpm build               # typecheck (node + web) + electron-vite build, no packaging
pnpm typecheck            # typecheck:node && typecheck:web (tsc --noEmit, composite false)
pnpm lint                 # eslint --cache .
pnpm format                # prettier --write .
pnpm test                  # vitest run
pnpm test:watch            # vitest watch mode
pnpm build:win / :mac / :linux / :unpack   # full build + electron-builder package
```

Single test file: `pnpm exec vitest run src/renderer/src/__tests__/utils.test.ts`. Vitest only picks up `src/**/__tests__/**/*.test.ts` (see `vitest.config.ts`); tests live in `renderer/src/__tests__`.

Python worker tests (separate toolchain, not run by `pnpm test`):

```bash
cd python-worker && pytest tests/test_detect_bpm.py -v   # single file
cd python-worker && pytest                                # whole worker suite
```

No lint config exists for Python; the worker has no formatter/linter wired up.

## Architecture

Electron desktop app: React/TS renderer → Electron IPC → Electron main → spawned Python subprocess → Demucs/FFmpeg → generated stem files → renderer streams them back over a local HTTP server.

```
src/main/index.ts          Electron entrypoint: creates BrowserWindow, wires SetupManager + JobManager, starts audio-server, registers top-level IPC (setup:*, audio:url)
src/main/ipc/handlers.ts   Bulk of IPC handlers (song list/delete, export, recording, BPM/key detection, URL import, transpose)
src/main/jobs/JobManager.ts  Separation job queue (FIFO, one job running at a time); spawns separate.py, parses its JSON stdout protocol
src/main/audio-server.ts   Local HTTP server (127.0.0.1, random port) that streams stem files with Range support to the renderer's <audio>/AudioContext consumers
src/main/setup/index.ts    First-run SetupManager: detects Python3, creates a venv at ~/.local/share/velody/venv, pip-installs Demucs/PyTorch, fetches portable FFmpeg
src/preload/index.ts       contextBridge surface; src/preload/index.d.ts + src/shared/types.ts define the VelodyAPI contract shared by main and renderer
src/renderer/src/          React UI (see below)
python-worker/             Isolated Python scripts invoked as subprocesses — never imported, always spawned and communicated with via stdout JSON lines
```

### IPC / subprocess protocol

Main-process code talks to Python by spawning a script and reading newline-delimited JSON from stdout, e.g. `separate.py` emits `{"type": "progress", "percent": N}`, `{"type": "complete", "stems": [...]}`, `{"type": "error", "message": "..."}`. `JobManager` parses these line-by-line, tolerating non-JSON lines (Demucs's own logging). Long-running spawns (Demucs, FFmpeg) have hard timeouts (10 min) and are killed on cancel/app-quit. Follow this same JSON-lines pattern if adding new Python-backed operations rather than inventing a new protocol.

`useRealDemucs` (`SetupManager.canUseRealDemucs()`) gates real Demucs vs. a sine-wave simulation fallback used when the venv isn't set up — check this when touching separation behavior, since dev environments without the venv silently run in simulation mode.

BPM detection (`song:detectBpm`) uses a **singleflight** pattern in the IPC handler: only one Python process runs at a time; concurrent calls reuse the in-flight promise. This exists because multiple simultaneous TensorFlow (TempoCNN) processes OOM on low-RAM Windows machines — don't remove it without understanding why.

### Renderer structure

`StemPlayer.tsx` is the main orchestrator/god component; most audio logic has been extracted into hooks under `src/renderer/src/hooks/`:
- `useAudioContextEngine` — the audio engine: one `AudioBufferSourceNode` + `GainNode` + `StereoPannerNode` per stem, preloaded buffers, RAF loop for position. Muting sets gain to 0 rather than stopping the source, so stems stay sample-accurate in sync — never reconnect/recreate nodes for mute/volume/pan.
- `useMetronome` — owns its own `AudioContext` (independent of the playback engine) and reads `positionRef` directly; beat alignment uses `firstBeatOffsetRef` from TempoCNN.
- `useWaveSurfers` — uses a `seekRef` to avoid a circular dependency with the audio engine.
- `useSongAnalysis` — BPM + key detection orchestration; a `detectedRef` prevents re-running detection once done client-side (backend singleflight handles process-level dedup).
- `useRecording` — "record over a stem" flow: mutes the original stem, captures mic via `MediaRecorder` (webm), and on save the backend converts webm → WAV/MP3 via FFmpeg into `output/stems/<song>/`.

Metadata (BPM, key, markers) is cached per song as a sidecar JSON file (`.velody`) next to the stems, versioned via `CACHE_VERSION`. Only successful detections are cached — failures are never persisted, so the next load retries rather than getting stuck on a fallback value. If you bump the detection algorithm, bump `CACHE_VERSION` to invalidate old caches.

### Key/BPM detection algorithms (python-worker/)

- `detect_bpm.py`: TempoCNN (TensorFlow) for a base tempo estimate, refined by `librosa.beat.beat_track()` (also gives `firstBeatOffset`); falls back to TempoCNN-only if librosa is unavailable.
- `detect_key.py`: decodes the bass stem only (more reliable than full mix) via FFmpeg, 32768-point FFT → 12-bin chroma vector (40–2000 Hz) → Krumhansl-Schmuckler correlation against 24 key profiles. If KS confidence is low (gap < 5% between top two) but the bass has a clearly dominant note (>10% margin), the bass note overrides KS.

### Security-relevant details

`audio-server.ts` binds to `127.0.0.1` only and enforces `isPathSafe()` (resolved-path must be inside the stems root) before serving any file — preserve this check when changing path handling, it's the only thing preventing arbitrary file reads through the streaming server.

## Notes

- `AGENTS.md` at the repo root is the canonical, detailed product/architecture doc (feature specs, full IPC surface, roadmap, performance-optimization changelog). Consult it for anything not covered above, especially before changing BPM/key detection, the audio engine, or the recording flow.
- `MOBILE_APP.md` describes a *separate*, not-yet-built React Native companion app (cloud sync via Railway/Postgres/R2) — it is a design doc, not code in this repo.
- This is a local-first tool by design: no cloud processing, no accounts, no telemetry. Don't introduce network dependencies for core separation/playback/export flows.
