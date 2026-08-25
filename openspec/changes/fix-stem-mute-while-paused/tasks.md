## 1. Fix

- [x] 1.1 Simplify `toggleStem` in `useAudioContextEngine.ts` to
      unconditionally toggle `active[key]` via `setActive`, removing the
      `masterPlayingRef`-branching auto-start/no-op special case.

## 2. Tests

- [x] 2.1 Update the existing "starts a live source even for a stem that
      begins inactive" test to configure mutes via `toggleStem` while
      paused, then call `toggleMasterPlay()` separately — matching the
      corrected two-step flow.
- [x] 2.2 Add regression coverage: toggling a stem while paused updates
      `active` without starting playback (no sources created,
      `setMasterPlaying` not called).
- [x] 2.3 Add regression coverage: un-muting one stem while paused doesn't
      change any other stem's `active` entry.
- [x] 2.4 Add regression coverage: toggling an already-active stem off
      while paused actually flips it off (previously a silent no-op).

## 3. Manual verification

- [ ] 3.1 Run `pnpm dev`, pause/stop a song, mute and un-mute several
      stems, confirm every click works and other stems' states aren't
      disturbed.
- [ ] 3.2 Press Play after configuring mutes while paused and confirm the
      mix starts exactly as configured.
