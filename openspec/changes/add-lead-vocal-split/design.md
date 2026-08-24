## Context

See proposal.md — Why. Researched during this conversation (web search,
not assumption): no open-source pretrained model exists for lead-vs-backing
vocal separation specifically (Spleeter/Demucs-family models separate by
instrument *class*, not by instance within a class; `drumsep` is the closest
analog but is for drums, a different sub-problem with its own specialized
training data). The standard, well-documented mixing/mastering technique
that *is* freely available is Mid/Side (center-channel) decomposition:
`Mid = (L+R)/2` isolates content panned to the stereo center, `Side =
(L-R)/2` isolates content that differs between channels (anything panned
off-center). Commercial mixes conventionally place the lead vocal centered
and backing vocals/harmonies off-center (lower level, more reverb, wider
pan) — this is the exploitable convention, not a learned/trained one.

Confirmed by direct code reading:

- `scanSongsLibrary`'s stem filter (`src/main/ipc/handlers.ts`) is
  `STEM_NAMES.some((s) => f.startsWith(s))` — a new file named
  `vocals_lead.wav` or `vocals_backing.wav` already matches the `vocals`
  prefix, so no filter change is needed for the new files to be picked up
  as stems for a song.
- `stemNameFromPath` (`src/renderer/src/utils.ts`) derives a stem's key by
  stripping the directory and extension only, keeping the full basename —
  so those two filenames become the distinct keys `vocals_lead` and
  `vocals_backing` automatically, with no collision with the original
  `vocals` key.
- `STEM_META` (`StemPlayer.tsx`) falls back to `{ color: '#6b7280', label:
  key }` for any key it doesn't recognize — functional but generic; this
  proposal adds real entries for the two new keys.
- The FFmpeg spawn pattern used for trim/export
  (`trimInputArgs`/`trimOutputArgs` in `handlers.ts`) is the existing
  precedent to follow for spawning FFmpeg with specific filter args from
  the main process — no new subprocess-handling pattern needed.
- `handleDeleteRecording` (`useAudioContextEngine.ts`) already does
  everything a stem removal needs (stop the source, disconnect gain/pan
  nodes, drop the decoded buffer, destroy the WaveSurfer instance, update
  `active`, call `window.api.deleteFile(path)`) — `window.api.deleteFile`
  itself is already a generic "delete this file" IPC call, not
  recording-specific; only the surrounding React state array
  (`recordedStems`) is recording-specific.

## Goals / Non-Goals

**Goals:**
- Give the user a way to try isolating the lead vocal from backing
  vocals/harmonies, using only tooling already in the app (FFmpeg), with no
  new ML model or Python dependency.
- Make the experimental nature and main failure mode obvious in the UI
  itself, not just in a changelog — the user (and any bandmate who opens
  the app) should understand up front that this won't always work.
- Keep the original `vocals` stem fully intact and usable regardless of
  whether the split is run or how it turns out.

**Non-Goals:**
- A trained/ML-based lead-vs-backing separation model. No open dataset
  exists to train one, and building/licensing one is a research project in
  its own right, not something to attempt here.
- Separating more than two "voices" (e.g. distinguishing three-part
  harmony into three separate stems). Mid/Side gives exactly two outputs
  (center vs. everything-off-center); it has no notion of *how many*
  off-center sources exist, only that they're not centered.
- Multiple-guitar separation, or any other same-instrument-class instance
  separation. Raised in the same discussion as this proposal, but there's
  no equivalent mixing convention to exploit (guitars aren't conventionally
  centered vs. off-center the way lead/backing vocals are), so there's no
  comparably cheap technique available. Not pursued here.
- Automatic/always-on splitting during initial separation. Opt-in only —
  see proposal.md.

## Decisions

- **Mid/Side extraction runs on the already-separated `vocals` stem, not
  the raw song mix.** Demucs has already stripped instruments out, so the
  Mid/Side split only has to distinguish center vs. off-center *vocal*
  content, not fight against a full band mix at the same time — a
  meaningfully easier and cleaner version of the technique than running it
  on the original recording.
- **Output is mono for both derived stems**, not stereo-with-silence-in-one-
  channel. A mono `AudioBufferSourceNode` through the existing per-stem
  `StereoPannerNode` (default pan `0`) already plays centered in the mix
  identically to a "fake stereo" file with the same content duplicated to
  both channels — no reason to double the file size for an identical
  audible result, and it keeps the FFmpeg filter graph simpler
  (`pan=mono|c0=...` directly, one output channel).
- **On-demand per song, not automatic.** A song whose vocals are mixed
  dead-center will produce a near-silent, useless `vocals_backing` stem;
  running this unconditionally on every separation would silently clutter
  every song's stem list with two extra, often-useless entries. An
  explicit button keeps it opt-in and makes the "this might not work well"
  framing natural (the user chooses to try it, rather than discovering two
  new stems appeared on their own).
- **Additive, not destructive.** The original `vocals` stem is never
  modified or removed by running the split — this is a low-risk way to let
  the user experiment freely; a bad result costs nothing but two small
  files, easily deleted.
- **Re-running overwrites the previous split's two files** (same fixed
  filenames) rather than versioning them — matches the existing
  "record over a stem" precedent (`useRecording`), which also just
  overwrites rather than accumulating versions. No use case here needs
  keeping an old split around once you've tried again.
- **Deletion reuses `handleDeleteRecording`'s cleanup, generalized.** Rather
  than write a second near-identical "stop source, disconnect nodes, drop
  buffer, destroy waveform, delete file" function, the existing one is
  generalized to accept any derived-stem path (recording or vocal split)
  and the state array it should filter out of becomes a parameter (or the
  two derived-stem-tracking arrays — `recordedStems` and a new
  `splitVocalStems` — are merged into one concept). Exact shape decided
  during implementation; the constraint is no duplicated cleanup logic.

## Risks / Trade-offs

- [Vocals mixed dead-center throughout (common — many genres/production
  styles don't pan backing vocals wide) produce a near-silent, useless
  `vocals_backing` and a `vocals_lead` that's nearly identical to the
  original `vocals` stem] → Accepted and expected; this is the core,
  unavoidable limitation of a heuristic vs. a trained model, called out
  explicitly in the UI copy so it isn't a surprise. The original `vocals`
  stem stays available as the reliable fallback.
- [A song where backing vocals happen to be centered but the lead vocal has
  a wide stereo effect (chorus/doubler) could invert the expected result —
  `vocals_lead` picks up mostly the effect's off-center smear, not the dry
  lead] → Accepted; inherent to any convention-based heuristic. Not
  detectable in advance without analyzing the specific mix, so not solved
  here — same "try it and see" framing applies.
- [Adding two more mutable/soloable stems per song increases the stem list
  length, which the user already asked to make scrollable/searchable
  earlier this session] → Low risk — this only happens for songs where the
  user explicitly opts in, and `add-song-list-search`/`fix-song-list-scroll`
  already address list-length UX generally.

## Migration Plan

No migration needed. No existing songs are affected until the user
explicitly runs the split on a given song; nothing changes for songs that
never use this feature.
