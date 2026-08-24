## Context

See proposal.md — Why. Relevant existing pieces, established by direct code
reading (not assumption):

- `SongItem { name: string; stems: string[] }` (`shared/types.ts`) is the
  only existing "song" shape; `scanSongsLibrary` (`handlers.ts`) derives it
  fresh from the filesystem every call (`songs:list`) — there is no
  persisted, app-owned list of songs today, only what's currently on disk
  under `output/stems/`.
- `getStemsRootDir()` (`handlers.ts`) resolves to `output/stems` in dev and
  `<userData>/output/stems` when packaged. There is no existing sibling
  file at the `output/` level — this proposal introduces the first one.
- `song:saveMeta`/`song:loadMeta` write/read one JSON file *per song
  directory* (`.velody`). That pattern fits per-song data (BPM, key, and
  per `add-song-trim-points`/`add-song-count-in`, trim/count-in settings)
  but doesn't fit a setlist, which is a collection spanning many songs and
  needs to exist even before/after any specific song directory does.
- `Home.tsx`'s sidebar (`<aside>`) currently renders exactly one list
  (`recentSongs.map(...)`) with select/delete per row — no concept of
  switching between multiple lists or views exists yet. `add-song-list-
  search` (a separate proposal) adds filtering to this same list but
  doesn't change its single-list structure.
- `song:delete` (`handlers.ts`) removes the song's directory from disk and
  returns `{ success, error? }`; `Home.tsx`'s `handleDeleteSong` then prunes
  its own `recentSongs`/`jobQueue` state. There is currently nothing else
  that references a song by name that would need pruning when a song is
  deleted — this proposal adds the first such thing (setlists).

## Goals / Non-Goals

**Goals:**
- Let the user prepare an exact show order once, ahead of time, and have it
  persist indefinitely (same "prepared once, still there on show day"
  requirement the user raised for trim points, which applies identically
  here — arguably more so, since a setlist *is* the show).
- Make it fast to move through a prepared setlist live — one action to
  advance to the next song — rather than returning to a search/scroll flow
  between every song.
- Never duplicate or risk song data: a setlist is purely an ordered list of
  name references into the existing library, never a copy.

**Non-Goals:**
- Drag-and-drop reordering. Every existing ordering interaction in this app
  (loop A/B marker assignment) is click/button-driven, not drag-based; move-
  up/move-down buttons are simpler to implement correctly and consistent
  with that precedent. A drag handle is a reasonable v2 if move-up/down
  proves too slow for large setlists in practice.
- Multiple setlists "active" at once, or nesting setlists. One setlist is
  selected/active at a time in the sidebar.
- Per-song overrides scoped to a specific setlist (e.g., "different trim
  points when this song is played in setlist A vs. setlist B"). Trim
  points/count-in/BPM stay properties of the *song*, not of a
  song-within-a-setlist; a setlist only orders references.
- Cloud sync or sharing setlists between machines/users. Purely a local
  JSON file, consistent with the project's local-first design.
- Auto-advancing to the next song when the current one finishes playing.
  The user asked to "dejarlas listas" (have them ready/queued) and to move
  between songs quickly — an explicit "Next song" action is the safer
  default (auto-advance mid-show with no confirmation is a bigger behavior
  change and easy to add later if actually wanted).

## Decisions

- **Storage: a single `output/setlists.json` file, not one file per
  setlist and not folded into any song's `.velody`.** A setlist spans many
  songs and needs to exist independent of any one song's directory, so it
  can't live in a per-song sidecar. A single combined file (versus one file
  per setlist) is simpler for the expected scale — a handful of setlists,
  each tens of songs — and avoids inventing a directory-of-files pattern
  for what's realistically a few KB of JSON total. Shape:
  ```json
  { "setlists": [ { "id": "uuid", "name": "Show 8/24", "songNames": ["...", "..."], "updatedAt": 1234567890 } ] }
  ```
  `songNames` (not full `SongItem`s) — a setlist stores references only;
  the actual song data is always re-derived from `songs:list` at render
  time, so a setlist can never itself go stale/wrong about a song's stems.
- **New IPC handlers (`setlists:list`, `setlists:save`,
  `setlists:delete`), read-modify-write the whole file per call — same
  pattern as `song:saveMeta`'s merge-and-rewrite, just at the file level
  instead of per-song.** No need for a more granular update API; setlist
  files are small and edits are infrequent (prep time, not per-frame).
- **`song:delete` additionally prunes the deleted song's name from every
  setlist's `songNames`.** Otherwise a deleted song leaves a dangling
  reference that would render awkwardly (a setlist row for a song that no
  longer exists). Pruning happens in the same handler, after the directory
  removal succeeds, keeping "delete a song" atomic from the user's
  perspective — they don't need to separately clean up setlists.
- **Sidebar gets a mode toggle between "Library" (today's
  `recentSongs`/search list) and "Setlists"**, rather than merging setlists
  into the existing list or replacing it. The two are genuinely different
  views (all songs vs. one prepared subset in a specific order) and users
  will want to search/browse the full library even while a setlist is
  selected (e.g., to add one more song to it), so neither should hide the
  other permanently.
- **"Next song" only appears when the currently open song was reached via
  an active setlist**, and simply loads the next `songNames` entry the same
  way `handleSelectRecent` loads any song today (finds it in `songs:list`'s
  result, sets `currentSong`). If the next name in the setlist no longer
  exists in the library (deleted outside the prune path, e.g. manually from
  disk), "Next song" skips it and shows a toast, rather than failing
  silently.

## Risks / Trade-offs

- [Two independent sources of truth — the filesystem-derived song list and
  the setlist's `songNames` references — could drift if a song is renamed
  by editing the filesystem directly outside the app] → Accepted: the app
  has no rename feature for songs today, so this can only happen via manual
  filesystem edits outside the app's control, same class of risk the
  existing `.velody` sidecars already have (keyed by directory name).
- [`output/setlists.json` corruption (e.g., app killed mid-write) could lose
  all setlists at once, unlike per-song `.velody` files where damage is
  contained to one song] → Mitigated by writing to a temp file and renaming
  over the target (atomic on the same filesystem), same safety property
  worth applying here even though the existing `.velody` writes don't do
  this today — call out in tasks.md as a small deliberate improvement over
  the existing pattern, not a regression.

## Migration Plan

No migration needed — this is wholly new, additive state. No
`output/setlists.json` file existing is treated as "zero setlists," not an
error.
