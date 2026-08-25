## 1. Data model and pure logic

- [x] 1.1 Add `livePresets.ts`: `LivePreset` type (id, name, active,
      stemVolumes, stemPannings, metronomeOn, masterVolume, updatedAt) and
      pure `upsertLivePreset`/`removeLivePreset`/`renameLivePreset`
      functions.
- [x] 1.2 `upsertLivePreset`: creates a new preset when no existing one
      shares the given name; updates the existing one in place (same id)
      when one does.

## 2. Persistence hook

- [x] 2.1 Add `useLivePresets.ts`: loads `livePresets`/
      `lastAppliedLivePresetId` from the song's `.velody` sidecar on song
      change (guarded so it only loads once per song).
- [x] 2.2 Auto-applies the preset matching `lastAppliedLivePresetId` (if
      any) on load — calls every relevant setter (active, stemVolumes,
      stemPannings, metronomeOn, masterVolume).
- [x] 2.3 `handleSavePreset`/`handleApplyPreset`/`handleDeletePreset`/
      `handleRenamePreset`, each persisting via `saveMeta` (shallow-merges
      `livePresets` + `lastAppliedLivePresetId` into the existing
      `.velody` file).
- [x] 2.4 Mirrors current live values into a ref (`liveRef`) so
      `handleSavePreset` always captures the latest snapshot without
      needing every value in its own dependency array.

## 3. UI

- [x] 3.1 Add `LivePresetBar.tsx`: preset dropdown (applies on select),
      delete button for the active preset, name input + Save button.
- [x] 3.2 Wire into `StemPlayer.tsx`'s song header, next to the existing
      "Next Song" control.

## 4. Tests

- [x] 4.1 `livePresets.test.ts`: `upsertLivePreset` create vs. update-in-
      place (including that other presets are untouched); `removeLivePreset`;
      `renameLivePreset`.
- [x] 4.2 `useLivePresets.test.ts`: no cache → empty/no auto-apply; cache
      with presets but no `lastAppliedLivePresetId` → loaded but not
      applied; auto-applies the matching preset on load; gracefully does
      not apply (or crash) when `lastAppliedLivePresetId` points at a
      deleted preset; `handleSavePreset` captures the *current* (not
      stale/initial) live values; `handleApplyPreset` calls every setter
      and persists as the new last-used; `handleDeletePreset` clears
      `activePresetId` when deleting the active one.

## 5. Manual verification

- [ ] 5.1 Run `pnpm dev`, configure a song's mix (mute some stems, turn on
      the metronome, adjust master volume), save it as a preset, close and
      reopen the song — confirm it's already configured with zero clicks.
- [ ] 5.2 Save a second preset under a different name, switch between the
      two via the dropdown, confirm both mid-playback and while stopped.
- [ ] 5.3 Re-save an existing preset's name after changing the mix,
      confirm it updates in place (no duplicate appears in the dropdown).
- [ ] 5.4 Delete the currently active preset, reopen the song, confirm it
      no longer auto-applies anything.

## 6. Follow-up: UX gaps found on first live use

Three issues surfaced immediately after shipping, all in `LivePresetBar.tsx`
only — no data/hook changes needed for any of them.

- [x] 6.1 **"No los puedo actualizar" (can't update a saved preset).**
      `upsertLivePreset` already updated in place when saved under an
      existing name, but the only way to trigger that was re-typing the
      exact name into an always-blank text field — nobody found it. Added
      a dedicated "Update" button, shown whenever a preset is selected,
      that calls `onSave(activePreset.name)` directly — no typing needed.
      The name field + button are now explicitly "Save current mix as
      new..." / "Save New".
- [x] 6.2 **"Le di en la x y perdi mi preset" (accidental delete).** A
      single click on "×" deleted immediately. First click now only arms a
      "Confirm?" state (button turns red, reverts on its own after 4s if
      not clicked again); an actual delete needs a second, deliberate
      click on the same button.
- [x] 6.3 **"Quiero que el botón haga algo... para que el usuario se dé
      cuenta que le dio clic" (Update/Save New gave no feedback).** Both
      buttons now flash "✓ Saved" (green) for ~1.2s after a click, so a
      click that seemingly "did nothing" visibly confirms it registered.
