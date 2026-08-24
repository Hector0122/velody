## Why

Today the sidebar only offers one flat, alphabetically-sorted list of every
song in the library (`recentSongs` from `listSongs()`). With a real library
of 100+ songs, there's no way to prepare a specific show's order ahead of
time — the user has to hunt through the full library (helped by
`add-song-list-search`, but still one lookup per song) for every song in the
set, in the middle of performing. There's no concept of "these N songs, in
this order, for this show" that can be prepared once and reused.

## What Changes

- Add **setlists**: named, ordered groups of songs from the library. A
  setlist references songs by name — it doesn't duplicate or move any song
  data, it's purely an ordered list of references.
- Create, rename, and delete setlists. Add a song to a setlist (from the
  library), remove a song from a setlist, and reorder songs within a
  setlist via move-up/move-down controls (no drag-and-drop in this
  proposal — see design.md).
- A new "Setlists" section in the sidebar, alongside the existing "Recent
  Songs" library view — selecting a setlist shows just its songs, in the
  set order, instead of the full alphabetical library.
- While a setlist is active, a "Next song" control advances directly to the
  next song in that setlist's order, so the user doesn't have to return to
  the sidebar and search/scroll between every song during a show.
- Setlists persist across app restarts (new `output/setlists.json`, sibling
  to the existing `output/stems/` directory) — prepared once before a show,
  still there on show day, matching the same rationale already established
  for `add-song-trim-points` and `add-song-count-in`.
- Deleting a song from the library removes it from any setlists that
  reference it (no dangling references); deleting a setlist never deletes
  the songs it references.

## Capabilities

### New Capabilities
- `song-setlists`: Named, ordered, persisted groups of songs used to prepare
  and run through a live show's set order.

### Modified Capabilities
(none — `openspec/specs/` has no existing capabilities yet)

## Impact

- `src/main/ipc/handlers.ts`: new `setlists:list`, `setlists:save`,
  `setlists:delete` handlers reading/writing `output/setlists.json`; the
  existing `song:delete` handler additionally prunes the deleted song from
  any setlist that references it.
- `src/shared/types.ts`, `src/preload/index.d.ts`: new `Setlist` type and
  `VelodyAPI` methods (`listSetlists`, `saveSetlist`, `deleteSetlist`).
- `src/renderer/src/pages/Home.tsx`: sidebar gains a Setlists section/view
  alongside the library list; song selection can come from either view.
- `src/renderer/src/components/StemPlayer.tsx` / `MasterPanel.tsx`: a "Next
  song" control appears when the currently playing song came from an active
  setlist.
- No changes to `python-worker/`, stem separation, or any per-song `.velody`
  sidecar data — setlists are a new, separate top-level file.
