## Context

See proposal.md — Why. Relevant existing pieces, established by direct code
reading (not assumption):

- `playClick(accent, scheduledTime)` (`useMetronome.ts`) is the **single**
  click-synthesis function in the renderer: `createOscillator()` (triangle,
  1600Hz/900Hz) → `createGain()` with an exponential decay from
  `vol * (accent ? 0.5 : 0.35)` to `0.001` over 60ms → `ctx.destination`.
  It's called from three places today: the live scheduler
  (`scheduleConstantTempo`/`scheduleFromGrid`), and `useRecording.ts`'s
  count-in loop. `add-song-count-in` (a separate proposal) adds a fourth
  call site (playback-start count-in) — all four go through this one
  function, so changing its body is the only renderer-side change needed to
  affect every click the user hears live.
- `generateClickTrackWavAsync` (`handlers.ts`) is a **second, independent**
  implementation in the main process: hand-written 16-bit PCM synthesis
  (no Web Audio API available outside a renderer), used only when exporting
  a mix with `options.bpm` set. It computes, per-sample, a short
  (1–2ms) decaying sine burst at the same 1600/900Hz frequencies. It does
  not share any code with `playClick` today and must be updated separately
  for the exported click to match.
- No noise-generation, filtering (`BiquadFilterNode`), or `AudioBuffer`-based
  one-shot playback exists anywhere in the renderer yet — the metronome is
  the first place that would use them if a preset uses a noise transient.
- The app persists no global (non-per-song) user preference anywhere today
  — `metroVolume`, `metronomeOn`, `countInBars` are all plain `useState`,
  reset every launch. `grep`'d confirmed: no `localStorage` usage exists in
  the renderer at all currently.

## Goals / Non-Goals

**Goals:**
- A default click that's clearly more percussive/audible over a full band
  mix than today's soft 60ms triangle blip, with no configuration required
  — most users (including this one, until now) never touch a metronome
  sound setting and just want the default to be good.
- A small, curated set of alternatives (not a full library) so the user can
  pick what cuts through their specific setup, without turning this into an
  open-ended sound-design feature.
- One choice that consistently applies everywhere a click plays — the user
  shouldn't get a different-sounding click when recording vs. performing
  live vs. listening to an exported reference track.

**Non-Goals:**
- Custom/user-uploaded click sample files. Every existing audio-generation
  path in this app (BPM click track, recording pre-roll, the metronome
  itself) is synthesized, not sample-based; introducing file-based samples
  would add asset management (bundling, packaging, format validation) this
  proposal has no reason to take on when synthesis can already produce a
  convincing percussive click.
- Per-song click sound overrides. The click's timbre is a personal/hardware
  preference (what cuts through *this* PA, *this* in-ear mix), not a
  property of any individual song — global, like the proposal states.
- Changing click *volume* behavior, the metronome on/off toggle, or any
  scheduling/timing logic. Only the waveform each click produces changes.

## Decisions

- **Four presets, all pure Web Audio synthesis (no samples):**
  - **Ping Pong** (new default): a fast pitch-down sweep (accent
    2000→1200Hz, regular 1400→900Hz over ~12ms, via
    `osc.frequency.exponentialRampToValueAtTime`) on a `sine` oscillator,
    envelope decaying to silence over ~18ms (versus today's 60ms) — the
    short decay and downward sweep is what reads as a hard, small-object
    "knock" rather than a tone. Layered with a ~4ms burst of white noise
    through a `BiquadFilterNode` (`bandpass`, ~2.5kHz center) at low gain,
    for the transient "impact" click a pure tone can't produce on its own.
  - **Wood Block**: similar structure to Ping Pong but centered lower
    (accent 900→500Hz, regular 650→400Hz) and slightly longer decay
    (~30ms) with a `triangle` oscillator — a rounder, lower knock.
  - **Rim Click**: no tonal oscillator at all — just the filtered-noise
    burst (bandpass ~3.5kHz, ~6ms), for a dry, sharp stick-click that sits
    high in a mix without adding pitch content.
  - **Beep** (closest to today's sound, kept for anyone who prefers it):
    today's triangle-oscillator/60ms-decay implementation, unchanged,
    demoted from default to one of the options.
  - All four share one function signature —
    `(ctx, accent, scheduledTime, volume) => void` — selected by a
    `ClickPreset` id, so `playClick` becomes a small dispatch over this set
    rather than one hardcoded body.
- **New default is Ping Pong, not a config flag the user has to discover.**
  The current default is exactly what prompted this proposal; there's no
  reason to ship an improved sound behind an opt-in nobody asked for. Users
  who preferred the old sound can select "Beep" (identical to today).
- **Persist the choice in `localStorage`, not a new IPC/settings-file
  layer.** This is the first global (non-per-song) preference the app has
  ever needed to persist. Building a general settings-file/IPC mechanism
  for exactly one field would be more new surface than the feature
  justifies (`AGENTS.md`'s stated philosophy: "Evitar overengineering").
  `localStorage` is standard, available in the renderer with zero
  main-process changes, and exactly fits a lightweight UI preference like
  this. If a second global preference shows up later, that's the point to
  reconsider a shared mechanism — not preemptively now for one value.
- **Export's click track (`generateClickTrackWavAsync`) gets matching, but
  independently implemented, per-sample synthesis for the same four
  presets** — expressed as raw sample-generation math (no Web Audio API in
  the main process), mirroring each preset's frequency sweep/decay/noise
  characteristics as closely as hand-written PCM synthesis allows. The
  renderer passes its currently-selected preset id through `export:mix`'s
  existing `options` parameter (extended from `{ bpm?: number }` to
  `{ bpm?: number; clickPreset?: ClickPreset }`), defaulting to "Ping Pong"
  if omitted (an older renderer build or a caller that never set a
  preference).

## Risks / Trade-offs

- [Duplicated synthesis logic between the renderer's Web-Audio-based
  presets and the main process's raw-PCM presets could drift out of sync
  if a preset's parameters are tuned later] → Accepted and called out
  explicitly, same trade-off class already accepted in
  `add-batch-import-cli-script`'s design.md for a different duplication;
  the parameter sets (frequencies, decay times, noise band) are small and
  documented in this file, making a mismatch easy to spot and fix.
- [A noise-burst layer (new technique for this codebase) could sound harsh
  or clip if gain-staged wrong] → Mitigated by keeping the noise layer at a
  deliberately low mix level relative to the tonal component and gating its
  implementation behind manual listening tests (tasks.md) before treating
  any preset as final — this is inherently a "tune by ear" task, not one
  fully specifiable in a design doc.
- [Changing the live default click sound changes muscle memory for a user
  who already learned the old one] → Accepted per the Why — the old sound
  is the reported problem; "Beep" preset keeps the old behavior available
  for anyone who wants it back.

## Migration Plan

No migration needed. No stored preference (fresh install, or before this
change ships) defaults to the new "Ping Pong" preset. Nothing to roll back
beyond selecting the "Beep" preset to restore today's exact sound.
