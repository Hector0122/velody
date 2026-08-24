## Why

The sidebar's "Recent Songs" list (`Home.tsx`) renders every song returned by
`listSongs()` with no way to filter it. With a handful of songs during
development this was fine, but the user's real library has 100+ songs and,
during live use, they have to scroll and read through the whole list one entry
at a time to find the song they need next — slow and error-prone in a live
setting where they need to switch songs quickly between sets.

## What Changes

- Add a search input at the top of the Recent Songs section in the sidebar.
- Filter the rendered song list to entries whose name matches the search text
  (case-insensitive substring match), live as the user types.
- No matches: show a small "No songs found" message instead of an empty list.
- Clearing the search restores the full list. The search does not affect the
  Queue section, which is unrelated to the song library.
- Purely a renderer-side filter over the already-loaded `recentSongs` array —
  no IPC or backend changes, since `listSongs()` already returns the full list
  up front and `SongItem` only has `name`/`stems`.

## Capabilities

### New Capabilities
- `song-list-search`: How the sidebar's song list can be filtered by name to
  find a song quickly in a large library.

### Modified Capabilities
(none — `openspec/specs/` has no existing capabilities yet)

## Impact

- `src/renderer/src/pages/Home.tsx`: add search input state and a filtered
  view of `recentSongs` for rendering.
- No IPC, backend, or on-disk format changes.
