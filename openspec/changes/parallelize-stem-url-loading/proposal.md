## Why

`useAudioContextEngine` resolves each stem's playable URL from its file path with a
sequential `for...of` loop of `await window.api.getAudioUrl(stem)` IPC calls, one stem
at a time. For a typical 6-stem song this means 6 sequential renderer↔main IPC
round-trips before any stem URL is known, which gates the start of audio fetch/decode
(and, once `dedupe-stem-audio-decode` lands, waveform rendering too) — every stem
waits on every earlier stem's IPC round-trip finishing first, for no reason: the calls
are fully independent.

## What Changes

- Resolve all stem URLs concurrently with `Promise.all` instead of sequentially
  awaiting `getAudioUrl` in a loop, so total URL-resolution time is bounded by the
  slowest single IPC call rather than the sum of all of them.
- No change to the `getAudioUrl` IPC contract itself, the URLs produced, or any
  downstream consumer of `urls` — this only changes how the results are gathered.

## Capabilities

### New Capabilities
- `stem-url-resolution`: How the app resolves playable URLs for a song's stem files
  before playback/decoding can begin.

### Modified Capabilities
(none — `openspec/specs/` has no existing capabilities yet)

## Impact

- `src/renderer/src/hooks/useAudioContextEngine.ts`: the URL-loading `useEffect`
  (currently a `for` loop calling `window.api.getAudioUrl` sequentially).
- No IPC (`src/preload/index.ts`, `src/main/index.ts`'s `audio:url` handler) or
  main-process changes.
