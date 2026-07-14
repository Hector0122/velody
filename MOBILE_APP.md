# Velody Mobile — App Architecture Plan

## Concept

React Native app (Android only) that consumes stems + metadata produced by Velody Desktop. Desktop handles Demucs separation; mobile handles offline playback, multitrack mix, and export.

## Stack

| Layer | Technology |
|-------|-----------|
| Mobile framework | React Native bare (Metro, no Expo) |
| Audio engine (MVP) | WebView + Web Audio API |
| Audio engine (future) | Kotlin native module (Oboe/ExoPlayer) |
| Backend | Node.js + Express on Railway |
| Auth | Custom JWT (email + password, bcrypt) |
| Database | PostgreSQL on Railway |
| Storage | Cloudflare R2 |
| Format | MP3 320 kbps (code-ready for WAV) |

## Architecture

```
Velody Desktop              Cloud (Railway)              Mobile (Android)
┌──────────────────┐       ┌──────────────────┐         ┌──────────────────┐
│ Demucs separates  │       │ Express API       │         │ React Native     │
│ stems (6 stems)  │──────▶│ JWT auth          │◀────────│ (bare, Metro)    │
│ → convert MP3    │       │ Postgres          │         │                  │
│ → compress mix   │       │ R2 signed URLs    │         │ Login            │
│ → metadata JSON  │       │                   │         │ Song list        │
│                  │──────▶│ Cloudflare R2     │◀────────│ Download stems   │
│ User clicks      │       │ buckets/stems/    │         │ (RNFS)           │
│ "Upload"         │       │ buckets/mixes/    │         │                  │
└──────────────────┘       └──────────────────┘         │ WebView player   │
                                                         │  · play/pause    │
                                                         │  · seek          │
                                                         │  · mute/solo     │
                                                         │  · volume/pan    │
                                                         │  · chord chart   │
                                                         │ Export mix → MP3 │
                                                         └──────────────────┘
```

