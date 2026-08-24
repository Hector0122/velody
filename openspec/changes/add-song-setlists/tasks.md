## 1. Backend storage

- [ ] 1.1 Add a `getSetlistsPath()` helper (`join(dirname(getStemsRootDir()),
      'setlists.json')`) and a `Setlist { id: string; name: string;
      songNames: string[]; updatedAt: number }` type.
- [ ] 1.2 Add `readSetlists()`/`writeSetlists()` helpers: read returns `[]`
      if the file doesn't exist or fails to parse; write serializes to a
      temp file in the same directory and renames it over the target
      (atomic write, avoids partial-write corruption).
- [ ] 1.3 Add `ipcMain.handle('setlists:list', ...)` returning all setlists.
- [ ] 1.4 Add `ipcMain.handle('setlists:save', ...)` accepting a full
      `Setlist` (new or existing `id`) and upserting it into the file
      (create if `id` not found, replace if found), bumping `updatedAt`.
- [ ] 1.5 Add `ipcMain.handle('setlists:delete', ...)` accepting an `id` and
      removing that setlist from the file.
- [ ] 1.6 In the existing `song:delete` handler, after the directory removal
      succeeds, load all setlists, remove the deleted song's name from each
      `songNames`, and write back only the setlists that actually changed.

## 2. Shared types / preload

- [ ] 2.1 Add `Setlist` to `src/shared/types.ts` and the `VelodyAPI`
      methods `listSetlists`, `saveSetlist`, `deleteSetlist`.
- [ ] 2.2 Wire the three methods through `src/preload/index.ts` following
      the existing `contextBridge` pattern for `listSongs`/`deleteSong`.

## 3. Sidebar UI — setlists view

- [ ] 3.1 In `Home.tsx`, add a sidebar view-mode toggle ("Library" /
      "Setlists"), state for the list of setlists (loaded via
      `listSetlists()` on mount, matching `recentSongs`' load pattern), and
      the currently selected/active setlist id.
- [ ] 3.2 Setlists view: list of setlist names with create/rename/delete
      controls; selecting one shows its songs (resolved against the
      already-loaded library list by name, in `songNames` order) with
      per-row remove and move-up/move-down controls.
- [ ] 3.3 A way to add a library song to the active setlist (e.g. an "Add to
      setlist" action per song row in the Library view, enabled when a
      setlist is active/selected).
- [ ] 3.4 Selecting a song from the setlist view opens it exactly like
      selecting one from the library view does today (`handleSelectRecent`
      equivalent), additionally recording that it was opened "from setlist
      X at index N" for the Next-song control in section 4.

## 4. Next-song navigation

- [ ] 4.1 Track, alongside `currentSong` in `Home.tsx`, which setlist (if
      any) and index the current song was opened from.
- [ ] 4.2 Add a "Next song" control (in `MasterPanel.tsx` or `StemPlayer`'s
      header) shown only when that tracking is set; clicking it opens
      `songNames[index + 1]` from the active setlist the same way any song
      selection does.
- [ ] 4.3 If there is no next song (end of setlist) or the next name no
      longer resolves to a library song, disable/hide the control
      accordingly (and toast on the latter case, per design.md).

## 5. Tests

- [ ] 5.1 Add tests for the setlist read/write helpers: round-trip
      save/list/delete, missing-file returns `[]`, corrupted JSON returns
      `[]` rather than throwing.
- [ ] 5.2 Add a test for `song:delete`'s pruning behavior: a deleted song's
      name is removed from every setlist that referenced it, other entries
      untouched.
- [ ] 5.3 Add a renderer test covering: creating a setlist, adding/removing/
      reordering songs, and Next-song advancing through the list correctly
      (including the end-of-setlist case).

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
