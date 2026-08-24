## Purpose

Defines a persisted, per-song metronome count-in that plays before playback
starts from a stopped state, so the performer has a predictable lead-in
before a song's first beat instead of it starting cold.

## ADDED Requirements

### Requirement: Count-in setting is OFF, 1 bar, or 2 bars, per song
Each song SHALL have an independent count-in setting with exactly three
states: off, 1 bar, or 2 bars.

#### Scenario: Selecting a count-in length
- **WHEN** the user selects OFF, 1 bar, or 2 bars for a song's count-in
- **THEN** that setting SHALL apply the next time playback starts from
  stopped for that song

#### Scenario: Song with no count-in configured
- **WHEN** a song has never had a count-in setting chosen
- **THEN** it SHALL behave as OFF (playback starts immediately, unchanged
  from today)

### Requirement: Count-in setting persists per song
The count-in setting SHALL be stored per song and SHALL survive closing and
reopening the song, including after restarting the app.

#### Scenario: Reopening a song after setting count-in
- **WHEN** the user sets a song's count-in to 1 or 2 bars, then closes and
  reopens that song (including after restarting the app)
- **THEN** the previously selected count-in setting SHALL still apply

### Requirement: Count-in plays before playback starts from stopped
When a song's count-in is enabled and the user starts playback from a
stopped state via the main Play control, the system SHALL play the
configured number of metronome click bars, at the song's current BPM,
before audio playback begins.

#### Scenario: Starting playback with count-in enabled
- **WHEN** playback is stopped, the song's count-in is set to 1 or 2 bars,
  and the user presses Play
- **THEN** the system SHALL schedule 4 (1 bar) or 8 (2 bars) metronome
  clicks at the song's BPM
- **AND** actual song playback SHALL NOT begin until all scheduled clicks
  have played

#### Scenario: Starting playback with count-in off
- **WHEN** playback is stopped and the song's count-in is OFF
- **THEN** playback SHALL begin immediately when Play is pressed, with no
  click count-in, matching today's behavior

### Requirement: Count-in shows an on-screen countdown
While a count-in is playing, the system SHALL display a live countdown
reflecting the number of clicks remaining.

#### Scenario: 2-bar count-in in progress
- **WHEN** a 2-bar count-in is playing
- **THEN** the displayed countdown SHALL tick down once per click, from 8
  down to 1, in sync with each click

### Requirement: Count-in can be cancelled before playback begins
The user SHALL be able to cancel an in-progress count-in, preventing
playback from starting.

#### Scenario: Cancelling during count-in
- **WHEN** the user presses Stop (or the equivalent control) while a
  count-in is playing
- **THEN** no further clicks SHALL play
- **AND** song playback SHALL NOT begin
