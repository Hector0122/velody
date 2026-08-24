## Context

See proposal.md — Why. Relevant existing pieces, established by direct code
reading (not assumption):

- `useMarkers.ts`: `markers`, `loopStart`, `loopEnd`, `loopEnabled` are plain
  `useState` with no persistence — they reset every time `StemPlayer` mounts
  (i.e. every time a song is opened). Loop A/B is set by clicking a marker
  (`TimelinePanel`'s `onMarkerClick`) or via the A—/B— `<select>` dropdowns
  bound to marker times.
- `useAudioContextEngine.ts`: `handleRestart` calls `startSources(0)`
  unconditionally. The RAF `tick()` loop already branches on
  `loopRef.current` — when `loop.enabled && position >= loop.end`, it stops
  and restarts sources at `loop.start`. `seek(time)` and `startSources(time)`
  both accept an arbitrary absolute position with no clamping.
  `masterPlaying=false` (via the existing `useEffect` watching
  `masterPlaying`) is what actually stops sources today.
- `useSongAnalysis.ts`: the *only* existing per-song persisted state, via
  `song:saveMeta`/`song:loadMeta` (`.velody` sidecar, generic
  `{...existing, ...meta}` JSON merge on save, plain `JSON.parse` on load).
  Cache is versioned (`_version: CACHE_VERSION`) and only written on
  successful detection — a pattern worth reusing for versioning if the trim
  schema ever needs to change shape, though trim values (plain numbers) are
  far less likely to need that than a detection algorithm's output.
- `stems:transpose` (handlers.ts): precedent for an audio transform that is
  explicitly **non-destructive to the original stem files** — it writes
  pitch-shifted copies to a sibling `_transposed/<suffix>/` cache dir and
  reuses cached output on repeat calls, never touching `output/stems/<song>/`
  itself.
- `export:mix`/`export:single` (handlers.ts): both spawn `ffmpeg -i <input>
  ... -y <outputPath>`. `export:mix` already takes an `options?: { bpm?:
  number }` parameter that conditionally adds a synthesized click-track input
  — the same shape extends naturally to a trim range.
- `TimelinePanel.tsx`: renders the master waveform in a plain `<div ref=...>`
  with `TimelineMarkers` absolutely positioned on top for marker chips/loop
  region. There is no existing "dimmed region" overlay, but the loop region
  itself is already drawn as an overlay by `TimelineMarkers`, so the same
  absolute-positioning-over-the-waveform technique applies directly.

## Goals / Non-Goals

**Goals:**
- Trim range persists across closing and reopening a song, since the whole
  point is "set it once before the gig, it's still there on show day" — this
  is the one meaningful way this feature differs from loop points, and it's
  what makes reusing `useMarkers`'s session-only pattern wrong here.
- Never modify the original stem files. The user's real library (100+ songs,
  each separated into up to 6 stems) took hours of Demucs processing; a
  trim feature must not risk corrupting or requiring re-separation of that
  investment, and must not silently invalidate the BPM/key cache (which is
  keyed off the *original* file's detected grid — see `firstBeatOffset`).
- Trim must be adjustable without friction: seeing/hearing the intro to
  decide exactly where to cut it is part of the workflow, so free scrubbing
  into the trimmed-out region must keep working.
- Exported files should match the trimmed playback range by default, since
  the export flow (WAV/MP3, mix or per-stem) is the same content the user
  hears live — no reason for it to silently re-include a trimmed intro.

**Non-Goals:**
- Destructively cutting the stem `.mp3` files on disk. Rejected: it would
  require re-encoding all 6 stems with FFmpeg every time the trim points
  change, would desync the cached `firstBeatOffset`/`beatTimes` grid (which
  is computed against the *original* file's timeline) without a repeat BPM
  detection pass, and is irreversible if the user changes their mind about
  where the intro ends. The non-destructive range covers the actual use case
  (skip on playback/restart, trim on export) without any of that risk.
- Draggable waveform trim handles. `TimelinePanel`'s existing loop-point UX
  is dropdown/click-based, not drag-based, and this proposal follows that
  existing interaction model rather than introducing the first drag-to-set
  interaction in the timeline. A drag handle is a reasonable v2 if the
  button-based flow proves too fiddly in practice.
- Automatic intro detection (e.g. silence/onset detection to guess where the
  song "really" starts). The user already knows their setlist and can
  scrub-and-click in a few seconds; auto-detection is unproven value for
  meaningfully more implementation risk (another Python analysis pass, more
  cache invalidation surface) and is explicitly out of scope for this
  proposal.
- Clamping manual seeks/scrubbing to the trimmed range. The user must be able
  to preview the un-trimmed intro to decide where to cut it, and to re-adjust
  later — only automatic playback entry (Restart) and automatic playback exit
  (reaching `trimEnd`) are affected.

## Decisions

- **Persist via the existing `.velody` sidecar, not a new storage
  mechanism.** `song:saveMeta`/`song:loadMeta` already do a generic
  key-merge JSON read/write per song directory; adding `trimStart`/`trimEnd`
  keys needs zero backend changes. Loaded once per song open (mirroring
  `useSongAnalysis`'s `detectedRef`-guarded load-on-mount, but simpler: no
  detection fallback needed, just "load if present, else use defaults").
- **Shape: `trimStart: number` (default `0`), `trimEnd: number | null`
  (default `null` = "to the end").** Deliberately asymmetric with
  `loopStart`/`loopEnd: number | null` in `useMarkers` — a trim range always
  has a meaningful start (0 is a valid, common value: "no intro to skip"),
  so `trimStart` doesn't need a null/unset state the way loop's A point
  does (which starts genuinely absent until the user picks a marker).
- **New dedicated hook `useTrim(songDir)`, not folded into `useMarkers`.**
  Trim is persisted and loop/markers are not; conflating them in one hook
  would mean either persisting markers too (out of scope, bigger surface —
  markers/loop are explicitly a rehearsal aid, not a setlist-prep artifact)
  or splitting persistence logic awkwardly inside a hook whose other state
  intentionally doesn't persist. A separate hook keeps the "this part
  survives reopening the song, this part doesn't" boundary explicit in the
  code, matching how `useSongAnalysis` already owns the one other piece of
  per-song persisted state.
- **Restart seeks to `trimStart`, not `0`.** `handleRestart` in
  `useAudioContextEngine` changes its hardcoded `startSources(0)` /
  `positionRef.current = 0` to use `trimStart`. This is the actual "skip the
  intro" behavior the user asked for — every time they hit Restart (or start
  a song fresh) during a live set, they land past the intro automatically.
- **Reaching `trimEnd` stops playback, using the same stop path as
  `masterPlaying=false`, and only when loop is not active.** Extends the RAF
  `tick()` loop with a second boundary check alongside the existing loop
  check: `if (!loop.enabled && trimEnd !== null && position >= trimEnd)`
  → stop sources exactly as the existing `masterPlaying` watcher does,
  and call `setMasterPlaying(false)` so UI state (play/pause icon) stays
  consistent. Loop's own boundary check is unchanged and still takes
  priority when loop is enabled — trim and loop are independent, not
  mutually exclusive (a user could loop a section that's fully inside the
  trimmed range).
- **No clamping on `seek`/scrub.** `seek(time)` and direct waveform clicks
  keep accepting any position in `[0, duration]` unchanged — trimming only
  changes what "Restart" and "reaching the end automatically" mean, per the
  Non-Goals above.
- **Export takes an optional `{ trimStart?: number; trimEnd?: number }`,
  applied as FFmpeg `-ss <trimStart>` (input-seek) and `-to <trimEnd>` (only
  when set) args on both `export:mix` and `export:single`.** Matches the
  existing `options?: { bpm?: number }` extension pattern on `export:mix`
  exactly. `-ss` before `-i` is used for fast input-side seeking rather than
  output-side (`-ss` after `-i`), consistent with FFmpeg best practice for a
  hard cut with no need for frame-accurate re-encoding at the boundary.
  Renderer passes the currently-loaded trim range from `useTrim` by default;
  a future export-modal toggle to "export full/untrimmed" is easy to add
  later but not required for this proposal (default behavior — trimmed
  export — matches what the user asked for).
- **Timeline UI: two buttons ("Set Trim Start", "Set Trim End") next to the
  existing Loop controls, capturing `positionRef`'s current value, plus a
  "Clear Trim" button.** Mirrors the existing button-driven interaction
  model (`onSetLoopStart`/`onSetLoopEnd`) rather than introducing marker
  dependency — trim points don't need a named marker, just a timestamp.
  Dimmed regions `[0, trimStart)` and `(trimEnd, duration]` render as
  absolutely-positioned overlays on the waveform container, using the same
  positioning math `TimelineMarkers` already uses for the loop region.

## Risks / Trade-offs

- [A user sets `trimEnd` shorter than `trimStart` by mistake] → Mitigated by
  validating in the "Set Trim End" handler: if the captured position is
  before the current `trimStart`, reject (toast) rather than storing an
  inverted range that would make every Restart immediately hit the stop
  condition.
- [Old `.velody` sidecars have no `trimStart`/`trimEnd` keys] → Handled by
  treating missing keys as the defaults (`0`/`null`) on load — no migration
  needed, no version bump required since absence is a valid, meaningful
  state (not a stale-cache situation like BPM detection results).
- [Export trim silently changes exported file length vs. today's
  always-full-length export, surprising an existing user] → Acceptable and
  intended per the Why — the exported file should match what's heard live;
  documented in tasks.md as something to call out if a changelog/release
  note is written.

## Migration Plan

No migration needed. Existing songs with no `trimStart`/`trimEnd` in their
`.velody` sidecar behave exactly as today (full song, no trim) until the user
explicitly sets trim points for that song. Nothing to roll back beyond not
setting trim points.
