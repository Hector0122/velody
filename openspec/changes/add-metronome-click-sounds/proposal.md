## Why

The metronome's click (`playClick` in `useMetronome.ts`) is a triangle-wave
oscillator (1600Hz accent / 900Hz regular) with a soft 60ms exponential
decay. In practice, over a live mix, this reads as a quiet, indistinct
"blip" rather than a sharp, cut-through click — the user described wanting
something closer to a ping-pong ball bouncing off a table: short, percussive,
audible over a full band mix. There is also no way to change it — one fixed
timbre for every user and every song.

## What Changes

- Replace the metronome click's synthesis with a punchier, more percussive
  default (shorter, tighter envelope; a touch of filtered-noise transient
  for the "knock" character) so it cuts through a mix instead of sounding
  like a soft beep.
- Add a small set of selectable click sound presets (e.g. **Ping Pong**,
  **Wood Block**, **Rim Click**, **Beep** — see design.md for the exact
  synthesis of each) so the user can pick the one that sits best in their
  mix.
- The choice is a global preference (not per-song, per `add-song-trim-
  points`/`add-song-count-in` — the physical click sound isn't something
  that varies song to song) and persists across app restarts.
- The same preset applies everywhere a click is heard: the live in-playback
  metronome, the recording count-in, and (per `add-song-count-in`, once
  merged) the playback count-in — all of these already funnel through the
  one `playClick` function, so switching its synthesis covers all of them
  from a single change.
- The exported "mix with metronome click track" (`export:mix`'s
  `options.bpm` path, via `generateClickTrackWavAsync` in `handlers.ts`)
  gets its own equivalent synthesis update so an exported file's click
  matches what the user hears live, instead of keeping its separate,
  unrelated tone generator.

## Capabilities

### New Capabilities
- `metronome-click-sound`: A selectable, persisted click timbre used
  everywhere the app plays a metronome click (live playback, recording
  count-in, exported click tracks).

### Modified Capabilities
(none — `openspec/specs/` has no existing capabilities yet)

## Impact

- `src/renderer/src/hooks/useMetronome.ts`: `playClick`'s synthesis becomes
  preset-driven instead of one hardcoded oscillator.
- New lightweight preference storage (renderer `localStorage` — see
  design.md for why) for the selected preset; no existing settings
  mechanism to extend, since the app persists no global preferences today.
- `src/main/ipc/handlers.ts`: `generateClickTrackWavAsync`'s raw-PCM
  synthesis updated to match the selected preset's character; `export:mix`
  gains the preset choice as part of its existing `options` parameter.
- UI: a small preset picker near the existing metronome volume control in
  `MasterPanel.tsx`.
- No changes to BPM/beat-grid detection, scheduling logic
  (`scheduleConstantTempo`/`scheduleFromGrid`), or any other metronome
  timing behavior — only the sound each scheduled click produces changes.
