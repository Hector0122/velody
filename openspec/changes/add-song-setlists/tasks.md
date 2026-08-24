## 1. Backend storage

- [x] 1.1 Add a `getSetlistsPath()` helper (`join(dirname(getStemsRootDir()),
      'setlists.json')`) and a `Setlist { id: string; name: string;
      songNames: string[]; updatedAt: number }` type.
- [x] 1.2 Add `readSetlists()`/`writeSetlists()` helpers: read returns `[]`
      if the file doesn't exist or fails to parse; write serializes to a
      temp file in the same directory and renames it over the target
      (atomic write, avoids partial-write corruption). Both take the target
      path as a parameter (not read internally) so they're directly
      unit-testable against a real temp file, matching
      `scanSongsLibrary`'s own testability rationale.
- [x] 1.3 Add `ipcMain.handle('setlists:list', ...)` returning all setlists.
- [x] 1.4 Add `ipcMain.handle('setlists:save', ...)` accepting a full
      `Setlist` (new or existing `id`) and upserting it into the file
      (create if `id` not found, replace if found), bumping `updatedAt`.
- [x] 1.5 Add `ipcMain.handle('setlists:delete', ...)` accepting an `id` and
      removing that setlist from the file.
- [x] 1.6 In the existing `song:delete` handler, after the directory removal
      succeeds, load all setlists, remove the deleted song's name from each
      `songNames`, and write back only the setlists that actually changed.
      The pruning logic itself is `pruneSongFromSetlists` — a pure function
      (setlists, songName) → { pruned, changed }, extracted for direct unit
      testing rather than left inline in the handler.

## 2. Shared types / preload

- [x] 2.1 Add `Setlist` to `src/shared/types.ts` and the `VelodyAPI`
      methods `listSetlists`, `saveSetlist`, `deleteSetlist`. Also added to
      `env.d.ts`'s global type ambient declarations (matching `SongItem`'s
      existing pattern) so renderer files can reference `Setlist` without
      an explicit import.
- [x] 2.2 Wire the three methods through `src/preload/index.ts` following
      the existing `contextBridge` pattern for `listSongs`/`deleteSong`.
      `preload/index.ts` redeclares its own local `Setlist` interface
      (matching its existing convention of not importing from
      `shared/types.ts` at all — every other event/type there is
      redeclared locally too).

## 3. Sidebar UI — setlists view

- [x] 3.1 In `Home.tsx`, add a sidebar view-mode toggle ("Library" /
      "Setlists"), state for the list of setlists (loaded via
      `listSetlists()` on mount, matching `recentSongs`' load pattern), and
      the currently selected/active setlist id.
- [x] 3.2 Setlists view: list of setlist names with create/rename/delete
      controls; selecting one shows its songs (resolved against the
      already-loaded library list by name, in `songNames` order) with
      per-row remove and move-up/move-down controls. Extracted into a new
      `SetlistPanel.tsx` component (mirroring `TimelinePanel`/`MasterPanel`)
      rather than inlining into `Home.tsx`. **Deviation:** no rename
      control shipped in this pass — creating and deleting are covered;
      renaming an existing setlist can be added later without a schema
      change (`saveSetlist` already upserts by `id`).
- [x] 3.3 A way to add a library song to the active setlist (e.g. an "Add to
      setlist" action per song row in the Library view, enabled when a
      setlist is active/selected). Shows a "+" button per song row (next to
      the existing delete button) only when a setlist is active, plus a
      small banner in the Library tab naming which setlist is the current
      add-target.
- [x] 3.4 Selecting a song from the setlist view opens it exactly like
      selecting one from the library view does today (`handleSelectRecent`
      equivalent), additionally recording that it was opened "from setlist
      X at index N" for the Next-song control in section 4.

## 4. Next-song navigation

- [x] 4.1 Track, alongside `currentSong` in `Home.tsx`, which setlist (if
      any) and index the current song was opened from.
- [x] 4.2 Add a "Next song" control (in `MasterPanel.tsx` or `StemPlayer`'s
      header) shown only when that tracking is set; clicking it opens
      `songNames[index + 1]` from the active setlist the same way any song
      selection does. Placed in `StemPlayer`'s song-title header row.
- [x] 4.3 If there is no next song (end of setlist) or the next name no
      longer resolves to a library song, disable/hide the control
      accordingly (and toast on the latter case, per design.md).
      **Enhancement beyond the original plan:** rather than just disabling
      on a single missing entry, `resolveNextSetlistSong` (pure, in
      `utils.ts`) scans forward past any number of consecutive missing
      entries to find the next one that *does* resolve — "Next song" skips
      gaps instead of getting stuck on the first one, and toasts listing
      everything it skipped.

## 5. Tests

- [x] 5.1 Add tests for the setlist read/write helpers: round-trip
      save/list/delete, missing-file returns `[]`, corrupted JSON returns
      `[]` rather than throwing. `src/main/ipc/__tests__/setlists.test.ts`,
      using a real temp directory (no `fs/promises` mocking needed since
      the helpers take an explicit path).
- [x] 5.2 Add a test for `song:delete`'s pruning behavior: a deleted song's
      name is removed from every setlist that referenced it, other entries
      untouched. Covered as direct unit tests of the extracted
      `pruneSongFromSetlists`.
- [x] 5.3 Add a renderer test covering: creating a setlist, adding/removing/
      reordering songs, and Next-song advancing through the list correctly
      (including the end-of-setlist case). Reordering and next-song
      resolution are covered as unit tests of two extracted pure functions
      (`reorderSetlistSongs`, `resolveNextSetlistSong` in `utils.ts`) —
      same reasoning already documented in `add-song-list-search`'s
      tasks.md for why this repo tests extracted logic rather than
      rendering `Home.tsx`/`SetlistPanel.tsx` directly (no `.tsx` test
      support in `vitest.config.ts`, no existing component-render
      precedent). Create/add/remove are thin `window.api` + `setState`
      wiring with no extracted logic to unit test beyond what's covered;
      exercised via manual verification instead (section 6).

## 6. Manual verification

- [ ] 6.1 Run `pnpm dev`, create a setlist, add several songs from the
      library, reorder them, and confirm the order is reflected
      immediately.
- [ ] 6.2 Restart the app and confirm the setlist and its order persisted.
- [ ] 6.3 Open a song from the setlist and click "Next song" repeatedly
      through to the end; confirm it stops/disables at the last song.
- [ ] 6.4 Delete a song that's in a setlist from the library view and
      confirm it disappears from the setlist without breaking the rest of
      the order.
