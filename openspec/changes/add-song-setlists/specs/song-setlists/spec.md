## Purpose

Defines named, ordered, persisted groups of songs ("setlists") that let the
user prepare a show's exact song order ahead of time and move through it
quickly during a live performance.

## ADDED Requirements

### Requirement: Setlists can be created, renamed, and deleted
The user SHALL be able to create a new named setlist, rename an existing
one, and delete one.

#### Scenario: Creating a setlist
- **WHEN** the user creates a new setlist with a name
- **THEN** an empty, named setlist SHALL be created and available for
  adding songs

#### Scenario: Deleting a setlist
- **WHEN** the user deletes a setlist
- **THEN** the setlist SHALL no longer appear in the setlists view
- **AND** no songs or their data SHALL be affected by the deletion

### Requirement: Setlists persist across app restarts
Setlists SHALL be stored so they survive closing and reopening the app.

#### Scenario: Reopening the app after creating a setlist
- **WHEN** the user creates a setlist, adds songs to it, and restarts the
  app
- **THEN** the setlist and its songs, in the same order, SHALL still be
  present

### Requirement: Songs can be added to and removed from a setlist
The user SHALL be able to add any song from the library to a setlist, and
remove any song from a setlist.

#### Scenario: Adding a library song to a setlist
- **WHEN** the user adds a song from the library to a setlist
- **THEN** that song SHALL appear in the setlist, at the end of its current
  order

#### Scenario: Removing a song from a setlist
- **WHEN** the user removes a song from a setlist
- **THEN** the song SHALL no longer appear in that setlist
- **AND** the song and its data SHALL remain unaffected in the library

### Requirement: Songs within a setlist can be reordered
The user SHALL be able to change the order of songs within a setlist.

#### Scenario: Moving a song earlier in the setlist
- **WHEN** the user moves a song up or down within a setlist
- **THEN** the setlist's song order SHALL update to reflect the move
- **AND** the new order SHALL persist across app restarts

### Requirement: A setlist can be viewed and played in order
Selecting a setlist SHALL show its songs in set order, distinct from the
full library list, and let the user open any song from it.

#### Scenario: Selecting a setlist
- **WHEN** the user selects a setlist in the sidebar
- **THEN** the sidebar SHALL show only that setlist's songs, in set order,
  instead of the full library list
- **AND** the full library SHALL remain reachable (e.g. via a toggle back
  to the library view)

### Requirement: The next song in an active setlist can be reached directly
While the currently open song was reached via an active setlist, the user
SHALL be able to advance directly to the next song in that setlist's order.

#### Scenario: Advancing to the next song
- **WHEN** a song from an active setlist is open and the user selects "Next
  song"
- **THEN** the next song in the setlist's order SHALL open

#### Scenario: Advancing from the last song in the setlist
- **WHEN** the currently open song is the last one in the active setlist
- **THEN** no further "Next song" advancement SHALL be available (or it
  SHALL be clearly indicated as the end of the setlist)

### Requirement: Deleting a song removes it from any setlists
Deleting a song from the library SHALL also remove it from every setlist
that references it, leaving no dangling reference.

#### Scenario: Deleting a song that is in a setlist
- **WHEN** the user deletes a song that appears in one or more setlists
- **THEN** that song SHALL no longer appear in any of those setlists
- **AND** the rest of each affected setlist's order SHALL be unchanged
