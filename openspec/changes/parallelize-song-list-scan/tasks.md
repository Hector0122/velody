## 1. Parallelize the directory scan

- [x] 1.1 In `songs:list`'s handler, replace the sequential `for (const entry of entries) { ...await stat...; ...await readdir... }` loop with a `Promise.all` over `entries.map(...)` that, for each entry, does the `stat` + (if a directory) `readdir` + stem-filtering concurrently with every other entry, returning `SongItem | null` per entry.
- [x] 1.2 Filter out the `null` results (non-directories, or directories with zero recognized stems) after the `Promise.all` resolves, preserving today's inclusion rule.
- [x] 1.3 Keep the existing `result.sort((a, b) => b.name.localeCompare(a.name))` sort applied after gathering all results, so final order is unaffected by scan concurrency.

## 2. Tests

- [x] 2.1 Add/extend a test for `songs:list` (or the underlying scan logic if it's extracted to a testable function) covering: multiple valid song directories are all included; a directory with no recognized stems is excluded; a non-directory entry is excluded; results remain sorted by name descending regardless of scan completion order.

## 3. Manual verification

- [ ] 3.1 Run `pnpm dev` with a library containing several separated songs, open the song list, and confirm the same songs/stems appear in the same order as before.
