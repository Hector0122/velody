## Why

The `songs:list` IPC handler builds the library list by looping over every entry in
the stems root directory with a sequential `for...of` + `await stat(dir)` +
`await readdir(dir)` per song, one song at a time. Each song's directory costs two
sequential filesystem round-trips before moving to the next song, so the list screen's
load time scales linearly with library size for no reason — every song's `stat`/
`readdir` pair is independent of every other song's.

## What Changes

- Scan all song directories concurrently with `Promise.all` instead of sequentially
  awaiting `stat`/`readdir` per song in a loop, so total scan time is bounded by the
  slowest single song directory rather than the sum of all of them.
- No change to the returned `SongItem[]` shape, sort order, or filtering logic (still
  only directories containing at least one recognized stem file are included).

## Capabilities

### New Capabilities
- `song-library-listing`: How the app enumerates the local song/stems library for
  display, including which entries are included and how they're ordered.

### Modified Capabilities
(none — `openspec/specs/` has no existing capabilities yet)

## Impact

- `src/main/ipc/handlers.ts`: the `songs:list` handler's directory-scan loop.
- No IPC contract, renderer, or on-disk format changes.
