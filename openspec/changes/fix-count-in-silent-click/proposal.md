## Why

Confirmed live: the playback count-in (`add-song-count-in`) played no click
at all — the on-screen countdown ran, but the drummer, who wasn't watching
the screen and relied entirely on hearing the click, got nothing.

Root cause, found by reading the code: `playClick` (`useMetronome.ts`)
always reads `useMetronome`'s own **private** `AudioContext` ref — one
that's only ever created inside that hook's own `useEffect`, and only when
`metronomeOn && masterPlaying` are both already true. `useCountIn` (and,
before it, `useRecording`'s original inline count-in loop) was instead
given a *different* AudioContext ref — `useAudioContextEngine`'s, the
stem-playback engine's own context — to check/create before scheduling
clicks. Ensuring that unrelated context did nothing for `playClick`, which
kept reading its own still-`null` private ref and silently no-opped
(`if (!ctx) return`) on every single scheduled click. Since a fresh song's
metronome toggle is off by default, the playback count-in's AudioContext
was *never* created before this fix, on every use.

This also explains a related point raised while testing: the count-in
"appeared" tied to the metronome's on/off toggle — in practice, count-in
only ever made sound if the metronome had happened to already be switched
on (which is what actually created the shared-by-accident context). They
were never intentionally coupled in the design; this was the bug making
them look that way.

## What Changes

- `useMetronome` exposes its context-creation function as
  `ensureAudioCtx(): AudioContext | null` (renamed from the previously
  private `getAudioCtx`) instead of keeping it internal.
- `useCountIn` takes `ensureAudioCtx` (a function) instead of an
  `AudioContext` ref, and calls it itself at the start of `start()` —
  guaranteeing the *correct*, `playClick`-compatible context exists before
  scheduling any clicks, regardless of whether the metronome toggle has
  ever been on.
- `useRecording`'s pre-roll count-in gets the same fix, and its own
  duplicate inline "create an AudioContext" logic is removed in favor of
  calling `ensureAudioCtx` (mirrors `add-song-count-in`'s own count-in path
  now, instead of drifting from it).
- StemPlayer's playback-count-in wrapper
  (`handleToggleMasterPlayWithCountIn`) drops its own now-redundant/wrong
  manual AudioContext creation (it was poking
  `useAudioContextEngine`'s `audioCtxRef`, which was never what `playClick`
  reads either).
- Confirmed independent, as designed: the count-in (per-song
  `playbackCountInBars`) and the in-song metronome click (`metronomeOn`)
  remain two separate settings — this fix removes the *accidental* runtime
  dependency the bug created, it doesn't add or remove any actual coupling
  between the two.

## Capabilities

(none — `add-song-count-in`'s existing requirement already correctly states
clicks SHALL play before playback begins; this fix corrects the
*implementation*, which was violating that already-correct requirement, not
the requirement itself. Same reasoning `add-song-count-in`'s own proposal
used for its accent-timing fix. `skip_specs: true` set in `.openspec.yaml`.)

## Impact

- `src/renderer/src/hooks/useMetronome.ts`: `getAudioCtx` renamed to
  `ensureAudioCtx` and added to the hook's return value.
- `src/renderer/src/hooks/useCountIn.ts`: takes an `ensureAudioCtx`
  function instead of an `AudioContext` ref.
- `src/renderer/src/hooks/useRecording.ts`: `audioCtxRef` param replaced
  with `ensureAudioCtx`; removed its own duplicate context-creation code.
- `src/renderer/src/components/StemPlayer.tsx`: passes
  `useMetronome`'s `ensureAudioCtx` into both `useCountIn` and
  `useRecording`; removed its own incorrect manual AudioContext handling
  for the playback count-in.
- No IPC, persistence, or UI changes — this is a pure runtime wiring fix.
