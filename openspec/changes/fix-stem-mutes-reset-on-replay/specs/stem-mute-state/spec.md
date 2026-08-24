## Purpose

Defines how each stem's active/muted state behaves across starting,
stopping, and restarting playback, so manual mute choices aren't silently
undone by the normal stop/replay workflow.

## ADDED Requirements

### Requirement: Mute state survives stopping and restarting playback
Muting or unmuting a stem SHALL persist across stopping playback and
starting it again within the same session, including via the main Play
control and the Restart control.

#### Scenario: Muting a stem, stopping, and pressing Play again
- **WHEN** the user mutes one or more stems, stops playback, and presses
  Play again
- **THEN** the previously muted stems SHALL remain muted
- **AND** the previously active stems SHALL remain active

#### Scenario: Restarting a song with some stems muted
- **WHEN** the user mutes one or more stems and uses Restart
- **THEN** playback SHALL resume from the restart position with the same
  mute state as before Restart was pressed

### Requirement: New or never-touched stems default to active
A stem with no prior explicit active/muted state (most commonly, the very
first time a song is played, or a stem that was just added — e.g. via
recording) SHALL default to active when playback starts.

#### Scenario: First time playing a freshly opened song
- **WHEN** a song is opened and played for the first time in the session,
  with no stems muted yet
- **THEN** every stem SHALL play (default active), matching today's
  behavior

#### Scenario: A new stem is added mid-session
- **WHEN** a new stem (e.g. a recording) is added to the song while other
  stems already have explicit mute state
- **THEN** the new stem SHALL default to active
- **AND** the existing stems' mute state SHALL be unaffected
