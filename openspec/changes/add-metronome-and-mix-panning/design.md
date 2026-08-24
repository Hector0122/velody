## Context

See proposal.md — Why. Confirmed with the user: their hardware is a
Focusrite Solo, whose monitor outputs are one stereo pair — separate L and
R jacks, but a single L/R channel pair, not multiple independent output
pairs. That's exactly what a stereo channel split targets (plug one speaker
into L, another into R), so no splitter cable or multi-device routing is
needed — this directly decides the scope below. Relevant existing pieces,
established by direct code reading (not assumption):

- **Two entirely independent `AudioContext`s already exist and both already
  mix down to the same system default output simultaneously**:
  `useAudioContextEngine.ts` owns one (`masterGainRef -> ctx.destination`,
  all stem sources), `useMetronome.ts` owns its own separate one
  (`playClick`'s `osc -> gain -> ctx.destination`). Nothing merges them —
  they're just two independent Web Audio graphs both rendering to the OS's
  current default output device, which is exactly how they already combine
  into one stereo signal today. This proposal doesn't need to change that
  relationship at all — it only needs to insert a pan stage into each
  graph's own existing path to `destination`.
- **Per-stem panning precedent**: `handleStemPanning` (`useAudioContextEngine.ts`)
  already does `gain.connect(pan); pan.connect(masterGainRef.current)` per
  stem, with `pan.pan.value` driven by `stemPannings[key] ?? 0`. This is the
  exact technique (a `StereoPannerNode` inserted into an existing chain)
  this proposal reuses for both the metronome and the master bus.
- **`playClick` currently connects straight to destination**: `osc.connect(gain);
  gain.connect(ctx.destination)`, recreated fresh on every single click call
  (a new `OscillatorNode`/`GainNode` per click, per the existing comment
  trail — clicks are short-lived, this is intentional and unrelated to
  panning).
- **`ensureCtx` (`useAudioContextEngine.ts`) is the one place the master
  chain is built**: `masterGainRef.current = ctx.createGain();
  masterGainRef.current.connect(ctx.destination)` — a single line to
  extend with an intermediate pan node.
- No output-device selection exists anywhere in this codebase today (no
  `enumerateDevices()`/`setSinkId()` usage) — multi-device routing would be
  entirely new surface, not an extension of anything already there.

## Goals / Non-Goals

**Goals:**
- Let the metronome click and the rest of the mix be routed to opposite
  stereo channels, so the interface's existing separate L/R monitor jacks
  become two independent physical feeds (click-only to the drummer, mix to
  everyone else) just by plugging a different speaker/monitor into each
  jack — the concrete setup the user described and confirmed hardware for.
- Keep it a global, hardware-tied preference (like the click sound preset),
  set once and not per-song, so it doesn't need reconfiguring every show.
- Don't touch per-stem panning's existing behavior — it should keep working
  exactly as it does today, just within whatever the master pan now places
  the overall mix at.

**Non-Goals:**
- Routing audio to two separate physical output *devices* (e.g. via
  `AudioContext`'s `setSinkId()`/`HTMLMediaElement.setSinkId()` and
  `navigator.mediaDevices.enumerateDevices()`). The user's confirmed
  hardware (Focusrite Solo, single stereo output) doesn't need this — a
  channel split on the one existing output covers their actual setup. This
  would also be a materially bigger feature (device enumeration/selection
  UI, handling devices connecting/disconnecting, uncertain Electron/Chromium
  `setSinkId` support to verify) that isn't justified for hardware the user
  doesn't have. Worth revisiting only if a future user's setup genuinely
  has multiple independent output pairs.
- Per-song pan values. Like the click sound preset, this is about the
  user's cable/hardware routing, which doesn't change per song.
- Any change to how per-stem panning works or is stored (`stemPannings`).
  The master pan is a separate, additional stage after per-stem panning has
  already been applied, not a replacement for it.
- A one-click "hard split" preset button. Two plain sliders (metronome pan,
  mix pan), each defaulting to center, are enough to set up "click hard
  left, mix hard right" once; not worth a dedicated preset control for a
  setting the user configures once per hardware setup, not per show.

## Decisions

- **Master pan is a new stage in the existing chain, not a replacement for
  per-stem panning**: `masterGainRef -> masterPanNode -> ctx.destination`,
  inserted once in `ensureCtx`. Every stem's existing per-stem pan value
  still applies *before* this stage, so e.g. a stem panned slightly left
  within the mix stays slightly left-of-center within wherever the master
  pan places the whole mix — additive, not conflicting.
- **Metronome pan is a persistent `StereoPannerNode` on the metronome's
  `AudioContext`, created once (alongside `getAudioCtx`) and reused across
  clicks**, rather than created fresh per click like the oscillator/gain
  nodes are — panning doesn't need to be recreated per click the way the
  short-lived envelope nodes do; a single persistent pan node just has its
  `.pan.value` read from a ref each time `playClick` connects through it.
- **Both values persist via `localStorage`, following exactly the pattern
  proposed in `add-metronome-click-sounds`** for the click preset — same
  rationale (first/second/third global, non-per-song, hardware-tied
  preferences; still not enough surface to justify a new settings-file/IPC
  mechanism). If both proposals ship, they can share one small
  `localStorage`-backed preferences module instead of each inventing their
  own read/write boilerplate.
- **Pan range is the standard Web Audio `-1` (left) to `1` (right)**,
  matching `stemPannings`' existing convention exactly — no new value
  scale to learn or convert between.

## Risks / Trade-offs

- [A user monitoring through a single speaker/headphone plugged into only
  one of the two jacks (or a mono source) could end up missing audio
  entirely if it's on the unwired channel] → Out of this proposal's control
  (it's a cabling/monitoring question), but worth a short in-app hint near
  the pan sliders explaining the intended "click on L, mix on R — plug a
  separate speaker into each interface jack" use case so the feature's
  purpose is clear from the UI itself.
- [Hard-panning the whole mix to one channel means anyone listening to the
  interface's output in normal stereo (e.g. headphones plugged into the
  interface's single stereo headphone jack, not two separate speakers on
  L/R) hears an unbalanced mix while these are set] → Accepted; this is an
  inherent trade-off of the channel-split technique itself, not something
  the software can hide, and only applies while the user has actually set a
  non-center split (defaults to center/unaffected otherwise).

## Migration Plan

No migration needed. No stored preference defaults both pans to `0`
(center) — identical to today's behavior — until the user explicitly sets
them.
