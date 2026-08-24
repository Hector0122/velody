## 1. Backend: FFmpeg Mid/Side split

- [ ] 1.1 In `src/main/ipc/handlers.ts`, add an exported pure function
      building the FFmpeg filter args for the split (mirrors
      `trimInputArgs`/`trimOutputArgs`'s pattern): input `vocals.wav`,
      `-filter_complex "[0:a]pan=mono|c0=0.5*c0+0.5*c1[lead];[0:a]pan=mono|
      c0=0.5*c0-0.5*c1[backing]"`, mapped to two mono output files.
- [ ] 1.2 Add the `song:splitLeadVocal` IPC handler: takes a song name,
      locates `vocals.wav` in that song's stem directory (return an error
      if it doesn't exist — e.g. separation hasn't produced a `vocals`
      stem for this song), spawns FFmpeg with the args from 1.1, writes
      `vocals_lead.wav` and `vocals_backing.wav` into the same directory
      (overwriting any previous split), returns success + the two new
      paths.
- [ ] 1.3 Add `splitLeadVocal` to the `VelodyAPI` contract
      (`src/preload/index.ts`, `src/shared/types.ts`) and the
      `contextBridge` surface.

## 2. Stem metadata and player wiring

- [ ] 2.1 Add `vocals_lead` ("Lead Vocal") and `vocals_backing` ("Backing
      Vocal") entries to `STEM_META` in `StemPlayer.tsx`, visually paired
      (shared hue, distinguishable shade) rather than reusing an existing
      stem color.
- [ ] 2.2 Add a "Split Lead / Backing Vocal (experimental)" action on the
      `vocals` stem row (only shown when a `vocals` stem exists), calling
      the new IPC and, on success, adding the two new paths into the
      existing `stems` state the same way a completed separation job's
      stems are applied — so the new stems appear immediately without a
      full song reload.
- [ ] 2.3 Add a short inline note near the action explaining the
      technique in plain terms and its main failure mode (works best when
      backing vocals are mixed off-center; may do little or nothing if the
      song's vocals are centered throughout).
- [ ] 2.4 Re-running the action on a song that already has split stems
      overwrites them in place (same fixed filenames/keys) rather than
      creating duplicates — confirm the `stems` state update in 2.2
      replaces rather than appends when the keys already exist.

## 3. Deletion

- [ ] 3.1 In `useAudioContextEngine.ts`, generalize
      `handleDeleteRecording`'s cleanup (stop source, disconnect gain/pan
      nodes, drop decoded buffer, destroy waveform, update `active`, call
      `window.api.deleteFile`) into a shared derived-stem delete path
      usable for both recordings and split-vocal stems, avoiding
      duplicated cleanup logic.
- [ ] 3.2 Wire a delete action for `vocals_lead`/`vocals_backing` stems in
      `StemPlayer.tsx`, reusing 3.1's shared path.

## 4. Tests

- [ ] 4.1 Unit test the pure FFmpeg-args function from 1.1: correct
      `pan` filter expressions and correct input/output file arguments.
- [ ] 4.2 Test the IPC handler: missing `vocals.wav` returns an error
      without spawning FFmpeg; a successful run's return value includes
      both new file paths.
- [ ] 4.3 Test that `stemNameFromPath` on `vocals_lead.wav`/
      `vocals_backing.wav` yields the expected distinct keys (regression
      guard — this is what lets the existing stem-scan filter and
      renderer stem-list logic pick these up with no special-casing).
- [ ] 4.4 Test the generalized derived-stem delete path (3.1) cleans up
      both a recording-originated stem and a split-vocal-originated stem
      correctly.

## 5. Manual verification

- [ ] 5.1 Run `pnpm dev` on a song with prominent, off-center backing
      vocals (e.g. wide-panned harmonies); trigger the split; confirm
      `vocals_lead` sounds like the lead performance and `vocals_backing`
      captures the harmonies, both independently mutable.
- [ ] 5.2 Run it on a song with vocals mixed dead-center; confirm the
      expected failure mode (near-silent or unhelpful `vocals_backing`)
      and that the original `vocals` stem is unaffected.
- [ ] 5.3 Delete the split stems and confirm the original `vocals` stem
      still plays normally with no leftover state issues.
- [ ] 5.4 Re-run the split on the same song and confirm it replaces the
      previous result rather than adding duplicate stems.
