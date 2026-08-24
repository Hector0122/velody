## 1. Add search state and filtering

- [x] 1.1 In `Home.tsx`, add a `searchQuery` string state (default `''`).
      Named `songSearch` in the implementation.
- [x] 1.2 Derive a `filteredSongs` list via `useMemo` over `recentSongs` and
      `searchQuery`: case-insensitive substring match on `song.name`; return
      `recentSongs` unchanged when `searchQuery` is empty. Extracted as a
      standalone `filterSongsByQuery` in `utils.ts` (matching this repo's
      existing convention of pulling logic out for direct unit testing,
      rather than testing it only through a component render) instead of
      an inline `useMemo` body.
- [x] 1.3 Render `filteredSongs` instead of `recentSongs` in the Recent Songs
      list `.map(...)`.

## 2. Search input UI

- [x] 2.1 Add a text `<input>` above the "Recent Songs" heading (or replacing
      it inline), styled consistently with the sidebar (matching the existing
      `bg-neutral-900`/`border-neutral-800` treatment used elsewhere), bound to
      `searchQuery`. Moved the heading+input into their own non-scrolling
      block above the scrollable list (mirrors the Queue section's fixed
      placement from `fix-song-list-scroll`) so the search box doesn't
      scroll out of view while the list below it scrolls.
- [x] 2.2 Add a clear ("✕") affordance inside/next to the input when
      `searchQuery` is non-empty, matching the pattern already used for the
      per-song delete button.
- [x] 2.3 When `filteredSongs.length === 0` and `searchQuery` is non-empty,
      render a "No songs found" message in place of the list. (Also shows
      "No songs yet" for an empty library with no search query, a small
      extra empty-state improvement in the same spot.)

## 3. Tests

- [x] 3.1 Add a test (or extend an existing `Home.tsx`-adjacent test if one
      exists, otherwise a new lightweight render test) covering: typing a
      query narrows the list to matching names; clearing the query restores
      the full list; a query matching nothing shows the empty-state message;
      the match is case-insensitive. Implemented as unit tests on the
      extracted `filterSongsByQuery` in `utils.test.ts` rather than a
      component render test — this repo's `vitest.config.ts` only includes
      `*.test.ts` (no `.tsx`) and has no existing component-render test
      precedent to extend; the extraction in 1.2 makes the filtering logic
      itself fully covered without needing to introduce that new test
      infrastructure for one feature.

## 4. Manual verification

- [ ] 4.1 Run `pnpm dev` with a library of 100+ songs (or stub `listSongs`),
      confirm typing progressively narrows the list and the delete/select
      buttons on filtered results still work correctly.
