## 1. Add search state and filtering

- [ ] 1.1 In `Home.tsx`, add a `searchQuery` string state (default `''`).
- [ ] 1.2 Derive a `filteredSongs` list via `useMemo` over `recentSongs` and
      `searchQuery`: case-insensitive substring match on `song.name`; return
      `recentSongs` unchanged when `searchQuery` is empty.
- [ ] 1.3 Render `filteredSongs` instead of `recentSongs` in the Recent Songs
      list `.map(...)`.

## 2. Search input UI

- [ ] 2.1 Add a text `<input>` above the "Recent Songs" heading (or replacing
      it inline), styled consistently with the sidebar (matching the existing
      `bg-neutral-900`/`border-neutral-800` treatment used elsewhere), bound to
      `searchQuery`.
- [ ] 2.2 Add a clear ("✕") affordance inside/next to the input when
      `searchQuery` is non-empty, matching the pattern already used for the
      per-song delete button.
- [ ] 2.3 When `filteredSongs.length === 0` and `searchQuery` is non-empty,
      render a "No songs found" message in place of the list.

## 3. Tests

- [ ] 3.1 Add a test (or extend an existing `Home.tsx`-adjacent test if one
      exists, otherwise a new lightweight render test) covering: typing a
      query narrows the list to matching names; clearing the query restores
      the full list; a query matching nothing shows the empty-state message;
      the match is case-insensitive.

## 4. Manual verification

- [ ] 4.1 Run `pnpm dev` with a library of 100+ songs (or stub `listSongs`),
      confirm typing progressively narrows the list and the delete/select
      buttons on filtered results still work correctly.
