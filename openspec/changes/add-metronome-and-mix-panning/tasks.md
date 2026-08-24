## 1. Preference storage

- [ ] 1.1 Add (or extend, if `add-metronome-click-sounds` already added
      one) a small `localStorage`-backed preferences helper, and read/write
      `metroPan` and `masterPan` (both default `0`) through it.

## 2. Metronome pan

- [ ] 2.1 In `useMetronome.ts`, create a persistent `StereoPannerNode` once
      alongside the metronome's `AudioContext` (in `getAudioCtx`, or lazily
      on first `playClick`), connected between the per-click gain nodes and
      `ctx.destination`.
- [ ] 2.2 Update `playClick` to connect each click's `gain` node to the
      persistent pan node instead of directly to `ctx.destination`.
- [ ] 2.3 Add a `metroPan` state + ref (mirroring `metroVolume`'s existing
      pattern) and apply it to the pan node's `.pan.value` whenever it
      changes.
- [ ] 2.4 Export `metroPan`/`setMetroPan` from `useMetronome`'s return
      value.

## 3. Master mix pan

- [ ] 3.1 In `useAudioContextEngine.ts`'s `ensureCtx`, create a
      `masterPanNode` (`ctx.createStereoPanner()`) and rewire
      `masterGainRef.current.connect(...)` to go through it:
      `masterGainRef -> masterPanNode -> ctx.destination`.
- [ ] 3.2 Add a `masterPan` state + ref and an effect (mirroring the
      existing per-stem-panning effect) that applies it to
      `masterPanNode.pan.value` whenever it changes.
- [ ] 3.3 Export `masterPan`/`setMasterPan` (or an equivalent handler,
      matching `handleStemPanning`'s naming style) from
      `useAudioContextEngine`'s return value.

## 4. UI

- [ ] 4.1 Add two pan sliders (Metronome Pan, Mix Pan) to `MasterPanel.tsx`
      near the existing volume controls, range -1..1, defaulting to 0,
      styled consistently with the existing volume sliders.
- [ ] 4.2 Add a brief inline hint near the two sliders explaining the
      intended use ("click on L, mix on R — plug a separate speaker/monitor
      into each of your interface's L/R jacks") so the feature's purpose is
      clear without external
      documentation.

## 5. Tests

- [ ] 5.1 Add a test confirming the metronome pan node's value updates
      when `setMetroPan` is called, and defaults to 0.
- [ ] 5.2 Add a test confirming the master pan node's value updates when
      the master pan handler is called, and that per-stem pan nodes remain
      connected to `masterGainRef` unchanged (i.e. the new node is inserted
      after the master gain stage, not replacing the per-stem chain).
- [ ] 5.3 Add a test for the `localStorage` preferences helper: default
      values when unset, round-trip persistence.

## 6. Manual verification

- [ ] 6.1 Run `pnpm dev`, set the metronome pan hard left and the mix pan
      hard right, and confirm (via headphones or a stereo meter) the click
      is isolated to the left channel and the stem mix to the right.
- [ ] 6.2 Confirm per-stem pan settings still work as relative positioning
      within the panned mix.
- [ ] 6.3 Restart the app and confirm both pan settings persisted.
- [ ] 6.4 Confirm leaving both at center (default) sounds identical to
      before this change.
