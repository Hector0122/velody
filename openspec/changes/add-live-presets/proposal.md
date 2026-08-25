## Why

Reported: every time the user opens a song to rehearse or play live, they
have to redo the same setup by hand — muting the stems they don't want,
turning the metronome click on, etc. — before they can just press play.
For a song they've already configured exactly how they want to perform it
live, that setup should stick, not reset every session.

The user also asked for **multiple** named configurations per song (e.g. a
different mix for an acoustic set vs. the full band), not just one
remembered state — confirmed this is worth the extra complexity over a
single auto-saved snapshot.

## What Changes

- A "Live Preset" control in the song header lets the user save the
  current mute/volume/pan/metronome-on/master-volume state under a name,
  and switch between saved presets for that song.
- **Auto-applies on open**: opening a song with a saved preset applies the
  most-recently-used one automatically — zero clicks needed to get
  "ready to play" (confirmed with the user over the alternative of always
  starting neutral and requiring an explicit pick each time).
- Saving under a name that already exists updates that preset in place
  (same identity, refreshed values) rather than creating a near-duplicate.
- Switching presets works even mid-playback — the underlying mute/volume/
  pan/metronome state already transitions smoothly (existing gain-
  ramping/reactive-effect infrastructure), so this is a bonus, not
  something that had to be specially built.
- **Deliberately excludes** BPM, trim points, and playback count-in bars
  from what a preset captures — those already have their own independent
  per-song (not per-preset) persistence (`useSongAnalysis`, `useTrim`,
  `useSongCountIn`); duplicating them into presets would create two
  competing writers of the same `.velody` keys for no real benefit (they
  describe properties of the song/recording, not "how do I want to
  perform it today").
- Also excludes metronome volume/pan (`metroVolume`/`metroPan`) — those
  are already global, hardware-tied preferences (`add-metronome-and-mix-
  panning`), not something that varies per song or per preset.

## Capabilities

### New Capabilities
- `live-presets`: Named, per-song snapshots of mute/volume/pan/metronome-
  on/master-volume state, saved and recalled on demand, with the most
  recently used one applied automatically when the song is opened.

## Impact

- `src/renderer/src/hooks/livePresets.ts` (new): `LivePreset` type and
  pure `upsertLivePreset`/`removeLivePreset`/`renameLivePreset` functions.
- `src/renderer/src/hooks/useLivePresets.ts` (new): loads/persists presets
  via the song's existing `.velody` sidecar (`loadMeta`/`saveMeta` — same
  mechanism as BPM/trim/markers, new `livePresets` +
  `lastAppliedLivePresetId` fields); auto-applies the last-used preset on
  song load; exposes save/apply/delete/rename handlers.
- `src/renderer/src/components/LivePresetBar.tsx` (new): compact preset
  selector + save/delete UI in the song header.
- `src/renderer/src/components/StemPlayer.tsx`: wires `useLivePresets` in
  and renders `LivePresetBar` in the song header, next to the existing
  "Next Song" control.
- No IPC/main-process changes — reuses the existing `song:loadMeta`/
  `song:saveMeta` handlers, which already shallow-merge new top-level keys
  into a song's `.velody` file without needing to know about them ahead of
  time.
