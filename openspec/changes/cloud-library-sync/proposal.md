## Why

The stem library lives only on the laptop (`<userData>/output/stems`: today 103
songs, 552 MP3 stems, 2.2 GB) and grows ~21 MB per song. There is no way to
free disk space without losing a song, no backup, and nothing a future phone
companion app could read from. A personal cloud copy on Cloudflare R2 solves
all three — and at this size it fits in R2's free tier (10 GB, zero egress
fees).

The cloud is a **synced copy, not the primary source**: the audio engine
decodes whole stems into `AudioBuffer`s before playback, so streaming would
not help, and Velody must keep working offline (rehearsals without Wi-Fi).

## What Changes

- New minimal backend, entirely on Cloudflare, in a new `cloud-worker/`
  folder of this repo: a Worker (HTTP API) + an R2 bucket (stem files and
  `.velody` metadata) + a D1 database (song index). Single user,
  authenticated by one personal API token. The Worker issues short-lived
  presigned R2 URLs; **R2 credentials never ship inside the desktop app**
  (the repo and releases are public).
- Each song gets a stable cloud id (`cloudId`, stored in its `.velody`) and
  one of three sync states, shown in the song list:
  - **Local + cloud** — synced.
  - **Cloud only** — 0 bytes on disk; downloaded on open or via "Download".
  - **Local only** — not uploaded yet; "Upload" action.
- Actions per song: **Upload**, **Download**, **Remove from this laptop**
  (deletes local stems, keeps the cloud copy), **Delete everywhere** (local +
  cloud, explicit confirmation). Existing "Delete" becomes an explicit choice
  between those last two for synced songs.
- Bulk "Upload all local-only songs" for the initial 2.2 GB backfill, with
  per-song progress, resumable (already-uploaded files are skipped).
- `.velody` metadata (BPM grid, markers, trim, count-in, speed/pitch,
  downbeat…) syncs last-write-wins on a per-song `updatedAt`, written locally
  only through `updateMeta()`.
- Settings: Worker URL + token entry (token stored with Electron
  `safeStorage`), "Test connection", and a cloud on/off switch. With cloud
  disabled or unreachable, the app behaves exactly as today.
- Docs: CLAUDE.md / AGENTS.md updated (local-first rule still holds — cloud
  is optional); MOBILE_APP.md backend section replaced by the Cloudflare
  Worker API for the personal phase.

Non-goals: the mobile app itself, multi-user accounts/registration, sharing
songs with others, streaming playback, syncing setlists/recordings-in-progress,
automatic background sync of every edit (sync is explicit or on open).

## Capabilities

### New Capabilities
- `cloud-library-sync`: per-song cloud sync states and actions (upload,
  download, remove local copy, delete everywhere), metadata reconciliation,
  and offline/disabled behavior in the desktop app.
- `cloud-storage-api`: the Cloudflare Worker contract — token auth, song
  index, presigned upload/download URLs, deletion — that both the desktop
  app and the future mobile app consume.

### Modified Capabilities
(none — no main specs exist under `openspec/specs/` yet)

## Impact

- **New**: `cloud-worker/` (Worker TypeScript, `wrangler.toml`, D1 migration,
  tests); new main-process module `src/main/cloud/` (API client, sync engine,
  transfer queue); new IPC channels `cloud:*`; new renderer UI (sync badges,
  song context actions, settings panel).
- **Modified**: `src/main/ipc/handlers.ts` (`songs:list` merges cloud-only
  songs, `song:delete` semantics), `scanSongsLibrary`/`SongItem` (sync
  state), `src/shared/types.ts` + preload (`VelodyAPI`), song open flow in
  `StemPlayer.tsx` (download before load when cloud-only), `.velody` gains
  `cloudId` and `updatedAt`.
- **Untouched**: `audio-server.ts` and its `isPathSafe()` check (it still
  serves only local files — cloud songs are downloaded first), separation,
  BPM detection, export, the audio engine.
- **Dependencies**: `wrangler` (dev, worker only); no new runtime dependency
  in the desktop app (uses `fetch`). Requires a Cloudflare account, one R2
  bucket and one D1 database, created by the user.
