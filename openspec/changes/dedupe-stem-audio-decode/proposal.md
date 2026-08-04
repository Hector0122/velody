## Why

When a song is opened, each stem's audio is fully decoded twice on the renderer side:
once by `useAudioContextEngine`'s `decodeStems()` (fetches the stem URL and runs
`AudioContext.decodeAudioData` to build the playback buffer) and once independently by
each stem's `WaveSurfer` instance in `useWaveSurfers` (`ws.load(url)` triggers its own
fetch + internal audio decode to compute waveform peaks). For a typical 6-stem song
this means 12 full fetches and 12 full PCM decodes of what is really 6 audio files —
doubling network transfer from the local audio server, doubling CPU decode time, and
doubling the in-memory PCM footprint held at once (Demucs stems are uncompressed WAV).
This duplication is the largest concrete cost in the "open a song" path today.

## What Changes

- Have `useWaveSurfers` reuse the already-decoded `AudioBuffer` from
  `useAudioContextEngine` to render waveform peaks instead of independently fetching
  and decoding each stem's audio a second time (WaveSurfer supports being handed
  pre-decoded audio data / precomputed peaks rather than only a URL to load).
- Sequence stem loading so the single decode happens once per stem and both the
  playback engine and the waveform renderer consume that one result.
- No change to what the user sees or hears — waveforms and playback stay pixel- and
  sample-identical; this is purely removing redundant work.

## Capabilities

### New Capabilities
- `stem-waveform-rendering`: How stem waveforms are computed and displayed from
  already-loaded audio data, without re-fetching or re-decoding audio the playback
  engine has already decoded.

### Modified Capabilities
(none — `openspec/specs/` has no existing capabilities yet)

## Impact

- `src/renderer/src/hooks/useAudioContextEngine.ts`: `decodeStems()` becomes the single
  source of decoded `AudioBuffer`s, needs to expose them (or a "decoded" signal) to
  `useWaveSurfers`.
- `src/renderer/src/hooks/useWaveSurfers.ts`: `ensureWaveSurfer()` and the master
  waveform effect must stop calling `ws.load(url)` for the per-stem waveforms and
  instead pass in already-decoded data.
- `src/renderer/src/components/StemPlayer.tsx`: wiring between the two hooks (order of
  calls / shared state) may need adjustment since `useWaveSurfers` currently has no
  dependency on `useAudioContextEngine`'s internal buffers.
- No IPC or main-process changes; no change to `audio-server.ts` streaming behavior.
