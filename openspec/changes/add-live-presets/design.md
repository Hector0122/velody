## Context

See proposal.md — Why. Confirmed with the user: auto-apply the
most-recently-used preset on open (not always-neutral-requiring-a-pick),
and support multiple named presets per song rather than a single
auto-saved slot.

Relevant existing pieces, established by direct code reading:

- `.velody` is a flat JSON object per song, read/written via
  `song:loadMeta`/`song:saveMeta` (`src/main/ipc/handlers.ts`).
  `song:saveMeta` shallow-merges (`{...existing, ...meta}`) — every
  existing per-song feature (BPM/beatTimes, trim points, markers,
  playback count-in bars) already adds its own top-level key(s) to this
  same file independently, with no coordination needed between them. This
  proposal follows the identical pattern rather than inventing a new
  storage mechanism.
- `useSongAnalysis`, `useTrim`, `useSongCountIn` are the existing
  precedents for "a small hook owns one per-song `.velody`-backed
  concern" — each has its own `loadedRef`-style guard so it only loads
  once per song, and calls `saveMeta` itself on every change. This
  proposal's `useLivePresets` follows the same shape.
- `active`, `stemVolumes`, `stemPannings` (mute/volume/pan) and
  `masterVolume` are all local `useState` in `StemPlayer.tsx`, passed by
  value+setter into `useAudioContextEngine`. `metronomeOn` is state owned
  by `useMetronome`. None of these are currently persisted anywhere — they
  reset to their defaults every time a song is (re)opened, which is
  exactly the reported friction.
- `useAudioContextEngine`'s gain-updating effect (`useEffect` keyed on
  `[active, solo, stemVolumes, masterVolume, computeGain]`) already
  applies changes to `active`/`stemVolumes`/`masterVolume` via
  `gain.gain.setTargetAtTime(...)` — a smooth ramp, not a hard jump — and
  a separate effect does the same for `stemPannings`. This means simply
  calling the existing setters with a preset's saved values, even during
  active playback, already produces a smooth, click-free transition with
  zero new code — confirmed by reading these effects, not assumed.
- `fix-stem-mute-while-paused` (found and fixed the same day, before this
  proposal) was a prerequisite: the mute toggle button was broken while
  the transport was paused, which would have undermined the entire
  "configure a preset, then save it" workflow this feature depends on.

## Goals / Non-Goals

**Goals:**
- Let a song go from "just opened" to "ready to press Play, exactly as
  last configured" with zero clicks.
- Support multiple distinctly-named configurations per song.
- Reuse existing persistence (`.velody`) and existing reactive
  mute/volume/pan infrastructure — no new IPC surface, no new audio-graph
  code.

**Non-Goals:**
- Capturing BPM, trim points, playback count-in bars, or the global
  metronome volume/pan preference in a preset — see proposal.md's "What
  Changes" for why each is excluded (either already independently
  per-song persisted, or a global hardware preference, not a per-
  performance choice).
- Solo state (`solo`). Solo is a momentary "just this stem" audition tool,
  not part of a considered final live mix — including it would mean
  applying a preset could unexpectedly silence stems the user didn't mean
  to solo-lock.
- A "default"/"factory" preset concept, or presets shared across songs.
  Every preset is specific to the one song it was saved from.
- Reordering or categorizing presets beyond a flat per-song list — the
  expected count per song (a handful of performance contexts) doesn't
  justify more structure.

## Decisions

- **Saving under an existing name updates that preset in place (same id),
  rather than requiring a separate "update" action or creating a
  duplicate.** Matches how the user is likely to actually work: tweak the
  mix, hit Save with the same name again. A distinct "Save As" affordance
  for the rarer "I want a variant" case is just typing a different name —
  no extra UI needed.
- **`lastAppliedLivePresetId` is a separate top-level `.velody` field, not
  a flag on the preset itself.** Keeps "which preset is currently active"
  as a single, unambiguous pointer (matches `activeSetlistId`'s existing
  shape in `add-song-setlists`) rather than needing to guard against more
  than one preset claiming to be "the" active one.
- **Presets are pure snapshots, not live/linked state.** Saving a preset
  copies the current values; later changing the mix (without re-saving)
  does not retroactively change the preset. This is the expected,
  unsurprising behavior for a "preset" concept and needs no special
  handling — it falls out naturally from storing a plain snapshot object
  rather than a reference.
- **No confirmation dialog on delete.** Matches the low-stakes,
  easily-redone nature of a preset (unlike deleting a whole song or
  recording) — an accidental delete just means re-saving the current mix
  again, which takes one click.

## Risks / Trade-offs

- [Auto-applying the last-used preset on open means a song's mix state on
  open is no longer "always whatever it physically was rendered/exported
  with" — it can silently differ per the last preset used] → Accepted;
  this is the entire point of the feature (confirmed with the user), and
  the original, un-configured mix remains fully recoverable — nothing
  about presets deletes or overwrites the song's actual stem files.
- [A preset's stem keys can go stale if a stem is later deleted (e.g. a
  recorded-over take removed) — applying it would set an `active`/
  `stemVolumes`/`stemPannings` entry for a key that no longer exists] →
  Accepted, harmless: this already-established, pre-existing pattern
  elsewhere in the codebase (e.g. `toggleMasterPlay`'s own merge logic)
  tolerates unknown/stale keys in these maps without any special handling
  — they're simply inert, unused entries.

## Migration Plan

No migration needed. No existing `.velody` file has a `livePresets` or
`lastAppliedLivePresetId` key; `useLivePresets` treats their absence as
"no presets yet, nothing to auto-apply" — identical to today's behavior
for every song until the user explicitly saves one.
