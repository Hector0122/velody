## Why

Feedback after further live use, three related requests:

1. The metronome click is still too quiet, even after `add-metronome-click-
   sounds` — the reported feel is "suena despacio," and it doesn't cut
   through a full band. Reading the code found the real cause: `metroVolume`
   was a plain `useState(0.5)`, never persisted — every app restart silently
   reset it back to 50%, so any louder setting the user found never stuck.
   On top of that, the presets' own gain multipliers (0.5/0.35 for
   woodblock) left a lot of headroom unused.
2. Of the four click sounds `add-metronome-click-sounds` added (Ping Pong,
   Wood Block, Rim Click, Beep), only Wood Block is wanted — the user asked
   to make it the fixed default and drop the other three entirely ("no me
   interesa tenerlos").
3. The right sidebar (`MasterPanel`) has grown across several recent
   features (trim, count-in, click sounds, panning, setlists tab) and now
   feels like it's taking more space than it needs. The "Record" section
   (monitor volume, WAV/MP3 format, recording count-in bars) was picked as
   the one to relocate — it's settings for an action that already lives on
   each stem card (the record button), not something that needs to be
   visible at a glance the way the transport/BPM/metronome controls do.

## What Changes

- **Click volume**: `metroVolume` now persists via `localStorage` (same
  pattern as `metroPan`/`masterPan`), default raised from `0.5` to `0.85`
  so a fresh install/cleared storage also starts loud. Wood Block's own
  gain multipliers raised from `0.5`/`0.35` (accent/non-accent) to
  `0.95`/`0.75` — near the top of the available headroom without risking
  hard clipping when the volume slider itself is also maxed. The
  main-process export click-track renderer (`clickSampleValue`, used when
  baking a click into an exported mix) gets the identical gain bump, so an
  exported file's click matches what's heard live.
- **Click sound**: Wood Block is now the only click sound — Ping Pong, Rim
  Click, and Beep (and their synthesis code, in both the renderer's Web
  Audio implementation and the main process's raw-PCM export equivalent)
  are removed, not just hidden. The now-pointless preset-picker UI is
  removed from the sidebar. The whole selectable-preset mechanism
  (`useClickPreset`, `clickPreset`/`setClickPreset` on `useMetronome`) is
  removed along with it — `playClick` always uses Wood Block.
- **Sidebar space**: the "Record" section in `MasterPanel` becomes a
  collapsible disclosure, closed by default — one line ("▶ Record") until
  clicked open, instead of always showing monitor volume / WAV-MP3 /
  count-in controls. Purely local UI state, not persisted (no need to
  remember open/closed across sessions). All other sidebar sections are
  unchanged.

## Capabilities

(none — this narrows an existing preference (click sound selection) back
down to a fixed value and adjusts existing volume/UI behavior; it doesn't
add or change a user-facing capability contract. `skip_specs: true` set in
`.openspec.yaml`.)

## Impact

- `src/renderer/src/hooks/clickPresets.ts`: `pingpong`/`rimclick`/`beep`
  and their shared noise-burst helpers removed; `ClickPreset` narrowed to
  `'woodblock'`; gain multipliers boosted.
- `src/renderer/src/hooks/useClickPreset.ts`: deleted (no longer needed).
- `src/renderer/src/hooks/useMetronome.ts`: `clickPreset`/`setClickPreset`
  removed from the hook's return value; `metroVolume` switched from
  `useState` to `useLocalStoragePreference` with a higher default;
  `playClick` calls `CLICK_PRESETS.woodblock` directly.
- `src/renderer/src/components/MasterPanel.tsx`: click-sound picker UI
  removed; Record section becomes a collapsible disclosure (local
  `useState`).
- `src/renderer/src/components/StemPlayer.tsx`: stops destructuring/passing
  `clickPreset`/`setClickPreset`; passes the literal `'woodblock'` to
  `useExportState` (which still accepts a `clickPreset` field for forward
  compatibility with the export IPC's options shape).
- `src/main/ipc/handlers.ts`: `ClickTrackPreset` narrowed to `'woodblock'`;
  `clickSampleValue` simplified to Wood Block's math only, gain boosted to
  match; `generateClickTrackWavAsync` drops its now-unused preset
  parameter.
- `src/shared/types.ts`, `src/preload/index.ts`: `clickPreset` option type
  narrowed to `'woodblock'`.
- Tests updated across `useMetronome.test.ts` (stub extended to support
  Wood Block's frequency sweep, assertions rewritten to check swept
  start-frequency instead of a fixed `.value`), `clickPresets.test.ts` and
  `clickSampleValue.test.ts` (trimmed to Wood Block only, plus new gain
  regression coverage), `useClickPreset.test.ts` deleted.

## Follow-up (see tasks.md — section 6)

Live-tested and still reported too quiet/dull even with the volume fix in
place and the slider maxed — raw gain (0.95/0.75) was already near the
safe headroom ceiling, so the real fix was giving the click a percussive
attack transient (a brief noise burst, matching the removed presets'
technique) rather than more raw tone volume, which a sustained tone can't
buy no matter how loud. Tone/noise gain rebalanced (0.7/0.55 tone,
0.3/0.2 noise) so the combined peak still stays at/under full scale.
