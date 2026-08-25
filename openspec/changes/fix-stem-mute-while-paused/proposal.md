## Why

Reported: "por que no puedo poner pausa a stems cuando la canción o el
master está en pausa?" (why can't I mute stems while the song/master is
paused?). Reading `toggleStem` (`useAudioContextEngine.ts`) found the
cause: while `masterPlaying` is false, the mute button special-cased into
completely different (and buggy) behavior instead of a plain toggle:

- Clicking an **already-active** stem's mute button did nothing at all — a
  silent early `return`.
- Clicking a **muted** stem's mute button auto-started full playback with
  *only that stem* active — silently discarding every other stem's mute
  state in the process (`setActive({ [key]: true })`, a full replace, not
  a merge).

This directly undermines the "set up the mix before pressing Play" workflow
`add-live-presets` (built the same day, after this was reported) depends
on — a preset is only as useful as the mute toggling used to configure and
verify it.

## What Changes

- `toggleStem` now always does exactly one thing, regardless of transport
  state: flip that stem's own `active` entry. No more auto-starting
  playback, no more early-return no-op.
- Muting/un-muting while paused/stopped no longer needs a live audio
  source to "apply" to — there isn't one while paused anyway (`stopSources`
  already tore every source down). The new `active` state is simply what
  `startSources`/`toggleMasterPlay` reads the next time playback actually
  starts, the same way a DAW's mixer lets you set mutes before pressing
  play.

## Capabilities

(none — corrects a bug in the existing mute-toggle behavior, doesn't
change what muting is supposed to do. `skip_specs: true` set in
`.openspec.yaml`.)

## Impact

- `src/renderer/src/hooks/useAudioContextEngine.ts`: `toggleStem`
  simplified from a `masterPlayingRef`-branching function (with the
  buggy paused-state special case) to a single-line `setActive` toggle.
- `src/renderer/src/__tests__/useAudioContextEngine.test.ts`: existing
  test for "starts a live source even for a stem that begins inactive"
  updated to reflect the corrected flow (toggle mute while paused, *then*
  press Play — rather than expecting a single `toggleStem` call to also
  start playback); new regression tests for the reported bug (mute toggles
  without starting playback; un-muting one stem doesn't disturb others;
  toggling an already-active stem off actually works).
