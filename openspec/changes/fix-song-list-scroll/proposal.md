## Why

`Home.tsx`'s sidebar (`<aside>`) is a flex child of a `min-h-screen flex` root
`<div>`. `min-h-screen` only sets a *minimum* height — it does not cap the root's
height at the viewport. The "Recent Songs" list inside the sidebar already has
`flex-1 overflow-y-auto`, but that class only produces an internal scrollbar when
its own box is height-constrained. Because nothing above it in the tree has a
*fixed* height, once the sidebar's content (queue + recent songs) is taller than
the viewport, the root `<div>` and the `<aside>` both grow to fit it instead of
clipping, so `overflow-y-auto` never activates — the whole window scrolls instead
of just the list. This was fine with a handful of songs during development, but
the user hit it live with a real library (100+ songs) and had to scroll the
entire app, including re-hiding the header, to reach songs further down the list.

## What Changes

- Cap the app's root layout at the viewport height (`h-screen` instead of
  `min-h-screen`, or an equivalent fixed-height + `overflow-hidden` container) so
  flex children are height-constrained instead of growing past the viewport.
- With that constraint in place, the existing `flex-1 overflow-y-auto` on the
  "Recent Songs" container in `Home.tsx` will scroll internally as intended — the
  header, "+ New Song" button, and Queue section stay pinned, and only the song
  list itself scrolls when it overflows.
- No change to which songs are listed, their order, or any other sidebar
  behavior — this is a layout/CSS fix, not a data or logic change.

## Capabilities

### New Capabilities
- `song-list-scroll`: How the sidebar's song list is contained and scrolled when
  it has more entries than fit in the viewport.

### Modified Capabilities
(none — `openspec/specs/` has no existing capabilities yet)

## Impact

- `src/renderer/src/pages/Home.tsx`: root layout `<div>` and `<aside>` height
  classes; no logic changes.
- Purely visual/CSS — no IPC, backend, or data-shape changes.