## Database Schema (PostgreSQL on Railway)

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  email text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE songs (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL,
  artist text,
  duration_ms integer,
  bpm float,
  key text,
  chord_chart jsonb,
  metadata jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE song_files (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  song_id uuid REFERENCES songs(id) ON DELETE CASCADE,
  stem_type text NOT NULL CHECK (stem_type IN (
    'mix', 'vocals', 'drums', 'bass', 'other', 'piano', 'guitar'
  )),
  format text NOT NULL DEFAULT 'mp3' CHECK (format IN ('mp3', 'wav')),
  storage_key text NOT NULL,
  size_bytes bigint NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_songs_user_id ON songs(user_id);
CREATE INDEX idx_song_files_song_id ON song_files(song_id);
```

## R2 File Naming Convention

```
/audio/{userId}/{songId}/
  mix.mp3
  vocals.mp3
  drums.mp3
  bass.mp3
  other.mp3
  piano.mp3
  guitar.mp3
  metadata.json    <-- BPM, key, chordChart, markers
```

## Desktop Upload Flow (Manual)

1. Separation completes locally.
2. Desktop shows a **"Upload to Cloud"** section per song with individual toggle:
   - □ Mix
   - ☑ Vocals
   - ☑ Drums
   - ☑ Bass
   - ☑ Other
   - ☑ Piano
   - ☑ Guitar
3. User clicks **Upload**. Desktop:
   - Logs in via JWT (first-time auth stored locally).
   - Compresses selected stems to MP3 320 kbps (re-encode if source is WAV).
   - Uploads each to R2 (direct upload via S3 API).
   - Creates song + song_files records via Express API.
   - Marks song as "uploaded" locally.
4. Upload progress bar per stem.

**Future-proof**: If user wants WAV, checkbox toggles format before upload. R2 key changes `.mp3` → `.wav`, `format` column changes.

## Mobile App — Auth

### JWT Flow

```
POST /api/auth/register   { email, password }
POST /api/auth/login      { email, password } → { token, refreshToken }
POST /api/auth/refresh    { refreshToken } → { token }
```

- JWT with 1h expiry, refresh token 30d.
- Token stored in `react-native-async-storage`.
- All API calls include `Authorization: Bearer <token>`.
- Express middleware validates JWT, returns 401 if expired.

### Registration

Only email + password. No social login. No email verification for MVP (add later).

## Mobile App — Screens

```
Login          ← Auth screen (email, password, register link)
Home           ← Song list with pull-to-refresh, search
SongDetail     ← BPM, key, chord chart (static), download button
Player         ← WebView multitrack player, mix export
Settings       ← Account info, cache size, logout
```

## Mobile App — Download Flow (Manual)

1. User taps a song → SongDetail screen.
2. Shows song info + "Download" button.
3. User taps Download → app:
   - Gets signed URLs from backend (`GET /api/songs/:id/files`).
   - Downloads all files to `RNFS.DocumentDirectoryPath/velody/{songId}/`.
   - Shows progress bar (total MB, per-file).
   - Marks as downloaded locally.
4. Once downloaded → "Play" button appears.
5. Cache management in Settings: "Clear cache", size displayed.

## Mobile App — WebView Player

### Architecture

```txt
React Native Screen
  │
  ├── RN UI layer: play/pause button, timeline, chord chart,
  │   stem controls (mute/solo/volume/pan sliders)
  │
  └── WebView (invisible or minimal)
        └── Web Audio API
              ├── AudioBuffer per stem (load from file:// path)
              ├── GainNode per stem (volume, mute)
              ├── StereoPannerNode per stem (pan)
              ├── ScriptProcessorNode → connect to destination
              └── OfflineAudioContext → export mix
```

### Communication: RN ↔ WebView

- **RN → WebView**: `webview.postMessage()` or injected JS:
  - Play/pause
  - Seek to time
  - Update volume per stem
  - Update pan per stem
  - Mute/solo toggle
  - Export mix (triggers offline render)

- **WebView → RN**: `onMessage` callback:
  - Current time / progress
  - Export progress
  - Export complete (file blob)

### Stem Controls

Each stem has:
- **Mute** toggle (GainNode = 0)
- **Solo** toggle (other stems mute)
- **Volume** slider (GainNode.value = 0–1)
- **Pan** slider (StereoPannerNode.pan = -1 to 1)

### Export Mix

1. User configures stems (volume, pan, mute/solo).
2. User taps "Exportar".
3. WebView runs `OfflineAudioContext` with same graph:
   - Duration = song duration.
   - Renders all stems mixed.
   - Output → `WAV` (AudioBuffer → Blob).
4. WebView converts WAV to MP3 via `lamejs` (JS MP3 encoder in WebView).
5. Blob sent back to RN via `postMessage` → `RNFetchBlob` or `blobUtil`.
6. RN saves to `RNFS.DownloadDirectoryPath` or opens share sheet.

### Chord Chart Sync

- Parsed `chordChart` passed as initial state to WebView.
- WebView highlights current chord based on playback time.
- Tapping a chord line seeks to that position (via `RN->WebView seek`).

## Backend API

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /api/auth/register | No | Create user |
| POST | /api/auth/login | No | Login, return JWT |
| POST | /api/auth/refresh | No | Refresh JWT |
| GET | /api/songs | Yes | List user's songs |
| GET | /api/songs/:id | Yes | Song detail + file listings |
| GET | /api/songs/:id/files | Yes | Get signed R2 URLs for all files |
| POST | /api/songs | Yes | Create song (from desktop) |
| POST | /api/songs/:id/upload-complete | Yes | Mark song fully uploaded |
| DELETE | /api/songs/:id | Yes | Remove song + R2 files |
| GET | /api/account | Yes | User info, storage used |
| DELETE | /api/account | Yes | Delete account |

### Signed URL Generation

- Backend generates R2 signed URLs valid for 1 hour.
- Mobile downloads files for offline use.
- For streaming (if needed), backend generates shorter-lived URLs.

## MVP Features

- Login with email/password (JWT)
- Upload from desktop (manual toggle per stem, MP3)
- Song list with pull-to-refresh
- Download stems to device (manual per song)
- Playback: play/pause/seek, volume + pan per stem, mute/solo
- Chord chart display with live highlighting
- Export final mix as MP3 to device
- Cache management (view size, clear)

## Phase 2 Features

- Native Android audio module (Oboe) replacing WebView for lower latency
- WAV upload support (toggle in desktop)
- Backend-triggered sync (upload from desktop triggers notification to mobile)
- Multiple profiles per device
- Favorite songs

## Timeline

| Phase | Feature | Time |
|-------|---------|------|
| 1 | Backend: Postgres schema, Express API, JWT auth | 3 days |
| 2 | Backend: R2 integration, signed URLs | 2 days |
| 3 | Desktop: upload dialog + MP3 compression + upload logic | 3 days |
| 4 | Mobile: login + song list + pull-to-refresh | 3 days |
| 5 | Mobile: download + cache management | 2 days |
| 6 | Mobile: WebView player with multitrack + volume/pan | 5 days |
| 7 | Mobile: chord chart sync + live highlighting | 2 days |
| 8 | Mobile: export mix to MP3 | 2 days |
| 9 | Polish + Android build | 2 days |

**Total**: ~3 weeks for working MVP.

## Open Decisions

None. All decisions made:
- ✅ MP3 only, ready for WAV
- ✅ Medium level (volume + pan per stem, mute/solo)
- ✅ WebView + Web Audio API (Android)
- ✅ Export only final mix (MP3)
- ✅ Manual download per song
- ✅ Manual upload from desktop
- ✅ Custom JWT auth
- ✅ React Native bare (no Expo)
- ✅ Node.js + Express on Railway
- ✅ PostgreSQL on Railway
- ✅ Cloudflare R2 for storage
- ✅ Pull-to-refresh, no real-time sync
