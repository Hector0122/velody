## 1. Fix the reset

- [x] 1.1 In `useAudioContextEngine.ts`'s `toggleMasterPlay`, change the
      start-from-stopped branch's `active` rebuild from unconditionally
      setting every stem to `true`, to merging: keep every existing key in
      `activeRef.current` as-is, and only default a stem to `true` when it
      has no key in `activeRef.current` yet (`key in activeRef.current`
      check, not just falsy — a stem explicitly muted to `false` must stay
      `false`, not be treated as "missing").
- [x] 1.2 Confirm `ensureWaveSurfer(key)` still runs for every stem
      regardless of active state (waveform creation is unrelated to mute
      state and must be unaffected by this change).
- [x] 1.3 Double check `toggleStem`'s existing merge behavior is unchanged
      (it already does the right thing) and that both start paths now
      agree on the same "default only if untouched" semantics.

## 2. Tests

- [x] 2.1 Add/extend a test for `toggleMasterPlay` covering: first-ever
      start activates all stems (unchanged behavior); starting after a
      stem was muted preserves that mute; starting after a stem was
      explicitly re-activated preserves that too; a stem with no prior
      entry (e.g. newly added) defaults to active alongside existing
      explicit state on other stems.

## 3. Manual verification

- [ ] 3.1 Run `pnpm dev`, play a song, mute a couple of stems, press Stop,
      press Play again, and confirm the muted stems are still muted.
- [ ] 3.2 Repeat using Restart instead of Stop/Play.
- [ ] 3.3 Confirm a brand-new song (or a song opened for the first time
      this session) still starts with every stem active, unchanged from
      today.
