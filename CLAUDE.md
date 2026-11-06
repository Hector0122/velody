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
src/main/ipc/handlers.ts   Bulk of IPC handlers (song list/delete, setlists, export, recording, BPM detection, URL import)
src/main/jobs/JobManager.ts  Separation job queue (FIFO, one job running at a time); spawns separate.py, parses its JSON stdout protocol
src/main/audio-server.ts   Local HTTP server (127.0.0.1, random port) that streams stem files with Range support to the renderer's <audio>/AudioContext consumers
src/main/setup/index.ts    First-run SetupManager: detects Python3, creates a venv at ~/.local/share/velody/venv, pip-installs Demucs/PyTorch, fetches portable FFmpeg
src/preload/index.ts       contextBridge surface; src/preload/index.d.ts + src/shared/types.ts define the VelodyAPI contract shared by main and renderer
src/renderer/src/          React UI (see below)
src/main/songMeta.ts       .velody read/write (updateMeta, re-exported from handlers.ts)
src/main/cloud/            Optional cloud library sync: settings (safeStorage token), Worker API client, sync engine, cloud:* IPC
src/shared/cloud.ts        Cloud Worker API contract, shared by main, renderer and cloud-worker/
python-worker/             Isolated Python scripts invoked as subprocesses — never imported, always spawned and communicated with via stdout JSON lines
cloud-worker/              Separate package: Cloudflare Worker (R2 + D1) backing cloud sync; own pnpm install/test/deploy, see its README
```

### IPC / subprocess protocol

Main-process code talks to Python by spawning a script and reading newline-delimited JSON from stdout, e.g. `separate.py` emits `{"type": "progress", "percent": N}`, `{"type": "complete", "stems": [...]}`, `{"type": "error", "message": "..."}`. `JobManager` parses these line-by-line, tolerating non-JSON lines (Demucs's own logging). Long-running spawns (Demucs, FFmpeg) have hard timeouts (10 min) and are killed on cancel/app-quit. Follow this same JSON-lines pattern if adding new Python-backed operations rather than inventing a new protocol.

`SetupManager.canUseRealDemucs()` gates separation: if the venv/Demucs isn't set up, the job fails with an explicit error (there is no simulation fallback anymore).

Stems are MP3 at a per-song bitrate (128/192/320 kbps) picked in the import screen ("Stem quality", persisted in localStorage as `velody:stemBitrate`) and passed `separation:start`/`url:import` → `JobManager.enqueue({ bitrate })` → `separate.py --bitrate`. Temp files are always cleaned up: `separate.py` removes its Demucs temp dir in a `finally` (and kills the Demucs child on SIGTERM), and URL imports pass the `velody_dl_*` download dir as the job's `tempDir`, deleted when the job ends.

BPM detection goes through `detectionQueue` (`src/main/taskQueue.ts`, a `SerialTaskQueue`): only one Python process runs at a time — multiple simultaneous detection processes (~1.4 GB each: Beat This!/BTC models + the song mix) OOM on low-RAM Windows machines, don't remove that. Requests are deduplicated per `stem|bpmHint` (the old singleflight handed an in-flight result to *any* caller, even for another song), and UI requests (`high`) jump ahead of background work (`low`). `requestLibraryAnalysis()` (10 s after launch and after every separation) walks the library and analyzes songs lacking a current cache (`hasCurrentAnalysis`, version in `src/shared/analysis.ts`), pausing while `jobManager.isBusy()`.

All `.velody` writes go through `updateMeta()` (`src/main/songMeta.ts`, re-exported from handlers.ts): serialized per song and written via temp-file + rename, so concurrent writers (UI hooks, background analysis, cloud sync) can't drop each other's keys or expose a half-written file. Every write stamps `updatedAt` (cloud sync is last-write-wins on it); device-only bookkeeping (`cloudId`, `fileHashes`) passes `{ touch: false }`.

### Cloud library sync (optional, off by default)

The cloud is a **synced copy, never the playback source** — songs are downloaded whole before they open, and with cloud off or unreachable the app behaves exactly as before. Backend: `cloud-worker/` (Cloudflare Worker + R2 bucket `velody` + D1 index), single user, one bearer token. The desktop never holds R2 credentials: the Worker issues 1 h presigned R2 URLs; the token is stored encrypted with Electron `safeStorage` in `<userData>/cloud.json` and never sent to the renderer.

- `CloudSync` (`src/main/cloud/sync.ts`) decorates `songs:list` (via `setLibraryLister`) with `sync: 'local' | 'cloud' | 'synced'`; local↔cloud match is by `cloudId` in `.velody`, or by name for a local song without one (reinstall / lost `.velody` — the id is then saved, so nothing is uploaded twice); a cloud-only song whose name is taken by a different local song is hidden. Cloud-only songs have `stems: []`.
- Downloads go to `<root>/.velody_dl_<id>/` (dot-prefixed — `scanSongsLibrary` skips dot entries), are size+SHA-256 verified, then renamed into place; stale ones are removed at startup.
- "Remove from this laptop" re-uploads anything changed first (so nothing exists only locally), then deletes the folder; "Delete everywhere" deletes in the cloud first and only then locally + prunes setlists.
- Metadata: last-write-wins on `updatedAt`, synced after upload and right before a synced song opens (`cloud:syncMetaOnOpen`, 2 s fail-fast).

Empty stems: `separate.py` drops stems with no real part (`python-worker/stem_activity.py`: audible < 2 s, or < 8 s with p95 < -50 dB — never all of them) and emits `{"type": "skipped"}`; `prune_empty_stems.py <root> [--apply]` applies the same rule to an existing library. Songs can therefore have fewer than 6 stems.

URL import: when download.py reports `[UPDATE_YTDLP]`, main updates yt-dlp in the venv and retries once before surfacing the error (batch-import.mjs does the same, once per run).

### Renderer structure

`StemPlayer.tsx` is the main orchestrator/god component; most audio logic has been extracted into hooks under `src/renderer/src/hooks/`:
- `useAudioContextEngine` — the audio engine: one `AudioBufferSourceNode` + `GainNode` + `StereoPannerNode` per stem, preloaded buffers, RAF loop for position. Muting sets gain to 0 rather than stopping the source, so stems stay sample-accurate in sync — never reconnect/recreate nodes for mute/volume/pan.
- `useMetronome` — schedules clicks on the playback engine's `AudioContext` via `playbackClockRef` (`PlaybackClock`: the engine's `ensureAudioCtx` + `getLivePosition`), so clicks are sample-locked to the stems; the click bypasses the engine's master gain/pan. Falls back to its own context + `positionRef` only when no clock is wired (tests); an owned context is closed on unmount. Don't go back to scheduling from the RAF-sampled `positionRef` — it's up to a frame stale and made clicks jitter. Beat alignment uses the detected `beatTimes` grid.
- Practice speed/transpose (`pitchShifter.ts`, persisted per song by `useSongSpeedPitch`): speed is `playbackRate` on every stem source (engine position = elapsed × speed; speed changes re-anchor `startRef`/`startTimeRef`), and one Signalsmith Stretch AudioWorklet on the master bus (masterPan → shifter → destination) applies `semitones − 12·log2(speed)`. It's bypassed (disconnected) at 100%/0 st. Its latency is exposed as `getOutputDelay()` and added to every metronome click; the in-song scheduler divides song-time delays by the rate. Recording is blocked while speed/pitch aren't default. Export ignores speed/pitch. The CSP allows `blob:` + `'wasm-unsafe-eval'` in `script-src` only because the library loads its worklet that way.
- Downbeat (`downbeat.ts` + `useDownbeatShift`): a per-song 0–3 shift of which beat gets the accent; the scheduler uses `isGridAccent`/`isConstantAccent` instead of hardcoded `% 4`. It's auto-detected (`python-worker/downbeat.py`: bass onsets + kick + bass chroma change, scored per bar phase; returned as `downbeatShift` by `detect_bpm.py` and cached as `detectedDownbeatShift`), and a manual choice ("This is the 1", ◀ ▶ — saved as `downbeatShift`) always wins until a tempo-octave correction rebuilds the grid.
- Playback count-in (`planCountIn` in `downbeat.ts`): clicks are taken from the song's own beat grid, ending one beat before the first beat at/after the start position and always starting on a "1"; StemPlayer maps them to AudioContext time (practice speed applied) and pre-schedules the stems at the matching `when`. The recording count-in (useRecording) still uses the plain N-bars `useCountIn.start`.
- Music start (`findMusicStart` in `utils.ts`): after decoding, the engine finds the first sound across all stems (minus 30 ms pre-roll) and parks the cursor there if it's still at 0 with no trim start; Restart goes there too when there's no trim start.
- `useWaveSurfers` — uses a `seekRef` to avoid a circular dependency with the audio engine.
- `useSongAnalysis` — BPM detection orchestration; runs on the drums stem (`pickBeatTrackingStem`, never `stems[0]`, whose identity depends on directory-listing order); a `detectedRef` prevents re-running detection once done client-side (the backend `detectionQueue` handles process-level dedup).
- `useRecording` — "record over a stem" flow: mutes the original stem, captures mic via `MediaRecorder` (webm), and on save the backend converts webm → WAV/MP3 via FFmpeg into `<stems root>/<song>/`.

The song library lives at `<userData>/output/stems` (Linux: `~/.config/velody/output/stems`) in both `pnpm dev` and packaged builds — one helper, `src/main/paths.ts`; `scripts/batch-import.mjs` defaults to the same place. Nothing is written inside the repo.

Metadata (BPM, beat grid, markers, trim, count-in, live presets) is cached per song as a sidecar JSON file (`.velody`) next to the stems, versioned via `CACHE_VERSION`. Only successful detections are cached — failures are never persisted, so the next load retries rather than getting stuck on a fallback value. If you bump the detection algorithm, bump `CACHE_VERSION` to invalidate old caches.

### BPM detection (python-worker/)

- `detect_bpm.py`: Beat This! (PyTorch, `beat-this` pip package — optional: not part of the setup readiness check, installed in the background at launch if missing; checkpoint downloaded once to the torch hub cache) on the sum of the song's stems gives the `beatTimes` grid and BPM (median gap), so tempo changes like a drumless intro are followed; extra beats closer than 0.65× the median gap are dropped. Results carry `tracker` (`beat_this`/`fallback`, cached in `.velody`); `fallback` songs are re-analyzed once Beat This! is available, `corrected` (tempo-octave fix) never. If it fails it falls back to `librosa.beat.beat_track()` on the drums stem (its own tempo estimate; TempoCNN/TensorFlow was removed — ~2 GB for this fallback only); `--bpm-hint` re-runs beat tracking at a user-corrected tempo (half/double-time fix). Chords: `chords.py` runs BTC (Park et al. 2019, model code vendored in `python-worker/btc/`, MIT; 12 MB weights downloaded once to `~/.local/share/velody/models/` from a pinned commit and SHA-256-checked, loaded with `weights_only=True`) on the full mix, averages its major/minor probabilities per beat of the grid and settles near-ties toward the song's own most-used chords (`SONG_PRIOR_WEIGHT`, fixes power-chord E vs Em); returned as `chords` ([{time, chord}] at each change) and cached in `.velody`. The renderer shows "chord now → next" in the timeline header, updated by `updateTimeDisplays`. There is no key detection.

### Security-relevant details

`audio-server.ts` binds to `127.0.0.1` only and enforces `isPathSafe()` (resolved-path must be inside the stems root) before serving any file — preserve this check when changing path handling, it's the only thing preventing arbitrary file reads through the streaming server.

## Notes

- Live-band features (Setlists, Live Presets) are kept but hidden behind a "Live mode" toggle; the app is now primarily a personal practice tool.
- Releases: `pnpm version patch|minor` + `git push --follow-tags` → `.github/workflows/release.yml` builds AppImage + .deb, runs `scripts/verify-asar.mjs` (fails if electron-builder's pnpm collector dropped a runtime dependency from app.asar — v1.1.0 shipped without `ms` and couldn't launch; `ms` is now a direct dependency for that reason), then publishes the GitHub Release that `src/main/updater.ts` reads.
- Tests run under Node 25+ with `--no-experimental-webstorage` (set in `vitest.config.ts`) so jsdom's `localStorage` isn't shadowed by Node's.
- `AGENTS.md` at the repo root is the canonical, detailed product/architecture doc (feature specs, full IPC surface, roadmap, performance-optimization changelog). Consult it for anything not covered above, especially before changing BPM detection, the audio engine, or the recording flow.
- `MOBILE_APP.md` describes a *separate*, not-yet-built React Native companion app that will consume the same `cloud-worker` API — it is a design doc, not code in this repo.
- This is a local-first tool by design: no cloud processing, no accounts, no telemetry. Don't introduce network dependencies for core separation/playback/export flows. Cloud sync is an optional add-on that must keep it that way (everything works with it off or offline).
- `cloud-worker/` is not part of `pnpm test`/`typecheck` at the root: `cd cloud-worker && pnpm install && pnpm test` (plain Node vitest; D1 is faked with `node:sqlite` running the real migration SQL). Deploy with `pnpm run deploy` (bare `pnpm deploy` is a different pnpm command).
