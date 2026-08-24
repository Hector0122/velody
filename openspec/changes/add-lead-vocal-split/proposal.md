## Why

The user asked whether Velody could separate the lead vocal from backing
vocals/harmonies (and, separately, split multiple simultaneous guitars —
out of scope, see below), using Moises as a reference since it advertises
this. Investigated and confirmed with the user: Moises' "lead vs. backing
vocal" separation isn't a generically more powerful model than Demucs — it's
a much *narrower*, specialized model trained specifically on that one
sub-problem, using a large proprietary dataset of isolated lead/backing
vocal multitracks that doesn't exist in the open-source world. No
comparable pretrained open-source checkpoint for this exists today
(confirmed via search — general vocal/accompaniment separators like
Spleeter exist, and drum-specific sub-separation models like `drumsep`
exist, but nothing for lead-vs-backing vocal specifically).

What *is* available, and doesn't need any ML model at all, is the standard
mixing-engineer technique of **Mid/Side (center-channel) extraction**:
commercial mixes conventionally place the lead vocal dead-center and
backing vocals/harmonies further out (lower volume, more reverb, wider
pan) — a Mid/Side decomposition (`Mid = (L+R)/2`, `Side = (L-R)/2`)
exploits exactly that convention. Applied not to the raw mix but to
Demucs's *already-isolated* `vocals` stem (instruments already stripped
out), this is a plain FFmpeg filter — no new Python/ML dependency, reusing
tooling the app already spawns for trim/export.

This is explicitly a **best-effort, experimental** feature, not a
guaranteed clean separation like Moises': quality depends entirely on how
the original recording was mixed. It works reasonably when backing vocals
are genuinely off-center; it does close to nothing useful on a mix where
everything (lead and backing) is centered/mono, which is a real and common
case. The user asked for this specifically, understanding that trade-off
(the alternative — no lead/backing split at all — was also considered and
rejected by the user in favor of trying this).

Multiple simultaneous guitars (a separate case raised in the same
discussion) has no equivalent extraction trick — there's no "guitars are
conventionally mixed one on top of the other" convention to exploit — and
remains explicitly out of scope, no known viable approach.

## What Changes

- New **per-song, on-demand** action on the `vocals` stem: "Split Lead /
  Backing Vocal (experimental)". Not run automatically during separation —
  it's opt-in, since it may produce a useless result for a given song and
  shouldn't add processing time or stem-list clutter by default.
- New IPC handler runs FFmpeg's `pan` filter on the song's existing
  `vocals.wav`, writing two new mono files into the same stem directory:
  `vocals_lead.wav` (Mid = `0.5*c0+0.5*c1`) and `vocals_backing.wav`
  (Side = `0.5*c0-0.5*c1`).
- These become two ordinary new stems in the player — no changes needed to
  the existing song-scan stem filter, since both filenames already start
  with `vocals` (same prefix-match rule that already includes the base
  `vocals.wav`). Full mute/volume/pan controls apply to them exactly like
  any other stem, with no special-casing needed there.
- New stem-metadata entries (label + color) for `vocals_lead` ("Lead
  Vocal") and `vocals_backing` ("Backing Vocal"), visually distinguished as
  a derived pair (e.g. shared hue, different shade) from the primary six
  stem colors.
- The original `vocals` stem is untouched and still fully available — the
  split is additive. If the split sounds bad for a given song (the common
  failure mode: mostly-silent `vocals_backing` because that song's vocals
  are mixed dead-center throughout), the user can just delete the two
  derived stems and keep using the original `vocals` stem as before.
- Deletable the same way recorded-over stems are today — generalizes the
  existing recording-only delete path (`handleDeleteRecording` /
  `window.api.deleteFile`) into a shared "derived stem" concept covering
  both recordings and vocal splits, rather than duplicating that cleanup
  logic.
- A short inline note next to the split button explains the technique and
  its main failure mode in plain terms, so the "(experimental)" label
  isn't the only signal of what to expect.

## Capabilities

### New Capabilities
- `lead-vocal-split`: On-demand, per-song Mid/Side extraction of the
  `vocals` stem into a lead-vocal-candidate and a backing-vocal-candidate
  stem, using the recording's existing stereo mix conventions rather than
  a trained model.

## Impact

- `src/main/ipc/handlers.ts`: new `song:splitLeadVocal` handler; pure
  helper for the FFmpeg `pan` filter args (matches `trimInputArgs`/
  `trimOutputArgs`'s existing exported-pure-function pattern for direct
  unit testing).
- `src/preload/index.ts`, `src/shared/types.ts`: new `splitLeadVocal` API
  method on the `VelodyAPI` contract.
- `src/renderer/src/components/StemPlayer.tsx`: new `vocals_lead`/
  `vocals_backing` `STEM_META` entries; new split button + inline
  explanatory note on the `vocals` stem row; wires the new stems into the
  existing `stems` state on success (same refresh path a completed
  separation job already uses).
- `src/renderer/src/hooks/useAudioContextEngine.ts`: generalizes
  `handleDeleteRecording`'s cleanup into a shared "derived stem" delete
  path reused by both recordings and vocal-split stems.
- No changes to `scanSongsLibrary`'s stem filter, Python worker, or the
  separation job pipeline — this is a post-processing step on an
  already-separated stem, not a new separation model.
