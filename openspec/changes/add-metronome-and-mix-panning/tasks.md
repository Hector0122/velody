## 1. Preference storage

- [x] 1.1 Add (or extend, if `add-metronome-click-sounds` already added
      one) a small `localStorage`-backed preferences helper, and read/write
      `metroPan` and `masterPan` (both default `0`) through it. Reused
      `useLocalStoragePreference` as planned.

## 2. Metronome pan

- [x] 2.1 In `useMetronome.ts`, create a persistent `StereoPannerNode` once
      alongside the metronome's `AudioContext` (in `getAudioCtx`, or lazily
      on first `playClick`), connected between the per-click gain nodes and
      `ctx.destination`. **Note:** created in `getAudioCtx` as planned, but
      wiring it "between the per-click gain nodes and ctx.destination"
      required extending `clickPresets.ts`'s `ClickFn`/preset signatures
      with a `destination: AudioNode` parameter (each preset's tone/noise
      gain now connects to whatever `destination` it's given, instead of a
      hardcoded `ctx.destination`) — a small, deliberate extension beyond
      what `add-metronome-click-sounds` shipped, needed so the pan node can
      sit downstream of every preset's own graph without duplicating each
      preset's synthesis.
- [x] 2.2 Update `playClick` to connect each click's `gain` node to the
      persistent pan node instead of directly to `ctx.destination`.
      (Achieved via the `destination` param above — `playClick` passes
      `panNodeRef.current ?? ctx.destination`.)
- [x] 2.3 Add a `metroPan` state + ref (mirroring `metroVolume`'s existing
      pattern) and apply it to the pan node's `.pan.value` whenever it
      changes.
- [x] 2.4 Export `metroPan`/`setMetroPan` from `useMetronome`'s return
      value.

## 3. Master mix pan

- [x] 3.1 In `useAudioContextEngine.ts`'s `ensureCtx`, create a
      `masterPanNode` (`ctx.createStereoPanner()`) and rewire
      `masterGainRef.current.connect(...)` to go through it:
      `masterGainRef -> masterPanNode -> ctx.destination`.
- [x] 3.2 Add a `masterPan` state + ref and an effect (mirroring the
      existing per-stem-panning effect) that applies it to
      `masterPanNode.pan.value` whenever it changes.
- [x] 3.3 Export `masterPan`/`setMasterPan` (or an equivalent handler,
      matching `handleStemPanning`'s naming style) from
      `useAudioContextEngine`'s return value.

## 4. UI

- [x] 4.1 Add two pan sliders (Metronome Pan, Mix Pan) to `MasterPanel.tsx`
      near the existing volume controls, range -1..1, defaulting to 0,
      styled consistently with the existing volume sliders. Labeled "Mix
      Pan" (under Master Volume) and "Click Pan" (under Metronome Vol),
      each with a live L/C/R readout.
- [x] 4.2 Add a brief inline hint near the two sliders explaining the
      intended use ("click on L, mix on R — plug a separate speaker/monitor
      into each of your interface's L/R jacks") so the feature's purpose is
      clear without external documentation.

## 5. Tests

- [x] 5.1 Add a test confirming the metronome pan node's value updates
      when `setMetroPan` is called, and defaults to 0.
- [x] 5.2 Add a test confirming the master pan node's value updates when
      the master pan handler is called, and that per-stem pan nodes remain
      connected to `masterGainRef` unchanged (i.e. the new node is inserted
      after the master gain stage, not replacing the per-stem chain).
      Verified structurally by code (per-stem `ensureNodes` untouched) plus
      a test asserting `masterGain.connect(masterPanNode)` and
      `masterPanNode.connect(destination)`. Also extended
      `clickPresets.test.ts` to assert every preset's gain node(s) connect
      to the given `destination` (not a hardcoded `ctx.destination`), per
      task 2.1's signature change.
- [x] 5.3 Add a test for the `localStorage` preferences helper: default
      values when unset, round-trip persistence. Already covered by
      `useLocalStoragePreference.test.ts` from `add-metronome-click-sounds`
      (the helper is generic, not preset-specific); `metroPan`/`masterPan`
      each get their own default/round-trip assertions in
      `useMetronome.test.ts`/`useAudioContextEngine.test.ts`.

## 6. Manual verification

- [ ] 6.1 Run `pnpm dev`, set the metronome pan hard left and the mix pan
      hard right, and confirm (via headphones or a stereo meter) the click
      is isolated to the left channel and the stem mix to the right.
- [ ] 6.2 Confirm per-stem pan settings still work as relative positioning
      within the panned mix.
- [ ] 6.3 Restart the app and confirm both pan settings persisted.
- [ ] 6.4 Confirm leaving both at center (default) sounds identical to
      before this change.
