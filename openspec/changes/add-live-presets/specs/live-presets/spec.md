## Purpose

Defines named, per-song "ready to play" mix snapshots — mute state, stem
volume/pan, metronome on/off, and master volume — that can be saved,
recalled, and are automatically re-applied when the song is reopened, so a
song configured for live performance doesn't need to be reconfigured by
hand every session.

## ADDED Requirements

### Requirement: User can save the current mix as a named preset
The user SHALL be able to save the current mute state, stem volumes, stem
pans, metronome on/off state, and master volume as a named preset
associated with the current song.

#### Scenario: Saving a new preset
- **WHEN** the user configures the mix (mutes, volumes, pans, metronome
  on/off, master volume) and saves it under a name that doesn't already
  exist for this song
- **THEN** a new preset SHALL be created with that name, capturing the
  current values

#### Scenario: Saving under an existing name updates it in place
- **WHEN** the user saves a preset under a name that already exists for
  this song
- **THEN** that existing preset's values SHALL be updated to the current
  state
- **AND** no additional/duplicate preset SHALL be created

### Requirement: User can recall a saved preset
The user SHALL be able to apply any saved preset for the current song,
restoring its mute/volume/pan/metronome/master-volume state.

#### Scenario: Applying a preset
- **WHEN** the user selects a saved preset
- **THEN** every stem's mute state, volume, and pan SHALL be set to that
  preset's saved values
- **AND** the metronome on/off state and master volume SHALL be set to
  that preset's saved values

#### Scenario: Applying a preset during playback
- **WHEN** the user selects a different preset while the song is currently
  playing
- **THEN** the mix SHALL transition to that preset's values without
  needing playback to be stopped first

### Requirement: The most recently used preset is applied automatically on open
Reopening a song that has a saved preset SHALL apply the most recently
used preset automatically, without requiring the user to select it again.

#### Scenario: Reopening a song with one saved preset
- **WHEN** the user saves a preset, closes the song, and reopens it later
- **THEN** that preset's mix state SHALL already be applied when the song
  finishes loading, with no action required from the user

#### Scenario: Reopening a song with multiple presets
- **WHEN** a song has multiple saved presets and the user most recently
  applied a specific one
- **THEN** reopening the song SHALL apply that specific preset, not an
  arbitrary or the first one

#### Scenario: A song with no saved presets
- **WHEN** a song has never had a preset saved for it
- **THEN** opening it SHALL behave exactly as it does today — no preset is
  applied, the mix starts at its ordinary defaults

### Requirement: User can delete a saved preset
The user SHALL be able to delete a preset they no longer want.

#### Scenario: Deleting the currently active preset
- **WHEN** the user deletes the preset that is currently applied
- **THEN** the preset SHALL no longer be available to select
- **AND** the song SHALL no longer auto-apply it the next time it's opened
