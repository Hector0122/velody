## 1. Expose decoded buffers from the playback engine

- [x] 1.1 In `useAudioContextEngine`, expose a stable accessor (e.g. `getDecodedBuffer(key: string): AudioBuffer | undefined` reading from the existing `buffersRef`) from the hook's return value.
- [x] 1.2 Add a way for consumers to know when a new stem buffer becomes available (e.g. bump a ref-backed counter or fire a callback at the end of each per-stem decode inside `decodeStems`'s `Promise.all` map, not just at full completion).
- [x] 1.3 Confirm `decodeStems` still only decodes a given stem once (existing `if (buffersRef.current[key]) return` guard) — no behavior change here.

## 2. Consume decoded buffers in waveform rendering

- [x] 2.1 In `useWaveSurfers`, accept the new `getDecodedBuffer` accessor and decoded-signal from params.
- [x] 2.2 In `ensureWaveSurfer(key)`, after creating the `WaveSurfer` instance, check `getDecodedBuffer(key)`: if a buffer is already available, call `ws.load(url, [buffer.getChannelData(0), ...other channels], buffer.duration)` instead of `ws.load(url)`. If not yet available, create the instance without loading audio and mark it pending.
- [x] 2.3 When the decoded-signal fires for a stem that has a pending (created-but-not-loaded) WaveSurfer instance, load that stem's audio into it using the same `channelData`/`duration` path.
- [x] 2.4 Apply the same `channelData`/`duration` load path to the master waveform effect (currently `ws.load(masterUrl)`), sourced from the first stem's decoded buffer.
- [x] 2.5 Keep the existing "load a new URL when `urls[key]` changes" effect working correctly with the new load path (re-decoding is still owned by the engine; this effect should still use decoded data when available, falling back to `ws.load(url)` only if a decoded buffer genuinely isn't available for some reason).

## 3. Wire the hooks together in StemPlayer

- [x] 3.1 In `StemPlayer.tsx`, thread the new accessor/signal from `useAudioContextEngine`'s return into `useWaveSurfers`' params (adjust call order/shared refs as needed per design.md's "Ordering" decision — avoid introducing a circular hook dependency, following the existing `seekRef` pattern).
- [x] 3.2 Re-run `pnpm typecheck` to confirm the new prop wiring across both hooks and `StemPlayer.tsx` type-checks cleanly.

## 4. Tests

- [x] 4.1 Add/extend a renderer test asserting that when a stem's `AudioBuffer` is already decoded, creating its waveform does not call `fetch`/trigger a second `decodeAudioData`-equivalent path (mock `WaveSurfer.create`/`load` and assert `channelData`/`duration` args are passed instead of a bare URL).
- [x] 4.2 Add a test for the pending-buffer race: `ensureWaveSurfer(key)` called before decoding finishes still ends up with a correctly loaded waveform once decoding completes.
- [x] 4.3 Confirm existing waveform/audio-engine tests (if any) in `src/renderer/src/__tests__/` still pass.

## 5. Manual verification

- [ ] 5.1 Run `pnpm dev`, open a song with multiple stems, and confirm waveforms render correctly and playback/scrubbing/looping behave identically to before.
- [ ] 5.2 Using browser devtools network/performance panels, confirm each stem's audio file is fetched once (not twice) and `decodeAudioData`-equivalent work happens once per stem when opening a song.
- [ ] 5.3 Record over a stem and delete a recorded stem; confirm waveform cleanup still works as before.
