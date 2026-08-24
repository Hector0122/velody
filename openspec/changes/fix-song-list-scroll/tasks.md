## 1. Constrain the layout to the viewport

- [x] 1.1 In `Home.tsx`, change the root `<div>` from `min-h-screen flex` to
      `h-screen flex overflow-hidden` (or equivalent) so it can no longer grow
      taller than the viewport.
- [x] 1.2 Verify the `<aside>` sidebar and `<main>` content area both correctly
      stretch to fill the now-fixed-height root without introducing their own
      unwanted scrollbars (e.g. `<main>` may need `overflow-y-auto` of its own
      if `StemPlayer` content can already exceed the viewport — check current
      behavior before changing it). Confirmed `StemGrid` has no internal
      scroll of its own (`contentHeight = rowCount * ROW_HEIGHT`, grows with
      item count), so it relied on page-level scroll before this change —
      `<main>` now gets its own `overflow-y-auto` to keep that working
      independently of the sidebar.
- [x] 1.3 Confirm the existing `flex-1 overflow-y-auto` on the Recent Songs
      container now produces an internal scrollbar once entries overflow,
      with no further class changes needed there.

## 2. Manual verification

- [ ] 2.1 Run `pnpm dev` with a library of 100+ songs (or temporarily stub
      `listSongs` to return many entries), confirm scrolling the sidebar list
      does not move the header, "+ New Song" button, Queue section, or main
      content area.
- [ ] 2.2 Confirm a small library (a handful of songs) still renders with no
      scrollbar and no visual regression.
- [ ] 2.3 Confirm the Queue section, when populated, still displays correctly
      above the Recent Songs list and doesn't get clipped.
