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
