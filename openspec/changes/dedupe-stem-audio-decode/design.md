## Context

See proposal.md - Why. `useAudioContextEngine.decodeStems()` already does
`fetch(url)` → `ctx.decodeAudioData(buf)` per stem into `buffersRef.current[key]`
(an `AudioBuffer`). Separately, `useWaveSurfers.ensureWaveSurfer()` calls
`WaveSurfer.create(...)` then `ws.load(url)`, and the master waveform effect does
the same for the first stem's URL. WaveSurfer 7.x's `load(url, channelData?, duration?)`
already supports skipping its internal `fetchBlob` + decode when `channelData` (an
array of `Float32Array`/`number[]`, one per channel) and `duration` are supplied —
confirmed by reading `node_modules/wavesurfer.js/dist/wavesurfer.js`: `loadAudio()`
only calls `Fetcher.fetchBlob` and `Decoder.decode` `if (!blob && !channelData)`.
It still calls `setSrc(url, blob)` to give its underlying media element a URL (needed
for its internal playback capability, which this app doesn't use since waveforms are
`interact: false` for stems and only used as a visual + scrub surface for the master),
but that's a cheap `<audio>.src` assignment, not a JS-side full decode.

## Goals / Non-Goals

**Goals:**
- Each stem's audio file is fetched and decoded exactly once per song load.
- No visible change to waveform rendering or playback behavior.
- Keep the two hooks' responsibilities clean: `useAudioContextEngine` remains the
  owner of decoding; `useWaveSurfers` becomes a consumer of decoded data rather than
  an independent decoder.

**Non-Goals:**
- Changing how the master waveform picks its source stem (still the first stem's URL).
- Removing WaveSurfer's own internal peak-computation/downsampling logic — we still
  hand it full channel data and let it compute peaks itself, only removing the fetch
  and `decodeAudioData` step.
- Touching `audio-server.ts` or any main-process/IPC code.

## Decisions

- **Pass `AudioBuffer.getChannelData(i)` arrays + `AudioBuffer.duration` into
  `ws.load(url, channelData, duration)`**, rather than switching WaveSurfer to a
  precomputed-peaks-only mode (`peaks` option at `create()` time). Reasoning: passing
  full channel data (not downsampled peaks) keeps WaveSurfer's own peak/rendering
  logic and visual output unchanged (satisfies "visually... unaffected" requirement)
  with a minimal diff, whereas hand-rolling peak extraction would risk visually
  different waveforms and is unnecessary since the expensive part being removed is
  the fetch + decode, not WaveSurfer's peak computation.
- **`useAudioContextEngine` exposes decoded buffers via a ref + a "stem decoded" signal
  (callback or version counter)**, not by lifting `buffersRef` state into `StemPlayer`.
  `buffersRef` is already a ref (not React state) by design, updated outside the React
  render cycle as stems finish decoding asynchronously; `useWaveSurfers` needs a way to
  know *when* a given stem's buffer becomes available (decoding is async and can finish
  after `ensureWaveSurfer(key)` is first called, e.g. via `toggleStem`/`toggleMasterPlay`
  which call `ensureWaveSurfer` synchronously before waiting on `decodeStems`). Pass a
  `getDecodedBuffer: (key: string) => AudioBuffer | undefined` accessor plus reuse the
  existing `decodeStems` completion (already an `await Promise.all` inside a `useEffect`)
  to trigger a re-check for any stem whose `ensureWaveSurfer` ran before its buffer was
  ready.
- **Ordering**: `useWaveSurfers` is currently instantiated before
  `useAudioContextEngine` in `StemPlayer.tsx` (it produces `ensureWaveSurfer`, consumed
  by the engine hook). Since the engine hook now needs to *feed* the waveform hook
  instead of only consuming from it, `StemPlayer.tsx` needs a small restructure: keep
  `useWaveSurfers`'s `ensureWaveSurfer` signature as-is (still called by the engine to
  lazily create a WaveSurfer instance on stem activation), but have `ensureWaveSurfer`
  read from a decoded-buffers ref/accessor passed in from the engine — same dependency
  direction as today (`useAudioContextEngine` still depends on `ensureWaveSurfer`), just
  with an additional accessor threaded the other way via a shared ref created in
  `StemPlayer.tsx` and passed into both hooks (avoids a circular hook dependency, mirrors
  the existing `seekRef` pattern already used to break a similar cycle).

## Risks / Trade-offs

- [WaveSurfer's `setSrc(url, undefined)` still assigns the file URL to its internal
  media element, which could trigger a browser-native preload of the file even though
  we skip the JS decode] → Acceptable: this is a lightweight native resource reference,
  not a JS fetch+decode; can be further minimized later by setting `media: undefined`/
  a muted placeholder if WaveSurfer's API allows disabling the media element entirely
  for non-interactive stem waveforms, but that's a separate, smaller follow-up and not
  required to achieve the dedup goal.
- [Race between `ensureWaveSurfer(key)` being called (e.g. on `toggleStem`) before that
  stem's buffer has finished decoding] → Mitigated by the accessor + re-check approach
  above: if the buffer isn't ready yet, `ensureWaveSurfer` creates the WaveSurfer
  instance without loading audio into it yet, and a `decodeStems` completion effect
  loads any pending stem's audio into its already-created WaveSurfer instance once the
  buffer becomes available.
- [Multi-channel handling: `getChannelData` returns per-channel `Float32Array`s tied to
  the `AudioBuffer`'s internal buffer; passing them directly into WaveSurfer should be
  safe (read-only consumption) but must not mutate them] → No mutation needed on our
  side; WaveSurfer only reads channel data to compute peaks.

## Migration Plan

No data migration; renderer-only change. Ship behind normal code review — since this
touches the hot "open a song" path, verify manually (see tasks.md) with a multi-stem
song before merging. Rollback is a plain revert of the two hooks + `StemPlayer.tsx`
wiring change.
