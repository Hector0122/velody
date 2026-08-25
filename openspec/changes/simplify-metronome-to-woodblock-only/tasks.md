## 1. Louder, persistent click volume

- [x] 1.1 Switch `metroVolume` in `useMetronome.ts` from `useState` to
      `useLocalStoragePreference`, default raised to `0.85`.
- [x] 1.2 Boost Wood Block's gain multipliers in `clickPresets.ts` from
      `0.5`/`0.35` to `0.95`/`0.75` (accent/non-accent).
- [x] 1.3 Match the same gain boost in the main process's
      `clickSampleValue` (export click-track rendering).

## 2. Remove the other three click sounds

- [x] 2.1 Remove `pingpong`, `rimclick`, `beep` from `clickPresets.ts`
      (and their now-unused shared noise-burst helpers); narrow
      `ClickPreset` to `'woodblock'`.
- [x] 2.2 Delete `useClickPreset.ts` and its test; remove
      `clickPreset`/`setClickPreset` from `useMetronome`'s return value;
      `playClick` calls `CLICK_PRESETS.woodblock` directly.
- [x] 2.3 Remove the click-sound picker UI block from `MasterPanel.tsx`
      and its props; update `StemPlayer.tsx` to stop
      destructuring/passing `clickPreset`/`setClickPreset`, passing the
      literal `'woodblock'` to `useExportState` instead.
- [x] 2.4 Narrow `ClickTrackPreset` in `handlers.ts` (and the
      `clickPreset` option type in `shared/types.ts`/`preload/index.ts`)
      to `'woodblock'`; simplify `clickSampleValue` to Wood Block's math
      only; drop the now-unused preset parameter from
      `generateClickTrackWavAsync`.

## 3. Collapse the Record section

- [x] 3.1 In `MasterPanel.tsx`, wrap the Record section's controls
      (monitor volume, WAV/MP3, count-in bars) in a local
      open/closed `useState`, closed by default, toggled by a header
      button.

## 4. Tests

- [x] 4.1 Update `useMetronome.test.ts`'s oscillator stub to support
      `setValueAtTime`/`exponentialRampToValueAtTime` (Wood Block's sweep
      API, not a plain `.value` assignment); rewrite accent/non-accent
      assertions to check the swept start frequency (900/650) instead of
      a fixed value (was 1600/900, the removed 'beep' preset's numbers);
      remove the now-unneeded `localStorage` preset-forcing in both
      `beforeEach` blocks.
- [x] 4.2 Rewrite `clickPresets.test.ts` to cover Wood Block only,
      including a regression test for the boosted gain multipliers.
- [x] 4.3 Rewrite `clickSampleValue.test.ts` to cover Wood Block only,
      including a regression test for the boosted gain envelope.
- [x] 4.4 Delete `useClickPreset.test.ts`.

## 5. Manual verification

- [ ] 5.1 Run `pnpm dev`, confirm the metronome click is audibly louder
      than before at the same volume slider position.
- [ ] 5.2 Restart the app and confirm the metronome volume setting
      persisted (previously always reset to 50%).
- [ ] 5.3 Confirm no click-sound picker appears anywhere in the UI, and
      the click always sounds like Wood Block.
- [ ] 5.4 Confirm the Record section in the sidebar starts collapsed and
      expands/collapses correctly, with all its controls (monitor volume,
      format, count-in bars) still functional once open.
- [ ] 5.5 Export a mix with "include metronome click" enabled and confirm
      the baked-in click is also audibly louder than before.

## 6. Follow-up: still reported too quiet after raising raw gain (5.1)

Live-tested after task 5.1: the volume default/persistence fix confirmed
working, but the click still didn't feel loud/present enough even with the
volume slider maxed — 0.95/0.75 was already close to the safe headroom
ceiling (destination clips above ~1.0), so more raw gain wasn't a viable
lever. Root cause: a sustained triangle-wave tone doesn't cut through a
live band mix the way a sharp transient does, regardless of peak
amplitude — human hearing weighs a transient's perceived loudness well
above a sustained tone's at the same level.

- [x] 6.1 Re-added a short (5ms) filtered-noise burst (`playNoiseBurst`,
      matching the removed `pingpong`/`rimclick` presets' technique) layered
      on top of woodblock's tone in `clickPresets.ts`, giving it a
      percussive attack transient.
- [x] 6.2 Rebalanced the gain budget between tone and noise rather than
      just adding the noise on top of the existing 0.95/0.75 (which would
      have risked clipping): tone dropped to 0.7/0.55, noise burst added at
      0.3/0.2 — combined accent peak lands at exactly 1.0 (full scale, not
      past it) even at full volume.
- [x] 6.3 Mirrored the same tone/noise rebalance in the main process's
      `clickSampleValue` (export click-track rendering) so an exported
      mix's baked-in click still matches what's heard live.
- [x] 6.4 Updated `clickPresets.test.ts`/`clickSampleValue.test.ts` for the
      new gain values and the noise burst (new tests for its presence,
      randomness, and the window it's confined to); extended
      `useMetronome.test.ts`'s `FakeAudioContext` stubs with
      `createBuffer`/`createBufferSource`/`createBiquadFilter` (woodblock
      now calls these, which the scheduling-focused stubs didn't
      previously need).

- [ ] 6.5 Manual verification: confirm the click now has an audible
      "punch"/attack that cuts through a full band mix, not just a louder
      tone.
