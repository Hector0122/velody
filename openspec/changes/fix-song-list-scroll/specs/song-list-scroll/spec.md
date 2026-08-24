## Purpose

Defines how the sidebar's song list is contained and scrolled, so that a long
library (many songs) never causes the whole application window to scroll.

## ADDED Requirements

### Requirement: Sidebar height is capped to the viewport
The application's root layout SHALL constrain the sidebar to the viewport
height rather than letting it grow to fit its content.

#### Scenario: Sidebar content taller than the viewport
- **WHEN** the combined height of the "+ New Song" button, Queue section, and
  Recent Songs list exceeds the viewport height
- **THEN** the sidebar's outer bounds SHALL remain clipped to the viewport
  instead of pushing the window's total height beyond it

### Requirement: Only the song list scrolls
When the Recent Songs list overflows its available height, only that list
SHALL scroll — the header, "+ New Song" button, Queue section, and the main
content area SHALL stay fixed in place.

#### Scenario: Scrolling through a long library
- **WHEN** the user scrolls (mouse wheel, trackpad, or scrollbar drag) while
  the pointer is over the Recent Songs list
- **THEN** only the Recent Songs list SHALL scroll, revealing songs further
  down the list
- **AND** the header, "+ New Song" button, and Queue section SHALL remain
  visible and unscrolled
- **AND** the main content area (song player) SHALL be unaffected

#### Scenario: Short library, no scrolling needed
- **WHEN** the Recent Songs list has few enough entries to fit within the
  available sidebar height
- **THEN** no scrollbar SHALL appear and the list SHALL render exactly as it
  does today
