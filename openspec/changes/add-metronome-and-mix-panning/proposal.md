## Why

The user runs a Focusrite Solo: one stereo pair of monitor outputs (L and R
are two separate physical jacks, meant to each drive one speaker as a
stereo pair), plus a headphone out — not multiple independent output pairs.
Live, the metronome click gets buried in the full band mix, but the
drummer is the one who actually needs to hear it clearly. Because the L and
R monitor outputs are already two separate physical jacks, the standard
"click track" solution needs no extra hardware: pan the click hard to one
channel and the rest of the mix hard to the other, then plug one speaker
into the L jack (click only) and another into the R jack (mix only).
Today neither the metronome nor the overall mix can be panned as a whole —
`handleStemPanning` only pans individual stems one at a time, and the
metronome (`playClick`, `useMetronome.ts`'s own independent `AudioContext`)
has no pan control at all, always centered.

## What Changes

- Add an independent **pan control for the metronome click**, separate from
  per-stem panning, defaulting to center (unchanged from today) — the
  metronome runs on its own `AudioContext` already, so this is a small,
  self-contained addition there.
- Add a **master mix pan control** that pans the entire combined stem
  output (after per-stem volume/pan/mute, at the master bus) — today's
  `masterGainRef -> destination` chain gains a pan stage. Per-stem panning
  keeps working as relative positioning within wherever the master pan
  places the overall mix.
- Together, this lets the user set the click hard left and the mix hard
  right (or any split they want); with the click on the interface's L
  output and the mix on R, plugging a different speaker/monitor into each
  jack gives the drummer a click-only feed and everyone else a click-free
  mix — using the Focusrite Solo's existing L/R monitor jacks directly, no
  splitter cable or extra hardware needed.
- Both pan values are a global preference (not per-song — this is about the
  user's cabling/hardware setup, not any particular song), persisted the
  same way as the click sound preset (`add-metronome-click-sounds`, if
  merged) — via `localStorage`, so it's set once and doesn't need
  reconfiguring every show.
- True multi-device output routing (sending audio to two separate physical
  *devices*, e.g. two different USB interfaces or independently selectable
  soundcards) is explicitly out of scope — see design.md. This proposal
  only needs a stereo channel split, which is what the user's actual
  two-jack setup calls for.

## Capabilities

### New Capabilities
- `metronome-mix-panning`: Independent stereo pan control for the metronome
  click and for the overall mix, enabling a single stereo output to be
  split into a click feed and a mix feed via external cabling.

### Modified Capabilities
(none — `openspec/specs/` has no existing capabilities yet)

## Impact

- `src/renderer/src/hooks/useMetronome.ts`: `playClick` gains a pan stage
  (`StereoPannerNode`) driven by a new `metroPan` state/ref.
- `src/renderer/src/hooks/useAudioContextEngine.ts`: `ensureCtx` gains a
  `StereoPannerNode` between `masterGainRef` and `ctx.destination`, driven
  by a new `masterPan` state/ref.
- UI: two pan sliders (Metronome Pan, Mix Pan) in `MasterPanel.tsx`, near
  the existing volume controls.
- New `localStorage`-backed persistence for both values, following the same
  pattern as `add-metronome-click-sounds`'s click preset (no new
  IPC/settings-file layer for two more lightweight, hardware-tied
  preferences).
- No changes to per-stem panning (`handleStemPanning`, `stemPannings`),
  export, or IPC.
